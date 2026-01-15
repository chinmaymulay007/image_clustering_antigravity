
import { env, AutoProcessor, CLIPVisionModelWithProjection, RawImage } from './vendor/transformers.js';

export class ProcessingManager {
    constructor(fileSystem) {
        this.fs = fileSystem;
        this.isRunning = false;
        this.isPaused = false;
        this.aborted = false;

        // Model State
        this.processor = null;
        this.model = null;
        this.modelId = 'Xenova/clip-vit-base-patch16';

        // Session State
        this.allImages = []; // { path, handle } mechanism
        this.processedPaths = new Set();
        this.excludedPaths = new Set(); // Sync with App
        this.refreshInterval = 20; // Default

        // Callbacks
        this.onProgress = null; // (stats) => void
        this.onClusterUpdate = null; // (newEmbeddings) => void
    }

    async loadModel() {
        console.log("Loading CLIP model...");
        env.allowLocalModels = true;
        env.localModelPath = 'models/';
        env.allowRemoteModels = true;

        // Point to local WASM binaries for 100% offline mode
        // In Transformers.js v2, wasm is under backends.onnx
        if (env.backends && env.backends.onnx) {
            env.backends.onnx.wasm.wasmPaths = 'js/vendor/dist/';
        } else if (env.wasm) {
            env.wasm.wasmPaths = 'js/vendor/dist/';
        }

        this.processor = await AutoProcessor.from_pretrained(this.modelId);
        this.model = await CLIPVisionModelWithProjection.from_pretrained(this.modelId, {
            quantized: true, // User requested ONLY quantized
            device: 'webgpu' // Prefer WebGPU
            // Fallback to wasm is automatic in transformers.js if webgpu fails usually
        });
        console.log("CLIP model loaded.");
    }

    async start(refreshInterval = 20) {
        this.refreshInterval = refreshInterval;
        if (!this.model) await this.loadModel();

        // 1. Scan Files
        console.log("Scanning files...");
        this.allImages = await this.fs.scanAllImagesRecursive();
        console.log(`Found ${this.allImages.length} images.`);

        // 2. Load Existing Metadata (Resume capability)
        const manifest = await this.fs.readMetadata('manifest.json');
        const existingEmbeddings = await this.fs.readMetadata('embeddings.json') || [];

        if (manifest && manifest.excludedImages) {
            manifest.excludedImages.forEach(p => this.excludedPaths.add(p));
            console.log(`Loaded ${this.excludedPaths.size} excluded images.`);
        }

        if (existingEmbeddings.length > 0) {
            existingEmbeddings.forEach(e => this.processedPaths.add(e.path));
            console.log(`Resumed with ${this.processedPaths.size} already processed images.`);

            // Trigger initial update with existing data
            if (this.onClusterUpdate) {
                console.log("[ProcessingManager] Triggering initial cluster update with existing metadata...");
                this.onClusterUpdate(existingEmbeddings);
            }
        }

        // 3. Start Loop
        this.isRunning = true;
        this.isPaused = false;
        this.aborted = false;
        this.startTime = Date.now();
        this.sessionStartTime = Date.now();
        this.processLoop();
    }

    async processLoop() {
        let sessionProcessedCount = 0;
        let pendingEmbeddings = [];

        while (this.isRunning && !this.aborted) {
            if (this.isPaused) {
                await new Promise(r => setTimeout(r, 500));
                continue;
            }

            // Identify unprocessed images
            const unprocessed = this.allImages.filter(img => !this.processedPaths.has(img.path));

            if (unprocessed.length === 0) {
                console.log("Processing complete!");
                this.isRunning = false;
                if (this.onProgress) this.onProgress({ completed: true });
                return;
            }

            // Pick Random
            const randIndex = Math.floor(Math.random() * unprocessed.length);
            const targetImage = unprocessed[randIndex];

            try {
                // Generate Embedding
                const embedding = await this.generateEmbedding(targetImage.handle);

                // Add to state
                const record = {
                    id: Date.now() + Math.random(), // Simple unique ID
                    path: targetImage.path,
                    embedding: embedding
                };

                pendingEmbeddings.push(record);
                this.processedPaths.add(targetImage.path);
                sessionProcessedCount++;

                // Trigger Update / Save
                if (pendingEmbeddings.length >= this.refreshInterval || unprocessed.length === 1) {
                    // Update Status Bar
                    if (this.onProgress) {
                        this.onProgress({
                            processed: this.processedPaths.size,
                            total: this.allImages.length,
                            completed: false,
                            currentAction: "Updating clusters... (This may take a moment)"
                        });
                    }

                    console.log(`[ProcessingManager] Batch full. Saving ${pendingEmbeddings.length} new embeddings.`);

                    // Save to Disk
                    const currentAllEmbeddings = (await this.fs.readMetadata('embeddings.json') || []).concat(pendingEmbeddings);
                    await this.fs.writeMetadata('embeddings.json', currentAllEmbeddings);

                    // Verify and Update Manifest
                    await this.fs.writeMetadata('manifest.json', {
                        processedCount: currentAllEmbeddings.length,
                        totalImagesFound: this.allImages.length,
                        lastUpdated: Date.now(),
                        excludedImages: Array.from(this.excludedPaths) // Persist exclusion
                    });
                    console.log(`[ProcessingManager] Session stats: ${sessionProcessedCount} images this run. Total processed: ${currentAllEmbeddings.length}`);

                    // Trigger Clustering Callback
                    if (this.onClusterUpdate) {
                        console.log("[ProcessingManager] Calling onClusterUpdate...");
                        await this.onClusterUpdate(currentAllEmbeddings);
                        console.log("[ProcessingManager] Cluster update complete.");
                    }

                    pendingEmbeddings = []; // Reset batch
                }

                // Update Progress UI (Calculated update)
                if (this.onProgress) {
                    const now = Date.now();

                    // Calculate speed: Seconds per Image
                    const sessionElapsed = now - (this.sessionStartTime || now);
                    let speedSec = 0;
                    if (sessionProcessedCount > 0 && sessionElapsed > 0) {
                        speedSec = (sessionElapsed / sessionProcessedCount) / 1000; // seconds per image
                    }

                    // ETA
                    const remaining = this.allImages.length - this.processedPaths.size;
                    const eta = (speedSec * 1000) * remaining; // ETA in ms for formatTime

                    this.onProgress({
                        processed: this.processedPaths.size,
                        total: this.allImages.length,
                        speed: speedSec, // Passed as seconds
                        eta: eta,
                        completed: false,
                        currentAction: `Processing: ${targetImage.path.split('/').pop()}`
                    });
                }
            } catch (err) {
                console.error(`Error processing ${targetImage.path}:`, err);
                this.processedPaths.add(targetImage.path);
            }

            // Tiny Yield
            await new Promise(r => setTimeout(r, 10));
        }
    }

    async generateEmbedding(fileHandle) {
        const file = await fileHandle.getFile();
        const url = URL.createObjectURL(file);
        try {
            const rawImage = await RawImage.read(url);
            const imageInputs = await this.processor(rawImage);
            const { image_embeds } = await this.model(imageInputs);
            return Array.from(image_embeds.data); // Float32Array to regular Array
        } finally {
            URL.revokeObjectURL(url);
        }
    }

    pause() { this.isPaused = true; }
    resume() { this.isPaused = false; }
    stop() { this.isRunning = false; this.aborted = true; }
}
