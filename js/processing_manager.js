
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

        // Optimization Configuration
        this.batchSize = 4; // Start with 4, safe for most devices
    }

    async loadModel() {
        console.log("Loading CLIP model...");
        env.allowLocalModels = true;
        env.localModelPath = 'models/';
        env.allowRemoteModels = true;

        // Comprehensive Debugging & Logging
        env.debug = true;
        env.logLevel = 'verbose';
        if (env.backends && env.backends.onnx) {
            env.backends.onnx.debug = true;
            env.backends.onnx.logLevel = 'verbose';
        }

        // Request dedicated GPU (High Performance) for multi-GPU systems
        if (env.backends && env.backends.onnx) {
            env.backends.onnx.webgpu = { powerPreference: 'high-performance' };
        }

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
                console.log("[ProcessingManager] Triggering initial cluster update...");
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

            // Pick a batch of images
            const currentBatchSize = Math.min(this.batchSize, unprocessed.length);
            const batchImages = [];
            for (let i = 0; i < currentBatchSize; i++) {
                // For randomness, we slice a random one
                const randIndex = Math.floor(Math.random() * unprocessed.length);
                batchImages.push(unprocessed.splice(randIndex, 1)[0]);
            }

            try {
                // Parallel I/O and Batch Processing
                const embeddings = await this.processBatch(batchImages);

                for (let i = 0; i < batchImages.length; i++) {
                    const record = {
                        id: Date.now() + Math.random(),
                        path: batchImages[i].path,
                        embedding: embeddings[i]
                    };

                    pendingEmbeddings.push(record);
                    this.processedPaths.add(batchImages[i].path);
                    sessionProcessedCount++;
                }

                // Batch Save to Disk
                if (pendingEmbeddings.length >= this.refreshInterval || unprocessed.length === 0) {
                    if (this.onProgress) {
                        this.onProgress({
                            processed: this.processedPaths.size,
                            total: this.allImages.length,
                            completed: false,
                            currentAction: "Updating clusters... (This may take a moment)"
                        });
                    }

                    const currentAllEmbeddings = (await this.fs.readMetadata('embeddings.json') || []).concat(pendingEmbeddings);
                    await this.fs.writeMetadata('embeddings.json', currentAllEmbeddings);

                    await this.fs.writeMetadata('manifest.json', {
                        processedCount: currentAllEmbeddings.length,
                        totalImagesFound: this.allImages.length,
                        lastUpdated: Date.now(),
                        excludedImages: Array.from(this.excludedPaths)
                    });

                    if (this.onClusterUpdate) {
                        await this.onClusterUpdate(currentAllEmbeddings);
                    }

                    pendingEmbeddings = [];
                }

                // Progress UI
                if (this.onProgress) {
                    const now = Date.now();
                    const sessionElapsed = now - this.sessionStartTime;
                    const speedSec = (sessionElapsed / sessionProcessedCount) / 1000;
                    const remaining = this.allImages.length - this.processedPaths.size;
                    const eta = (speedSec * 1000) * remaining;

                    this.onProgress({
                        processed: this.processedPaths.size,
                        total: this.allImages.length,
                        speed: speedSec,
                        eta: eta,
                        completed: false,
                        currentAction: `Processed batch of ${batchImages.length} images`
                    });
                }
            } catch (err) {
                console.error("Batch processing error:", err);
                // Mark as processed to avoid infinite loops, but maybe re-scan?
                batchImages.forEach(img => this.processedPaths.add(img.path));
            }

            await new Promise(r => setTimeout(r, 10));
        }
    }

    async processBatch(batchImages) {
        // 1. Parallel I/O: Load and decode all images in the batch concurrently
        const rawImages = await Promise.all(batchImages.map(async (img) => {
            const file = await img.handle.getFile();
            const url = URL.createObjectURL(file);
            try {
                return await RawImage.read(url);
            } finally {
                URL.revokeObjectURL(url);
            }
        }));

        // 2. Batch Inference
        const batchInputs = await this.processor(rawImages);
        const { image_embeds } = await this.model(batchInputs);

        // 3. Extract individual embeddings from the batch tensor
        const result = [];
        const numImages = batchImages.length;
        const totalElements = image_embeds.data.length;
        const dim = totalElements / numImages;

        for (let i = 0; i < numImages; i++) {
            const start = i * dim;
            const end = start + dim;
            result.push(Array.from(image_embeds.data.slice(start, end)));
        }
        return result;
    }

    pause() { this.isPaused = true; }
    resume() { this.isPaused = false; }
    stop() { this.isRunning = false; this.aborted = true; }
}
