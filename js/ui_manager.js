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

        this.btnApplySettings.addEventListener('click', () => {
            const settings = {
                k: parseInt(this.settingK.value),
                threshold: parseFloat(this.settingThreshold.value),
                refreshInterval: parseInt(this.inputRefresh.value)
            };
            this.callbacks.onApplySettings?.(settings);
            this.modalSettings.classList.add('hidden');
        });

        this.btnSave.addEventListener('click', () => this.callbacks.onSave?.());
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
        this.clusterGrid.innerHTML = ''; // Clear

        clusters.forEach((cluster, index) => {
            const card = document.createElement('div');
            card.className = 'cluster-card';
            card.dataset.clusterId = index;

            const memberCount = cluster.memberCount !== undefined ? cluster.memberCount : cluster.members.length;

            const header = document.createElement('div');
            header.className = 'card-header';
            header.style.display = 'flex';
            header.style.alignItems = 'center';
            header.style.gap = '10px';

            // Checkbox for selection
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.checked = false; // Unselected by default as requested
            checkbox.className = 'cluster-checkbox';
            checkbox.style.cursor = 'pointer';
            checkbox.style.width = '18px';
            checkbox.style.height = '18px';

            const title = document.createElement('span');
            title.innerHTML = `${cluster.label || `Cluster ${index + 1}`} <span style="color:#9ca3af; font-size:0.8em">${memberCount} items</span>`;

            header.appendChild(checkbox);
            header.appendChild(title);
            card.appendChild(header);

            const grid = document.createElement('div');
            grid.className = 'image-grid';

            // Fixed 16 slots
            for (let i = 0; i < 16; i++) {
                const cell = document.createElement('div');
                cell.className = 'img-cell';

                if (i < cluster.representatives.length) {
                    const imgData = cluster.representatives[i];

                    const image = document.createElement('img');
                    // image.loading = "lazy"; // Native lazy loading

                    cell.dataset.path = imgData.path;

                    // Add Remove Button
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

                    // Trigger load (Thumbnail)
                    this.callbacks.onLoadThumbnail?.(imgData.path).then(url => {
                        if (url) {
                            image.src = url;
                        }
                    });
                } else {
                    // Empty skeleton slot
                    cell.style.background = '#1f2937'; // Slightly lighter than black
                    cell.style.opacity = '0.5';
                }
                grid.appendChild(cell);
            }

            card.appendChild(grid);
            this.clusterGrid.appendChild(card);
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
