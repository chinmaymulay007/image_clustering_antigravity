export class UIManager {
    constructor() {
        // Elements
        this.overlayInitial = document.getElementById('overlay-initial');
        this.btnSelectInitial = document.getElementById('btn-select-folder-initial');

        this.statProcessed = document.getElementById('stat-processed');
        this.statTotal = document.getElementById('stat-total');
        this.statSpeed = document.getElementById('stat-speed');
        this.statEta = document.getElementById('stat-eta');

        this.btnPauseResume = document.getElementById('btn-pause-resume');
        this.inputRefresh = document.getElementById('setting-refresh');

        // Settings Modal Elements
        this.btnSettings = document.getElementById('btn-settings');
        this.modalSettings = document.getElementById('modal-settings');
        this.btnCloseSettings = document.getElementById('btn-close-settings');
        this.btnApplySettings = document.getElementById('btn-apply-settings');

        // Excluded Modal Elements
        this.btnViewExcluded = document.getElementById('btn-view-excluded');
        this.modalExcluded = document.getElementById('modal-excluded');
        this.btnCloseExcluded = document.getElementById('btn-close-excluded');
        this.btnCloseExcludedAction = document.getElementById('btn-close-excluded-action');
        this.excludedGrid = document.getElementById('excluded-grid');
        this.excludedEmptyMessage = document.getElementById('excluded-empty-message');

        this.settingK = document.getElementById('setting-k');
        this.valK = document.getElementById('val-k');
        this.settingThreshold = document.getElementById('setting-threshold');
        this.valThreshold = document.getElementById('val-threshold');

        this.clusterGrid = document.getElementById('cluster-grid-container');
        this.btnSave = document.getElementById('btn-save-clusters');
        this.statusBarText = document.getElementById('status-bar-text');
        this.settingAnimations = document.getElementById('setting-animations');

        // Save Choice Modal
        this.modalSaveChoice = document.getElementById('modal-save-choice');
        this.btnSaveSame = document.getElementById('btn-save-same');
        this.btnSaveDiff = document.getElementById('btn-save-diff');
        this.btnCancelSave = document.getElementById('btn-cancel-save');

        // State
        this.callbacks = {};
    }

    setCallbacks(callbacks) {
        this.callbacks = callbacks;
        this.initListeners();
    }

    initListeners() {
        this.btnSelectInitial.addEventListener('click', () => this.callbacks.onSelectFolder?.());

        this.btnPauseResume.addEventListener('click', () => {
            const isPaused = this.btnPauseResume.textContent === 'RESUME';
            this.callbacks.onPauseResume?.(!isPaused); // Toggle
        });

        // Settings Modal
        this.btnSettings.addEventListener('click', () => {
            this.modalSettings.classList.remove('hidden');
        });

        this.btnCloseSettings.addEventListener('click', () => {
            this.modalSettings.classList.add('hidden');
        });

        // Excluded Modal Listeners
        if (this.btnViewExcluded) {
            this.btnViewExcluded.addEventListener('click', () => {
                const excluded = this.callbacks.onGetExcludedPaths?.() || new Set();
                this.renderExcludedImages(excluded);
                this.modalExcluded.classList.remove('hidden');
            });
        }

        const closeExcludedManager = () => this.modalExcluded.classList.add('hidden');
        this.btnCloseExcluded.addEventListener('click', closeExcludedManager);
        this.btnCloseExcludedAction.addEventListener('click', closeExcludedManager);

        // Live values
        this.settingK.addEventListener('input', (e) => this.valK.textContent = e.target.value);
        this.settingThreshold.addEventListener('input', (e) => this.valThreshold.textContent = e.target.value);

        // Batch Options Buttons
        const batchButtons = document.querySelectorAll('#batch-options .opt-btn');
        const hiddenBatchInput = document.getElementById('setting-refresh');

        batchButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                batchButtons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                hiddenBatchInput.value = btn.dataset.value;
            });
        });

        this.btnApplySettings.addEventListener('click', () => {
            const settings = {
                k: parseInt(this.settingK.value),
                threshold: parseFloat(this.settingThreshold.value),
                refreshInterval: parseInt(hiddenBatchInput.value),
                disableAnimations: this.settingAnimations.checked
            };
            this.callbacks.onApplySettings?.(settings);
            this.modalSettings.classList.add('hidden');
        });

        this.btnSave.addEventListener('click', () => this.callbacks.onSave?.());

        this.btnSaveSame.addEventListener('click', () => {
            this.modalSaveChoice.classList.add('hidden');
            this.callbacks.onConfirmSaveLocation?.(false); // same
        });

        this.btnSaveDiff.addEventListener('click', () => {
            this.modalSaveChoice.classList.add('hidden');
            this.callbacks.onConfirmSaveLocation?.(true); // different
        });

        this.btnCancelSave.addEventListener('click', () => {
            this.modalSaveChoice.classList.add('hidden');
        });
    }

    hideInitialOverlay() {
        this.overlayInitial.classList.add('hidden');
    }

    updateStats(stats) {
        if (!stats) return;
        this.statProcessed.textContent = stats.processed;
        this.statTotal.textContent = stats.total;

        // Speed (sec per img)
        if (stats.speed !== undefined) {
            this.statSpeed.textContent = `${stats.speed.toFixed(2)} s/img`;
        } else {
            this.statSpeed.textContent = '-';
        }

        // ETA
        if (stats.eta) {
            this.statEta.textContent = this.formatTime(stats.eta);
        } else {
            this.statEta.textContent = '-';
        }

        if (stats.completed) {
            this.btnPauseResume.textContent = "COMPLETE";
            this.btnPauseResume.disabled = true;
            this.statusBarText.textContent = "Processing Complete. Ready to save.";
        } else if (stats.currentAction) {
            this.statusBarText.textContent = stats.currentAction;
        }
    }

    setPauseState(isPaused) {
        this.btnPauseResume.textContent = isPaused ? 'RESUME' : 'PAUSE';
        this.btnPauseResume.classList.toggle('btn-primary', isPaused);
        this.btnPauseResume.classList.toggle('btn-secondary', !isPaused);
    }

    renderClusters(clusters) {
        if (!clusters || clusters.length === 0) {
            this.clusterGrid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; margin-top: 50px; color: #9ca3af;">Scanning for patterns...</div>';
            return;
        }

        // 1. Remove clusters that are no longer present
        const existingCards = Array.from(this.clusterGrid.querySelectorAll('.cluster-card'));
        const activeIds = new Set(clusters.map((_, i) => i.toString()));

        existingCards.forEach(card => {
            if (!activeIds.has(card.dataset.clusterId)) {
                card.remove();
            }
        });

        // 2. Update or Create clusters
        clusters.forEach((cluster, index) => {
            let card = this.clusterGrid.querySelector(`.cluster-card[data-cluster-id="${index}"]`);
            const memberCount = cluster.memberCount !== undefined ? cluster.memberCount : cluster.members.length;
            const titleHtml = `${cluster.label || `Cluster ${index + 1}`} <span style="color:#9ca3af; font-size:0.8em">${memberCount} items</span>`;

            if (!card) {
                // Create New
                card = document.createElement('div');
                card.className = 'cluster-card';
                card.dataset.clusterId = index;

                const header = document.createElement('div');
                header.className = 'card-header';
                header.style.cssText = 'display:flex; align-items:center; gap:10px; padding: 5px;';

                const checkbox = document.createElement('input');
                checkbox.type = 'checkbox';
                checkbox.className = 'cluster-checkbox';
                checkbox.style.cssText = 'cursor:pointer; width:18px; height:18px;';

                const title = document.createElement('span');
                title.className = 'cluster-title';
                title.innerHTML = titleHtml;

                header.appendChild(checkbox);
                header.appendChild(title);
                card.appendChild(header);

                const grid = document.createElement('div');
                grid.className = 'image-grid';
                card.appendChild(grid);

                this.clusterGrid.appendChild(card);
            } else {
                // Update Existing Header
                const title = card.querySelector('.cluster-title');
                if (title && title.innerHTML !== titleHtml) {
                    title.innerHTML = titleHtml;
                }
            }

            // 3. Update Image Grid (Representatives)
            const grid = card.querySelector('.image-grid');
            const cells = Array.from(grid.querySelectorAll('.img-cell'));

            for (let i = 0; i < 16; i++) {
                let cell = cells[i];
                if (!cell) {
                    cell = document.createElement('div');
                    cell.className = 'img-cell';
                    grid.appendChild(cell);
                }

                if (i < cluster.representatives.length) {
                    const imgData = cluster.representatives[i];

                    // Only update if the image changed
                    if (cell.dataset.path !== imgData.path) {
                        cell.dataset.path = imgData.path;
                        cell.innerHTML = ''; // Clear previous content

                        const image = document.createElement('img');
                        const btnRemove = document.createElement('button');
                        btnRemove.innerHTML = '×';
                        btnRemove.style.cssText = 'position:absolute; top:2px; right:2px; background:rgba(0,0,0,0.6); color:white; border:none; border-radius:50%; width:20px; height:20px; cursor:pointer; display:none; justify-content:center; align-items:center; line-height:1; z-index:10;';

                        cell.onmouseenter = () => btnRemove.style.display = 'flex';
                        cell.onmouseleave = () => btnRemove.style.display = 'none';

                        btnRemove.onclick = (e) => {
                            e.stopPropagation();
                            this.callbacks.onExcludeImage?.(imgData.path);
                        };

                        cell.appendChild(image);
                        cell.appendChild(btnRemove);

                        // Add skeleton loading state
                        cell.classList.add('skeleton');

                        this.callbacks.onLoadThumbnail?.(imgData.path).then(url => {
                            if (!url) {
                                cell.classList.remove('skeleton'); // Failed, remove shimmer
                                return;
                            }

                            if (cell.dataset.path === imgData.path) {
                                image.src = url;
                                // Handle both fresh loads and already-complete cached images
                                if (image.complete) {
                                    image.classList.add('loaded');
                                    cell.classList.remove('skeleton');
                                } else {
                                    image.onload = () => {
                                        image.classList.add('loaded');
                                        cell.classList.remove('skeleton');
                                    };
                                }
                            }
                        }).catch(() => {
                            cell.classList.remove('skeleton');
                        });
                    }
                } else {
                    // Empty slot
                    if (cell.dataset.path || cell.innerHTML !== '') {
                        cell.dataset.path = '';
                        cell.innerHTML = '';
                        cell.classList.remove('skeleton'); // Ensure no shimmer on empty
                        cell.style.cssText = 'background: #1f2937; opacity: 0.3;';
                    }
                }
            }
        });
    }

    getSelectedClusterIndices() {
        const checkboxes = this.clusterGrid.querySelectorAll('.cluster-checkbox');
        const indices = [];
        checkboxes.forEach((cb, index) => {
            if (cb.checked) indices.push(index);
        });
        return indices;
    }

    showSaveChoice() {
        this.modalSaveChoice.classList.remove('hidden');
    }

    showProgress(title) {
        const modal = document.getElementById('modal-progress');
        const titleEl = document.getElementById('progress-title');
        titleEl.textContent = title;
        modal.classList.remove('hidden');
    }

    updateProgress(current, total, text) {
        const fill = document.getElementById('progress-bar-fill');
        const textEl = document.getElementById('progress-text');

        const pct = Math.min(100, Math.max(0, (current / total) * 100));
        fill.style.width = `${pct}%`;
        textEl.textContent = text || `${current} / ${total}`;
    }

    hideProgress() {
        document.getElementById('modal-progress').classList.add('hidden');
    }

    renderExcludedImages(excludedSet) {
        this.excludedGrid.innerHTML = '';
        if (excludedSet.size === 0) {
            this.excludedEmptyMessage.style.display = 'block';
            return;
        }
        this.excludedEmptyMessage.style.display = 'none';

        excludedSet.forEach(path => {
            const cell = document.createElement('div');
            cell.className = 'img-cell';
            cell.style.aspectRatio = "1";
            cell.style.position = "relative";

            const image = document.createElement('img');
            image.style.width = "100%";
            image.style.height = "100%";
            image.style.objectFit = "cover";

            // Add Restore Button Overlay
            const overlay = document.createElement('div');
            overlay.style.cssText = "position:absolute; top:0; left:0; width:100%; height:100%; background:rgba(0,0,0,0.5); display:flex; justify-content:center; align-items:center; opacity:0; transition:opacity 0.2s; cursor:pointer;";
            overlay.innerHTML = '<span style="font-size:2rem;">↩️</span>'; // Undo icon

            cell.onmouseenter = () => overlay.style.opacity = '1';
            cell.onmouseleave = () => overlay.style.opacity = '0';

            overlay.onclick = () => {
                this.callbacks.onRestoreImage?.(path);
                // Optimistic UI update: remove from this grid immediately
                cell.remove();
                if (this.excludedGrid.children.length === 0) {
                    this.excludedEmptyMessage.style.display = 'block';
                }
            };

            cell.appendChild(image);
            cell.appendChild(overlay);
            this.excludedGrid.appendChild(cell);

            // Trigger load (Thumbnail)
            this.callbacks.onLoadThumbnail?.(path).then(url => {
                if (url) image.src = url;
            });
        });
    }

    formatTime(ms) {
        if (!isFinite(ms) || ms < 0) return '-';
        const seconds = Math.floor(ms / 1000);
        const m = Math.floor(seconds / 60);
        const s = seconds % 60;
        return `${m}m ${s}s`;
    }
}
