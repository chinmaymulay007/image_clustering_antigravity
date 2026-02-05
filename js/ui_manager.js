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
        this.btnProceed = document.getElementById('btn-proceed');
        this.statusBarText = document.getElementById('status-bar-text');

        // Action Selection Modal
        this.modalActionChoice = document.getElementById('modal-action-choice');
        this.btnCloseAction = document.getElementById('btn-close-action');
        this.btnSaveSame = document.getElementById('btn-save-same');
        this.btnSaveDiff = document.getElementById('btn-save-diff');
        this.btnCancelAction = document.getElementById('btn-cancel-action');
        this.passfacesUsername = document.getElementById('passfaces-username');
        this.btnUploadPassfaces = document.getElementById('btn-upload-passfaces');
        this.uploadErrorMsg = document.getElementById('upload-error-msg');

        // Progression Indicator
        this.selectionIndicator = document.getElementById('selection-indicator');
        this.selectionCountSpan = document.getElementById('selection-count');

        // State
        this.callbacks = {};
        this.cards = new Map(); // Index -> Card DOM node
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
                refreshInterval: parseInt(hiddenBatchInput.value)
            };
            this.callbacks.onApplySettings?.(settings);
            this.modalSettings.classList.add('hidden');
        });

        this.btnProceed.addEventListener('click', () => this.callbacks.onProceed?.());

        this.btnSaveSame.addEventListener('click', () => {
            this.modalActionChoice.classList.add('hidden');
            this.callbacks.onConfirmSaveLocation?.(false); // same
        });

        this.btnSaveDiff.addEventListener('click', () => {
            this.modalActionChoice.classList.add('hidden');
            this.callbacks.onConfirmSaveLocation?.(true); // different
        });

        this.btnCancelAction?.addEventListener('click', () => this.modalActionChoice.classList.add('hidden'));
        this.btnCloseAction?.addEventListener('click', () => this.modalActionChoice.classList.add('hidden'));

        this.passfacesUsername.addEventListener('input', () => this.validateUploadRequirements());
        this.btnUploadPassfaces.addEventListener('click', () => {
            const username = this.passfacesUsername.value.trim();
            this.modalActionChoice.classList.add('hidden');
            this.callbacks.onUploadPassfaces?.(username);
        });
    }

    validateUploadRequirements() {
        if (!this.lastClusters) return;

        const username = this.passfacesUsername.value.trim();
        const selectedIndices = this.getSelectedClusterIndices();
        const errorMsg = this.uploadErrorMsg;
        const btnUpload = this.btnUploadPassfaces;

        let error = "";
        let isValid = true;

        if (selectedIndices.length !== 6) {
            error = `Selected ${selectedIndices.length}/6 groups. Exactly 6 groups required for Passfaces.`;
            isValid = false;
        } else if (!username) {
            // Only show username error if count is correct, to avoid noise? 
            // Or show it always? 
            // Better: "Please enter a username."
            error = "Please enter a username.";
            isValid = false;
        } else {
            // Check if each selected cluster has exactly 16 representatives
            for (const idx of selectedIndices) {
                const cluster = this.lastClusters[idx];
                if (cluster.representatives.length !== 16) {
                    error = `Group ${idx + 1} has only ${cluster.representatives.length}/16 images. (Try increasing cluster size/decreasing threshold)`;
                    isValid = false;
                    break;
                }
            }
        }

        if (error) {
            errorMsg.textContent = error;
            errorMsg.style.display = 'block';
        } else {
            errorMsg.style.display = 'none';
        }

        btnUpload.disabled = !isValid;
    }

    hideInitialOverlay() {
        this.overlayInitial.classList.add('hidden');
    }

    updateStats(stats) {
        if (!stats) return;
        if (stats.processed !== undefined) this.statProcessed.textContent = stats.processed;
        if (stats.total !== undefined) this.statTotal.textContent = stats.total;

        // Speed (sec per img)
        if (stats.speed !== undefined) {
            this.statSpeed.textContent = `${stats.speed.toFixed(2)} s/img`;
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
        this.lastClusters = clusters; // Store for validation
        if (!clusters || clusters.length === 0) {
            this.clusterGrid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; margin-top: 50px; color: #9ca3af;">Scanning for patterns...</div>';
            return;
        }

        // 1. Remove clusters that are no longer present
        const existingCards = Array.from(this.clusterGrid.querySelectorAll('.cluster-card'));
        const activeIds = new Set(clusters.map((_, i) => i.toString()));

        existingCards.forEach(card => {
            if (!activeIds.has(card.dataset.clusterId)) {
                this.cards.delete(parseInt(card.dataset.clusterId));
                card.remove();
            }
        });

        // 2. Update or Create clusters
        clusters.forEach((cluster, index) => {
            let card = this.cards.get(index);
            const memberCount = cluster.memberCount !== undefined ? cluster.memberCount : cluster.members.length;

            // Drift Indicator (e.g. "🔒 1➔ 🔄 2")
            let statusBadge = '';
            if (cluster.isFrozen) {
                const driftCount = cluster.driftCount || 0;
                const driftIcon = driftCount > 0 ? '<span class="drift-icon">🔄</span>' : '';
                const driftHtml = driftCount > 0
                    ? `<span class="drift-number">${driftCount}</span>`
                    : '';

                const moveHtml = cluster.movedFrom !== undefined
                    ? `<span class="move-count">${cluster.movedFrom + 1}➔${index + 1}</span>`
                    : '';

                const moveTooltip = cluster.movedFrom !== undefined
                    ? `Was Cluster ${cluster.movedFrom + 1} previously. `
                    : '';
                const tooltip = `${moveTooltip}${driftCount} images replaced.`;
                statusBadge = `<span class="freeze-badge" title="${tooltip}">🔒${moveHtml}${driftIcon}${driftHtml}</span>`;
            }

            const labelHtml = `<span class="cluster-name">${cluster.label || `Cluster ${index + 1}`}</span>`;
            const countHtml = `<span class="cluster-count">${memberCount} items</span>`;

            // Flex layout handles the spacing
            const titleHtml = `<div class="header-info">${labelHtml} ${statusBadge} <span class="spacer">•</span> ${countHtml}</div>`;

            if (!card) {
                // Create New
                card = document.createElement('div');
                card.className = 'cluster-card';
                card.dataset.clusterId = index;
                this.cards.set(index, card);

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
                card._titleNode = title; // Link

                header.appendChild(checkbox);
                header.appendChild(title);
                card.appendChild(header);

                const grid = document.createElement('div');
                grid.className = 'image-grid';
                card._gridNode = grid; // Link
                card.appendChild(grid);

                this.clusterGrid.appendChild(card);
            }

            // ALWAYS Update dynamic UI states (frozen, title, styling)
            const checkbox = card.querySelector('.cluster-checkbox');
            const title = card._titleNode;

            // Update title content if changed
            if (title.innerHTML !== titleHtml) {
                title.innerHTML = titleHtml;
            }

            // Ensure checkbox state matches expectation (if we are re-rendering)
            // Note: If we had an external selection state, we'd use it here.
            // For now, we rely on the DOM or the `cluster` object if it had a `selected` prop.
            // But `cluster` object doesn't seem to have `selected`. 
            // The existing code didn't maintain selection on re-render explicity? 
            // Actually, `renderClusters` might be destructive. 
            // If `renderClusters` is called, it usually means new clusters.
            // However, `isFrozen` implies persistence. 
            // Let's ensure logic: if frozen, it is auto-selected?
            if (cluster.isFrozen) {
                card.classList.add('frozen');
                checkbox.checked = true;
                title.classList.add('frozen-title');
            } else {
                card.classList.remove('frozen');
                title.classList.remove('frozen-title');
                // Force uncheck if not frozen to maintain sync with engine state (esp. on auto-unfreeze)
                checkbox.checked = false;
            }

            // Wire/Update checkbox behavior
            checkbox.onchange = () => {
                if (checkbox.checked) {
                    if (cluster.isFrozen) {
                        // already frozen, no action? or maybe we want to allow selecting without freezing?
                        // The existing logic tied selection to `onFreezeCluster`. 
                        // "Freeze" implies "Keep this cluster".
                        // So checking = Freeze. 
                        this.callbacks.onFreezeCluster?.(index);
                    } else {
                        // User selected a non-frozen cluster. 
                        // Does this freeze it? The original code says:
                        // if (checkbox.checked) this.callbacks.onFreezeCluster?.(index);
                        // So yes, selection == freezing in the current app logic?
                        // Wait, the user request says "selecting 6 clusters".
                        // If selecting IS freezing, then fine.
                        // But if selection is just for "saving", we might need to decouple.
                        // "Implementing Cluster Freezing" conversation suggests freezing is keeping it from changing.
                        // For the purpose of "Proceed", we just need to know what is "selected".
                        // If the previous app logic equated Checkbox == Freeze, we should stick to that unless asked otherwise.
                        // BUT, for "Proceed", we just need to count checked boxes.

                        // Let's assume Checkbox == Freeze for now as per previous logic, 
                        // OR simply trigger a UI update.
                        this.callbacks.onFreezeCluster?.(index);
                    }
                } else {
                    this.callbacks.onUnfreezeCluster?.(index);
                }
                this.updateSelectionIndicator();
            };

            // 3. Update Image Grid (Representatives)
            const grid = card._gridNode;
            if (!grid._cells) grid._cells = []; // Link

            for (let i = 0; i < 16; i++) {
                let cell = grid._cells[i];
                if (!cell) {
                    cell = document.createElement('div');
                    cell.className = 'img-cell';
                    grid.appendChild(cell);
                    grid._cells[i] = cell; // Link

                    // Direct Link: Cache children immediately
                    cell._img = document.createElement('img');
                    cell._img.style.opacity = '1'; // Force visible inline

                    cell._driftIcon = document.createElement('span');
                    cell._driftIcon.className = 'cell-drift-icon';
                    cell._driftIcon.innerHTML = '🔄';
                    cell._driftIcon.title = 'Automatic substitution';
                    cell._driftIcon.style.cssText = 'position:absolute; bottom:2px; right:2px; background:rgba(0,0,0,0.6); color:white; border-radius:3px; padding: 1px 3px; font-size: 10px; display:none; z-index:11; pointer-events:none;';

                    cell._btn = document.createElement('button');
                    cell._btn.innerHTML = '×';
                    cell._btn.style.cssText = 'position:absolute; top:2px; right:2px; background:rgba(0,0,0,0.6); color:white; border:none; border-radius:50%; width:20px; height:20px; cursor:pointer; display:none; justify-content:center; align-items:center; line-height:1; z-index:10;';

                    cell.appendChild(cell._img);
                    cell.appendChild(cell._driftIcon);
                    cell.appendChild(cell._btn);
                }

                if (i < cluster.representatives.length) {
                    const imgData = cluster.representatives[i];

                    // Only update if the image changed
                    if (cell.dataset.path !== imgData.path) {
                        cell.dataset.path = imgData.path;

                        // FIX: Reset any styles from "empty" state (like opacity: 0.3)
                        cell.style.cssText = '';
                        cell.style.background = '#111827'; // Default background

                        const image = cell._img;
                        const btnRemove = cell._btn;

                        // Clean Slate Reset (Instant)
                        image.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
                        image.className = '';
                        cell.classList.add('skeleton');

                        // CONDITIONAL UI: Prevent showing remove button if cluster is frozen
                        // (Only blocking exclusion of representatives in frozen clusters)
                        cell.onmouseenter = () => {
                            if (cluster.isFrozen) {
                                btnRemove.style.display = 'none';
                            } else {
                                btnRemove.style.display = 'flex';
                            }
                        };
                        cell.onmouseleave = () => btnRemove.style.display = 'none';

                        btnRemove.onclick = (e) => {
                            e.stopPropagation();
                            this.callbacks.onExcludeImage?.(imgData.path);
                        };

                        const isLowPerf = document.body.getAttribute('data-low-perf') === 'true';

                        this.callbacks.onLoadThumbnail?.(imgData.path).then(url => {
                            if (!url) {
                                cell.classList.remove('skeleton');
                                return;
                            }

                            // Race condition check: Ensure the cell hasn't been recycled for a new path
                            if (cell.dataset.path === imgData.path) {
                                image.src = url;

                                // FIX: Always remove skeleton immediately for visible updates
                                const onImageReady = () => {
                                    if (cell.dataset.path === imgData.path) {
                                        image.classList.add('loaded');
                                        cell.classList.remove('skeleton');

                                        // Show/Hide replacement badge (Only if frozen)
                                        if (cluster.isFrozen && imgData.isReplacement) {
                                            cell._driftIcon.style.display = 'block';
                                        } else {
                                            cell._driftIcon.style.display = 'none';
                                        }
                                    }
                                };

                                if (image.complete) {
                                    onImageReady();
                                } else {
                                    image.onload = onImageReady;
                                    image.onerror = () => cell.classList.remove('skeleton'); // Ensure cleanup on error
                                }
                            }
                        }).catch(() => {
                            cell.classList.remove('skeleton');
                        });
                    } else {
                        // Even if image didn't change, we must update the mouseenter handler
                        // because cluster.isFrozen might have changed
                        const btnRemove = cell._btn;
                        cell.onmouseenter = () => {
                            if (cluster.isFrozen) {
                                btnRemove.style.display = 'none';
                            } else {
                                btnRemove.style.display = 'flex';
                            }
                        };

                        // Ensure replacement badge matches current state (Only if frozen)
                        if (cluster.isFrozen && imgData.isReplacement) {
                            cell._driftIcon.style.display = 'block';
                        } else {
                            cell._driftIcon.style.display = 'none';
                        }
                    }
                } else {
                    // Empty slot
                    if (cell.dataset.path || cell.innerHTML !== '') {
                        cell.dataset.path = '';
                        if (cell._img) cell._img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
                        cell.classList.remove('skeleton'); // Ensure no shimmer on empty
                        cell.style.cssText = 'background: #1f2937; opacity: 0.3;';
                        if (cell._btn) cell._btn.style.display = 'none';
                        if (cell._driftIcon) cell._driftIcon.style.display = 'none';
                        cell.onmouseenter = null;
                        cell.onmouseleave = null;
                    }
                }
            }
        });

        this.updateSelectionIndicator();
    }

    getSelectedClusterIndices() {
        const checkboxes = this.clusterGrid.querySelectorAll('.cluster-checkbox');
        const indices = [];
        checkboxes.forEach((cb, index) => {
            if (cb.checked) indices.push(index);
        });
        return indices;
    }

    updateSelectionIndicator() {
        const selectedCount = this.getSelectedClusterIndices().length;
        this.selectionCountSpan.textContent = selectedCount;

        if (selectedCount > 0) {
            this.selectionIndicator.style.display = 'block';
        } else {
            // Optional: hide if 0? or show 0/6?
            this.selectionIndicator.style.display = 'block';
        }

        // Color coding
        if (selectedCount === 6) {
            this.selectionIndicator.style.color = '#10b981'; // Green
        } else if (selectedCount > 6) {
            this.selectionIndicator.style.color = '#ef4444'; // Red
        } else {
            this.selectionIndicator.style.color = '#f59e0b'; // Orange/Yellow
        }
    }

    showActionChoice() {
        this.modalActionChoice.classList.remove('hidden');
        this.validateUploadRequirements();
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
