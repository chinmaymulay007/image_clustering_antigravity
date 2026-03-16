import { db } from './db_manager.js';
import { wakeLockManager } from './wake_lock.js';
import { backgroundKeepAlive } from './background_keep_alive.js';

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

        if (this.onProgress) this.onProgress({ currentAction: "🧠 Initializing AI Worker..." });
        console.log("[ProcessingManager] Initializing AI Worker...");
        this.worker = new Worker('js/ai_worker.js', { type: 'module' });

        return new Promise((resolve) => {
            this.worker.onmessage = (e) => {
                const { status, backend, device, embeddings, error, time } = e.data;

                if (status === 'ready') {
                    //console.info(`%c[Hardware Check] Worker Ready! Backend: ${backend} | Device: ${device}`, "color: #3b82f6; font-weight: bold; border: 1px solid #3b82f6; padding: 2px 5px;");
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
                payload: { debug: false }
            });
        });
    }

    async start(refreshInterval = 20) {
        this.refreshInterval = refreshInterval;
        // Deferred loading: We don't load model here instantly anymore.

        // 1. Scan Files
        if (this.onProgress) this.onProgress({ currentAction: "🔍 Scanning folder for images..." });
        console.log("[ProcessingManager] Scanning files...");
        this.allImages = await this.fs.scanAllImagesRecursive();

        // 2. Resume Logic (Using IndexedDB instead of files)
        const manifest = await db.getManifest();
        const existingEmbeddings = await db.getEmbeddings();

        if (manifest && manifest.excludedImages) {
            manifest.excludedImages.forEach(p => this.excludedPaths.add(p));
        }

        let hasData = false;
        if (existingEmbeddings.length > 0) {
            hasData = true;
            this.memoryEmbeddings = existingEmbeddings;
            existingEmbeddings.forEach(e => this.processedPaths.add(e.path));
            if (this.onClusterUpdate) this.onClusterUpdate(existingEmbeddings);
        }

        // 3. Start Loop
        this.isRunning = true;
        this.aborted = false;
        this.sessionStartTime = Date.now();

        // NEW: If we have existing data, we default to PAUSED (Manual Resume)
        // If we have NO data (fresh run), we AUTO-START.
        if (hasData) {
            this.isPaused = true;
            console.log("[Processing] Existing database found. PAUSED (Automatic) for user review.");
            if (this.onProgress) {
                this.onProgress({
                    processed: this.processedPaths.size,
                    total: this.allImages.length,
                    currentAction: "⏸️ Database loaded. Ready to resume."
                });
            }
        } else {
            this.isPaused = false;
            console.log("[Processing] Fresh run detected. RESUMED (Auto-Start)...");
            // Load immediately for fresh runs
            if (!this.workerReady) await this.loadModel();
        }

        this.processLoop();
    }

    async processLoop() {
        let sessionProcessedCount = 0;
        let pendingEmbeddings = [];

        let unprocessed = this.allImages.filter(img => !this.processedPaths.has(img.path));

        if (this.isPaused) {
            console.log(`%c[ProcessingManager] Analysis queue ready: ${unprocessed.length} items pending. Waiting for Resume...`, "color: #f59e0b;");
            wakeLockManager.release();
            backgroundKeepAlive.stop();
        } else {
            console.log(`[ProcessingManager] Analysis started for ${unprocessed.length} items.`);
            wakeLockManager.request();
            backgroundKeepAlive.start();
        }

        while (this.isRunning && !this.aborted) {
            if (this.isPaused) {
                if (this.onProgress) {
                    this.onProgress({
                        processed: this.processedPaths.size,
                        total: this.allImages.length,
                        currentAction: "⏸️ AI Processing Paused."
                    });
                }
                await new Promise(r => setTimeout(r, 500));
                continue;
            }

            // Lazy Load: Ensure model is ready before processing
            if (!this.workerReady) {
                await this.loadModel();
            }

            if (unprocessed.length === 0) {
                this.isRunning = false;
                wakeLockManager.release();
                backgroundKeepAlive.stop();
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

                // 1. Prepare batch 
                if (this.onProgress) {
                    this.onProgress({ currentAction: `🧠 AI Analyzing images...` });
                }

                const batchWithFiles = [];
                for (const img of batchImages) {
                    try {
                        if (!img.file) throw new Error("File object is missing from image metadata");

                        batchWithFiles.push({
                            ...img
                            // file is already attached
                        });
                    } catch (e) {
                        console.error(`%c[ProcessingManager] ❌ Error accessing file: ${img.path}`, "color: #ef4444; font-weight: bold;");
                        console.error(`Detail: ${e.message}`);
                        batchWithFiles.push({ ...img, file: null });

                        // Small yield on error to avoid rapid-fire failures
                        await new Promise(r => setTimeout(r, 100));
                    }
                }

                // 2. Offload entirely to worker
                const embeddings = await this.processBatch(batchWithFiles);

                if (!embeddings || embeddings.length === 0) {
                    console.error("[Processing] AI Worker returned empty embeddings or error. Skipping this batch.");
                    continue;
                }

                // 3. Extract Metadata (EXIF or fallback) for timeline clustering
                for (let i = 0; i < batchImages.length; i++) {
                    let file = batchWithFiles[i].file;
                    let metaTimestamp = file ? file.lastModified : Date.now();
                    let metaLat = null;
                    let metaLon = null;

                    if (file && window.exifr) {
                        try {
                            const exifData = await window.exifr.parse(file);
                            if (exifData) {
                                if (exifData.DateTimeOriginal) {
                                    metaTimestamp = new Date(exifData.DateTimeOriginal).getTime();
                                }
                                if (exifData.latitude !== undefined && exifData.longitude !== undefined) {
                                    metaLat = exifData.latitude;
                                    metaLon = exifData.longitude;
                                }
                            }
                        } catch (e) {
                            console.warn(`[ProcessingManager] EXIF extraction failed for ${batchImages[i].path}`, e);
                        }
                    }

                    pendingEmbeddings.push({
                        id: Date.now() + Math.random(),
                        path: batchImages[i].path,
                        embedding: embeddings[i],
                        timestamp: metaTimestamp,
                        lat: metaLat,
                        lon: metaLon
                    });
                    this.processedPaths.add(batchImages[i].path);
                    sessionProcessedCount++;
                }

                if (pendingEmbeddings.length >= this.refreshInterval || unprocessed.length === 0) {
                    if (this.onProgress && !this.isPaused) {
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

                    if (this.onClusterUpdate && !this.isPaused) {
                        if (this.onProgress) this.onProgress({ currentAction: "🧩 Re-calculating clusters..." });
                        await this.onClusterUpdate(this.memoryEmbeddings);
                    }
                    pendingEmbeddings = [];
                }

                const now = Date.now();
                if (this.onProgress && !this.isPaused && (now - this.lastUiUpdate > 800 || unprocessed.length === 0)) {
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

    pause() {
        this.isPaused = true;
        console.log("[Processing] PAUSED (Manual)");
    }
    resume() {
        this.isPaused = false;
        console.log("[Processing] RESUMED (Manual)");
        wakeLockManager.request();
        backgroundKeepAlive.start();
    }
    stop() {
        this.isRunning = false;
        this.aborted = true;
        wakeLockManager.release();
        backgroundKeepAlive.stop();
        console.log("[Processing] STOPPED");
    }
}
