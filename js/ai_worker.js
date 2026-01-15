
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

    // Enhanced Probing for Hardware Info
    let backend = 'Unknown';
    let device = model.device || 'Unknown';

    try {
        // Deep probe for ONNX Session
        const findSession = (obj, depth = 0) => {
            if (!obj || depth > 5) return null;
            if (obj.session) return obj.session;
            if (obj._session) return obj._session;
            for (const key of Object.keys(obj)) {
                if (typeof obj[key] === 'object') {
                    const found = findSession(obj[key], depth + 1);
                    if (found) return found;
                }
            }
            return null;
        };

        const session = findSession(model);
        if (session) {
            // Check for specific backend handlers or labels
            const handler = session.handler || session._handler;
            const handlerName = handler?.constructor?.name || session.constructor?.name;

            if (handlerName) {
                backend = handlerName.replace('OnnxruntimeWeb', '').replace('Backend', '');
            }

            // Fallback for some versions of ORT
            if (backend === 'Unknown' && session.config?.executionProviders) {
                backend = session.config.executionProviders[0];
            }
        }
    } catch (e) {
        console.warn("[Worker] Backend probe hit a snag:", e);
    }

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

        // 3. Extract results
        const result = [];
        const numImages = batch.length;
        const totalElements = image_embeds.data.length;
        const dim = totalElements / numImages;

        for (let i = 0; i < numImages; i++) {
            const rowStart = i * dim;
            const rowEnd = rowStart + dim;
            result.push(Array.from(image_embeds.data.slice(rowStart, rowEnd)));
        }

        self.postMessage({
            status: 'success',
            embeddings: result,
            time: end - start,
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
