import { FileSystemManager } from './file_system.js';
import { GenerationStep } from './generation.js';
import { ClusteringStep } from './clustering.js';
import { OrganizationStep } from './organization.js';

class App {
    constructor() {
        this.fs = new FileSystemManager();
        this.generation = new GenerationStep(this.fs, this.log.bind(this));
        this.clustering = new ClusteringStep(this.fs, this.log.bind(this));
        this.organization = new OrganizationStep(this.fs, this.log.bind(this));

        // Cache GPU support status
        this.hasWebGPU = !!navigator.gpu;
        this.isGenerationRunning = false;

        this.initEventListeners();
        this.log("System initialized. Please select an image folder to begin.");
    }

    initEventListeners() {
        // Folder Selection
        document.getElementById('btn-select-folder').addEventListener('click', async () => {
            try {
                const dirName = await this.fs.selectDirectory();
                document.getElementById('selected-folder-name').textContent = dirName;
                this.enableTabs();
                this.log(`Selected folder: ${dirName}`);

                // Auto-cleanup empty metadata folders
                const deleted = await this.fs.deleteEmptyMetadataFolders();
                if (deleted.length > 0) {
                    this.log(`🧹 Cleaned up ${deleted.length} empty metadata folder(s)`);
                }

                this.updateRunLists();
            } catch (error) {
                this.log(`Error selecting folder: ${error.message}`, 'error');
            }
        });

        // Tab Switching
        document.querySelectorAll('.nav-item').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const tabId = e.currentTarget.dataset.tab;
                this.switchTab(tabId);
            });
        });

        // Temperature Slider
        const tempSlider = document.getElementById('llm-temperature');
        if (tempSlider) {
            tempSlider.addEventListener('input', (e) => {
                const valDisplay = document.getElementById('llm-temperature-value');
                if (valDisplay) valDisplay.textContent = e.target.value;
            });
        }

        // Generation Mode Toggle - REMOVED (moved to modal)
        /*
        document.querySelectorAll('input[name="gen-mode"]').forEach(radio => {
            radio.addEventListener('change', (e) => {
                const mode = e.target.value;
                if (mode === 'legacy') {
                    document.getElementById('gen-params-legacy').hidden = false;
                    document.getElementById('gen-params-clip').hidden = true;
                } else {
                    document.getElementById('gen-params-legacy').hidden = true;
                    document.getElementById('gen-params-clip').hidden = false;
                }
            });
        });
        */

        // Scan Model Button
        const btnScan = document.getElementById('btn-scan-model');
        if (btnScan) {
            btnScan.addEventListener('click', async () => {
                const folder = document.getElementById('clip-model-folder').value;
                const statusEl = document.getElementById('scan-status');

                statusEl.textContent = "Scanning...";
                statusEl.style.color = "var(--text-secondary)";

                const versions = await this.generation.scanModelVersions(folder);

                if (!versions.hasQuantized && !versions.hasFull) {
                    statusEl.innerHTML = "❌ No valid model files found. Check folder name.";
                    statusEl.style.color = "#ef4444";
                } else {
                    let msg = "✅ Found: ";
                    if (versions.hasQuantized) msg += "[Quantized] ";
                    if (versions.hasFull) msg += "[Full Precision]";
                    statusEl.textContent = msg;
                    statusEl.style.color = "#10b981";

                    // Auto-select logic
                    const select = document.getElementById('clip-precision');
                    if (versions.hasQuantized && !versions.hasFull) select.value = 'quantized';
                    else if (!versions.hasQuantized && versions.hasFull) select.value = 'full';
                    else select.value = 'auto';
                }
            });
        }

        // Generation Sequential
        // Generation Sequential
        document.getElementById('btn-start-generation').addEventListener('click', async () => {
            await this.handleStartGeneration('sequential');
        });

        // Generation Random
        document.getElementById('btn-start-generation-random').addEventListener('click', async () => {
            await this.handleStartGeneration('random');
        });

        // Generation Resume Select Change
        const genResumeSelect = document.getElementById('gen-resume-select');
        if (genResumeSelect) {
            genResumeSelect.addEventListener('change', () => {
                this.updateGenerationButtons();
            });
        }

        // Generation Abort
        document.getElementById('btn-abort-generation').addEventListener('click', () => {
            this.generation.abort();
        });

        // Clustering Algorithm Selector
        const algoSelect = document.getElementById('clustering-algorithm-select');
        if (algoSelect) {
            algoSelect.addEventListener('change', () => {
                const selectedAlgo = algoSelect.value;
                document.querySelectorAll('.algo-params').forEach(div => {
                    const algos = div.dataset.algo.split(' ');
                    if (algos.includes(selectedAlgo)) {
                        div.hidden = false;
                    } else {
                        div.hidden = true;
                    }
                });
            });
        }

        // Clustering
        document.getElementById('btn-run-clustering').addEventListener('click', async () => {
            const sourceRun = document.getElementById('clustering-source-select').value;
            if (!sourceRun) {
                this.showInfoModal('⚠️ Selection Required', 'Please select a source generation run from the dropdown.');
                return;
            }

            const algorithm = document.getElementById('clustering-algorithm-select').value;
            let config = { algorithm };
            let configItems = [{ key: 'sourceRun', label: 'Source Data', value: sourceRun, type: 'text', readonly: true }];

            // Safely get value helper
            const getValue = (id, type) => {
                const el = document.getElementById(id);
                if (!el) {
                    console.error(`Missing DOM Element: ${id}`);
                    this.log(`Error: UI Element '${id}' not found. Please refresh the page.`, 'error');
                    return type === 'int' ? 1 : (type === 'float' ? 0.0 : '');
                }
                const val = el.value;
                if (type === 'float') return parseFloat(val) || 0;
                if (type === 'int') return parseInt(val) || 1;
                return val;
            };

            // Gather specific params
            if (algorithm === 'dbscan' || algorithm === 'optics' || algorithm === 'hdbscan') {
                config.epsilon = getValue('cluster-epsilon', 'float');
                config.minPts = getValue('cluster-minpts', 'int');
                configItems.push(
                    { key: 'epsilon', label: 'Epsilon', value: config.epsilon, type: 'number', step: 0.01, min: 0, max: 2 },
                    { key: 'minPts', label: 'MinPts', value: config.minPts, type: 'number', step: 1, min: 1, max: 100 }
                );
            } else if (algorithm === 'kmeans' || algorithm === 'hierarchical') {
                config.k = getValue('cluster-k', 'int');
                configItems.push(
                    { key: 'k', label: 'Number of Clusters (K)', value: config.k, type: 'number', step: 1, min: 2, max: 100 }
                );

                if (algorithm === 'hierarchical') {
                    config.linkage = getValue('cluster-linkage', 'text');
                    configItems.push({ key: 'linkage', label: 'Linkage', value: config.linkage, type: 'text', readonly: true });
                }
            }

            const confirmedConfig = await this.showConfigConfirmation('Clustering Analysis', configItems);

            if (confirmedConfig) {
                confirmedConfig.algorithm = algorithm; // Ensure algorithm is preserved
                this.log(`Starting clustering with source: ${sourceRun} (${algorithm})`);
                await this.clustering.run(sourceRun, confirmedConfig);
            }
        });

        // Save Selected Clusters
        document.getElementById('btn-save-clusters').addEventListener('click', async () => {
            await this.clustering.saveSelectedClusters();
            this.updateRunLists(); // Update for Organization step
        });

        // Enable clustering button when source is selected
        document.getElementById('clustering-source-select').addEventListener('change', (e) => {
            document.getElementById('btn-run-clustering').disabled = !e.target.value;
        });

        // Organization
        document.getElementById('btn-run-organization').addEventListener('click', async () => {
            const sourceCluster = document.getElementById('org-source-select').value;
            if (!sourceCluster) {
                this.showInfoModal('⚠️ Selection Required', 'Please select a clustering run from the dropdown.');
                return;
            }

            const mode = document.querySelector('input[name="org-mode"]:checked').value;

            const confirmedConfig = await this.showConfigConfirmation('Folder Organization', [
                { key: 'sourceCluster', label: 'Source Clusters', value: sourceCluster, type: 'text', readonly: true },
                { key: 'mode', label: 'Operation Mode', value: mode, type: 'text', readonly: true } // Mode not editable here for simplicity, or could be select
            ]);

            if (confirmedConfig) {
                await this.organization.run(sourceCluster, confirmedConfig.mode);
            }
        });

        // Enable organization button when source is selected
        document.getElementById('org-source-select').addEventListener('change', (e) => {
            document.getElementById('btn-run-organization').disabled = !e.target.value;
        });

        // Prepopulate settings when a resume run is selected
        document.getElementById('gen-resume-select').addEventListener('change', async (e) => {
            const run = e.target.value;
            if (!run) return;

            const config = await this.fs.readFile(`metadata/${run}/config.json`, 'json');
            if (config) {
                this.log(`Prepopulating settings from ${run}...`);

                // Set mode
                if (config.mode === 'direct_clip') {
                    document.querySelector('input[name="gen-mode"][value="clip"]').checked = true;
                    document.getElementById('gen-params-legacy').hidden = true;
                    document.getElementById('gen-params-clip').hidden = false;

                    document.getElementById('clip-model-folder').value = config.modelFolderName || 'clip-vit-base-patch16';
                    const precisionSelect = document.getElementById('clip-precision');
                    if (config.quantized === true) precisionSelect.value = 'quantized';
                    else if (config.quantized === false) precisionSelect.value = 'full';
                    else precisionSelect.value = 'auto';
                } else {
                    document.querySelector('input[name="gen-mode"][value="legacy"]').checked = true;
                    document.getElementById('gen-params-legacy').hidden = false;
                    document.getElementById('gen-params-clip').hidden = true;

                    document.getElementById('llm-model').value = config.modelFileName || '';
                    document.getElementById('llm-prompt').value = config.systemPrompt || '';
                    document.getElementById('llm-temperature').value = config.temperature || 0;
                    document.getElementById('llm-temperature-value').textContent = config.temperature || 0;
                    document.getElementById('llm-max-tokens').value = config.maxTokens || 512;
                }
            } else {
                // For older runs without config.json, we still log that we're using those runs
                // and switch the UI mode if we can infer it
                const isClip = run.includes('_clip');
                this.log(`Resuming ${isClip ? 'CLIP' : 'Gemma'} run: ${run} (Settings inferred from folder name)`);

                if (isClip) {
                    document.querySelector('input[name="gen-mode"][value="clip"]').checked = true;
                    document.getElementById('gen-params-legacy').hidden = true;
                    document.getElementById('gen-params-clip').hidden = false;
                } else {
                    document.querySelector('input[name="gen-mode"][value="legacy"]').checked = true;
                    document.getElementById('gen-params-legacy').hidden = false;
                    document.getElementById('gen-params-clip').hidden = true;
                }
            }
        });
    }

    async handleStartGeneration(type) { // type = 'sequential' or 'random'
        const resumeRun = document.getElementById('gen-resume-select').value;
        let configItems = [];
        let initialConfig = {};

        if (resumeRun) {
            // Resume logic
            const config = await this.fs.readFile(`metadata/${resumeRun}/config.json`, 'json');
            if (config) {
                initialConfig = config;
            } else {
                // Infer
                initialConfig = {
                    mode: resumeRun.includes('_clip') ? 'direct_clip' : 'legacy',
                    systemPrompt: "Analyze this image and classify it into a single category. Output ONLY the category name (e.g. 'Landscape', 'Portrait', 'Document', 'Vehicle'). Do not include any explanation or other text."
                };
            }
            configItems.push({
                key: 'mode',
                label: 'Pipeline',
                value: initialConfig.mode,
                displayValue: initialConfig.mode === 'direct_clip' ? 'CLIP (Visual)' : 'Gemma (Captions)',
                type: 'text',
                readonly: true
            });
        } else {
            // New Run logic
            initialConfig = {
                mode: 'direct_clip',
                systemPrompt: "Analyze this image and classify it into a single category. Output ONLY the category name (e.g. 'Landscape', 'Portrait', 'Document', 'Vehicle'). Do not include any explanation or other text."
            };
            configItems.push({
                key: 'mode',
                label: 'Pipeline',
                value: initialConfig.mode,
                type: 'select',
                options: [
                    { v: 'direct_clip', l: 'Direct Image Embedding (CLIP)' },
                    { v: 'legacy', l: 'Dense Captioning (Gemma + USE)' }
                ]
            });
        }

        const defaultDevice = this.hasWebGPU ? 'webgpu' : 'wasm';

        // CLIP specific fields
        configItems.push(
            {
                key: 'clip_device', label: 'Compute Device', value: initialConfig.device || defaultDevice, type: 'select',
                options: [
                    { v: 'webgpu', l: `WebGPU ${this.hasWebGPU ? '(Detected)' : '(Not Supported)'}` },
                    { v: 'wasm', l: 'WASM (CPU - Safe Fallback)' },
                    { v: 'webgl', l: 'WebGL (Legacy GPU)' }
                ],
                group: 'direct_clip',
                help: "WebGPU is fastest."
            },
            {
                key: 'precision', label: 'Precision',
                value: (initialConfig.quantized === true ? 'quantized' : (initialConfig.quantized === false ? 'full' : 'quantized')),
                type: 'select',
                options: [
                    { v: 'quantized', l: 'Quantized (Faster, Lower Memory)' },
                    { v: 'full', l: 'Full Precision (Slower, Higher Quality)' }
                ],
                group: 'direct_clip',
                help: "Quantized is recommended for most use cases."
            },
            { key: 'modelFolderName', label: 'Model Folder', value: initialConfig.modelFolderName || 'clip-vit-base-patch16', type: 'text', readonly: true, group: 'direct_clip' }
        );

        // Gemma specific fields
        configItems.push(
            {
                key: 'gemma_device', label: 'Compute Device', value: initialConfig.device || 'gpu', type: 'select',
                options: [{ v: 'gpu', l: 'GPU (MediaPipe)' }, { v: 'cpu', l: 'CPU (MediaPipe)' }],
                group: 'legacy'
            },
            { key: 'temperature', label: 'Temperature', value: initialConfig.temperature || 0, type: 'number', step: 0.1, min: 0, max: 1, group: 'legacy' },
            { key: 'maxTokens', label: 'Max Tokens', value: initialConfig.maxTokens || 512, type: 'number', step: 32, min: 32, max: 2048, group: 'legacy' },
            { key: 'systemPrompt', label: 'System Prompt', value: initialConfig.systemPrompt || "", type: 'textarea', span: 2, group: 'legacy' },
            { key: 'modelFileName', label: 'Model File', value: initialConfig.modelFileName || 'gemma-3n-E2B-it-int4-Web.litertlm', type: 'text', readonly: true, group: 'legacy' }
        );

        const modalTitle = `${resumeRun ? 'Resume' : 'New'} ${type === 'random' ? 'Random' : 'Sequential'} Analysis`;
        const confirmedConfig = await this.showConfigConfirmation(modalTitle, configItems);

        if (confirmedConfig) {
            const finalConfig = {
                mode: confirmedConfig.mode,
                runFolder: resumeRun || undefined
            };

            if (finalConfig.mode === 'direct_clip') {
                finalConfig.device = confirmedConfig.clip_device;
                finalConfig.modelFolderName = initialConfig.modelFolderName || 'clip-vit-base-patch16';
                finalConfig.quantized = confirmedConfig.precision === 'quantized';
            } else {
                finalConfig.device = confirmedConfig.gemma_device;
                finalConfig.temperature = confirmedConfig.temperature;
                finalConfig.maxTokens = confirmedConfig.maxTokens;
                finalConfig.systemPrompt = confirmedConfig.systemPrompt;
                finalConfig.modelFileName = initialConfig.modelFileName || 'gemma-3n-E2B-it-int4-Web.litertlm';
                finalConfig.embeddingModel = 'universal_sentence_encoder.tflite';
            }

            this.switchTab('generation');
            this.isGenerationRunning = true;
            this.updateGenerationButtons();
            try {
                await this.generation.run(finalConfig, type);
            } finally {
                this.isGenerationRunning = false;
                this.updateRunLists();
            }
        }
    }

    showConfigConfirmation(title, items) {
        return new Promise((resolve) => {
            const modal = document.createElement('div');
            modal.className = 'resume-modal';

            // Extract mode field separately to display in top section
            const modeItem = items.find(item => item.key === 'mode');
            const readonlyItems = items.filter(item => item.readonly && item.key !== 'mode');
            const editableItems = items.filter(item => !item.readonly && item.key !== 'mode');

            const initialMode = modeItem?.value;

            // Create mode field HTML (render in top section)
            let modeHtml = '';
            if (modeItem) {
                if (modeItem.type === 'select') {
                    // Editable mode dropdown
                    modeHtml = `
                        <div class="read-only-item" style="grid-column: span 2;">
                            <label>Pipeline</label>
                            <select name="mode" style="width: 100%; padding: 0.5rem; border: 1px solid var(--border-color); border-radius: 0.375rem; font-size: 0.9rem; background: white;">
                                ${modeItem.options.map(o => `<option value="${o.v}" ${o.v === modeItem.value ? 'selected' : ''}>${o.l}</option>`).join('')}
                            </select>
                        </div>
                    `;
                } else {
                    // Readonly mode display
                    modeHtml = `
                        <div class="read-only-item" style="grid-column: span 2;">
                            <label>${modeItem.label}</label>
                            <span>${modeItem.displayValue || modeItem.value}</span>
                        </div>
                    `;
                }
            }

            const readonlyHtml = (modeHtml || readonlyItems.length > 0) ? `
                <div class="modal-readonly-section">
                    ${modeHtml}
                    ${readonlyItems.map(item => {
                const isHidden = item.group && item.group !== initialMode;
                return `
                        <div class="read-only-item" data-group="${item.group || ''}" ${isHidden ? 'hidden' : ''}>
                            <label>${item.label}</label>
                            <span>${item.displayValue || item.value}</span>
                        </div>
                        `;
            }).join('')}
                </div>
            ` : '';

            const itemsHtml = editableItems.map(item => {
                let inputHtml = '';
                if (item.type === 'textarea') {
                    inputHtml = `<textarea name="${item.key}" rows="3">${item.value}</textarea>`;
                } else if (item.type === 'select') {
                    inputHtml = `<select name="${item.key}">${item.options.map(o => `<option value="${o.v}" ${o.v === item.value ? 'selected' : ''} ${o.v === 'webgpu' && !this.hasWebGPU ? 'style="color:#999"' : ''}>${o.l}</option>`).join('')}</select>`;
                } else {
                    inputHtml = `<input type="${item.type || 'text'}" name="${item.key}" value="${item.value}" ${item.min !== undefined ? `min="${item.min}"` : ''} ${item.max !== undefined ? `max="${item.max}"` : ''} ${item.step !== undefined ? `step="${item.step}"` : ''}`;
                }

                const isHidden = item.group && item.group !== initialMode;

                return `
                <div class="config-item ${item.span ? `span-${item.span}` : ''}" data-group="${item.group || ''}" ${isHidden ? 'hidden' : ''}>
                    <label>${item.label}:</label>
                    ${inputHtml}
                    ${item.help ? `<small style="display:block; color:#6b7280; font-size:0.75rem; margin-top:4px;">${item.help}</small>` : ''}
                </div>
                `;
            }).join('');

            // Build the modal HTML with clear structure
            const modalContent = `
                <div class="resume-modal-content">
                    <div class="modal-header">
                        <h2>${title}</h2>
                        <p>Review and edit settings if needed.</p>
                    </div>
                    ${readonlyHtml}
                    ${editableItems.length > 0 ? `
                    <div class="modal-editable-section">
                        <div class="resume-stats grid-2">
                            ${itemsHtml}
                        </div>
                    </div>
                    ` : ''}
                    <div class="resume-modal-actions">
                        <button class="btn-new">Cancel</button>
                        <button class="btn-resume">Proceed</button>
                    </div>
                </div>
            `;
            modal.innerHTML = modalContent;

            document.body.appendChild(modal);

            // Handle Dynamic Mode Switching
            const modeSelect = modal.querySelector('select[name="mode"]');
            if (modeSelect) {
                modeSelect.addEventListener('change', (e) => {
                    const newMode = e.target.value;
                    // Toggle editable items
                    modal.querySelectorAll('.config-item[data-group]').forEach(div => {
                        div.hidden = div.dataset.group && div.dataset.group !== newMode;
                    });
                    // Toggle read-only items
                    modal.querySelectorAll('.read-only-item[data-group]').forEach(div => {
                        div.hidden = div.dataset.group && div.dataset.group !== newMode;
                    });
                });
            }

            modal.querySelector('.btn-resume').addEventListener('click', () => {
                const newConfig = {};
                items.forEach(item => {
                    if (item.readonly) {
                        newConfig[item.key] = item.value;
                    } else {
                        const input = modal.querySelector(`[name="${item.key}"]`);
                        if (input) {
                            let val = input.value;
                            if (item.type === 'number') val = parseFloat(val);
                            newConfig[item.key] = val;
                        }
                    }
                });

                document.body.removeChild(modal);
                resolve(newConfig);
            });

            modal.querySelector('.btn-new').addEventListener('click', () => {
                document.body.removeChild(modal);
                resolve(null); // Cancelled
            });
        });
    }

    enableTabs() {
        document.querySelectorAll('.nav-item').forEach(btn => btn.disabled = false);
    }

    switchTab(tabId) {
        document.querySelectorAll('.nav-item').forEach(btn => btn.classList.remove('active'));
        document.querySelector(`.nav-item[data-tab="${tabId}"]`).classList.add('active');

        document.querySelectorAll('.tab-content').forEach(content => content.classList.remove('active'));
        document.getElementById(`tab-${tabId}`).classList.add('active');
    }

    showInfoModal(title, message) {
        const modal = document.createElement('div');
        modal.className = 'resume-modal';
        modal.innerHTML = `
            <div class="resume-modal-content">
                <h2>${title}</h2>
                <p>${message}</p>
                <div class="resume-modal-actions">
                    <button class="btn-resume">OK</button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        modal.querySelector('.btn-resume').addEventListener('click', () => {
            document.body.removeChild(modal);
        });
    }

    async updateRunLists() {
        if (!this.fs.hasDirectory()) return;

        const dirs = await this.fs.listDirectories('metadata');

        // Filter for Generation runs (gen_...)
        const genRuns = dirs.filter(d => d.startsWith('gen_')).sort().reverse();
        const genSelect = document.getElementById('clustering-source-select');
        const genResumeSelect = document.getElementById('gen-resume-select');
        const clusterBtn = document.getElementById('btn-run-clustering');
        genSelect.innerHTML = '<option value="">Select a Generation Run...</option>';
        if (genResumeSelect) genResumeSelect.innerHTML = '<option value="">(New Run)</option>';

        const totalImagesFound = await this.fs.listRootImages();

        for (const run of genRuns) {
            // Get image count from metadata
            const filenames = await this.fs.readFile(`metadata/${run}/filenamesArray.json`, 'json');
            const count = filenames ? filenames.length : 0;

            const isIncomplete = count < totalImagesFound.length;

            // Parse timestamp from folder name (gen_YYYY-MM-DD_HH-MM-SS...)
            let timestampPartRaw = run.replace('gen_', '');
            let modeLabel = ' (Seq)';

            if (timestampPartRaw.includes('_random')) {
                modeLabel = ' (Rand)';
            } else if (timestampPartRaw.includes('_sequential')) {
                modeLabel = ' (Seq)';
            }

            // Extract only the YYYY-MM-DD_HH-MM-SS part for formatting
            const timestampPart = timestampPartRaw.split('_').slice(0, 2).join('_');

            const formattedDate = this.formatRunTimestamp(timestampPart);

            // Get config if available
            const config = await this.fs.readFile(`metadata/${run}/config.json`, 'json');
            let configInfo = '';
            if (config) {
                if (config.mode === 'direct_clip') {
                    configInfo = ` [CLIP ${config.device || 'webgpu'}]`;
                } else {
                    configInfo = ` [Gemma ${config.device || 'gpu'}]`;
                }
            } else {
                // Fallback: Infer from folder name if config.json is missing (for older runs)
                if (run.includes('_clip')) {
                    configInfo = ' [CLIP]';
                } else if (run.startsWith('gen_')) {
                    configInfo = ' [Gemma]';
                }
            }

            const label = `${formattedDate} (${count} imgs)${modeLabel}${configInfo}${isIncomplete ? ' [INCOMPLETE]' : ''}`;

            const option = document.createElement('option');
            option.value = run;
            option.textContent = label;

            // Add to Step 1 Resume dropdown if incomplete
            if (isIncomplete && genResumeSelect) {
                genResumeSelect.appendChild(option.cloneNode(true));
            }

            // Add to Step 2 Source dropdown if it has at least some data
            if (count > 0) {
                genSelect.appendChild(option);
            }
        }

        // Enable button if there's a pre-selected value
        clusterBtn.disabled = !genSelect.value;

        // Filter for Clustering runs (cluster_...)
        const clusterRuns = dirs.filter(d => d.startsWith('cluster_')).sort().reverse();
        const orgSelect = document.getElementById('org-source-select');
        const orgBtn = document.getElementById('btn-run-organization');
        orgSelect.innerHTML = '<option value="">Select a Clustering Run...</option>';

        for (const run of clusterRuns) {
            // Get cluster count
            const clusters = await this.fs.readFile(`metadata/${run}/clusters.json`, 'json');
            const clusterCount = clusters ? clusters.length : 0;

            // Skip empty or invalid runs
            if (clusterCount === 0) continue;

            // Parse timestamp
            const timestampPart = run.replace('cluster_', '').split('_from_')[0];
            const formattedDate = this.formatRunTimestamp(timestampPart);

            const option = document.createElement('option');
            option.value = run;
            option.textContent = `${formattedDate} (${clusterCount} clusters)`;
            orgSelect.appendChild(option);
        }

        // Enable button if there's a pre-selected value
        orgBtn.disabled = !orgSelect.value;

        // Update Step 1 buttons based on resume selection
        this.updateGenerationButtons();
    }

    updateGenerationButtons() {
        const genResumeSelect = document.getElementById('gen-resume-select');
        const btnSeq = document.getElementById('btn-start-generation');
        const btnRand = document.getElementById('btn-start-generation-random');

        if (!genResumeSelect || !btnSeq || !btnRand) return;

        const resumeContainer = genResumeSelect.closest('.form-group');

        if (this.isGenerationRunning) {
            btnSeq.hidden = true;
            btnRand.hidden = true;
            if (resumeContainer) resumeContainer.hidden = true;
            return;
        }

        if (resumeContainer) resumeContainer.hidden = false;
        const selectedRun = genResumeSelect.value;

        if (!selectedRun) {
            // New Run
            btnSeq.hidden = false;
            btnRand.hidden = false;
            btnSeq.textContent = 'Start Sequential Analysis';
            btnRand.textContent = 'Start Random Analysis';
        } else if (selectedRun.includes('_random')) {
            // Resume Random
            btnSeq.hidden = true;
            btnRand.hidden = false;
            btnRand.textContent = 'Resume Random Analysis';
        } else {
            // Resume Sequential (includes _sequential suffix or no suffix for older runs)
            btnSeq.hidden = false;
            btnRand.hidden = true;
            btnSeq.textContent = 'Resume Sequential Analysis';
        }
    }

    formatRunTimestamp(timestampStr) {
        // Convert "2025-12-05_02-04-30" to "Dec 5, 2025 02:04"
        try {
            const [datePart, timePart] = timestampStr.split('_');
            const [year, month, day] = datePart.split('-');
            const [hour, minute] = timePart.split('-');

            const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
                'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
            const monthName = months[parseInt(month) - 1];

            return `${monthName} ${parseInt(day)}, ${year} ${hour}:${minute}`;
        } catch {
            return timestampStr; // Fallback to original
        }
    }

    log(message, type = 'info') {
        const timestamp = new Date().toLocaleTimeString();
        const entry = document.createElement('div');
        entry.className = 'log-entry';
        entry.style.color = type === 'error' ? '#ef4444' : '#10b981';
        entry.textContent = `[${timestamp}] ${message}`;

        document.getElementById('system-log-window').prepend(entry);

        // Also log to specific tab windows if active
        const activeTab = document.querySelector('.tab-content.active').id;
        if (activeTab === 'tab-generation') {
            document.getElementById('gen-log-window').prepend(entry.cloneNode(true));
        } else if (activeTab === 'tab-organization') {
            document.getElementById('org-log-window').prepend(entry.cloneNode(true));
        }
    }
}

// Initialize App
window.app = new App();
