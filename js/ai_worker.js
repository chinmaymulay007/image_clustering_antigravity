
import { env, AutoProcessor, CLIPVisionModelWithProjection, RawImage } from './vendor/transformers.js';

let processor = null;
let model = null;
const modelId = 'Xenova/clip-vit-base-patch16';

// Initialize Transformers.js in the worker
async function init(config) {
    env.allowLocalModels = true;
    env.localModelPath = '../models/'; // Relative to worker in js/
    env.allowRemoteModels = true;
    env.backends.onnx.wasm.wasmPaths = 'vendor/dist/';

    // Inherit debug settings if passed
    if (config.debug) {
        env.debug = true;
        env.logLevel = 'verbose';
        env.backends.onnx.debug = true;
        env.backends.onnx.logLevel = 'verbose';
    }

    processor = await AutoProcessor.from_pretrained(modelId);
    model = await CLIPVisionModelWithProjection.from_pretrained(modelId, {
        quantized: true,
        device: 'webgpu'
    });

    console.log("%c[AI Worker] Model loaded & ready.", "color: #10b981; font-weight: bold;");

    // Enhanced Probing for Hardware Info
    let backend = 'Unknown';
    let device = model.device || 'Unknown';

    try {
        // Deep walk to find session or environment markers
        const session = model?.model?.session || model?.session || model?._session;
        if (session) {
            // Check execution providers list
            const eps = session.config?.executionProviders || [];
            if (eps.some(e => String(e).toLowerCase().includes('webgpu'))) backend = 'WebGPU';
            else if (eps.some(e => String(e).toLowerCase().includes('wasm'))) backend = 'WASM';

            // Second check: Handler name
            if (backend === 'Unknown' && session.handler) {
                const name = session.handler.constructor.name.toLowerCase();
                if (name.includes('webgpu')) backend = 'WebGPU';
                else if (name.includes('wasm')) backend = 'WASM';
            }
        }
    } catch (e) {
        console.warn("[AI Worker] Hardware probe hit a snag:", e);
    }

    console.log(`%c[AI Worker] Backend: ${backend} | Device: ${device}`, "color: #10b981; font-weight: bold;");
    self.postMessage({ status: 'ready', backend, device });
}

async function processBatch(batch) {
    if (!model || !processor) return;

    try {
        const start = performance.now();

        // 1. Load and Decode in Worker (No main-thread hitches!)
        const rawImages = await Promise.all(batch.map(async (item) => {
            const file = item.file; // Already retrieved in main thread

            if (!file) {
                console.warn(`%c[AI Worker] Missing file for ${item.path}, skipping.`, "color: #ef4444;");
                return null;
            }

            console.log(`%c[AI Worker] Decoding file: ${item.path.split('/').pop()} (${(file.size / 1024).toFixed(1)}KB)`, "color: #fb8c00; font-size: 0.8rem;");

            const url = URL.createObjectURL(file);
            try {
                return await RawImage.read(url);
            } finally {
                URL.revokeObjectURL(url);
            }
        }));

        // Filter out any failed reads
        const validRawImages = rawImages.filter(img => img !== null);
        if (validRawImages.length === 0) throw new Error("No valid images in batch");

        // 2. Preprocess & Inference
        const inputs = await processor(validRawImages);
        const { image_embeds } = await model(inputs);
        const end = performance.now();
        const duration = end - start;

        // 3. Extract results (FIXED: Restored missing logic)
        const result = [];
        const numImages = batch.length;
        const totalElements = image_embeds.data.length;
        const dim = totalElements / numImages;

        for (let i = 0; i < numImages; i++) {
            const rowStart = i * dim;
            const rowEnd = rowStart + dim;
            result.push(Array.from(image_embeds.data.slice(rowStart, rowEnd)));
        }

        console.log(`%c[AI Worker] Processed batch of ${batch.length} in ${duration.toFixed(1)}ms (${(duration / batch.length).toFixed(1)}ms/img)`, "color: #10b981;");

        self.postMessage({
            status: 'success',
            embeddings: result,
            time: duration,
            batchSize: batch.length
        });
    } catch (err) {
        self.postMessage({ status: 'error', error: err.message });
    }
}

self.onmessage = async (e) => {
    const { action, payload } = e.data;
    if (action === 'init') {
        await init(payload);
    } else if (action === 'process') {
        await processBatch(payload);
    }
};
