import { db } from './db_manager.js';

export class ProcessingManager {
    constructor(fileSystem) {
        this.fs = fileSystem;
        this.isRunning = false;
        this.isPaused = false;
        this.aborted = false;

        // Worker State
        this.worker = null;
        this.workerReady = false;

        // Session State
        this.allImages = [];
        this.processedPaths = new Set();
        this.excludedPaths = new Set();
        this.refreshInterval = 20;

        // Callbacks
        this.onProgress = null;
        this.onClusterUpdate = null;

        // Optimization
        this.batchSize = 4;
        this.lastUiUpdate = 0;
        this.memoryEmbeddings = null;

        this.pendingBatchResolve = null;
    }

    async loadModel() {
        if (this.worker) return;

        if (this.onProgress) this.onProgress({ currentAction: "⚡ Initializing AI Worker..." });
        console.log("%c[ProcessingManager] Initializing AI Worker...", "color: #3f51b5; font-weight: bold;");
        this.worker = new Worker('js/ai_worker.js', { type: 'module' });

        return new Promise((resolve) => {
            this.worker.onmessage = (e) => {
                const { status, backend, device, embeddings, error, time } = e.data;

                if (status === 'ready') {
                    console.info(`%c[Hardware Check] Worker Ready! Backend: ${backend} | Device: ${device}`, "color: #3b82f6; font-weight: bold; border: 1px solid #3b82f6; padding: 2px 5px;");
                    this.workerReady = true;
                    resolve();
                } else if (status === 'success') {
                    if (this.pendingBatchResolve) {
                        this.pendingBatchResolve(embeddings);
                        this.pendingBatchResolve = null;
                    }
                } else if (status === 'error') {
                    console.error("AI Worker Error:", error);
                    if (this.pendingBatchResolve) {
                        this.pendingBatchResolve([]);
                        this.pendingBatchResolve = null;
                    }
                }
            };

            this.worker.postMessage({
                action: 'init',
                payload: { debug: true }
            });
        });
    }

    async start(refreshInterval = 20) {
        this.refreshInterval = refreshInterval;
        if (!this.workerReady) await this.loadModel();

        // 1. Scan Files
        if (this.onProgress) this.onProgress({ currentAction: "🔍 Scanning folder for images..." });
        console.log("%c[ProcessingManager] Scanning files...", "color: #3f51b5;");
        this.allImages = await this.fs.scanAllImagesRecursive();

        // 2. Resume Logic (Using IndexedDB instead of files)
        const manifest = await db.getManifest();
        const existingEmbeddings = await db.getEmbeddings();

        if (manifest && manifest.excludedImages) {
            manifest.excludedImages.forEach(p => this.excludedPaths.add(p));
        }

        if (existingEmbeddings.length > 0) {
            this.memoryEmbeddings = existingEmbeddings;
            existingEmbeddings.forEach(e => this.processedPaths.add(e.path));
            if (this.onClusterUpdate) this.onClusterUpdate(existingEmbeddings);
        }

        // 3. Start Loop
        this.isRunning = true;
        this.isPaused = false;
        this.aborted = false;
        this.sessionStartTime = Date.now();
        this.processLoop();
    }

    async processLoop() {
        let sessionProcessedCount = 0;
        let pendingEmbeddings = [];

        let unprocessed = this.allImages.filter(img => !this.processedPaths.has(img.path));
        console.log(`%c[ProcessingManager] Loop started with ${unprocessed.length} items.`, "color: #3f51b5; font-weight: bold;");

        while (this.isRunning && !this.aborted) {
            if (this.isPaused) {
                await new Promise(r => setTimeout(r, 500));
                continue;
            }

            if (unprocessed.length === 0) {
                this.isRunning = false;
                if (this.onProgress) this.onProgress({ completed: true });
                return;
            }

            const currentBatchSize = Math.min(this.batchSize, unprocessed.length);
            const batchImages = [];
            for (let i = 0; i < currentBatchSize; i++) {
                const randIndex = Math.floor(Math.random() * unprocessed.length);
                batchImages.push(unprocessed.splice(randIndex, 1)[0]);
            }

            try {
                const firstName = batchImages[0].path.split('/').pop();

                // Offload entirely to worker
                const embeddings = await this.processBatch(batchImages);

                if (!embeddings || embeddings.length === 0) {
                    console.error("[Processing] AI Worker returned empty embeddings or error. Skipping this batch.");
                    continue;
                }

                for (let i = 0; i < batchImages.length; i++) {
                    pendingEmbeddings.push({
                        id: Date.now() + Math.random(),
                        path: batchImages[i].path,
                        embedding: embeddings[i]
                    });
                    this.processedPaths.add(batchImages[i].path);
                    sessionProcessedCount++;
                }

                if (pendingEmbeddings.length >= this.refreshInterval || unprocessed.length === 0) {
                    if (this.onProgress) {
                        this.onProgress({
                            processed: this.processedPaths.size,
                            total: this.allImages.length,
                            currentAction: `💾 Syncing ${pendingEmbeddings.length} items to Database...`
                        });
                    }

                    // Memory-first optimization + DB Persistence
                    if (!this.memoryEmbeddings) this.memoryEmbeddings = [];
                    this.memoryEmbeddings = this.memoryEmbeddings.concat(pendingEmbeddings);

                    // Structured DB Save (No heavy file writing)
                    await db.upsertEmbeddings(pendingEmbeddings);
                    await db.saveManifest({
                        processedCount: this.memoryEmbeddings.length,
                        totalImagesFound: this.allImages.length,
                        excludedImages: Array.from(this.excludedPaths)
                    });

                    if (this.onClusterUpdate) {
                        if (this.onProgress) this.onProgress({ currentAction: "🧩 Re-calculating clusters..." });
                        await this.onClusterUpdate(this.memoryEmbeddings);
                    }
                    pendingEmbeddings = [];
                }

                const now = Date.now();
                if (this.onProgress && (now - this.lastUiUpdate > 800 || unprocessed.length === 0)) {
                    const sessionElapsed = now - this.sessionStartTime;
                    const speedSec = (sessionElapsed / sessionProcessedCount) / 1000;
                    const eta = (speedSec * 1000) * unprocessed.length;

                    this.onProgress({
                        processed: this.processedPaths.size,
                        total: this.allImages.length,
                        speed: speedSec,
                        eta: eta,
                        completed: false,
                        currentAction: `🧠 Analyzing: ${firstName}${batchImages.length > 1 ? ` (+${batchImages.length - 1} more)` : ''}`
                    });
                    this.lastUiUpdate = now;
                }
            } catch (err) {
                console.error("Batch error:", err);
            }

            await new Promise(r => setTimeout(r, 20)); // Small yield
        }
    }

    async processBatch(batch) {
        return new Promise((resolve) => {
            this.pendingBatchResolve = resolve;
            // Send handles directly! They are transferable.
            this.worker.postMessage({
                action: 'process',
                payload: batch
            });
        });
    }

    pause() { this.isPaused = true; }
    resume() { this.isPaused = false; }
    stop() { this.isRunning = false; this.aborted = true; }
}
