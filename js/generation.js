import { FilesetResolver, LlmInference } from './vendor/tasks-genai.js';
import { TextEmbedder } from './vendor/tasks-text.js';
// Transformers.js local import
import { env, AutoProcessor, CLIPVisionModelWithProjection, RawImage } from './vendor/transformers.js';

export class GenerationStep {
    constructor(fileSystem, logger) {
        this.fs = fileSystem;
        this.log = logger;
        this.llmInference = null;
        this.textEmbedder = null;
        this.clipPipeline = null; // Store the CLIP pipeline
        this.loadedMode = null; // Track which mode is currently loaded ('direct_clip' or 'legacy')
        this.isAborted = false;
        this.mode = 'sequential'; // default
    }

    async loadModels(config) {
        // If the same mode is already loaded, skip loading
        if (this.loadedMode === config.mode) return;

        this.log(`Loading AI models for ${config.mode === 'direct_clip' ? 'CLIP' : 'Gemma'}... This may take a moment.`);

        try {
            if (config.mode === 'direct_clip') {
                // --- CLIP MODE ---
                this.log(`Initializing Transformers.js for local model in 'models/${config.modelFolderName}'...`);

                // Configure strictly for local loading
                env.allowLocalModels = true;
                env.localModelPath = 'models/'; // Base path for models
                env.allowRemoteModels = false; // Disable remote fetching

                let quantizedOption = true; // Default
                if (config.quantized === 'false' || config.quantized === false) quantizedOption = false;

                this.log(`Loading CLIP model (Quantized: ${quantizedOption})...`);

                // Initialize Processor and Model explicitly
                this.clipProcessor = await AutoProcessor.from_pretrained(config.modelFolderName);

                // Use CLIPVisionModelWithProjection to get the projected image embeddings
                this.clipModel = await CLIPVisionModelWithProjection.from_pretrained(config.modelFolderName, {
                    quantized: quantizedOption,
                    device: config.device || 'webgpu' // Attempt WebGPU if possible
                });
                this.log("✅ Local CLIP model loaded successfully.");

            } else {
                // --- GEMMA / LEGACY MODE ---
                this.log("Initializing MediaPipe Gemma & USE...");

                // Load Text Embedder (USE)
                this.log("  - Resolving files for Text Tasks...");
                const textFiles = await FilesetResolver.forTextTasks("js/vendor/wasm");
                this.log("  - Creating Text Embedder (USE)...");
                this.textEmbedder = await TextEmbedder.createFromOptions(textFiles, {
                    baseOptions: {
                        modelAssetPath: config.embeddingModel || 'universal_sentence_encoder.tflite',
                        delegate: "CPU" // CPU is safer and plenty fast for USE
                    }
                });
                this.log("  ✅ Text Embedder ready.");

                // Load LLM (Gemma)
                this.log("  - Resolving files for GenAi Tasks...");
                const genaiFileset = await FilesetResolver.forGenAiTasks('js/vendor/wasm');
                this.log(`  - Creating LLM Inference (${config.modelFileName})...`);
                this.llmInference = await LlmInference.createFromOptions(genaiFileset, {
                    baseOptions: { modelAssetPath: config.modelFileName },
                    temperature: config.temperature !== undefined ? config.temperature : 0,
                    maxTokens: config.maxTokens || 512,
                    maxNumImages: 1
                });
                this.log("✅ Gemma & USE models loaded successfully.");
            }

            this.loadedMode = config.mode;
        } catch (error) {
            this.log(`Error loading models: ${error.message}`, 'error');
            this.loadedMode = null; // Reset on failure
            throw error;
        }
    }

    /**
     * Scans the specific model folder to check for quantization versions.
     * @param {string} folderName 
     * @returns {Promise<Object>} { hasQuantized: boolean, hasFull: boolean }
     */
    async scanModelVersions(folderName) {
        // Use fetch to check existence, mirroring how Transformers.js loads files
        // This avoids issues where the 'Selected Folder' in FS API is different from the Server Root
        let hasQuantized = false;
        let hasFull = false;
        const pathsToCheck = [
            `models/${folderName}/onnx/vision_model_quantized.onnx`,
            `models/${folderName}/vision_model_quantized.onnx`, // fallback to root
            `models/${folderName}/onnx/model_quantized.onnx`, // legacy
            `models/${folderName}/model_quantized.onnx` // legacy
        ];

        const pathsToCheckFull = [
            `models/${folderName}/onnx/vision_model.onnx`,
            `models/${folderName}/vision_model.onnx`,
            `models/${folderName}/onnx/model.onnx`,
            `models/${folderName}/model.onnx`
        ];

        // Check Quantized
        for (const path of pathsToCheck) {
            try {
                const res = await fetch(path, { method: 'HEAD' });
                if (res.ok) { hasQuantized = true; break; }
            } catch (e) { console.warn("Fetch check failed", path); }
        }

        // Check Full
        for (const path of pathsToCheckFull) {
            try {
                const res = await fetch(path, { method: 'HEAD' });
                if (res.ok) { hasFull = true; break; }
            } catch (e) { console.warn("Fetch check failed", path); }
        }

        return { hasQuantized, hasFull };
    }

    abort() {
        this.isAborted = true;
        const btnAbort = document.getElementById('btn-abort-generation');
        btnAbort.disabled = true;
        btnAbort.textContent = 'Aborting...';
        this.log("Aborting... Please wait for current image to finish processing.", 'error');
    }

    async validateAndSyncMetadata(runFolder) {
        // Load all three metadata files
        let filenames = await this.fs.readFile(`metadata/${runFolder}/filenamesArray.json`, 'json') || [];
        let captions = await this.fs.readFile(`metadata/${runFolder}/captionsArray.json`, 'json') || [];
        let embeddings = await this.fs.readFile(`metadata/${runFolder}/embeddingsArray.json`, 'json') || [];

        // Check if all have the same length
        const lengths = [filenames.length, captions.length, embeddings.length];
        const minLength = Math.min(...lengths);
        const maxLength = Math.max(...lengths);

        if (minLength !== maxLength) {
            this.log(`⚠️ Metadata files out of sync! Lengths: filenames=${lengths[0]}, captions=${lengths[1]}, embeddings=${lengths[2]}`, 'error');
            this.log(`🔧 Auto-repairing: truncating all to ${minLength} entries...`);

            // Truncate all arrays to the minimum length
            filenames = filenames.slice(0, minLength);
            captions = captions.slice(0, minLength);
            embeddings = embeddings.slice(0, minLength);

            // Save the synchronized data back
            await this.saveData(runFolder, filenames, captions, embeddings, null); // Pass null for config if we don't have it here
            this.log(`✅ Metadata synchronized. Safe to resume from image ${minLength + 1}.`);
        } else {
            this.log(`✅ Metadata integrity verified: all files have ${minLength} entries.`);
        }

        return { filenames, captions, embeddings };
    }

    async run(config, mode = 'sequential') {
        if (!this.fs.hasDirectory()) {
            this.log("No folder selected.", 'error');
            return;
        }

        this.isAborted = false;
        // Buttons handled by caller or we can improve this later to handle both buttons
        const btnAbort = document.getElementById('btn-abort-generation');

        btnAbort.hidden = false;
        btnAbort.disabled = false;
        btnAbort.textContent = 'Abort';

        try {
            await this.loadModels(config);

            const allImages = await this.fs.listRootImages();
            if (allImages.length === 0) {
                this.log("No images found in the selected folder.", 'error');
                return;
            }

            // Check for existing runs to resume
            const existingRuns = await this.fs.listDirectories('metadata');
            // Filter runs based on mode AND generation type
            // Note: mixing gemma/clip runs might confuse clustering if not separated.
            // But we generally separate by timestamp folder.
            const genRuns = existingRuns.filter(d => {
                const isGen = d.startsWith('gen_');
                if (!isGen) return false;

                // Detect mode from folder name
                const isClipRun = d.includes('_clip');
                const isCurrentClip = config.mode === 'direct_clip';

                // Prevent mixing Embedding models (they have different dimensions)
                if (isClipRun !== isCurrentClip) return false;

                // Detect selection mode (random vs sequential)
                const isRandomRun = d.includes('_random');
                if (mode === 'random') return isRandomRun;
                return !isRandomRun;
            }).sort().reverse();

            let runFolder = config.runFolder;
            let filenames = [];
            let captions = [];
            let embeddings = [];

            // Resume logic
            if (runFolder) {
                // Explicit resume from UI selection
                const syncedData = await this.validateAndSyncMetadata(runFolder);
                filenames = syncedData.filenames;
                captions = syncedData.captions;
                embeddings = syncedData.embeddings;

                // Load previous config to ensure continuity (e.g. system prompt, model files)
                const prevConfig = await this.fs.readFile(`metadata/${runFolder}/config.json`, 'json');
                if (prevConfig) {
                    config = { ...config, ...prevConfig };
                }
                this.log(`Resuming ${mode} run: ${runFolder} (${filenames.length} images processed)`);
            } else if (genRuns.length > 0) {
                // Legacy / Auto-detect resume (optional, can be kept as fallback or removed)
                // Since App.js now handles run selection, we could theoretically skip this,
                // but we'll keep a simpler version for robustness if no run was explicitly selected
                // but one is available. However, the user complained about the prompt.
                // Best to skip auto-prompting if they explicitly chose "New Run" in App.js.

                /* Selection in App.js is the source of truth now. 
                   If runFolder is null here, it means the user chose "(New Run)".
                   We should skip the auto-prompt to avoid the "additional modal" issue.
                */
            }

            if (!runFolder) {
                // Pass true for isRawSuffix to get _random instead of _from_random
                // Add CLIP tag to foldername if CLIP mode
                const runType = config.mode === 'direct_clip' ? '_clip' : '';
                runFolder = await this.fs.createRunFolder('gen', mode + runType, true);
                this.log(`Starting new ${mode} generation run: ${runFolder}`);
            }

            // Determine unprocessed images
            // We need a set of already processed filenames to efficiently filter
            const processedSet = new Set(filenames);
            let unprocessedImages = allImages.filter(img => !processedSet.has(img));

            const progressBar = document.getElementById('gen-progress-bar');
            const progressText = document.getElementById('gen-progress-text');
            const statsContainer = document.getElementById('gen-progress-stats');
            const previewArea = document.getElementById('gen-preview-area');
            const previewImg = document.getElementById('gen-preview-img');
            const previewCaption = document.getElementById('gen-preview-caption');

            document.querySelector('.progress-bar-container').hidden = false;
            statsContainer.hidden = false;
            previewArea.hidden = false;

            const startTime = Date.now();
            let processedCount = filenames.length;
            const initialProcessedCount = filenames.length; // Count before session start
            const totalCount = allImages.length;
            const totalSessionItems = totalCount - initialProcessedCount; // Items to do in this session

            // Main Processing Loop
            while (unprocessedImages.length > 0) {
                if (this.isAborted) {
                    this.log("Processing aborted. Progress saved.", 'error');
                    break;
                }

                // Selection Logic
                let selectedIndex;
                if (mode === 'random') {
                    // Random pick
                    const randomVal = Math.random();
                    selectedIndex = Math.floor(randomVal * unprocessedImages.length);
                    // console.log(`Random selection: value=${randomVal.toFixed(4)}, index=${selectedIndex}, poolSize=${unprocessedImages.length}`);
                } else {
                    // Sequential pick (always first in the queue of unprocessed)
                    selectedIndex = 0;
                }

                const filename = unprocessedImages[selectedIndex];
                // Remove from queue immediately
                unprocessedImages.splice(selectedIndex, 1);
                processedCount++;

                this.log(`Processing ${processedCount}/${totalCount}: ${filename}`);

                // Read image file
                const fileHandle = await this.fs.getDirectoryHandle('', false).then(h => h.getFileHandle(filename));
                const file = await fileHandle.getFile();
                const imageUrl = URL.createObjectURL(file);

                let captionResult = '';
                let embeddingArray = [];

                if (config.mode === 'direct_clip') {
                    // --- CLIP INFERENCE ---
                    captionResult = "[CLIP Embedded Image]"; // Placeholder
                    try {
                        // 1. Read image using Transformers.js RawImage
                        const rawImage = await RawImage.read(imageUrl);

                        // 2. Preprocess
                        const imageInputs = await this.clipProcessor(rawImage);

                        // 3. Inference
                        // Note: CLIPVisionModelWithProjection outputs { image_embeds: Tensor, ... }
                        // We want 'image_embeds' which are the projected features ready for dot-product with text.
                        const { image_embeds } = await this.clipModel(imageInputs);

                        // 4. Extract data
                        if (image_embeds) {
                            // data is Float32Array
                            embeddingArray = Array.from(image_embeds.data);
                        } else {
                            throw new Error("Model output missing 'image_embeds'.");
                        }

                    } catch (e) {
                        this.log(`Error running CLIP on image: ${e.message}`, 'error');
                        throw e; // Stop if serious error
                    }

                } else {
                    // --- MEDIA PIPE GEMMA + USE ---
                    try {
                        // Generate Caption
                        // console.log("Calling generateResponse...");
                        captionResult = await this.llmInference.generateResponse([config.systemPrompt, { imageSource: imageUrl }]);
                        // console.log("Caption received.");

                        // Generate Embedding
                        const embeddingResult = this.textEmbedder.embed(captionResult);
                        embeddingArray = embeddingResult.embeddings[0].floatEmbedding;
                    } catch (e) {
                        this.log(`❌ Error processing image with Gemma/USE: ${e.message}`, 'error');
                        // Use empty values so we can continue with other images if possible
                        captionResult = "[ERROR: Generation failed]";
                        embeddingArray = new Array(512).fill(0); // USE defaults to 512
                    }
                }

                filenames.push(filename);
                captions.push(captionResult);
                embeddings.push(embeddingArray);

                // Update Preview
                previewImg.src = imageUrl;
                previewCaption.textContent = captionResult;

                // Cleanup Blob URL to prevent memory leaks
                previewImg.onload = () => URL.revokeObjectURL(imageUrl);

                // Calculate and Update Stats
                const elapsed = Date.now() - startTime;
                const processedInSession = processedCount - initialProcessedCount; // Count in this run only

                // Update Progress Bar & Percentage (Session Relative)
                let percent = 0;
                if (totalSessionItems > 0) {
                    percent = Math.round((processedInSession / totalSessionItems) * 100);
                }
                progressBar.style.width = `${percent}%`;
                progressText.textContent = `${percent}% (Session)`;

                // Speed: Time per Image (Average over session)
                let speedPerImage = 0; // ms per image
                if (processedInSession > 0) {
                    speedPerImage = elapsed / processedInSession;
                }

                // Remaining Time
                const remaining = unprocessedImages.length;
                const eta = remaining * speedPerImage;

                const elapsedStr = this.formatTime(elapsed / 1000);
                const speedStr = speedPerImage > 0 ? `${this.formatTime(speedPerImage / 1000)}/img` : '-';
                const etaStr = speedPerImage > 0 ? this.formatTime(eta / 1000) : (remaining === 0 ? 'Complete!' : 'Calculating...');

                // Bifurcated Progress String
                const progressStr = `Prev: ${initialProcessedCount} | Sess: ${processedInSession} | Total: ${processedCount}/${totalCount}`;

                document.getElementById('gen-stat-elapsed').textContent = `⏱️ ${elapsedStr} | ${progressStr}`;
                document.getElementById('gen-stat-speed').textContent = `⚡ ${speedStr}`;
                document.getElementById('gen-stat-eta').textContent = `🏁 ${etaStr}`;

                // Save every image as requested
                await this.saveData(runFolder, filenames, captions, embeddings, config);

                // Give the UI a chance to breathe, especially during heavy LLM tasks
                await new Promise(r => setTimeout(r, 100)); // Slightly longer breather
            }

            // Final save after loop for safety
            await this.saveData(runFolder, filenames, captions, embeddings, config);

            if (!this.isAborted) {
                this.log(`Generation complete (${mode}). Metadata saved.`);
            }

        } catch (error) {
            this.log(`Generation failed: ${error.message}`, 'error');
            console.error(error);
        } finally {
            btnAbort.hidden = true;
            btnAbort.disabled = false;
            btnAbort.textContent = 'Abort';
            document.getElementById('gen-progress-stats').hidden = true;
        }
    }

    formatTime(secondsInput) {
        // Handle input in seconds (float)
        const totalSeconds = Math.floor(secondsInput);
        const hours = Math.floor(totalSeconds / 3600);
        const minutes = Math.floor((totalSeconds % 3600) / 60);
        const seconds = totalSeconds % 60;

        const p = (n) => n.toString().padStart(2, '0');

        if (hours > 0) {
            return `${hours}:${p(minutes)}:${p(seconds)}`;
        } else {
            return `${minutes}:${p(seconds)}`;
        }
    }

    async saveData(folder, filenames, captions, embeddings, config) {
        await this.fs.writeFile(`metadata/${folder}/filenamesArray.json`, JSON.stringify(filenames));
        await this.fs.writeFile(`metadata/${folder}/captionsArray.json`, JSON.stringify(captions));
        await this.fs.writeFile(`metadata/${folder}/embeddingsArray.json`, JSON.stringify(embeddings));
        if (config) {
            await this.fs.writeFile(`metadata/${folder}/config.json`, JSON.stringify(config));
        }
    }
}
