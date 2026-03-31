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

        this.unifiedGrid = document.getElementById('unified-cluster-grid');
        this.btnShowMoreMetadata = document.getElementById('btn-show-more-metadata');
        this.btnProceed = document.getElementById('btn-proceed');
        this.statusBarText = document.getElementById('status-current-text');
        this.statusEvent = document.getElementById('status-event');
        this.statusBarRight = document.getElementById('status-bar-right');
        this.currStatusTimeout = null;

        this.statusSpinner = document.getElementById('status-spinner');
        this.aiStatusIndicator = document.getElementById('ai-status-indicator');
        this.aiMachineAnim = document.getElementById('ai-machine-anim');
        this.aiPillText = document.getElementById('ai-pill-text');
        this.headerProgressBar = document.getElementById('header-progress-bar');
        this.btnPauseResumeIcon = this.btnPauseResume?.querySelector('.pause-resume-icon');
        this.aiMetricsContainer = document.getElementById('ai-pill-secondary');

        this.floatingControls = document.getElementById('floating-controls');
        this.appHeader = document.querySelector('.app-header');
        this.aiPausedMessage = document.getElementById('ai-paused-message');
        this.aiCompleteMessage = document.getElementById('ai-complete-message');
        this.statusBarContainer = document.getElementById('status-bar-container');
        this.lastSignificantEvent = '';

        // Action Selection Modal
        this.modalActionChoice = document.getElementById('modal-action-choice');
        this.btnCloseAction = document.getElementById('btn-close-action');
        this.btnSaveDiff = document.getElementById('btn-save-diff');
        this.passfacesUsername = document.getElementById('passfaces-username');
        this.btnUploadPassfaces = document.getElementById('btn-upload-passfaces');
        this.uploadErrorMsg = document.getElementById('upload-error-msg');
        this.btnCancelAction = document.getElementById('btn-cancel-action');

        // Reorder Modal
        this.modalReorder = document.getElementById('modal-reorder');
        this.reorderGrid = document.getElementById('reorder-grid');
        this.btnCloseReorder = document.getElementById('btn-close-reorder');
        this.btnCancelReorder = document.getElementById('btn-cancel-reorder');
        this.btnStartUpload = document.getElementById('btn-start-upload');

        // Progression Indicator
        this.selectionIndicator = document.getElementById('selection-indicator');
        this.selectionCountSpan = document.getElementById('selection-count');

        // Progress Modal refinement
        this.modalProgress = document.getElementById('modal-progress');
        this.activeClusterPreview = document.getElementById('active-cluster-preview');

        // Suggestions
        this.suggestionContainer = document.getElementById('suggestion-container');
        this.suggestionText = document.getElementById('suggestion-text');
        this.suggestions = [
            "AI is analysing your images",
            "Clusters are updated dynamically as images are analyzed",
            "Visual clusters show images grouped by visual similarity",
            "Timeline clusters show images grouped by dates",
            "Clustering results improve over time",
            "Redo clustering by clicking on recalibrate button",
            "Lock any 6 clusters for Passfaces setup, use lock button",
            "Exclude images that you don't want by clicking X on image",
            "Change number of visual clusters from settings"
        ];
        this.currSuggestionIndex = 0;
        this.suggestionInterval = null;

        // State
        this.callbacks = {};
        this.cards = new Map(); // Index/ID -> Card DOM node
        this.isAnalysisComplete = false;

        // Storage Management Elements
        this.btnManageStorage = document.getElementById('btn-manage-storage');
        this.modalStorage = document.getElementById('modal-manage-storage');
        this.btnCloseStorage = document.getElementById('btn-close-storage');
        this.btnCloseStorageFooter = document.getElementById('btn-close-storage-footer');
        this.storageProjectList = document.getElementById('storage-project-list');
        this.btnManageStorageInitial = document.getElementById('btn-manage-storage-initial');
        this.btnDeleteAllStorage = document.getElementById('btn-delete-all-storage');
        this.excludedBadge = document.getElementById('excluded-badge');

        // Instructions Modal
        this.modalInstructions = document.getElementById('modal-instructions');
        this.linkShowInstructions = document.getElementById('link-show-instructions');
        this.btnCloseInstructions = document.getElementById('btn-close-instructions');

        this.unifiedGrid = document.getElementById('unified-cluster-grid');
        this.globalPlaceholder = document.getElementById('global-processing-placeholder');
        this.btnRecalibrate = document.getElementById('btn-recalibrate');
        this.clusterControlsHeader = document.getElementById('cluster-controls-header');
    }

    setCallbacks(callbacks) {
        this.callbacks = callbacks;
        this.initListeners();
    }

    initListeners() {
        this.btnSelectInitial.addEventListener('click', () => {
            document.getElementById('folder-input').click();
        });

        // Add listener for the hidden file input
        const folderInput = document.getElementById('folder-input');
        if (folderInput) {
            folderInput.addEventListener('change', (e) => {
                if (e.target.files && e.target.files.length > 0) {
                    this.callbacks.onFilesSelected?.(e.target.files);
                }
            });
        }

        if (this.btnShowMoreMetadata) {
            this.btnShowMoreMetadata.addEventListener('click', () => {
                this.callbacks.onShowMoreMetadata?.();
            });
        }

        this.btnPauseResume.addEventListener('click', () => {
            const isCurrentlyPaused = this.btnPauseResume.classList.contains('paused');
            this.callbacks.onPauseResume?.(!isCurrentlyPaused);
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
        this.btnCloseExcluded?.addEventListener('click', closeExcludedManager);
        this.btnCloseExcludedAction?.addEventListener('click', closeExcludedManager);

        // Live values
        this.settingK?.addEventListener('input', (e) => this.valK.textContent = e.target.value);
        this.settingThreshold?.addEventListener('input', (e) => this.valThreshold.textContent = e.target.value);

        // Batch Options Buttons
        const batchButtons = document.querySelectorAll('#batch-options .opt-btn');
        const hiddenBatchInput = document.getElementById('setting-refresh');

        batchButtons.forEach(btn => {
            btn.addEventListener('click', () => {
                const value = parseInt(btn.dataset.value);
                batchButtons.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
                if (hiddenBatchInput) hiddenBatchInput.value = value;
                this.callbacks.onBatchSizeChange?.(value);
            });
        });

        this.btnApplySettings?.addEventListener('click', () => {
            const settings = {
                k: parseInt(this.settingK?.value || 6),
                threshold: parseFloat(this.settingThreshold?.value || 0.15),
                refreshInterval: parseInt(hiddenBatchInput?.value || 20)
            };
            this.callbacks.onApplySettings?.(settings);
            this.modalSettings.classList.add('hidden');
        });

        this.btnProceed?.addEventListener('click', () => this.callbacks.onProceed?.());

        this.btnSaveDiff?.addEventListener('click', () => {
            this.modalActionChoice.classList.add('hidden');
            this.callbacks.onConfirmSaveLocation?.(true); // download zip
        });

        this.btnCancelAction?.addEventListener('click', () => this.modalActionChoice.classList.add('hidden'));
        this.btnCloseAction?.addEventListener('click', () => this.modalActionChoice.classList.add('hidden'));

        this.passfacesUsername?.addEventListener('input', () => this.validateUploadRequirements());
        this.btnUploadPassfaces?.addEventListener('click', () => {
            const username = this.passfacesUsername.value.trim();
            this.modalActionChoice.classList.add('hidden');
            this.callbacks.onUploadPassfaces?.(username);
        });

        // Reorder Modal Listeners
        const closeReorder = () => this.modalReorder.classList.add('hidden');
        this.btnCloseReorder?.addEventListener('click', closeReorder);
        this.btnCancelReorder?.addEventListener('click', closeReorder);
        this.btnStartUpload?.addEventListener('click', () => {
            this.modalReorder.classList.add('hidden');
            this.onReorderConfirm?.(this.reorderClusters);
        });

        // Storage Management Listeners
        this.btnManageStorage?.addEventListener('click', () => {
            this.callbacks.onManageStorage?.();
            this.modalStorage.classList.remove('hidden');
        });

        this.btnManageStorageInitial?.addEventListener('click', () => {
            this.callbacks.onManageStorage?.();
            this.modalStorage.classList.remove('hidden');
        });

        this.btnDeleteAllStorage?.addEventListener('click', () => {
            if (confirm("🔥 DANGER: This will delete ALL AI metadata for ALL projects from your browser memory. This cannot be undone.\n\nContinue?")) {
                this.callbacks.onDeleteAllData?.();
            }
        });

        const closeStorage = () => this.modalStorage.classList.add('hidden');
        this.btnCloseStorage?.addEventListener('click', closeStorage);
        this.btnCloseStorageFooter?.addEventListener('click', closeStorage);

        // Instructions Modal Listeners
        this.linkShowInstructions?.addEventListener('click', () => {
            this.modalInstructions.classList.remove('hidden');
        });

        const closeInstructions = () => this.modalInstructions.classList.add('hidden');
        this.btnCloseInstructions?.addEventListener('click', closeInstructions);

        this.btnRecalibrate?.addEventListener('click', () => {
            if (confirm("🔄 Recalibrate Clusters?\n\nThis will find a fresh way to group your images.\n\nLocked clusters will stay where they are!")) {
                this.callbacks.onRecalibrate?.();
            }
        });
    }

    validateUploadRequirements() {
        if (!this.lastClusters) return;

        const username = this.passfacesUsername.value.trim();
        const selectedRefs = this.getSelectedClusterIndices();
        const errorMsg = this.uploadErrorMsg;
        const btnUpload = this.btnUploadPassfaces;

        let error = "";
        let isValid = true;

        if (selectedRefs.length !== 6) {
            error = `Selected ${selectedRefs.length}/6 groups. Exactly 6 groups required for Passfaces.`;
            isValid = false;
        } else if (!username) {
            error = "Please enter a username.";
            isValid = false;
        } else {
            // Check if each selected cluster has exactly 16 representatives
            for (const ref of selectedRefs) {
                const clusterList = ref.domain === 'visual' ? this.lastClusters : this.lastMetadataClusters;
                const cluster = clusterList?.find(c => c.id.toString() === ref.id.toString());

                if (cluster && cluster.representatives.length !== 16) {
                    const label = cluster.label || `Group ${ref.id + 1}`;
                    error = `${label} has only ${cluster.representatives.length}/16 images. (Try increasing cluster size/decreasing threshold)`;
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
        this.floatingControls?.classList.remove('hidden');
        this.appHeader?.classList.remove('hidden');
        this.statusBarContainer?.classList.remove('hidden');
        this.clusterControlsHeader?.classList.remove('hidden');

        this.startSuggestionRotation();
    }

    startSuggestionRotation() {
        if (this.suggestionInterval) return;

        const rotate = () => {
            if (!this.suggestionText) return;

            // Fade out
            this.suggestionText.classList.add('fade-out');

            setTimeout(() => {
                this.currSuggestionIndex = (this.currSuggestionIndex + 1) % this.suggestions.length;
                this.suggestionText.textContent = this.suggestions[this.currSuggestionIndex];
                this.suggestionText.classList.remove('fade-out');
            }, 300);
        };

        // Initial text
        this.suggestionText.textContent = this.suggestions[0];
        this.suggestionContainer.classList.remove('hidden');

        this.suggestionInterval = setInterval(rotate, 5000);
    }

    updateStats(stats) {
        if (!stats) return;

        // Excluded Badge
        if (stats.excludedCount !== undefined) {
            this.excludedBadge.textContent = stats.excludedCount;
            this.excludedBadge.classList.toggle('hidden', stats.excludedCount === 0);
        }

        // PROTECT PAUSE STATE: If engine is manually paused, prevent secondary messages 
        // from reverting the visual state to "running".
        const isCurrentlyPaused = this.btnPauseResume.classList.contains('paused');

        // Check if the message contains run-indicators (emojis that usually trigger running state)
        const isRunMessage = stats.currentAction && (stats.currentAction.includes('🧠') || stats.currentAction.includes('💾') || stats.currentAction.includes('🧩'));

        // Logic Override: If COMPLETED, always proceed. Otherwise respect pause.
        if (isCurrentlyPaused && isRunMessage && !stats.completed) {
            // Silently update internal tracking but keep visual "PAUSED" state
            // (Wait until the engine actually resumes to show work status)
            return;
        }

        if (stats.processed !== undefined) this.statProcessed.textContent = stats.processed;
        if (stats.total !== undefined) this.statTotal.textContent = stats.total;

        // Update new AI pill text
        if (stats.processed !== undefined && stats.total !== undefined) {
            this.aiPillText.textContent = `${stats.processed}/${stats.total} images analyzed by AI`;

            // Update header progress bar
            const percent = (stats.processed / stats.total) * 100 || 0;
            this.headerProgressBar.style.width = `${percent}%`;
        }

        // Speed (sec per img)
        if (stats.speed !== undefined) {
            this.statSpeed.textContent = `${stats.speed.toFixed(2)} s/img`;
        }

        // ETA
        if (stats.eta !== undefined && stats.eta !== null) {
            this.statEta.textContent = this.formatTime(stats.eta);
        } else if (stats.currentAction && stats.currentAction.includes('▶️')) {
            this.statEta.textContent = '...';
        }

        // Last Event (now routed through showStatus)
        if (stats.lastEvent) {
            this.showStatus(stats.lastEvent);
        }

        // Current Activity (Global Status Bar & AI Engine Indicator)
        if (stats.completed) {
            this.isAnalysisComplete = true;
        }

        if (this.isAnalysisComplete) {
            this.btnPauseResume.innerHTML = '<span class="tick-mark-icon"></span>';
            this.btnPauseResume.disabled = true;
            this.showStatus("✅ Analysis Complete");
            this.statusSpinner.classList.add('hidden');

            this.aiStatusIndicator.textContent = "✅ Analysis Complete";
            this.aiStatusIndicator.className = "ai-indicator running";
        } else if (stats.currentAction) {
            // Prevent redundancy: If main action is "Clusters updated", it's a global status.
            if (stats.currentAction.includes('Clusters updated')) {
                this.lastSignificantEvent = null; // Clear history
            }

            const isAIAction = stats.currentAction.includes('🧠') ||
                stats.currentAction.includes('⏸️') ||
                stats.currentAction.includes('▶️') ||
                stats.currentAction.toLowerCase().includes('ai worker');

            if (isAIAction) {
                const isPaused = stats.currentAction.includes('⏸️');
                // Progress Bar animation and color
                this.headerProgressBar.classList.toggle('shining', !isPaused);
                this.headerProgressBar.classList.toggle('paused', isPaused);
            } else {
                // Route to Global Status Bar
                this.showStatus(stats.currentAction);

                // Show spinner if activity looks like background work (excluding AI)
                const isWork = stats.currentAction.toLowerCase().includes('ing') ||
                    stats.currentAction.toLowerCase().includes('scan');

                if (isWork) {
                    this.statusSpinner.classList.remove('hidden');
                } else {
                    this.statusSpinner.classList.add('hidden');
                }
            }

            if (stats.currentAction && stats.currentAction.includes('⏸️')) {
                this.statSpeed.textContent = '-';
                this.statEta.textContent = '-';
            } else if (stats.currentAction && stats.currentAction.includes('▶️')) {
                // Show calculating if resuming - smaller text
                this.statSpeed.textContent = '...';
                this.statEta.textContent = '...';
            }
        }

        // Handle Metrics/Paused/Complete Message Visibility (Next to AI Pill)
        if (this.aiMetricsContainer) {
            const isPaused = this.btnPauseResume.classList.contains('paused');
            const isComplete = this.isAnalysisComplete;

            // Show metrics only when running and not complete
            const showMetrics = !isPaused && !isComplete;
            // Show paused message when manually paused (not complete)
            const showPausedMsg = isPaused && !isComplete;
            // Show complete message only when complete
            const showCompleteMsg = isComplete;

            this.aiMetricsContainer.classList.toggle('hidden', !showMetrics);
            if (this.aiPausedMessage) {
                this.aiPausedMessage.classList.toggle('hidden', !showPausedMsg);
            }
            if (this.aiCompleteMessage) {
                this.aiCompleteMessage.classList.toggle('hidden', !showCompleteMsg);
            }
        }
    }

    setPauseState(isPaused) {
        this.btnPauseResume.classList.toggle('paused', isPaused);
        this.btnPauseResume.classList.toggle('analyzing', !isPaused);
        this.headerProgressBar.classList.toggle('shining', !isPaused);
        this.headerProgressBar.classList.toggle('paused', isPaused);

        // Also update metrics visibility immediately for better responsiveness
        if (this.aiMetricsContainer) {
            const isComplete = this.aiStatusIndicator?.textContent.includes("Complete");
            const showMetrics = !isPaused && !isComplete;
            const showPausedMsg = isPaused && !isComplete;
            const showCompleteMsg = isComplete;

            this.aiMetricsContainer.classList.toggle('hidden', !showMetrics);
            if (this.aiPausedMessage) {
                this.aiPausedMessage.classList.toggle('hidden', !showPausedMsg);
            }
            if (this.aiCompleteMessage) {
                this.aiCompleteMessage.classList.toggle('hidden', !showCompleteMsg);
            }
        }
    }

    showStatus(text) {
        if (!text) return;
        this.statusBarText.textContent = text;
        this.statusBarContainer.classList.remove('hidden');

        if (this.currStatusTimeout) clearTimeout(this.currStatusTimeout);
        this.currStatusTimeout = setTimeout(() => {
            this.statusBarContainer.classList.add('hidden');
        }, 5000);
    }

    updateMetadataPagination(visibleCount, totalCount) {
        if (!this.btnShowMoreMetadata) return;
        if (visibleCount < totalCount) {
            this.btnShowMoreMetadata.classList.remove('hidden');
            this.btnShowMoreMetadata.textContent = `Show More (${totalCount - visibleCount} remaining)`;
        } else {
            this.btnShowMoreMetadata.classList.add('hidden');
        }
    }

    renderClusters(clusters, domain = 'visual') {
        const targetGrid = this.unifiedGrid;

        // Differentiate lastClusters storage
        if (domain === 'visual') {
            this.lastClusters = clusters;
        } else {
            this.lastMetadataClusters = clusters;
        }

        const isVisualEmpty = !this.lastClusters?.length;
        const isTimelineEmpty = !this.lastMetadataClusters?.length;

        if (isVisualEmpty && isTimelineEmpty) {
            targetGrid.innerHTML = '';
            this.globalPlaceholder?.classList.remove('hidden');
            this.floatingControls.classList.add('hidden');
            this.clusterControlsHeader?.classList.add('hidden');
            return;
        }

        this.globalPlaceholder?.classList.add('hidden');
        this.floatingControls.classList.remove('hidden');
        this.clusterControlsHeader?.classList.remove('hidden');

        // Logic check: We want to show Visual clusters THEN Timeline clusters.
        // To do this simply, we'll clear and re-render both whenever either changes,
        // or manage their presence in the DOM carefully.
        // Since we have a 'cards' Map and use appendChild, we can manage order by re-appending.

        // 1. Remove clusters that are no longer present in EITHER list
        const activeVisualIds = new Set((this.lastClusters || []).map(c => `visual_${c.id}`));
        const activeMetadataIds = new Set((this.lastMetadataClusters || []).map(c => `metadata_${c.id}`));
        const activeIds = new Set([...activeVisualIds, ...activeMetadataIds]);

        const existingCards = Array.from(targetGrid.querySelectorAll('.cluster-card'));
        existingCards.forEach(card => {
            if (!activeIds.has(card.dataset.idKey)) {
                this.cards.delete(card.dataset.idKey);
                card.remove();
            }
        });

        // 2. Render Visual Clusters
        (this.lastClusters || []).forEach(c => this.renderSingleCluster(c, 'visual'));

        // 3. Render Metadata Clusters
        (this.lastMetadataClusters || []).forEach(c => this.renderSingleCluster(c, 'metadata'));
    }

    renderSingleCluster(cluster, domain) {
        const targetGrid = this.unifiedGrid;
        const idKey = `${domain}_${cluster.id}`;
        let card = this.cards.get(idKey);
        const memberCount = cluster.memberCount !== undefined ? cluster.memberCount : cluster.members.length;

        // Drift Indicator
        let statusBadge = '';
        if (cluster.isLocked) {
            const driftCount = cluster.driftCount || 0;
            const relocated = cluster.movedFrom !== undefined;
            if (driftCount > 0 || relocated) {
                const driftIcon = driftCount > 0 ? '<span class="drift-icon">🔄</span>' : '';
                const driftHtml = driftCount > 0 ? `<span class="drift-number">${driftCount}</span>` : '';
                const moveHtml = relocated ? `<span class="move-count">${cluster.movedFrom + 1}➔${parseInt(cluster.id) + 1}</span>` : '';
                const moveTooltip = relocated ? `Was Cluster ${cluster.movedFrom + 1} previously.` : '';
                const driftTooltip = driftCount > 0 ? ` ${driftCount} images replaced.` : '';
                const tooltip = `${moveTooltip}${driftTooltip}`.trim();
                statusBadge = `<span class="lock-badge" title="${tooltip}">${moveHtml}${driftIcon}${driftHtml}</span>`;
            }
        }

        const geotagHtml = cluster.resolvedLocation ? ` <span class="geotag-label" style="font-size: 0.85em; opacity: 0.8; margin-left: 5px;">(${cluster.resolvedLocation})</span>` : '';
        const labelHtml = `<span class="cluster-name">${cluster.label || `Cluster ${cluster.id + 1}`}${geotagHtml}</span>`;
        const countHtml = `<span class="cluster-count">${memberCount} items</span>`;
        const titleHtml = `<div class="header-info">${labelHtml} ${statusBadge} <span class="spacer">•</span> ${countHtml}</div>`;

        if (!card) {
            // Create New
            card = document.createElement('div');
            card.className = 'cluster-card';
            card.dataset.idKey = idKey;
            card.dataset.domain = domain;
            card.dataset.clusterId = cluster.id;
            this.cards.set(idKey, card);

            const header = document.createElement('div');
            header.className = 'card-header';
            header.style.cssText = 'display:flex; align-items:center; gap:10px; padding: 5px;';

            const lockToggle = document.createElement('label');
            lockToggle.className = 'lock-toggle';

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = 'cluster-checkbox';

            const lockIcon = document.createElement('span');
            lockIcon.className = 'lock-icon';
            lockIcon.innerHTML = '🔓';
            card._lockIconNode = lockIcon;

            lockToggle.appendChild(checkbox);
            lockToggle.appendChild(lockIcon);
            card._lockToggleNode = lockToggle;

            const title = document.createElement('span');
            title.className = 'cluster-title';
            title.innerHTML = titleHtml;
            card._titleNode = title;

            header.appendChild(title);
            header.appendChild(lockToggle);
            card.appendChild(header);

            const grid = document.createElement('div');
            grid.className = 'image-grid';
            card._gridNode = grid;
            card.appendChild(grid);
        }

        // Always re-append to ensure order: Visual then Metadata
        targetGrid.appendChild(card);

        // Update dynamic states
        const checkbox = card.querySelector('.cluster-checkbox');
        const title = card._titleNode;
        if (title.innerHTML !== titleHtml) title.innerHTML = titleHtml;

        if (cluster.isLocked) {
            card.classList.add('locked');
            checkbox.checked = true;
            title.classList.add('locked-title');
            card._lockToggleNode.classList.add('active');
            card._lockIconNode.innerHTML = '🔒';
        } else {
            card.classList.remove('locked');
            title.classList.remove('locked-title');
            card._lockToggleNode.classList.remove('active');
            card._lockIconNode.innerHTML = '🔓';
            checkbox.checked = false;
        }

        if (cluster.isDisabled) {
            card.classList.add('conflicting');
            card.title = "Some of these images are already locked in another cluster";
            card._lockToggleNode.style.pointerEvents = 'none';
            card._lockToggleNode.style.opacity = '0.3';
            checkbox.disabled = true;
        } else {
            card.classList.remove('conflicting');
            card.title = "";
            card._lockToggleNode.style.pointerEvents = 'auto';
            card._lockToggleNode.style.opacity = '1';
            checkbox.disabled = false;
        }

        checkbox.onchange = () => {
            if (checkbox.checked) {
                this.callbacks.onLockCluster?.(cluster.id, domain);
            } else {
                this.callbacks.onUnlockCluster?.(cluster.id, domain);
            }
            this.updateSelectionIndicator();
        };

        const grid = card._gridNode;
        if (!grid._cells) grid._cells = [];

        for (let i = 0; i < 16; i++) {
            let cell = grid._cells[i];
            if (!cell) {
                cell = document.createElement('div');
                cell.className = 'img-cell';
                grid.appendChild(cell);
                grid._cells[i] = cell;
                cell._img = document.createElement('img');
                cell._img.style.opacity = '1';
                cell._driftIcon = document.createElement('span');
                cell._driftIcon.className = 'cell-drift-icon';
                cell._driftIcon.innerHTML = '🔄';
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
                if (cell.dataset.path !== imgData.path) {
                    cell.dataset.path = imgData.path;
                    cell.style.cssText = '';
                    cell.style.background = '#111827';
                    const image = cell._img;
                    const btnRemove = cell._btn;
                    image.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
                    image.className = '';
                    cell.classList.add('skeleton');
                    cell.onmouseenter = () => btnRemove.style.display = cluster.isLocked ? 'none' : 'flex';
                    cell.onmouseleave = () => btnRemove.style.display = 'none';
                    btnRemove.onclick = (e) => { e.stopPropagation(); this.callbacks.onExcludeImage?.(imgData.path); };
                    this.callbacks.onLoadThumbnail?.(imgData.path).then(url => {
                        if (cell.dataset.path === imgData.path) {
                            if (!url) { cell.classList.remove('skeleton'); return; }
                            image.src = url;
                            const onImageReady = () => {
                                if (cell.dataset.path === imgData.path) {
                                    image.classList.add('loaded');
                                    cell.classList.remove('skeleton');
                                    cell._driftIcon.style.display = (cluster.isLocked && imgData.isReplacement) ? 'block' : 'none';
                                }
                        });
                    } else {
                        // Even if image didn't change, we must update the mouseenter handler
                        // because cluster.isLocked might have changed
                        const btnRemove = cell._btn;
                        cell.onmouseenter = () => {
                            if (cluster.isLocked) {
                                btnRemove.style.display = 'none';
                            } else {
                                btnRemove.style.display = 'flex';
                            }
                        };

                        // Ensure replacement badge matches current state (Only if locked)
                        if (cluster.isLocked && imgData.isReplacement) {
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
        const checkboxes = document.querySelectorAll('.cluster-checkbox');
        const ids = [];
        checkboxes.forEach((cb) => {
            if (cb.checked) {
                const card = cb.closest('.cluster-card');
                if (card) {
                    ids.push({
                        id: card.dataset.clusterId,
                        domain: card.dataset.domain
                    });
                }
            }
        });
        return ids;
    }

    updateSelectionIndicator() {
        const selectedCount = this.getSelectedClusterIndices().length;
        this.selectionCountSpan.textContent = selectedCount;

        // Functional disabling
        this.btnProceed.disabled = (selectedCount === 0);

        // Always show the indicator (0/6 selected is useful info)
        this.selectionIndicator.classList.remove('hidden');
        this.selectionIndicator.style.display = ''; // Clear any inline conflicts
        // Color coding
        if (selectedCount === 6) {
            this.selectionIndicator.style.color = '#10b981'; // Green
        } else if (selectedCount > 6) {
            this.selectionIndicator.style.color = '#ef4444'; // Red
        } else {
            this.selectionIndicator.style.color = '#f59e0b'; // Orange/Yellow
        }

        // Animate count change
        if (this._lastSelectionCount !== undefined && this._lastSelectionCount !== selectedCount) {
            this.selectionCountSpan.classList.remove('selection-count-pop');
            void this.selectionCountSpan.offsetWidth; // Trigger reflow
            this.selectionCountSpan.classList.add('selection-count-pop');
        }
        this._lastSelectionCount = selectedCount;
    }

    showActionChoice() {
        this.modalActionChoice.classList.remove('hidden');
        this.validateUploadRequirements();
    }

    showReorderModal(clusters, onConfirm) {
        this.reorderClusters = [...clusters];
        this.onReorderConfirm = onConfirm;
        this.renderReorderGrid();
        this.modalReorder.classList.remove('hidden');
    }

    renderReorderGrid() {
        this.reorderGrid.innerHTML = '';
        this.reorderClusters.forEach((cluster, index) => {
            const item = document.createElement('div');
            item.className = 'reorder-item';
            item.dataset.index = index;

            const badge = document.createElement('div');
            badge.className = 'position-badge';
            badge.textContent = index + 1;
            item.appendChild(badge);

            const card = this.createMiniClusterCard(cluster, index, false);
            item.appendChild(card);

            this.reorderGrid.appendChild(item);

            // Listeners on the slot (item) for drop, and the card for drag
            this.addReorderListeners(item, card);
        });
    }

    createMiniClusterCard(cluster, index, isPreview = false) {
        const card = document.createElement('div');
        card.className = `mini-cluster-card ${isPreview ? 'preview-mode' : ''}`;

        if (!isPreview) {
            card.draggable = true;
            card.dataset.index = index;
        }

        // Show Cluster Label (Cluster 1, etc.)
        const labelText = cluster.originalLabel || `Cluster ${cluster.index + 1}`;

        const header = document.createElement('div');
        header.className = 'mini-header';
        header.innerHTML = `<span>${labelText}</span>`;
        card.appendChild(header);

        const grid = document.createElement('div');
        grid.className = 'mini-grid';

        // Show up to 16 thumbnails (4x4)
        for (let i = 0; i < 16; i++) {
            const img = document.createElement('img');
            img.className = 'mini-img';
            if (i < cluster.representatives.length) {
                const path = cluster.representatives[i].path;
                this.callbacks.onLoadThumbnail?.(path).then(url => {
                    if (url) img.src = url;
                });
            }
            grid.appendChild(img);
        }
        card.appendChild(grid);

        return card;
    }

    addReorderListeners(slot, card) {
        card.addEventListener('dragstart', (e) => {
            card.classList.add('dragging');
            e.dataTransfer.setData('text/plain', card.dataset.index);
        });

        card.addEventListener('dragend', () => {
            card.classList.remove('dragging');
            this.reorderGrid.querySelectorAll('.reorder-item').forEach(i => i.classList.remove('drop-target'));
        });

        slot.addEventListener('dragover', (e) => {
            e.preventDefault();
            slot.classList.add('drop-target');
        });

        slot.addEventListener('dragleave', () => {
            slot.classList.remove('drop-target');
        });

        slot.addEventListener('drop', (e) => {
            e.preventDefault();
            const fromIndex = parseInt(e.dataTransfer.getData('text/plain'));
            const toIndex = parseInt(slot.dataset.index);

            if (fromIndex !== toIndex) {
                const movedItem = this.reorderClusters.splice(fromIndex, 1)[0];
                this.reorderClusters.splice(toIndex, 0, movedItem);
                this.renderReorderGrid();
            }
        });
    }

    showProgress(title, activeCluster = null) {
        const modal = document.getElementById('modal-progress');
        const titleEl = document.getElementById('progress-title');
        titleEl.textContent = title;

        if (activeCluster) {
            this.activeClusterPreview.innerHTML = '';
            const miniCard = this.createMiniClusterCard(activeCluster, activeCluster.originalOrder || 0, true);
            this.activeClusterPreview.appendChild(miniCard);

            this.activeClusterPreview.classList.remove('hidden');
        } else {
            this.activeClusterPreview.classList.add('hidden');
        }

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

    renderProjectStorageList(projects, currentProjectId) {
        this.storageProjectList.innerHTML = '';
        if (!projects || projects.length === 0) {
            this.storageProjectList.innerHTML = '<div style="text-align:center; padding: 20px; color:#9ca3af;">No project data found in browser.</div>';
            return;
        }

        projects.forEach(project => {
            const isCurrent = project.id === currentProjectId;
            const item = document.createElement('div');
            item.className = `storage-item ${isCurrent ? 'current-project' : ''}`;

            const info = document.createElement('div');
            info.className = 'storage-info';

            const name = document.createElement('div');
            name.className = 'storage-name';
            name.textContent = project.id;
            if (isCurrent) {
                const indicator = document.createElement('span');
                indicator.className = 'current-indicator';
                indicator.textContent = 'Current';
                name.appendChild(indicator);
            }

            const meta = document.createElement('div');
            meta.className = 'storage-meta';
            const dateStr = project.lastUpdated ? new Date(project.lastUpdated).toLocaleDateString() : 'Unknown';
            const countStr = project.embeddingCount !== undefined ? `${project.embeddingCount} images` : '';
            meta.textContent = `Last active: ${dateStr} ${countStr ? `• ${countStr}` : ''}`;

            info.appendChild(name);
            info.appendChild(meta);

            const btnDelete = document.createElement('button');
            btnDelete.className = 'btn-delete-storage';
            btnDelete.innerHTML = '<span>🗑️</span> Delete AI Metadata';
            btnDelete.onclick = () => {
                const msg = isCurrent
                    ? `Are you sure you want to delete AI metadata for the CURRENT project? This will reset the app.`
                    : `Delete AI metadata for project "${project.id}"?`;
                if (confirm(msg)) {
                    this.callbacks.onDeleteProjectData?.(project.id);
                }
            };

            item.appendChild(info);
            item.appendChild(btnDelete);
            this.storageProjectList.appendChild(item);
        });
    }

    /**
     * Dynamically update a cluster's title with its resolved geolocated name.
     */
    updateClusterGeotag(clusterId, locationName) {
        if (!locationName) return;
        const card = this.cards.get(clusterId.toString());
        if (!card || !card._titleNode) return;

        const nameSpan = card._titleNode.querySelector('.cluster-name');
        if (nameSpan) {
            // Avoid duplicate appending if triggered multiple times
            if (!nameSpan.textContent.includes(`(${locationName})`)) {
                nameSpan.innerHTML += ` <span class="geotag-label" style="font-size: 0.85em; opacity: 0.8; margin-left: 5px;">(${locationName})</span>`;
            }
        }
    }
}
