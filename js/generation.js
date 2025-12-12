import { FilesetResolver, LlmInference } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai';
import { TextEmbedder } from 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-text';

export class GenerationStep {
    constructor(fileSystem, logger) {
        this.fs = fileSystem;
        this.log = logger;
        this.llmInference = null;
        this.textEmbedder = null;
        this.isModelLoaded = false;
        this.isAborted = false;
    }

    async loadModels(config) {
        if (this.isModelLoaded) return;

        this.log("Loading AI models... This may take a moment.");

        try {
            // Load Text Embedder
            const textFiles = await FilesetResolver.forTextTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-text@latest/wasm");
            this.textEmbedder = await TextEmbedder.createFromOptions(textFiles, {
                baseOptions: { modelAssetPath: config.embeddingModel || 'universal_sentence_encoder.tflite' }
            });

            // Load LLM
            const genaiFileset = await FilesetResolver.forGenAiTasks('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-genai/wasm');
            this.llmInference = await LlmInference.createFromOptions(genaiFileset, {
                baseOptions: { modelAssetPath: config.modelFileName },
                temperature: config.temperature !== undefined ? config.temperature : 0,
                maxTokens: config.maxTokens || 512,
                maxNumImages: 1
            });

            this.isModelLoaded = true;
            this.log("Models loaded successfully.");
        } catch (error) {
            this.log(`Error loading models: ${error.message}`, 'error');
            throw error;
        }
    }

    abort() {
        this.isAborted = true;
        const btnAbort = document.getElementById('btn-abort-generation');
        btnAbort.disabled = true;
        btnAbort.textContent = 'Aborting...';
        this.log("Aborting... Please wait for current image to finish processing.", 'error');
    }

    showResumeDialog(runName, processed, total) {
        return new Promise((resolve) => {
            // Create modal
            const modal = document.createElement('div');
            modal.className = 'resume-modal';
            modal.innerHTML = `
                <div class="resume-modal-content">
                    <h2>🔄 Resume Previous Run?</h2>
                    <p>Found an incomplete generation run from a previous session.</p>
                    
                    <div class="resume-stats">
                        <div>
                            <span>Run Name:</span>
                            <strong>${runName}</strong>
                        </div>
                        <div>
                            <span>Progress:</span>
                            <strong>${processed} / ${total} images (${Math.round((processed / total) * 100)}%)</strong>
                        </div>
                        <div>
                            <span>Remaining:</span>
                            <strong>${total - processed} images</strong>
                        </div>
                    </div>
                    
                    <div class="resume-modal-actions">
                        <button class="btn-new">Start Fresh</button>
                        <button class="btn-resume">Resume</button>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);

            // Handle button clicks
            modal.querySelector('.btn-resume').addEventListener('click', () => {
                document.body.removeChild(modal);
                resolve(true);
            });

            modal.querySelector('.btn-new').addEventListener('click', () => {
                document.body.removeChild(modal);
                resolve(false);
            });
        });
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
            await this.saveData(runFolder, filenames, captions, embeddings);
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

        // Hide start buttons
        document.getElementById('btn-start-generation').hidden = true;
        const btnStartRandom = document.getElementById('btn-start-generation-random');
        if (btnStartRandom) btnStartRandom.hidden = true;

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
            // Filter runs based on mode
            const genRuns = existingRuns.filter(d => {
                const isGen = d.startsWith('gen_');
                if (!isGen) return false;

                // Check suffix
                const isRandom = d.endsWith('_random');
                if (mode === 'random') return isRandom;
                // For sequential, legacy runs (no suffix) or explicit sequential suffix
                const isSequential = d.endsWith('_sequential');
                const hasNoSuffix = !d.includes('_from_') && !d.includes('_random') && !d.includes('_sequential'); // Rough legacy check
                return isSequential || (!isRandom && hasNoSuffix);
            }).sort().reverse();

            let runFolder;
            let filenames = [];
            let captions = [];
            let embeddings = [];

            // Resume logic
            if (genRuns.length > 0) {
                const lastRun = genRuns[0];
                const syncedData = await this.validateAndSyncMetadata(lastRun);

                if (syncedData.filenames.length < allImages.length) {
                    const shouldResume = await this.showResumeDialog(
                        lastRun,
                        syncedData.filenames.length,
                        allImages.length
                    );

                    if (shouldResume) {
                        runFolder = lastRun;
                        filenames = syncedData.filenames;
                        captions = syncedData.captions;
                        embeddings = syncedData.embeddings;
                        this.log(`Resuming ${mode} run from ${filenames.length} processed images...`);
                    }
                }
            }

            if (!runFolder) {
                // Pass true for isRawSuffix to get _random instead of _from_random
                runFolder = await this.fs.createRunFolder('gen', mode, true);
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
            const totalCount = allImages.length;

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
                    console.log(`Random selection: value=${randomVal.toFixed(4)}, index=${selectedIndex}, poolSize=${unprocessedImages.length}`);
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

                // Generate Caption
                const response = await this.llmInference.generateResponse([config.systemPrompt, { imageSource: imageUrl }]);

                // Generate Embedding
                const embeddingResult = this.textEmbedder.embed(response);

                filenames.push(filename);
                captions.push(response);
                embeddings.push(embeddingResult.embeddings[0].floatEmbedding);

                // Update Preview
                previewImg.src = imageUrl;
                previewCaption.textContent = response;

                // Update Progress Bar & Percentage
                const percent = Math.round((processedCount / totalCount) * 100);
                progressBar.style.width = `${percent}%`;
                progressText.textContent = `${percent}%`;

                // Calculate and Update Stats
                const elapsed = Date.now() - startTime;
                const sessionsProcessed = processedCount - (filenames.length - 1); // Current session count roughly
                // Use total run time for speed estimation if resuming? Better to use current session speed
                const currentSessionProcessed = processedCount - (totalCount - unprocessedImages.length - 1); // Logic tricky here, stick to session speed
                // Let's use simple session speed:
                // We don't have exactly "session start index" easy here without extra var...
                // Actually start time is from NOW.
                // processed in this session = processedCount - (initial filenames length)
                const processedInSession = processedCount - (filenames.length - 1);

                const speed = processedInSession > 0 ? elapsed / processedInSession : 0;
                const remaining = unprocessedImages.length;
                const eta = remaining * speed;

                const elapsedStr = this.formatTime(elapsed);
                const speedStr = speed > 0 ? `${(speed / 1000).toFixed(1)}s/img` : '-';
                const etaStr = remaining > 0 ? this.formatTime(eta) : 'Complete!';
                const progressStr = `${processedCount}/${totalCount} images`;

                document.getElementById('gen-stat-elapsed').textContent = `⏱️ ${elapsedStr} | ${progressStr}`;
                document.getElementById('gen-stat-speed').textContent = `⚡ ${speedStr}`;
                document.getElementById('gen-stat-eta').textContent = `🏁 ${etaStr}`;

                // Save every image
                await this.saveData(runFolder, filenames, captions, embeddings);
            }

            if (!this.isAborted) {
                this.log(`Generation complete (${mode}). Metadata saved.`);
            }

        } catch (error) {
            this.log(`Generation failed: ${error.message}`, 'error');
            console.error(error);
        } finally {
            document.getElementById('btn-start-generation').hidden = false;
            const btnStartRandom = document.getElementById('btn-start-generation-random');
            if (btnStartRandom) btnStartRandom.hidden = false;

            btnAbort.hidden = true;
            btnAbort.disabled = false;
            btnAbort.textContent = 'Abort';
            document.getElementById('gen-progress-stats').hidden = true;
        }
    }

    formatTime(ms) {
        const totalSeconds = Math.floor(ms / 1000);
        const minutes = Math.floor(totalSeconds / 60);
        const seconds = totalSeconds % 60;
        return `${minutes}:${seconds.toString().padStart(2, '0')}`;
    }

    async saveData(folder, filenames, captions, embeddings) {
        await this.fs.writeFile(`metadata/${folder}/filenamesArray.json`, JSON.stringify(filenames));
        await this.fs.writeFile(`metadata/${folder}/captionsArray.json`, JSON.stringify(captions));
        await this.fs.writeFile(`metadata/${folder}/embeddingsArray.json`, JSON.stringify(embeddings));
    }
}
