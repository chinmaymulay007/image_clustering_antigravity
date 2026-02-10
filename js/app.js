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
        this.lastCentroids = null; // Warm start stability
        this.excludedPaths = new Set();
        this.refreshInterval = 20;
        this.k = 6;
        this.threshold = 0.15;
        this.handleMap = new Map(); // Path -> FileHandle
        this.thumbnailCache = new Map(); // Path -> { url, blob }
        this.isClustering = false;
        this.pendingRecluster = false;
        this.clusterWorker = null;
        this.imageWorker = null;
        this.thumbnailPromises = new Map(); // Path -> Promise
        this.lockedClusters = new Map(); // Index -> { preferredPaths }

        // Logging & Memory Stats
        this.thumbnailsCreatedSinceLastLog = 0;
        this.thumbnailsDestroyedSinceLastLog = 0;

        console.log("ClusterAI Orchestrator Initialized");
        this.init();
    }

    init() {
        this.ui.setCallbacks({
            onSelectFolder: () => this.handleSelectFolder(),
            onPauseResume: (shouldPause) => this.handlePauseResume(shouldPause),
            onApplySettings: (settings) => this.handleApplySettings(settings),
            onProceed: () => this.handleProceed(),
            onUploadPassfaces: (username) => this.handleUploadPassfaces(username),
            onExcludeImage: (path) => this.handleExclude(path),
            onLoadThumbnail: (path) => this.loadThumbnail(path),
            onGetExcludedPaths: () => this.excludedPaths,
            onRestoreImage: (path) => this.handleRestore(path),
            onConfirmSaveLocation: (isDifferent) => this.handleConfirmSaveLocation(isDifferent),
            onLockCluster: (index) => this.handleLockCluster(index),
            onUnlockCluster: (index) => this.handleUnlockCluster(index)
        });
    }

    handleApplySettings(settings) {
        const currentLockedCount = this.lockedClusters.size;

        if (settings.k < currentLockedCount) {
            alert(`⚠️ Action Required: Cannot reduce total clusters to ${settings.k}.\n\nYou currently have ${currentLockedCount} clusters locked. Please unlock some clusters before decreasing the total count.`);
            return;
        }

        // Check if any locked clusters need to be "slid" down into the new range
        const lockedIndices = Array.from(this.lockedClusters.keys());
        const maxLockedIndex = lockedIndices.length > 0 ? Math.max(...lockedIndices) : -1;

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
        this.ui.updateStats({ lastEvent: `Settings changed` });
        this.refreshClusters();
    }

    async handleSelectFolder() {
        console.log("[App] User clicked Select Folder.");
        try {
            const dirName = await this.fs.selectDirectory();
            console.log(`[App] Selected: ${dirName}`);

            // Initialize Database for this project
            await db.init(dirName);

            this.ui.hideInitialOverlay();

            // Setup callbacks from Processing
            this.processing.onProgress = (stats) => {
                this.ui.updateStats(stats);
            };

            this.processing.onClusterUpdate = async (embeddings) => {
                this.currentEmbeddings = embeddings;
                await this.refreshClusters();
            };

            // Start Processing
            // Note: We need to populate handleMap AFTER processing scans
            // But processing.start() scans internaly. 
            // We should split scan? Or just read access from processing.
            // Let's rely on processing to set state, then we read it.

            this.processing.start(this.refreshInterval).then(() => {
                // Post-scan, build map for fast retrieval
                this.rebuildHandleMap();

                // Sync loaded exclusions
                this.processing.excludedPaths.forEach(p => this.excludedPaths.add(p));
                console.log(`[App] Synced ${this.excludedPaths.size} exclusions from manifest.`);

                if (this.processing.isPaused) {
                    this.ui.updateStats({ currentAction: "⏸️ Database loaded. Ready to resume." });
                    this.ui.setPauseState(true); // Ensure button says "RESUME"
                } else {
                    this.ui.updateStats({ currentAction: "🧠 Scan complete. Starting AI analysis..." });
                    this.ui.setPauseState(false);
                }

                console.log("[App] Initial scan complete. Handle map rebuilt.");
            });

        } catch (error) {
            console.error("Initialization failed:", error);
            alert("❌ Folder Access Failed: We couldn't open the selected folder. Please ensure the app has permission and try again.");
        }
    }

    rebuildHandleMap() {
        this.handleMap.clear();
        if (this.processing.allImages) {
            this.processing.allImages.forEach(img => {
                this.handleMap.set(img.path, img.handle);
            });
        }
    }

    handlePauseResume(shouldPause) {
        if (shouldPause) {
            this.processing.pause();
            this.ui.updateStats({
                currentAction: "⏸️ Processing Paused.",
                lastEvent: "Processing Paused"
            });
        } else {
            this.processing.resume();
            this.ui.updateStats({
                currentAction: "▶️ Resuming...",
                lastEvent: "Processing Resumed"
            });
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
        this.ui.updateStats({
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
        this.ui.updateStats({
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
        this.ui.updateStats({ currentAction: "♻️ Refreshing clusters..." });

        if (!this.clusterWorker) {
            this.clusterWorker = new Worker('js/clustering_worker.js', { type: 'module' });
            this.clusterWorker.onmessage = (e) => {
                const { status, result, error } = e.data;
                this.isClustering = false;

                if (status === 'success') {
                    let clusters = result.clusters;

                    // POST-PROCESSING: Apply locked constraints
                    if (this.lockedClusters.size > 0) {
                        clusters = this.applyLockedConstraints(clusters);
                    }

                    this.currentClusters = clusters;
                    this.lastCentroids = result.centroids;

                    // Update UI
                    this.ui.renderClusters(this.currentClusters);

                    // Check for pending thumbnails
                    if (this.thumbnailPromises.size > 0) {
                        this.ui.updateStats({ currentAction: `🖼️ Loading thumbnails (${this.thumbnailPromises.size})...` });
                    } else {
                        const processedCount = this.processing.processedPaths.size;
                        const msg = `✅ Clusters updated based on available ${processedCount} images data.`;
                        // Only show "Clusters updated" if NOT paused, otherwise it clears the PAUSED indicator
                        if (!this.processing.isPaused) {
                            this.ui.updateStats({
                                currentAction: msg
                            });
                        }
                        this.ui.updateStats({
                            lastEvent: msg // Also show in last event area for persistence
                        });
                    }

                    // Immediate Cleanup (RAM), but Delay Logging until thumbnails are ready
                    this.cleanupThumbnails(false); // false = don't log yet

                    // If everything was already in cache, log immediately
                    if (this.thumbnailPromises.size === 0) {
                        this.logImageSummary();
                    }

                    // If a re-cluster was requested while we were busy, do it now
                    if (this.pendingRecluster) {
                        this.pendingRecluster = false;
                        this.refreshClusters();
                    }
                } else {
                    console.error("Clustering Worker Error:", error);
                }
            };
        }

        const lockedIndices = Array.from(this.lockedClusters.keys());
        const lockedRadii = {};
        const lockedCentroids = {};

        if (this.lockedClusters.size > 0) {
            this.lockedClusters.forEach((data, index) => {
                lockedRadii[index] = data.maxRadius;
                lockedCentroids[index] = data.centroid;
            });
        }

        const previousCentroids = this.lastCentroids ? this.lastCentroids.map(c => [...c]) : null;

        // If K changed or centroids don't exist, we can't easily warm start with locked ones 
        // unless we force the worker to respect the specific indices.
        // Actually, previousCentroids helps Lloyd's init.
        if (previousCentroids && previousCentroids.length === this.k) {
            // ... (Optional: we already have lockedCentroids handling the anchors, but keeping consistency)
            this.lockedClusters.forEach((data, index) => {
                if (index < previousCentroids.length) {
                    previousCentroids[index] = [...data.centroid];
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
                    const resolver = this.thumbnailPromises.get(resPath)?.resolver;
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

                    this.thumbnailPromises.delete(resPath);

                    // Update UI status during loading
                    if (this.thumbnailPromises.size > 0) {
                        this.ui.updateStats({ currentAction: `🖼️ Loading thumbnails (${this.thumbnailPromises.size})...` });
                    } else {
                        // Complete
                        this.ui.updateStats({
                            currentAction: this.processing.isRunning
                                ? `✅ Clusters updated based on available ${this.currentEmbeddings.length} images data.`
                                : "✅ Ready."
                        });
                        this.logImageSummary();
                    }
                };
            }

            try {
                const file = await handle.getFile();
                return new Promise((resolve) => {
                    this.thumbnailPromises.set(path, { resolver: resolve });
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
            const selectedIndices = this.ui.getSelectedClusterIndices();
            const clustersToUpload = this.currentClusters.filter((c, i) => selectedIndices.includes(i));

            if (clustersToUpload.length !== 6) {
                alert("⚠️ Selection Required: Please select exactly 6 clusters to initialize your Passfaces setup.");
                return;
            }

            // Mapping clusters to include their original user-facing label (Cluster 1, etc.)
            const clustersWithMetadata = clustersToUpload.map((c, i) => {
                // Find the index of this cluster in the original array to get the "Cluster N" label
                const originalIndex = this.currentClusters.indexOf(c);
                return {
                    ...c,
                    originalLabel: `Cluster ${originalIndex + 1}`
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
                        const file = await handle.getFile();
                        blob = await this.compressImageForUpload(file, TARGET_SIZE_KB);
                    }
                    compressedImages.push(blob);
                    totalProcessed++;
                    this.ui.updateProgress(totalProcessed, 96, `Preparing images (${totalProcessed}/96)...`);
                }
            }

            // ============ STEP 1: START SESSION ============
            this.ui.showProgress("Starting session...");
            const startResponse = await fetch(`${API_BASE}/api/external/start-session`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username })
            });

            if (!startResponse.ok) {
                const err = await startResponse.json();
                throw new Error(err.error || "Session start failed");
            }

            // ============ STEP 2: UPLOAD GROUPS ============
            for (let i = 0; i < 6; i++) {
                const cluster = reorderedClusters[i];
                this.ui.showProgress(`Uploading Group # ${i + 1}`, cluster);

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

    async handleConfirmSaveLocation(isDifferent) {
        try {
            const btn = document.getElementById('btn-proceed');
            const originalText = "🚀 PROCEED";

            let targetHandle = null;
            if (isDifferent) {
                try {
                    targetHandle = await window.showDirectoryPicker({ mode: 'readwrite' });
                } catch (userCancelled) {
                    return; // Stop if user cancels folder picker
                }
            }

            btn.textContent = "SAVING...";
            btn.disabled = true;

            const selectedIndices = this.ui.getSelectedClusterIndices();
            const clustersToSave = this.currentClusters.filter((c, i) => selectedIndices.includes(i));

            if (clustersToSave.length === 0) {
                alert("❌ System Error: A selection mismatch occurred. Please try selecting the clusters again."); // Should not happen
                btn.disabled = false;
                btn.textContent = originalText;
                return;
            }

            // 4. Show Progress UI
            this.ui.showProgress("Starting Save...");

            // 5. Execute Save with Progress Callback
            const folderName = await this.fs.saveClusters(clustersToSave, this.handleMap, (current, total, text) => {
                this.ui.updateProgress(current, total, text);
            }, targetHandle);

            this.ui.hideProgress();
            alert(`✅ Success: Your curated clusters have been saved to "${folderName}".`);

            btn.textContent = originalText;
            btn.disabled = false;
        } catch (e) {
            console.error("Save failed:", e);
            alert("❌ Save Error: We encountered a problem saving your selection. Please try again or pick a different location.");
            this.ui.hideProgress();
            document.getElementById('btn-proceed').disabled = false;
            document.getElementById('btn-proceed').textContent = originalText;
        }
    }

    // --- Lock / Unlock Logic ---

    handleLockCluster(clusterIndex) {
        const cluster = this.currentClusters[clusterIndex];

        if (!cluster) return;

        if (cluster.representatives.length < 16) {
            alert("⚠️ Cluster Too Small: Only clusters with 16 or more images can be locked for Passfaces.");
            this.ui.renderClusters(this.currentClusters); // Revert checkbox state
            return;
        }

        // Calculate Radius (Distance from centroid to 16th representative)
        const reps = cluster.representatives;
        const centroid = cluster.centroid;
        let maxRadius = 0;
        reps.forEach(r => {
            const d = this.clustering.cosineDistance(r.embedding, centroid);
            if (d > maxRadius) maxRadius = d;
        });

        // Count images currently within this radius (Radius Lock Coverage)
        const inRadiusCount = cluster.members.filter(m =>
            this.clustering.cosineDistance(m.embedding, centroid) <= maxRadius
        ).length;

        this.lockedClusters.set(clusterIndex, {
            centroid: [...centroid],
            representatives: JSON.parse(JSON.stringify(reps)), // Pinned set
            maxRadius: maxRadius,
            initialCoverage: inRadiusCount,
            initialTotalSize: cluster.members.length,
            initialMembership: new Set(cluster.members.map(m => m.path)),
            initialIndex: clusterIndex
        });

        cluster.isLocked = true;
        cluster.driftCount = 0;

        console.log(`[App] %cLocked cluster ${clusterIndex + 1} | Radius: ${maxRadius.toFixed(4)} | Initial Radius Lock Coverage: ${inRadiusCount} images | Initial Total Size: ${cluster.members.length}`, "color: #10b981; font-weight: bold;");

        this.ui.renderClusters(this.currentClusters);
        this.ui.updateStats({ lastEvent: `Locked Cluster ${clusterIndex + 1}` });
    }

    handleUnlockCluster(clusterIndex) {
        if (this.lockedClusters.has(clusterIndex)) {
            this.lockedClusters.delete(clusterIndex);

            const cluster = this.currentClusters[clusterIndex];
            if (cluster) {
                cluster.isLocked = false;

                // Re-select representatives immediately using CURRENT members
                // This updates the view to show "natural" representatives without full recluster
                if (cluster.members.length > 0) {
                    cluster.representatives = this.clustering.selectClosestToCentroid(
                        cluster.members,
                        cluster.centroid,
                        16,
                        this.threshold
                    );
                }
            }

            this.ui.renderClusters(this.currentClusters);
            this.ui.updateStats({ lastEvent: `Unlocked Cluster ${clusterIndex + 1}` });
            console.log(`[App] Unlocked cluster ${clusterIndex + 1}`);
        }
    }

    compactLockedClusters(newK) {
        // Sort existing by index to preserve relative order where possible
        const sortedLocked = Array.from(this.lockedClusters.entries())
            .sort((a, b) => a[0] - b[0]);

        const newMap = new Map();
        const takenIndices = new Set();

        // Pass 1: Keep clusters that already fit in the new range
        for (const [index, data] of sortedLocked) {
            if (index < newK) {
                newMap.set(index, data);
                takenIndices.add(index);
            }
        }

        // Pass 2: Move clusters that were in "lost" slots into the first available holes
        let nextAvailable = 0;
        let movedCount = 0;
        let lastFrom = -1, lastTo = -1;

        for (const [index, data] of sortedLocked) {
            if (index >= newK) {
                while (takenIndices.has(nextAvailable)) {
                    nextAvailable++;
                }
                if (nextAvailable < newK) {
                    data.relocatedFrom = index; // Store movement for UI
                    newMap.set(nextAvailable, data);
                    takenIndices.add(nextAvailable);

                    movedCount++;
                    lastFrom = index; lastTo = nextAvailable;
                    console.log(`%c[App] Relocating locked cluster from slot ${index + 1} to ${nextAvailable + 1}`, "color: #f59e0b; font-weight: bold;");
                }
            }
        }

        if (movedCount === 1) {
            this.ui.updateStats({ lastEvent: `Relocated Cluster ${lastFrom + 1} ➔ ${lastTo + 1}` });
        } else if (movedCount > 1) {
            this.ui.updateStats({ lastEvent: `Relocated ${movedCount} clusters` });
        }

        this.lockedClusters = newMap;
    }

    applyLockedConstraints(clusters) {
        if (this.lockedClusters.size === 0) return clusters;

        console.log(`%c[Lock] --- Applying Fixed-Centroid Absorption Constraints ---`, "color: #3b82f6; font-weight: bold;");

        this.lockedClusters.forEach((lockedData, index) => {
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

        // 1. Get all paths currently being displayed
        const activePaths = new Set();
        this.currentClusters.forEach(cluster => {
            cluster.representatives.forEach(rep => activePaths.add(rep.path));
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

    logImageSummary() {
        if (this.thumbnailsCreatedSinceLastLog === 0 && this.thumbnailsDestroyedSinceLastLog === 0) return;

        console.log(`%c[Images] Summary: ${this.thumbnailsCreatedSinceLastLog} Created | ${this.thumbnailsDestroyedSinceLastLog} Destroyed | ${this.thumbnailCache.size} in Cache. Files: Scanned Total ${this.currentEmbeddings.length}`, "color: #00bcd4; font-weight: bold;");

        // Reset pass counters
        this.thumbnailsCreatedSinceLastLog = 0;
        this.thumbnailsDestroyedSinceLastLog = 0;
    }
}

window.app = new App();
