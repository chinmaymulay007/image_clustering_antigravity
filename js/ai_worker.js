
import { env, AutoProcessor, CLIPVisionModelWithProjection, RawImage } from './vendor/transformers.js';

let processor = null;
let model = null;
const modelId = 'Xenova/mobileclip_s0';

// Initialize Transformers.js in the worker
async function init(config) {
    env.allowLocalModels = true;
    env.localModelPath = '../models/'; // Relative to worker in js/
    env.allowRemoteModels = true;
    env.backends.onnx.wasm.wasmPaths = 'vendor/dist/';
    self.debug = config.debug || false;

    // Inherit debug settings if passed
    if (config.debug) {
        env.debug = true;
        env.logLevel = 'verbose';
        env.backends.onnx.debug = true;
        env.backends.onnx.logLevel = 'verbose';
    }

    processor = await AutoProcessor.from_pretrained(modelId);
    model = await CLIPVisionModelWithProjection.from_pretrained(modelId, {
        quantized: false,
        device: 'webgpu'
    });

    console.log("[AI Worker] Model loaded & ready.");

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

    console.log(`[AI Worker] Backend: ${backend} | Device: ${device}`);
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

            if (self.debug) {
                console.log(`[AI Worker] Decoding file: ${item.path.split('/').pop()} (${(file.size / 1024).toFixed(1)}KB)`);
            }

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

        // 3. Extract results (FIXED: Uses actual processed count and normalization)
        const result = [];
        const numImages = validRawImages.length; // Use successfully processed count
        const totalElements = image_embeds.data.length;
        const dim = totalElements / numImages;

        // Normalize before extracting data if possible, or handle manually
        // Transformers.js tensors have a .tolist() or .data getter. 
        // Let's use the explicit slice but on normalized data if available.
        const embeds = image_embeds.normalize(); 

        for (let i = 0; i < numImages; i++) {
            const rowStart = i * dim;
            const rowEnd = rowStart + dim;
            result.push(Array.from(embeds.data.slice(rowStart, rowEnd)));
        }

        console.log(`[AI Worker] Processed batch of ${numImages} in ${duration.toFixed(1)}ms (${(duration / numImages).toFixed(1)}ms/img)`);

        self.postMessage({
            status: 'success',
            embeddings: result,
            time: duration,
            batchSize: numImages
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
