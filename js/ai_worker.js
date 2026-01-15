
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
        const session = model?.model?.session || model?.session || model?._session;
        if (session) {
            const ep = session.config?.executionProviders?.[0] || '';
            if (ep.includes('webgpu')) backend = 'WebGPU';
            else if (ep.includes('wasm')) backend = 'WASM';
            else if (ep.includes('cpu')) backend = 'CPU';

            // If still unknown, try the handler name but avoid minified 'd'
            if (backend === 'Unknown') {
                const handlerName = session.handler?.constructor?.name;
                if (handlerName && handlerName.length > 1) {
                    backend = handlerName.replace('OnnxruntimeWeb', '').replace('Backend', '');
                }
            }
        }
    } catch (e) {
        console.warn("[AI Worker] Backend probe failed:", e);
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
            const file = await item.handle.getFile();
            // In a worker, we can use simpler Buffer-based approach or the same Blob approach
            const url = URL.createObjectURL(file);
            try {
                return await RawImage.read(url);
            } finally {
                URL.revokeObjectURL(url);
            }
        }));

        // 2. Preprocess & Inference
        const inputs = await processor(rawImages);
        const { image_embeds } = await model(inputs);
        const end = performance.now();
        const duration = end - start;

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
