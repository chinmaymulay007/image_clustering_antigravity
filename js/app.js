import { FileSystemManager } from './file_system.js';
import { ProcessingManager } from './processing_manager.js';
import { ClusteringEngine } from './clustering_engine.js';
import { UIManager } from './ui_manager.js';
import { db } from './db_manager.js';

class App {
    constructor() {
        this.fs = new FileSystemManager();
        this.processing = new ProcessingManager(this.fs);
        this.clustering = new ClusteringEngine();
        this.ui = new UIManager();

        // State
        this.currentEmbeddings = [];
        this.currentClusters = []; // Cache for WYSIWYG
        this.allMetadataClusters = []; // All extracted
        this.currentMetadataClusters = []; // Timeline Clusters shown
        this.visibleMetadataClustersCount = 6;
        this.lastCentroids = null; // Warm start stability
        this.excludedPaths = new Set();
        this.refreshInterval = 20;
        this.k = 6;
        this.threshold = 0.15;
        this.modelId = 'Xenova/mobileclip_s0'; // Current Model Configuration
        this.handleMap = new Map(); // Path -> FileHandle
        this.thumbnailCache = new Map(); // Path -> { url, blob }
        this.isClustering = false;
        this.pendingRecluster = false;
        this.clusterWorker = null;
        this.imageWorker = null;
        this.thumbnailPromises = new Map(); // Path -> Promise
        this.thumbnailResolvers = new Map(); // Path -> resolve function
                
        // Locked state is now keyed by domain + index, e.g., 'visual_0', 'metadata_meta_1'
        this.lockedClusters = new Map(); 

        // Logging & Memory Stats
        this.thumbnailsCreatedSinceLastLog = 0;
        this.thumbnailsDestroyedSinceLastLog = 0;

        console.log("ClusterAI Orchestrator Initialized");
        this.init();
    }

    init() {
        this.ui.setCallbacks({
            onFilesSelected: (files) => this.handleFilesSelected(files),
            onPauseResume: (shouldPause) => this.handlePauseResume(shouldPause),
            onApplySettings: (settings) => this.handleApplySettings(settings),
            onProceed: () => this.handleProceed(),
            onUploadPassfaces: (username) => this.handleUploadPassfaces(username),
            onExcludeImage: (path) => this.handleExclude(path),
            onLoadThumbnail: (path) => this.loadThumbnail(path),
            onGetExcludedPaths: () => this.excludedPaths,
            onRestoreImage: (path) => this.handleRestore(path),
            onConfirmSaveLocation: () => this.handleConfirmSaveLocation(),
            onLockCluster: (id, domain) => this.handleLockCluster(id, domain),
            onUnlockCluster: (id, domain) => this.handleUnlockCluster(id, domain),
            onManageStorage: () => this.handleManageStorage(),
            onDeleteProjectData: (projectId) => this.handleDeleteProjectData(projectId),
            onDeleteAllData: () => this.handleDeleteAllData(),
            onBatchSizeChange: (size) => this.handleBatchSizeChange(size),
            onShowMoreMetadata: () => this.handleShowMoreMetadata(),
            onRecalibrate: () => this.handleRecalibrate()
        });
    }

    handleApplySettings(settings) {
        // Count visual locks only for K constraint checking if we still want that
        let visualLockedCount = 0;
        for (const [key] of this.lockedClusters) {
            if (key.startsWith('visual_')) visualLockedCount++;
        }

        if (settings.k < visualLockedCount) {
            alert(`⚠️ Action Required: Cannot reduce total clusters to ${settings.k}.\n\nYou currently have ${visualLockedCount} clusters locked. Please unlock some clusters before decreasing the total count.`);
            return;
        }

        // Check if any locked clusters need to be "slid" down into the new range
        let maxLockedIndex = -1;
        for (const key of this.lockedClusters.keys()) {
            if (key.startsWith('visual_')) {
                const idx = parseInt(key.replace('visual_', ''));
                if (idx > maxLockedIndex) maxLockedIndex = idx;
            }
        }

        if (settings.k <= maxLockedIndex) {
            console.log(`[App] Defragmenting locked clusters to fit into new K=${settings.k}`);
            this.compactLockedClusters(settings.k);
        }

        console.log("[App] Applying user settings:", settings);
        this.refreshInterval = settings.refreshInterval;
        this.k = settings.k;
        this.threshold = settings.threshold;

        // Sync to processing manager
        this.processing.refreshInterval = this.refreshInterval;

        // Immediate Re-cluster
        console.log("[App] Triggering immediate re-cluster due to settings change.");
        this.updateUI({ lastEvent: `Settings changed` });
        this.refreshClusters();
    }

    handleRecalibrate() {
        console.log("%c[App] RECALIBRATE: Forcing cold start (reseting centroids)", "color: #ff9800; font-weight: bold;");
        this.lastCentroids = null; // Discard warm start memories
        this.updateUI({ 
            lastEvent: "AI Recalibrating...",
            currentAction: "🔄 Recalibrating: Finding fresh clusters..." 
        });
        this.refreshClusters();
    }

    updateUI(stats) {
        if (!stats) return;
        const enrichedStats = {
            ...stats,
            excludedCount: this.excludedPaths.size
        };
        this.ui.updateStats(enrichedStats);
    }

    handleBatchSizeChange(size) {
        console.log(`[App] Batch size updated to ${size} (Applying immediately)`);
        this.refreshInterval = size;
        this.processing.refreshInterval = size;
        this.updateUI({ lastEvent: `Batch size: ${size}` });
    }

    async handleFilesSelected(fileList) {
        console.log("[App] User selected folder via universal input.");
        try {
            // Filter and set files in FileSystemManager
            const { projectName, imageCount } = await this.fs.setFiles(fileList);
            console.log(`[App] Project Name inferred: ${projectName}, Found ${imageCount} valid images.`);

            if (imageCount === 0) {
                alert("❌ No valid images found in the selected folder.");
                return;
            }

            // Initialize Database for this project
            await db.init(projectName);

            // Check for Model Migration (Global Upgrade)
            const manifest = await db.getManifest();
            if (manifest && manifest.modelId !== this.modelId) {
                await db.globalUpgradeCleanup(this.modelId);
            }

            this.ui.hideInitialOverlay();
            this.ui.renderClusters([]); // Show placeholder immediately during scan

            // Setup callbacks from Processing
            this.processing.onProgress = (stats) => {
                this.updateUI(stats);
            };

            this.processing.onClusterUpdate = async (embeddings) => {
                this.currentEmbeddings = embeddings;
                await this.refreshClusters();
            };

            // Initialize background keep-alive on user gesture
            import('./background_keep_alive.js').then(m => m.backgroundKeepAlive.init());

            // Rebuild handle map BEFORE resume logic triggers thumbnails
            this.rebuildHandleMap();

            // Start Processing
            this.processing.start(this.refreshInterval).then(() => {
                // Ensure map is fully synced after scan
                this.rebuildHandleMap();

                // Sync loaded exclusions
                this.processing.excludedPaths.forEach(p => this.excludedPaths.add(p));
                console.log(`[App] Synced ${this.excludedPaths.size} exclusions from manifest.`);

                const isComplete = this.processing.processedPaths.size >= this.processing.allImages.length && this.processing.allImages.length > 0;

                if (isComplete) {
                    this.updateUI({ 
                        currentAction: "✅ All images processed.",
                        processed: this.processing.allImages.length,
                        total: this.processing.allImages.length,
                        completed: true
                    });
                    this.ui.setPauseState(false);
                } else if (this.processing.isPaused) {
                    this.updateUI({ currentAction: "⏸️ Database loaded. Ready to resume." });
                    this.ui.setPauseState(true); // Ensure button says "RESUME"
                } else {
                    this.updateUI({ currentAction: "🧠 Scan complete. Starting AI analysis..." });
                    this.ui.setPauseState(false);
                }

                console.log("[App] Initial scan complete. Handle map rebuilt.");
            });

        } catch (error) {
            console.error("Initialization failed:", error);
            alert("❌ Initialization Failed: We couldn't process the selected files. Please check console for details.");
        }
    }

    rebuildHandleMap() {
        this.handleMap.clear();
        const files = this.fs.allFiles;
        if (files && files.length > 0) {
            files.forEach(file => {
                const path = file.webkitRelativePath || file.name;
                this.handleMap.set(path, file);
            });
            console.log(`%c[App] Handle map rebuilt with ${this.handleMap.size} files.`, "color: #fb8c00; font-weight: bold;");
        }
    }

    handlePauseResume(shouldPause) {
        if (shouldPause) {
            this.processing.pause();
            this.updateUI({
                currentAction: "⏸️ Processing Paused.",
                lastEvent: "Processing Paused"
            });
        } else {
            this.updateUI({
                currentAction: "▶️ Resuming...",
                lastEvent: "Processing Resumed"
            });
            // Ensure background keep-alive is initialized on user interaction
            this.processing.resume();
            import('./background_keep_alive.js').then(m => m.backgroundKeepAlive.init());
        }
        this.ui.setPauseState(shouldPause);
    }

    async handleExclude(path) {
        // Check if this path belongs to ANY locked cluster
        for (const cluster of this.currentClusters) {
            if (cluster.isLocked) {
                const isMember = cluster.members.some(m => m.path === path);
                if (isMember) {
                    alert("⚠️ Image Locked: This image is part of a locked cluster. To exclude it, please unlock the cluster first.");
                    return;
                }
            }
        }

        console.log("Excluding:", path);
        this.excludedPaths.add(path);
        this.processing.excludedPaths.add(path); // Sync

        // Persist immediately to DB
        await db.saveManifest({
            processedCount: this.currentEmbeddings.length,
            totalImagesFound: this.processing.allImages?.length || 0,
            excludedImages: Array.from(this.excludedPaths)
        });

        // Immediate UI Refresh
        this.updateUI({
            currentAction: `🚫 Excluding: ${path.split('/').pop()}`,
            lastEvent: `Excluded 1 image`
        });
        this.thumbnailCache.delete(path); // Optimization: Remove from cache if excluded
        this.refreshClusters();
    }

    async handleRestore(path) {
        // Restoring is allowed, but we should check if it affects anything?
        // Actually, logic says restore is allowed and triggers recluster.
        console.log("Restoring:", path);
        this.excludedPaths.delete(path);
        this.processing.excludedPaths.delete(path); // Sync

        // Persist immediately to DB
        await db.saveManifest({
            processedCount: this.currentEmbeddings.length,
            totalImagesFound: this.processing.allImages?.length || 0,
            excludedImages: Array.from(this.excludedPaths)
        });
        console.log(`[App] Restored ${path}. Exclusions persisted to DB.`);

        // Immediate UI Refresh
        this.updateUI({
            currentAction: `♻️ Restoring: ${path.split('/').pop()}`,
            lastEvent: `Restored 1 image`
        });
        this.refreshClusters();
    }

    async refreshClusters() {
        if (this.isClustering) {
            this.pendingRecluster = true;
            return;
        }

        const validEmbeddings = this.currentEmbeddings.filter(e => !this.excludedPaths.has(e.path));
        if (validEmbeddings.length === 0) return;

        console.log(`[App] Offloading clustering of ${validEmbeddings.length} items to Worker...`);
        this.isClustering = true;
        this.updateUI({ currentAction: "♻️ Refreshing clusters..." });

        if (!this.clusterWorker) {
            this.clusterWorker = new Worker('js/clustering_worker.js', { type: 'module' });
            this.clusterWorker.onmessage = async (e) => {
                const { status, result, error } = e.data;
                if (status === 'success') {
                    let clusters = result.clusters;

                    // Compute Metadata Clusters locally (It's fast enough on main thread or we could workerize)
                    // We need to wait for geo-coding which is async so we do it here.
                    const updatedValid = this.currentEmbeddings.filter(e => !this.excludedPaths.has(e.path));
                    const metadataClusters = await this.clustering.updateMetadataClusters(updatedValid, 15, this.threshold);
                    this.allMetadataClusters = metadataClusters;
                    this.currentMetadataClusters = this.allMetadataClusters.slice(0, this.visibleMetadataClustersCount);

                    // POST-PROCESSING: Apply locked constraints to both
                    if (this.lockedClusters.size > 0) {
                        clusters = this.applyLockedConstraints(clusters);
                        this.currentMetadataClusters = this.applyMetadataLockedConstraints(this.currentMetadataClusters);
                    }

                    this.currentClusters = clusters;
                    this.lastCentroids = result.centroids;

                    // Calculate cross-domain interlocking (disabling locks)
                    this.evaluateLockingConstraints();

                    // Update UI (Pass grid targets from ui class)
                    this.ui.renderClusters(this.currentClusters, this.ui.clusterGrid);
                    this.ui.renderClusters(this.currentMetadataClusters, this.ui.metadataClusterGrid);
                    this.ui.updateMetadataPagination(this.currentMetadataClusters.length, this.allMetadataClusters.length);
                    this.enrichTimelineClusters();

                    // Check for pending thumbnails
                    if (this.thumbnailPromises.size > 0) {
                        this.updateUI({ currentAction: `🖼️ Loading thumbnails (${this.thumbnailPromises.size})...` });
                    } else {
                        const processedCount = this.processing.processedPaths.size;
                        const msg = `✅ Clusters updated based on available ${processedCount} images data.`;
                        // Only show "Clusters updated" if NOT paused, otherwise it clears the PAUSED indicator
                        if (!this.processing.isPaused) {
                            this.updateUI({
                                currentAction: msg
                            });
                        }
                        this.updateUI({
                            lastEvent: msg // Also show in last event area for persistence
                        });
                    }

                    // Immediate Cleanup (RAM), but Delay Logging until thumbnails are ready
                    this.cleanupThumbnails(false); // false = don't log yet

                    // If everything was already in cache, log immediately
                    if (this.thumbnailPromises.size === 0) {
                        this.logImageSummary();
                    }

                    this.isClustering = false;

                    // If a re-cluster was requested while we were busy, do it now
                    if (this.pendingRecluster) {
                        this.pendingRecluster = false;
                        this.refreshClusters();
                    }
                } else {
                    console.error("Clustering Worker Error:", error);
                    this.isClustering = false;
                }
            };
        }

        const lockedIndices = [];
        const lockedRadii = {};
        const lockedCentroids = {};

        // Worker only knows about "Visual" clusters by INT index
        if (this.lockedClusters.size > 0) {
            this.lockedClusters.forEach((data, key) => {
                if (key.startsWith('visual_')) {
                    const idx = parseInt(key.replace('visual_', ''));
                    lockedIndices.push(idx);
                    lockedRadii[idx] = data.maxRadius;
                    lockedCentroids[idx] = data.centroid;
                }
            });
        }

        const previousCentroids = this.lastCentroids ? this.lastCentroids.map(c => [...c]) : null;

        // Identity Overwrite: Force warm start centroids to match locked anchors where available.
        // This ensures the mathematical center stays anchored even if K changed.
        if (previousCentroids) {
            this.lockedClusters.forEach((data, key) => {
                if (key.startsWith('visual_')) {
                    const idx = parseInt(key.replace('visual_', ''));
                    if (idx < previousCentroids.length) {
                        previousCentroids[idx] = [...data.centroid];
                    }
                }
            });
        }

        this.clusterWorker.postMessage({
            embeddings: validEmbeddings,
            k: this.k,
            threshold: this.threshold,
            previousCentroids: previousCentroids,
            lockedIndices: lockedIndices,
            lockedRadii: lockedRadii,
            lockedCentroids: lockedCentroids
        });
    }

    async loadThumbnail(path) {
        if (this.thumbnailCache.has(path)) return this.thumbnailCache.get(path).url;
        if (this.thumbnailPromises.has(path)) return this.thumbnailPromises.get(path);

        const promise = (async () => {
            const handle = this.handleMap.get(path);
            if (!handle) return null;

            if (!this.imageWorker) {
                this.imageWorker = new Worker('js/image_worker.js');
                this.imageWorker.onmessage = (e) => {
                    const { status, blob, path: resPath, error } = e.data;
                    const resolver = this.thumbnailResolvers.get(resPath);
                    if (status === 'success') {
                        const url = URL.createObjectURL(blob);
                        // Store both URL and blob for reuse during upload
                        this.thumbnailCache.set(resPath, { url, blob });
                        this.thumbnailsCreatedSinceLastLog++;
                        if (resolver) resolver(url);
                    } else {
                        console.warn("ImageWorker failed:", error);
                        if (resolver) resolver(null);
                    }

                    this.thumbnailResolvers.delete(resPath);
                    this.thumbnailPromises.delete(resPath);

                    // Update UI status during loading
                    if (this.thumbnailPromises.size > 0) {
                        this.updateUI({ currentAction: `🖼️ Loading thumbnails (${this.thumbnailPromises.size})...` });
                    } else {
                        // Complete
                        this.updateUI({
                            currentAction: this.processing.isRunning
                                ? `✅ Clusters updated based on available ${this.currentEmbeddings.length} images data.`
                                : "✅ Ready."
                        });
                        this.logImageSummary();
                    }
                };
            }

            try {
                const file = handle; // handle is now the File object directly
                return new Promise((resolve) => {
                    this.thumbnailResolvers.set(path, resolve);
                    this.imageWorker.postMessage({ file, targetWidth: 300, path });
                });
            } catch (e) {
                console.warn(`%c[App] Failed to load thumbnail for ${path}: ${e.message}`, "color: #ff9800;");
                return null;
            }
        })();

        this.thumbnailPromises.set(path, promise);
        return promise;
    }

    handleShowMoreMetadata() {
        if (this.currentMetadataClusters.length < this.allMetadataClusters.length) {
            this.visibleMetadataClustersCount += 3;
            this.currentMetadataClusters = this.allMetadataClusters.slice(0, this.visibleMetadataClustersCount);
            
            if (this.lockedClusters.size > 0) {
                this.currentMetadataClusters = this.applyMetadataLockedConstraints(this.currentMetadataClusters);
            }
            this.evaluateLockingConstraints();
            
            this.ui.renderClusters(this.currentMetadataClusters, this.ui.metadataClusterGrid);
            this.ui.updateMetadataPagination(this.currentMetadataClusters.length, this.allMetadataClusters.length);
            
            // Trigger Enrichment for the newly visible clusters
            this.enrichTimelineClusters();
        }
    }

    async handleProceed() {
        try {
            if (this.currentEmbeddings.length === 0) {
                alert("⚠️ No Data: Please wait for the AI to analyze more images before proceeding.");
                return;
            }

            // Show Action Selection Modal
            this.ui.showActionChoice();
        } catch (e) {
            console.error("Proceed initiation failed:", e);
        }
    }

    async handleUploadPassfaces(username) {
        try {
            const selectedMetadata = this.ui.getSelectedClusterIndices(); // Returns {id, domain}
            let clustersToUpload = [];

            const totalLocks = selectedMetadata.length;
            
            if (totalLocks !== 6) {
                alert(`⚠️ Selection Required: Please select exactly 6 clusters to initialize your Passfaces setup. You currently have ${totalLocks} selected.`);
                return;
            }

            // Gather clusters from both domains
            selectedMetadata.forEach(sel => {
                if (sel.domain === 'visual') {
                    const cl = this.currentClusters.find(c => c.id.toString() === sel.id.toString());
                    if (cl) clustersToUpload.push(cl);
                } else if (sel.domain === 'metadata') {
                    const cl = this.currentMetadataClusters.find(c => c.id.toString() === sel.id.toString());
                    if (cl) clustersToUpload.push(cl);
                }
            });

            // Mapping clusters to include their original user-facing label (Cluster 1, etc.)
            const clustersWithMetadata = clustersToUpload.map((c, i) => {
                return {
                    ...c,
                    originalLabel: c.label || `Cluster ${i + 1}`
                };
            });

            // Show reorder modal first
            this.ui.showReorderModal(clustersWithMetadata, (reorderedClusters) => {
                this.executePassfacesUpload(username, reorderedClusters);
            });

        } catch (e) {
            console.error("Upload initiation failed:", e);
        }
    }

    async executePassfacesUpload(username, reorderedClusters) {
        const API_BASE = 'https://passfaces.vercel.app';
        const MAX_RETRIES = 3;
        const TARGET_SIZE_KB = 200;

        try {
            console.log(`%c[UPLOAD] Starting Passfaces upload for user: ${username}`, "color: #4caf50; font-weight: bold;");

            // ============ STEP 0: PREPARE IMAGES ============
            this.ui.showProgress("Preparing images...");

            const compressedImages = [];
            let totalProcessed = 0;

            for (let i = 0; i < reorderedClusters.length; i++) {
                const cluster = reorderedClusters[i];
                // Augment cluster for UI progress
                cluster.index = i;
                cluster.originalOrder = i;

                this.ui.showProgress(`Preparing Group # ${i + 1}`, cluster);

                for (let j = 0; j < 16; j++) {
                    const imgData = cluster.representatives[j];
                    const handle = this.handleMap.get(imgData.path);

                    let blob;
                    const cached = this.thumbnailCache.get(imgData.path);
                    if (cached && cached.blob) {
                        blob = cached.blob;
                    } else {
                        const file = handle; // handle is now the File object directly
                        blob = await this.compressImageForUpload(file, TARGET_SIZE_KB);
                    }
                    compressedImages.push(blob);
                    totalProcessed++;
                    this.ui.updateProgress(totalProcessed, 96, `Preparing images (${totalProcessed}/96)...`);
                }
            }

            // ============ STEP 1: START SESSION ============
            this.ui.showProgress("Starting session...");
            this.ui.updateProgress(0, 100, "Connecting...");
            const startResponse = await fetch(`${API_BASE}/api/external/start-session`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username })
            });

            if (!startResponse.ok) {
                const err = await startResponse.json();
                throw new Error(err.error || "Session start failed");
            }

            for (let i = 0; i < 6; i++) {
                const cluster = reorderedClusters[i];
                this.ui.showProgress(`Uploading Group # ${i + 1}`, cluster);
                this.ui.updateProgress(i, 6, `Uploaded ${i}/6 groups`);

                const groupImages = compressedImages.slice(i * 16, (i + 1) * 16);
                const formData = new FormData();
                formData.append('username', username);
                groupImages.forEach((blob, idx) => {
                    formData.append('images', blob, `cluster_${i}_img_${idx}.jpg`);
                });

                let uploadSuccess = false;
                for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
                    try {
                        const response = await fetch(`${API_BASE}/api/external/upload-group/${i}`, {
                            method: 'POST',
                            body: formData
                        });
                        if (response.ok) {
                            uploadSuccess = true;
                            break;
                        }
                    } catch (err) {
                        if (attempt === MAX_RETRIES) throw err;
                        await new Promise(r => setTimeout(r, 1000 * attempt));
                    }
                }
                if (!uploadSuccess) throw new Error(`Group ${i + 1} upload failed`);
                this.ui.updateProgress(i + 1, 6, `Uploaded ${i + 1}/6 clusters`);
            }

            // ============ STEP 3: COMPLETE ============
            this.ui.showProgress("Finalizing setup...");
            const completeResponse = await fetch(`${API_BASE}/api/external/complete?username=${encodeURIComponent(username)}`);

            if (completeResponse.ok) {
                this.ui.updateProgress(6, 6, "Success! Redirecting...");
                window.location.href = completeResponse.url;
            } else {
                const err = await completeResponse.json();
                alert(`Validation Failed: ${err.error || "Check your cluster selection"}`);
                this.ui.hideProgress();
            }

        } catch (e) {
            console.error("Upload failed:", e);
            alert(`Upload Failed: ${e.message}`);
            this.ui.hideProgress();
        }
    }

    async compressImageForUpload(file, targetSizeKB) {
        return new Promise(async (resolve, reject) => {
            try {
                // Start with reasonable dimensions that should give us ~200KB
                let targetWidth = 800;
                let quality = 0.85;

                // Create bitmap with target width
                const bitmap = await createImageBitmap(file, {
                    resizeWidth: targetWidth,
                    resizeQuality: 'high'
                });

                // Convert to blob
                const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
                const ctx = canvas.getContext('2d');
                ctx.drawImage(bitmap, 0, 0);

                let blob = await canvas.convertToBlob({
                    type: 'image/jpeg',
                    quality: quality
                });

                bitmap.close();

                // If still too large, reduce quality
                if (blob.size > targetSizeKB * 1024 * 1.5) {
                    quality = 0.7;
                    const bitmap2 = await createImageBitmap(file, {
                        resizeWidth: targetWidth,
                        resizeQuality: 'medium'
                    });
                    const canvas2 = new OffscreenCanvas(bitmap2.width, bitmap2.height);
                    const ctx2 = canvas2.getContext('2d');
                    ctx2.drawImage(bitmap2, 0, 0);
                    blob = await canvas2.convertToBlob({ type: 'image/jpeg', quality });
                    bitmap2.close();
                }

                resolve(blob);
            } catch (err) {
                reject(err);
            }
        });
    }

    async handleSave() {
        // Obsolete but kept if needed by other components, though we removed its listener
        this.handleProceed();
    }

    async handleConfirmSaveLocation() {
        try {
            const btn = document.getElementById('btn-proceed');
            const originalText = "🚀 PROCEED";

            btn.textContent = "ZIPPING...";
            btn.disabled = true;

            const selectedMetadata = this.ui.getSelectedClusterIndices();
            let clustersToSave = [];

            selectedMetadata.forEach(sel => {
                if (sel.domain === 'visual') {
                    const cl = this.currentClusters.find(c => c.id.toString() === sel.id.toString());
                    if (cl) clustersToSave.push(cl);
                } else if (sel.domain === 'metadata') {
                    const cl = this.currentMetadataClusters.find(c => c.id.toString() === sel.id.toString());
                    if (cl) clustersToSave.push(cl);
                }
            });

            if (clustersToSave.length === 0) {
                alert("❌ System Error: A selection mismatch occurred. Please try selecting the clusters again."); // Should not happen
                btn.disabled = false;
                btn.textContent = originalText;
                return;
            }

            this.ui.showProgress("Starting Zipping...");

            // Create ZIP using JSZip
            const zip = new JSZip();
            const rootFolderName = `clusterai_curated_${new Date().getTime()}`;
            const zipRoot = zip.folder(rootFolderName);

            let totalFiles = 0;
            clustersToSave.forEach(c => totalFiles += c.representatives.length);
            let processedFiles = 0;

            for (const cluster of clustersToSave) {
                const safeLabel = cluster.label.replace(/[^a-z0-9]/gi, '_');
                const clusterFolder = zipRoot.folder(safeLabel);

                for (const member of cluster.representatives) {
                    const file = this.handleMap.get(member.path); // handleMap now stores the actual File
                    if (!file) {
                        console.warn(`Cannot find file for ${member.path}, skipping save.`);
                        continue;
                    }

                    const originalName = member.path.split('/').pop();
                    clusterFolder.file(originalName, file);
                    processedFiles++;
                    this.ui.updateProgress(processedFiles, totalFiles, `Adding ${originalName} to zip...`);
                }
            }

            this.ui.showProgress("Generating ZIP file...");
            const blob = await zip.generateAsync({ type: "blob" }, (metadata) => {
                this.ui.updateProgress(metadata.percent, 100, `Compressing... ${metadata.percent.toFixed(0)}%`);
            });

            // Trigger Download
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.style.display = "none";
            a.href = url;
            a.download = `${rootFolderName}.zip`;
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);

            this.ui.hideProgress();
            alert(`✅ Success: Your curated clusters have been downloaded as a ZIP file.`);

            btn.textContent = originalText;
            btn.disabled = false;
        } catch (e) {
            console.error("Save failed:", e);
            alert("❌ Save Error: We encountered a problem zipping your selection. Please try again or check your memory usage.");
            this.ui.hideProgress();
            document.getElementById('btn-proceed').disabled = false;
            document.getElementById('btn-proceed').textContent = "🚀 PROCEED";
        }
    }

    async handleManageStorage() {
        try {
            const projects = await db.getAllProjects();
            this.ui.renderProjectStorageList(projects, db.currentProject);
        } catch (e) {
            console.error("Failed to fetch storage projects:", e);
        }
    }

    async handleDeleteProjectData(projectId) {
        try {
            await db.deleteProjectData(projectId);

            if (projectId === db.currentProject) {
                // If it's the current project, we need to reset/reload
                window.location.reload();
            } else {
                // Otherwise just refresh the list
                this.handleManageStorage();
            }
        } catch (e) {
            console.error("Failed to delete project data:", e);
            alert("❌ Deletion Failed: Could not clear AI metadata.");
        }
    }

    async handleDeleteAllData() {
        try {
            await db.deleteAllData();
            window.location.reload();
        } catch (e) {
            console.error("Failed to delete all project data:", e);
            alert("❌ Deletion Failed: Could not clear all AI metadata.");
        }
    }

    // --- Lock / Unlock Logic ---

    handleLockCluster(clusterId, domain) {
        let cluster;
        let index;
        let lockKey = `${domain}_${clusterId}`;

        if (domain === 'visual') {
            index = this.currentClusters.findIndex(c => c.id.toString() === clusterId.toString());
            cluster = this.currentClusters[index];
        } else {
            index = this.currentMetadataClusters.findIndex(c => c.id.toString() === clusterId.toString());
            cluster = this.currentMetadataClusters[index];
        }

        if (!cluster) return;

        if (cluster.representatives.length < 16) {
            alert("⚠️ Cluster Too Small: Only clusters with 16 or more images can be locked for Passfaces.");
            // Re-render grids to revert checkbox visually
            this.evaluateLockingConstraints();
            this.ui.renderClusters(this.currentClusters, this.ui.clusterGrid);
            this.ui.renderClusters(this.currentMetadataClusters, this.ui.metadataClusterGrid);
            return;
        }

        if (domain === 'visual') {
            // Calculate Radius only relevant for visual KMeans anchoring
            const reps = cluster.representatives;
            const centroid = cluster.centroid;
            let maxRadius = 0;
            reps.forEach(r => {
                const d = this.clustering.cosineDistance(r.embedding, centroid);
                if (d > maxRadius) maxRadius = d;
            });

            const inRadiusCount = cluster.members.filter(m =>
                this.clustering.cosineDistance(m.embedding, centroid) <= maxRadius
            ).length;

            this.lockedClusters.set(lockKey, {
                domain: domain,
                centroid: [...centroid],
                representatives: JSON.parse(JSON.stringify(reps)), // Pinned set
                maxRadius: maxRadius,
                initialCoverage: inRadiusCount,
                initialTotalSize: cluster.members.length,
                initialMembership: new Set(cluster.members.map(m => m.path)),
                pinnedIndex: index
            });
        } else {
            // Metadata cluster lock (Just pinning the cluster contents)
            this.lockedClusters.set(lockKey, {
                domain: domain,
                representatives: JSON.parse(JSON.stringify(cluster.representatives)),
                pinnedIndex: index
            });
        }

        cluster.isLocked = true;
        cluster.driftCount = 0;

        console.log(`[App] %cLocked ${domain} cluster ${cluster.label}`, "color: #10b981; font-weight: bold;");

        // Compute cross-domain constraints
        this.evaluateLockingConstraints();

        this.ui.renderClusters(this.currentClusters, this.ui.clusterGrid);
        this.ui.renderClusters(this.currentMetadataClusters, this.ui.metadataClusterGrid);
        
        this.updateUI({ lastEvent: `Locked ${domain} Cluster ${cluster.label}` });
    }

    handleUnlockCluster(clusterId, domain) {
        let lockKey = `${domain}_${clusterId}`;
        
        if (this.lockedClusters.has(lockKey)) {
            this.lockedClusters.delete(lockKey);

            let cluster;
            if (domain === 'visual') {
                cluster = this.currentClusters.find(c => c.id.toString() === clusterId.toString());
            } else {
                cluster = this.currentMetadataClusters.find(c => c.id.toString() === clusterId.toString());
            }

            if (cluster) {
                cluster.isLocked = false;

                if (domain === 'visual' && cluster.members.length > 0) {
                     cluster.representatives = this.clustering.selectClosestToCentroid(
                        cluster.members,
                        cluster.centroid,
                        16,
                        this.threshold
                    );
                } else if (domain === 'metadata' && cluster.members.length > 0) {
                     // Metadata uses the same selection logic as the engine for stability
                     cluster.representatives = this.clustering.selectClosestToCentroid(
                        cluster.members,
                        cluster.centroid,
                        16,
                        this.threshold
                    );
                }
            }

            // Compute cross-domain constraints
            this.evaluateLockingConstraints();

            this.ui.renderClusters(this.currentClusters, this.ui.clusterGrid);
             this.ui.renderClusters(this.currentMetadataClusters, this.ui.metadataClusterGrid);
             
            this.updateUI({ lastEvent: `Unlocked ${domain} Cluster` });
            console.log(`[App] Unlocked ${domain} cluster ${clusterId}`);
        }
    }

    /**
     * Cross-Domain Constraints:
     * Disables clusters in Section B if they share any representative image with a locked cluster in Section A.
     */
    evaluateLockingConstraints() {
        // Build sets of locked image paths per domain
        const lockedVisualPaths = new Set();
        const lockedMetadataPaths = new Set();

        for (const [key, data] of this.lockedClusters) {
            data.representatives.forEach(r => {
                if(data.domain === 'visual') lockedVisualPaths.add(r.path);
                else lockedMetadataPaths.add(r.path);
            });
        }

        // Check Visual Clusters against locked metadata paths
        this.currentClusters.forEach(cluster => {
            if(cluster.isLocked) {
                cluster.isDisabled = false;
                return;
            }
            // Check intersection
            const hasConflict = cluster.representatives.some(r => lockedMetadataPaths.has(r.path));
            cluster.isDisabled = hasConflict;
        });

        // Check Metadata Clusters against locked visual paths
        this.currentMetadataClusters.forEach(cluster => {
            if(cluster.isLocked) {
                cluster.isDisabled = false;
                return;
            }
             const hasConflict = cluster.representatives.some(r => lockedVisualPaths.has(r.path));
            cluster.isDisabled = hasConflict;
        });
    }

    applyMetadataLockedConstraints(clusters) {
        // Just preserve the isLocked visual state for metadata clusters during a refresh
        // Their contents don't "drift" because metadata is fixed, unless an exclusion happens.
        clusters.forEach(cluster => {
            const lockKey = `metadata_${cluster.id}`;
            if (this.lockedClusters.has(lockKey)) {
                cluster.isLocked = true;
                const lockData = this.lockedClusters.get(lockKey);
                // Force pinned reps if exclusions removed an item
                cluster.representatives = lockData.representatives.filter(r => !this.excludedPaths.has(r.path));
                if (cluster.representatives.length < 16) {
                    cluster.driftCount = 16 - cluster.representatives.length;
                } else {
                    cluster.driftCount = 0;
                }
            } else {
                cluster.isLocked = false;
                cluster.driftCount = 0;
            }
        });

        // RE-ORDERING: Ensure locked clusters stay at their pinned positions
        const result = [...clusters];
        const lockedMetadata = Array.from(this.lockedClusters.values())
            .filter(data => data.domain === 'metadata' && data.pinnedIndex !== undefined)
            .sort((a, b) => a.pinnedIndex - b.pinnedIndex);

        lockedMetadata.forEach(data => {
            // Find where it is currently
            const currentIdx = result.findIndex(c => {
                const lockKey = `metadata_${c.id}`;
                return this.lockedClusters.has(lockKey) && this.lockedClusters.get(lockKey).pinnedIndex === data.pinnedIndex;
            });

            if (currentIdx !== -1 && currentIdx !== data.pinnedIndex && data.pinnedIndex < result.length) {
                // Swap it back to its pinned index
                const temp = result[data.pinnedIndex];
                result[data.pinnedIndex] = result[currentIdx];
                result[currentIdx] = temp;
            }
        });

        return result;
    }

    compactLockedClusters(newK) {
        // Sort existing by index to preserve relative order where possible
        // keys are like 'visual_0', 'metadata_meta_2026-03-17'
        const visualLocked = Array.from(this.lockedClusters.entries())
            .filter(([key]) => key.startsWith('visual_'))
            .map(([key, data]) => ({
                key,
                index: parseInt(key.replace('visual_', '')),
                data
            }))
            .sort((a, b) => a.index - b.index);

        const newMap = new Map();
        const takenIndices = new Set();

        // Pass 1: Keep clusters that already fit in the new range
        for (const item of visualLocked) {
            if (item.index < newK) {
                newMap.set(item.key, item.data);
                takenIndices.add(item.index);
            }
        }

        // Pass 2: Move clusters that were in "lost" slots into the first available holes
        let nextAvailable = 0;
        let movedCount = 0;
        let lastFrom = -1, lastTo = -1;

        for (const item of visualLocked) {
            if (item.index >= newK) {
                while (takenIndices.has(nextAvailable)) {
                    nextAvailable++;
                }
                if (nextAvailable < newK) {
                    const newKey = `visual_${nextAvailable}`;
                    item.data.relocatedFrom = item.index; // Store movement for UI
                    item.data.pinnedIndex = nextAvailable;
                    newMap.set(newKey, item.data);
                    takenIndices.add(nextAvailable);

                    movedCount++;
                    lastFrom = item.index; lastTo = nextAvailable;
                    console.log(`%c[App] Relocating locked cluster from slot ${item.index + 1} to ${nextAvailable + 1}`, "color: #f59e0b; font-weight: bold;");
                }
            }
        }

        // Preserve metadata locks (they aren't affected by visual K)
        for (const [key, data] of this.lockedClusters) {
            if (!key.startsWith('visual_')) {
                newMap.set(key, data);
            }
        }

        // MATHEMATICAL STABILITY: Update lastCentroids to match new positions
        if (this.lastCentroids) {
            const newCentroids = [];
            // Fill with truncated lastCentroids first (up to newK)
            for (let i = 0; i < newK; i++) {
                newCentroids.push(this.lastCentroids[i] ? [...this.lastCentroids[i]] : new Array(512).fill(0));
            }
            
            // Overwrite positions with relocated locked centroids
            for (const item of visualLocked) {
                if (item.index >= newK) {
                    // Find where it moved to in newMap
                    // We know the loop above in Pass 2 used nextAvailable
                    // Actually we can just re-extract from our just-built newMap
                }
            }

            // Simpler: Just sync newCentroids to match everything in newMap.keys() (visuals)
            for (const [key, data] of newMap.entries()) {
                if (key.startsWith('visual_')) {
                    const idx = parseInt(key.replace('visual_', ''));
                    if (idx < newK) {
                        newCentroids[idx] = [...data.centroid];
                    }
                }
            }
            this.lastCentroids = newCentroids;
        }

        if (movedCount === 1) {
            this.updateUI({ lastEvent: `Relocated Cluster ${lastFrom + 1} ➔ ${lastTo + 1}` });
        } else if (movedCount > 1) {
            this.updateUI({ lastEvent: `Relocated ${movedCount} clusters` });
        }

        this.lockedClusters = newMap;
    }

    applyLockedConstraints(clusters) {
        if (this.lockedClusters.size === 0) return clusters;

        console.log(`%c[Lock] --- Applying Fixed-Centroid Absorption Constraints ---`, "color: #3b82f6; font-weight: bold;");

        this.lockedClusters.forEach((lockedData, key) => {
            if (!key.startsWith('visual_')) return;
            const index = lockedData.pinnedIndex;
            const cluster = clusters[index];
            if (!cluster) return;

            // 1. Mark as locked and track movement
            cluster.isLocked = true;
            cluster.driftCount = 0; // Visual drift is now 0 by definition
            if (lockedData.relocatedFrom !== undefined) {
                cluster.movedFrom = lockedData.relocatedFrom;
            }

            // 2. VISUAL OVERRIDE: Restore Pinned Representatives
            // We use the exact 16 images stored at lock time.
            cluster.representatives = JSON.parse(JSON.stringify(lockedData.representatives));

            // 3. DETAILED LOGGING (Membership Churn)
            const currentMembers = cluster.members;
            const initialPaths = lockedData.initialMembership;

            let coreRetained = 0;
            let coreAbsorbed = 0;
            let proximityRetained = 0;
            let proximityAbsorbed = 0;

            currentMembers.forEach(m => {
                const isInRadius = this.clustering.cosineDistance(m.embedding, lockedData.centroid) <= lockedData.maxRadius;
                const isInitial = initialPaths.has(m.path);

                if (isInRadius) {
                    if (isInitial) coreRetained++;
                    else coreAbsorbed++;
                } else {
                    if (isInitial) proximityRetained++;
                    else proximityAbsorbed++;
                }
            });

            const currentPaths = new Set(currentMembers.map(m => m.path));
            const departedCount = Array.from(initialPaths).filter(path => !currentPaths.has(path)).length;

            console.log(`%c[Lock] Cluster ${index + 1}:`, "font-weight: bold;");
            console.log(`  - Core Lock: ${coreRetained + coreAbsorbed} images (${coreRetained} retained | ${coreAbsorbed} absorbed) | Forced`);
            console.log(`  - Proximity: ${proximityRetained + proximityAbsorbed} total (${proximityRetained} retained | ${proximityAbsorbed} absorbed)`);
            console.log(`  - Departures: ${departedCount} images left for other clusters`);
            console.log(`  - Cluster Size: ${currentMembers.length} (Initial: ${lockedData.initialTotalSize})`);
        });

        return clusters;
    }

    cleanupThumbnails(shouldLog = true) {
        if (!this.currentClusters || this.currentClusters.length === 0) return;

        // 1. Get all paths currently being displayed (from BOTH visual and timeline grids)
        const activePaths = new Set();
        const allActiveSourceGrids = [this.currentClusters, this.currentMetadataClusters];
        
        allActiveSourceGrids.forEach(grid => {
            if (!grid) return;
            grid.forEach(cluster => {
                cluster.representatives.forEach(rep => activePaths.add(rep.path));
            });
        });

        // 2. Clear cache for paths NOT in the active set
        let destroyed = 0;
        for (const [path, data] of this.thumbnailCache.entries()) {
            if (!activePaths.has(path)) {
                URL.revokeObjectURL(data.url);
                this.thumbnailCache.delete(path);
                destroyed++;
            }
        }
        this.thumbnailsDestroyedSinceLastLog += destroyed;

        if (shouldLog) {
            this.logImageSummary();
        }
    }

    /**
     * For each visible timeline cluster, asynchronously find its geographic name
     * and update the UI label.
     */
    async enrichTimelineClusters() {
        if (!this.currentMetadataClusters) return;

        for (const cluster of this.currentMetadataClusters) {
            // Priority: Use already resolved location if available
            if (cluster.resolvedLocation) {
                this.ui.updateClusterGeotag(cluster.id, cluster.resolvedLocation);
                continue;
            }

            if (cluster.geoCentroid) {
                // Non-blocking async fetch
                this.clustering.reverseGeocode(cluster.geoCentroid.lat, cluster.geoCentroid.lon)
                    .then(locationName => {
                        if (locationName) {
                            cluster.resolvedLocation = locationName; // Persist in cluster object
                            this.ui.updateClusterGeotag(cluster.id, locationName);
                        }
                    });
            }
        }
    }

    logImageSummary() {
        if (this.thumbnailsCreatedSinceLastLog === 0 && this.thumbnailsDestroyedSinceLastLog === 0) return;

        console.log(`%c[Images] Summary: ${this.thumbnailsCreatedSinceLastLog} Created | ${this.thumbnailsDestroyedSinceLastLog} Destroyed | ${this.thumbnailCache.size} in Cache. Files: Scanned Total ${this.currentEmbeddings.length}`, "color: #00bcd4; font-weight: bold;");

        // Reset pass counters
        this.thumbnailsCreatedSinceLastLog = 0;
        this.thumbnailsDestroyedSinceLastLog = 0;
    }
}

window.app = new App();
