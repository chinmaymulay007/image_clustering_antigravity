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
        document.getElementById('llm-temperature').addEventListener('input', (e) => {
            document.getElementById('llm-temperature-value').textContent = e.target.value;
        });

        // Generation
        document.getElementById('btn-start-generation').addEventListener('click', async () => {
            const initialConfig = {
                modelFileName: document.getElementById('llm-model').value,
                systemPrompt: document.getElementById('llm-prompt').value,
                temperature: parseFloat(document.getElementById('llm-temperature').value),
                maxTokens: parseInt(document.getElementById('llm-max-tokens').value),
                embeddingModel: document.getElementById('embedding-model').value
            };

            const confirmedConfig = await this.showConfigConfirmation('Generation Settings', [
                { key: 'modelFileName', label: 'LLM Model', value: initialConfig.modelFileName, type: 'text', readonly: true },
                { key: 'systemPrompt', label: 'System Prompt', value: initialConfig.systemPrompt, type: 'textarea' },
                { key: 'temperature', label: 'Temperature', value: initialConfig.temperature, type: 'number', step: 0.1, min: 0, max: 1 },
                { key: 'maxTokens', label: 'Max Tokens', value: initialConfig.maxTokens, type: 'number', step: 32, min: 32, max: 2048 },
                { key: 'embeddingModel', label: 'Embedding Model', value: initialConfig.embeddingModel, type: 'text', readonly: true }
            ]);

            if (confirmedConfig) {
                this.switchTab('generation');
                await this.generation.run(confirmedConfig);
                this.updateRunLists();
            }
        });

        // Generation Abort
        document.getElementById('btn-abort-generation').addEventListener('click', () => {
            this.generation.abort();
        });

        // Clustering
        document.getElementById('btn-run-clustering').addEventListener('click', async () => {
            const sourceRun = document.getElementById('clustering-source-select').value;
            if (!sourceRun) {
                this.showInfoModal('⚠️ Selection Required', 'Please select a source generation run from the dropdown.');
                return;
            }

            const initialConfig = {
                epsilon: parseFloat(document.getElementById('cluster-epsilon').value),
                minPts: parseInt(document.getElementById('cluster-minpts').value)
            };

            const confirmedConfig = await this.showConfigConfirmation('Clustering Settings', [
                { key: 'sourceRun', label: 'Source Data', value: sourceRun, type: 'text', readonly: true },
                { key: 'epsilon', label: 'Epsilon', value: initialConfig.epsilon, type: 'number', step: 0.01, min: 0, max: 2 },
                { key: 'minPts', label: 'MinPts', value: initialConfig.minPts, type: 'number', step: 1, min: 1, max: 100 }
            ]);

            if (confirmedConfig) {
                this.log(`Starting clustering with source: ${sourceRun}`);
                // Use the confirmed config values
                await this.clustering.run(sourceRun, confirmedConfig);
                // Note: updateRunLists is NOT called here anymore because we don't auto-save
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

            const confirmedConfig = await this.showConfigConfirmation('Organization Settings', [
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
    }

    showConfigConfirmation(title, items) {
        return new Promise((resolve) => {
            const modal = document.createElement('div');
            modal.className = 'resume-modal';

            const itemsHtml = items.map(item => {
                let inputHtml = '';
                if (item.readonly) {
                    inputHtml = `<input type="text" value="${item.value}" readonly class="readonly-input">`;
                } else if (item.type === 'textarea') {
                    inputHtml = `<textarea name="${item.key}" rows="3">${item.value}</textarea>`;
                } else {
                    inputHtml = `<input type="${item.type || 'text'}" name="${item.key}" value="${item.value}" ${item.min !== undefined ? `min="${item.min}"` : ''} ${item.max !== undefined ? `max="${item.max}"` : ''} ${item.step !== undefined ? `step="${item.step}"` : ''}>`;
                }

                return `
                <div>
                    <label>${item.label}:</label>
                    ${inputHtml}
                </div>
                `;
            }).join('');

            modal.innerHTML = `
                <div class="resume-modal-content">
                    <h2>⚙️ ${title}</h2>
                    <p>Review and edit settings if needed.</p>
                    <div class="resume-stats">
                        ${itemsHtml}
                    </div>
                    <div class="resume-modal-actions">
                        <button class="btn-new">Cancel</button>
                        <button class="btn-resume">Proceed</button>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);

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
        const clusterBtn = document.getElementById('btn-run-clustering');
        genSelect.innerHTML = '<option value="">Select a Generation Run...</option>';

        for (const run of genRuns) {
            // Get image count from metadata
            const filenames = await this.fs.readFile(`metadata/${run}/filenamesArray.json`, 'json');
            const count = filenames ? filenames.length : 0;

            // Skip empty or invalid runs
            if (count === 0) continue;

            // Parse timestamp from folder name (gen_YYYY-MM-DD_HH-MM-SS)
            const timestampPart = run.replace('gen_', '');
            const formattedDate = this.formatRunTimestamp(timestampPart);

            const option = document.createElement('option');
            option.value = run;
            option.textContent = `${formattedDate} (${count} images)`;
            genSelect.appendChild(option);
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
