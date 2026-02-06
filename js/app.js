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
        this.frozenClusters = new Map(); // Index -> { preferredPaths }

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
            onFreezeCluster: (index) => this.handleFreezeCluster(index),
            onUnfreezeCluster: (index) => this.handleUnfreezeCluster(index)
        });
    }

    handleApplySettings(settings) {
        console.log("[App] Applying user settings:", settings);
        this.refreshInterval = settings.refreshInterval;
        this.k = settings.k;
        this.threshold = settings.threshold;

        // Sync to processing manager
        this.processing.refreshInterval = this.refreshInterval;

        // Immediate Re-cluster
        console.log("[App] Triggering immediate re-cluster due to settings change.");
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
                    this.ui.updateStats({ currentAction: "✅ Scan complete. Starting AI analysis..." });
                    this.ui.setPauseState(false);
                }

                console.log("[App] Initial scan complete. Handle map rebuilt.");
            });

        } catch (error) {
            console.error("Initialization failed:", error);
            alert("Failed to access folder. See console.");
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
            this.ui.updateStats({ currentAction: "⏸️ Processing Paused." });
        } else {
            this.processing.resume();
            this.ui.updateStats({ currentAction: "▶️ Resuming..." });
        }
        this.ui.setPauseState(shouldPause);
    }

    async handleExclude(path) {
        // Check if this path is a CURRENT frozen representative
        for (const cluster of this.currentClusters) {
            if (cluster.isFrozen) {
                const isFrozenRep = cluster.representatives.some(r => r.path === path);
                if (isFrozenRep) {
                    alert("⚠️ Cannot exclude: This image is a frozen representative.\n\nUnfreeze the cluster first.");
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
        this.ui.updateStats({ currentAction: `🚫 Excluding: ${path.split('/').pop()}` });
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
        this.ui.updateStats({ currentAction: `♻️ Restoring: ${path.split('/').pop()}` });
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

        if (!this.clusterWorker) {
            this.clusterWorker = new Worker('js/clustering_worker.js', { type: 'module' });
            this.clusterWorker.onmessage = (e) => {
                const { status, result, error } = e.data;
                this.isClustering = false;

                if (status === 'success') {
                    let clusters = result.clusters;

                    // POST-PROCESSING: Apply frozen constraints
                    if (this.frozenClusters.size > 0) {
                        clusters = this.applyFrozenConstraints(clusters);
                    }

                    this.currentClusters = clusters;
                    this.lastCentroids = result.centroids;

                    // Update UI
                    this.ui.renderClusters(this.currentClusters);

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

        this.clusterWorker.postMessage({
            embeddings: validEmbeddings,
            k: this.k,
            threshold: this.threshold,
            previousCentroids: this.lastCentroids
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
                        if (resolver) resolver(url);
                    } else {
                        console.warn("ImageWorker failed:", error);
                        if (resolver) resolver(null);
                    }
                    this.thumbnailPromises.delete(resPath);
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
                alert("No clusters to process yet. Process some images first.");
                return;
            }

            // Show Action Selection Modal
            this.ui.showActionChoice();
        } catch (e) {
            console.error("Proceed initiation failed:", e);
        }
    }

    async handleUploadPassfaces(username) {
        const API_BASE = 'https://passfaces.vercel.app';
        const MAX_RETRIES = 3;
        const TARGET_SIZE_KB = 200; // Target size per image

        try {
            const selectedIndices = this.ui.getSelectedClusterIndices();
            const clustersToUpload = this.currentClusters.filter((c, i) => selectedIndices.includes(i));

            if (clustersToUpload.length !== 6) {
                alert("Please select exactly 6 clusters for Passfaces upload.");
                return;
            }

            console.log(`%c[UPLOAD] Starting Passfaces upload for user: ${username}`, "color: #4caf50; font-weight: bold;");
            console.log(`[UPLOAD] Selected ${clustersToUpload.length} clusters (96 images total)`);

            // ============ STEP 0: PREPARE IMAGES (Reuse Cached Thumbnails) ============
            this.ui.showProgress("Preparing images...");
            console.log(`%c[STEP 0] Preparing images for upload (reusing cached thumbnails)`, "color: #ff9800; font-weight: bold;");

            const compressedImages = []; // Array of 96 blobs
            let processedCount = 0;
            let reuseCount = 0;
            let compressCount = 0;

            for (let groupIdx = 0; groupIdx < 6; groupIdx++) {
                const cluster = clustersToUpload[groupIdx];
                if (cluster.representatives.length !== 16) {
                    throw new Error(`Group ${groupIdx + 1} has ${cluster.representatives.length} images, expected 16.`);
                }

                for (const imgData of cluster.representatives) {
                    const handle = this.handleMap.get(imgData.path);
                    if (!handle) throw new Error(`File handle not found: ${imgData.path}`);

                    let blob;
                    const cached = this.thumbnailCache.get(imgData.path);

                    // Check if we already have a suitable compressed blob
                    if (cached && cached.blob) {
                        blob = cached.blob;
                        reuseCount++;
                        console.log(`[REUSE] ${processedCount + 1}/96: ${imgData.path.split('/').pop()} | ${(blob.size / 1024).toFixed(2)}KB (cached)`);
                    } else {
                        // Need to compress (shouldn't happen often since UI loads thumbnails)
                        const file = await handle.getFile();
                        const originalSizeKB = (file.size / 1024).toFixed(2);
                        blob = await this.compressImageForUpload(file, TARGET_SIZE_KB);
                        compressCount++;
                        console.log(`[COMPRESS] ${processedCount + 1}/96: ${imgData.path.split('/').pop()} | ${originalSizeKB}KB → ${(blob.size / 1024).toFixed(2)}KB`);
                    }

                    compressedImages.push(blob);
                    processedCount++;
                    this.ui.updateProgress(processedCount, 96, `Preparing images... ${processedCount}/96`);
                }
            }

            const totalCompressedSizeMB = (compressedImages.reduce((sum, b) => sum + b.size, 0) / (1024 * 1024)).toFixed(2);
            console.log(`%c[STEP 0] ✓ Preparation complete: ${totalCompressedSizeMB}MB total | Reused: ${reuseCount} | Compressed: ${compressCount}`, "color: #4caf50; font-weight: bold;");

            // ============ STEP 1: START SESSION ============
            console.log(`%c[STEP 1] Starting session...`, "color: #2196f3; font-weight: bold;");
            this.ui.updateProgress(96, 96, "Starting session...");

            const startResponse = await fetch(`${API_BASE}/api/external/start-session`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username })
            });

            const startData = await startResponse.json();
            console.log(`[STEP 1] Response (${startResponse.status}):`, startData);

            if (!startResponse.ok) {
                throw new Error(`Session start failed: ${startData.error || startResponse.statusText}`);
            }

            console.log(`%c[STEP 1] ✓ Session started successfully`, "color: #4caf50; font-weight: bold;");

            // ============ STEP 2: UPLOAD GROUPS ============
            console.log(`%c[STEP 2] Uploading 6 groups...`, "color: #2196f3; font-weight: bold;");

            for (let groupIdx = 0; groupIdx < 6; groupIdx++) {
                const groupImages = compressedImages.slice(groupIdx * 16, (groupIdx + 1) * 16);
                const groupSizeKB = (groupImages.reduce((sum, b) => sum + b.size, 0) / 1024).toFixed(2);

                console.log(`[STEP 2.${groupIdx + 1}] Uploading group ${groupIdx + 1}/6 (${groupSizeKB}KB, 16 images)...`);
                this.ui.updateProgress(groupIdx, 6, `Uploading group ${groupIdx + 1}/6...`);

                const formData = new FormData();
                formData.append('username', username);

                groupImages.forEach((blob, idx) => {
                    formData.append('images', blob, `image_${groupIdx}_${idx}.jpg`);
                });

                // Upload with retry logic
                let uploadSuccess = false;
                for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
                    try {
                        console.log(`[STEP 2.${groupIdx + 1}] Attempt ${attempt}/${MAX_RETRIES}...`);

                        const uploadResponse = await fetch(`${API_BASE}/api/external/upload-group/${groupIdx}`, {
                            method: 'POST',
                            body: formData
                        });

                        const uploadData = await uploadResponse.json();
                        console.log(`[STEP 2.${groupIdx + 1}] Response (${uploadResponse.status}):`, uploadData);

                        if (uploadResponse.ok) {
                            console.log(`%c[STEP 2.${groupIdx + 1}] ✓ Group ${groupIdx + 1} uploaded (${uploadData.count} images)`, "color: #4caf50;");
                            uploadSuccess = true;
                            break;
                        } else {
                            throw new Error(uploadData.error || uploadResponse.statusText);
                        }
                    } catch (error) {
                        console.warn(`[STEP 2.${groupIdx + 1}] ⚠ Attempt ${attempt} failed:`, error.message);

                        if (attempt < MAX_RETRIES) {
                            const delayMs = Math.pow(2, attempt) * 1000; // Exponential backoff
                            console.log(`[STEP 2.${groupIdx + 1}] Retrying in ${delayMs}ms...`);
                            await new Promise(resolve => setTimeout(resolve, delayMs));
                        } else {
                            throw new Error(`Group ${groupIdx + 1} upload failed after ${MAX_RETRIES} attempts: ${error.message}`);
                        }
                    }
                }

                if (!uploadSuccess) {
                    throw new Error(`Failed to upload group ${groupIdx + 1}`);
                }
            }

            console.log(`%c[STEP 2] ✓ All 6 groups uploaded successfully`, "color: #4caf50; font-weight: bold;");

            // ============ STEP 3: COMPLETE & VALIDATE ============
            console.log(`%c[STEP 3] Validating upload...`, "color: #2196f3; font-weight: bold;");
            this.ui.updateProgress(6, 6, "Validating upload...");

            const completeResponse = await fetch(`${API_BASE}/api/external/complete?username=${encodeURIComponent(username)}`, {
                method: 'GET',
                redirect: 'manual' // Handle redirect manually to log it
            });

            console.log(`[STEP 3] Response status: ${completeResponse.status}`);
            console.log(`[STEP 3] Response headers:`, Object.fromEntries(completeResponse.headers.entries()));

            if (completeResponse.status === 302 || completeResponse.type === 'opaqueredirect') {
                const redirectUrl = completeResponse.headers.get('Location') || completeResponse.url;
                console.log(`%c[STEP 3] ✓ Validation successful! Redirecting to: ${redirectUrl}`, "color: #4caf50; font-weight: bold;");
                this.ui.updateProgress(6, 6, "Success! Redirecting...");

                // Allow redirect by fetching with default redirect policy
                const finalResponse = await fetch(`${API_BASE}/api/external/complete?username=${encodeURIComponent(username)}`);
                window.location.href = finalResponse.url;

            } else if (completeResponse.ok) {
                // 200 OK - still success
                console.log(`%c[STEP 3] ✓ Upload complete!`, "color: #4caf50; font-weight: bold;");
                this.ui.updateProgress(6, 6, "Success! Redirecting...");
                window.location.href = completeResponse.url;

            } else if (completeResponse.status === 400) {
                const errorData = await completeResponse.json();
                console.error(`%c[STEP 3] ✗ Validation failed:`, "color: #f44336; font-weight: bold;", errorData);

                let errorMsg = `Validation failed. All uploaded data has been deleted.\n\n`;
                if (errorData.details && Array.isArray(errorData.details)) {
                    errorMsg += `Issues found:\n${errorData.details.join('\n')}`;
                } else {
                    errorMsg += errorData.error || 'Unknown validation error';
                }

                alert(errorMsg);
                this.ui.hideProgress();

            } else {
                throw new Error(`Unexpected response: ${completeResponse.status} ${completeResponse.statusText}`);
            }

        } catch (e) {
            console.error(`%c[UPLOAD] ✗ Upload failed:`, "color: #f44336; font-weight: bold;", e);
            console.error('[UPLOAD] Stack trace:', e.stack);
            alert(`Upload Error: ${e.message}`);
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
                alert("Error: Selection mismatch."); // Should not happen
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
            alert(`Curated clusters saved successfully to folder: ${folderName}`);

            btn.textContent = originalText;
            btn.disabled = false;
        } catch (e) {
            console.error("Save failed:", e);
            alert("Failed to save clusters. Check console for details.");
            this.ui.hideProgress();
            document.getElementById('btn-proceed').disabled = false;
            document.getElementById('btn-proceed').textContent = originalText;
        }
    }

    // --- Freeze / Unfreeze Logic ---

    handleFreezeCluster(clusterIndex) {
        const cluster = this.currentClusters[clusterIndex];

        if (!cluster) return;

        if (cluster.representatives.length < 16) {
            alert("Cannot freeze: cluster has fewer than 16 images");
            this.ui.renderClusters(this.currentClusters); // Revert checkbox state
            return;
        }

        this.frozenClusters.set(clusterIndex, {
            preferredPaths: new Set(cluster.representatives.map(r => r.path)),
            originalPaths: new Set(cluster.representatives.map(r => r.path)), // Immutable original set
            initialIndex: clusterIndex
        });

        cluster.isFrozen = true;
        cluster.driftCount = 0; // Initial drift
        this.ui.renderClusters(this.currentClusters);
        console.log(`[App] Frozen cluster ${clusterIndex + 1}`);
    }

    handleUnfreezeCluster(clusterIndex) {
        if (this.frozenClusters.has(clusterIndex)) {
            this.frozenClusters.delete(clusterIndex);

            const cluster = this.currentClusters[clusterIndex];
            if (cluster) {
                cluster.isFrozen = false;

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
            console.log(`[App] Unfrozen cluster ${clusterIndex + 1}`);
        }
    }

    applyFrozenConstraints(clusters) {
        if (this.frozenClusters.size === 0) return clusters;

        console.log(`%c[Freeze] --- Applying Constraints (Greedy Discovery) ---`, "color: #3b82f6; font-weight: bold;");

        const newFrozenClusters = new Map();
        const assignedTargetIndices = new Set();
        const assignments = [];

        // 1. DISCOVERY PHASE: Rank every possible pairing
        this.frozenClusters.forEach((frozenData, oldIndex) => {
            const { preferredPaths } = frozenData;

            for (let i = 0; i < clusters.length; i++) {
                const matchCount = clusters[i].members.filter(m => preferredPaths.has(m.path)).length;
                if (matchCount >= 8) { // Minimum threshold to even consider it a match
                    assignments.push({
                        oldIndex,
                        targetIndex: i,
                        matchCount,
                        frozenData
                    });
                }
            }
        });

        // Sort by match quality (best matches first)
        assignments.sort((a, b) => b.matchCount - a.matchCount);

        // 2. ASSIGNMENT PHASE: Greedy claim
        const resolvedAssignments = new Map(); // oldIndex -> resolved data

        assignments.forEach(assign => {
            if (resolvedAssignments.has(assign.oldIndex)) return; // Already assigned this frozen cluster
            if (assignedTargetIndices.has(assign.targetIndex)) {
                // Potential Collision!
                console.log(`[Freeze] ⚔️ Collision: Cluster ${assign.oldIndex + 1} also matching Target ${assign.targetIndex + 1}, but it was already claimed.`);
                return;
            }

            // Valid claim
            resolvedAssignments.set(assign.oldIndex, assign);
            assignedTargetIndices.add(assign.targetIndex);
        });

        // 3. ENFORCEMENT PHASE: Apply logic to the winners
        this.frozenClusters.forEach((frozenData, oldIndex) => {
            const assignment = resolvedAssignments.get(oldIndex);

            if (!assignment) {
                console.log(`[Freeze] ⚠️ Unfrozen: No unique matching cluster found (Previously Cluster ${oldIndex + 1})`);
                return;
            }

            const { targetIndex, matchCount } = assignment;
            const cluster = clusters[targetIndex];
            const { originalPaths, preferredPaths, initialIndex } = frozenData;

            // Target cluster too small?
            if (cluster.members.length < 16) {
                console.log(`[Freeze] ⚠️ Unfrozen: Target cluster too small (<16) (Previously Cluster ${oldIndex + 1})`);
                return;
            }

            // APPLY FROZEN DATA TO CLUSTER
            cluster.isFrozen = true;

            // Track movement relative to the LAST pass (not initial)
            if (targetIndex !== oldIndex) {
                cluster.movedFrom = oldIndex;
            }

            // --- RECOVERY & SELECTION LOGIC ---
            const originalsPresent = cluster.members.filter(m => originalPaths.has(m.path));
            const previousFillersPresent = cluster.members.filter(m =>
                preferredPaths.has(m.path) && !originalPaths.has(m.path)
            );

            cluster.driftCount = originalPaths.size - originalsPresent.length;

            const finalReps = [];
            const addRep = (member, isReplacement) => {
                if (finalReps.length < 16) {
                    member.isReplacement = isReplacement;
                    finalReps.push(member);
                    return true;
                }
                return false;
            };

            // Phase A: Originals first
            originalsPresent.forEach(m => addRep(m, false));

            // Phase B: Preferred Fillers
            if (finalReps.length < 16) {
                const sortedFillers = this.clustering.selectClosestToCentroid(
                    previousFillersPresent,
                    cluster.centroid,
                    16 - finalReps.length,
                    this.threshold
                );
                sortedFillers.forEach(m => addRep(m, true));
            }

            // Phase C: New Fillers
            let newRepsAdded = 0;
            if (finalReps.length < 16) {
                const usedPaths = new Set(finalReps.map(r => r.path));
                const others = cluster.members.filter(m => !usedPaths.has(m.path));

                const newFillers = this.clustering.selectClosestToCentroid(
                    others,
                    cluster.centroid,
                    16 - finalReps.length,
                    this.threshold
                );
                newFillers.forEach(m => {
                    if (addRep(m, true)) {
                        newRepsAdded++;
                    }
                });
            }

            // Track changes for logging
            const movedThisPass = targetIndex !== oldIndex;
            const lastOriginalsCount = Array.from(preferredPaths).filter(p => originalPaths.has(p)).length;
            const currentOriginalsCount = originalsPresent.length;
            const originalsDelta = currentOriginalsCount - lastOriginalsCount;

            const statusParts = [];
            if (movedThisPass) statusParts.push(`Moved (${oldIndex + 1} -> ${targetIndex + 1})`);

            const driftDetails = [];
            if (newRepsAdded > 0) driftDetails.push(`+${newRepsAdded} substituted`);
            if (originalsDelta > 0) driftDetails.push(`-${originalsDelta} recovered`);
            if (originalsDelta < 0) driftDetails.push(`+${Math.abs(originalsDelta)} lost original`);

            if (driftDetails.length > 0) {
                statusParts.push(`Drift: ${cluster.driftCount} cumulative (${driftDetails.join(", ")})`);
            }

            if (statusParts.length === 0) statusParts.push("No change");

            const logID = movedThisPass ? `${oldIndex + 1}➔${targetIndex + 1}` : (targetIndex + 1);
            console.log(`[Freeze] Cluster ${logID}: ${statusParts.join(" & ")}`);

            cluster.representatives = finalReps;

            // Sync preferredPaths to currently active 16 reps for next identification pass
            frozenData.preferredPaths = new Set(finalReps.map(r => r.path));

            // Track in new map
            newFrozenClusters.set(targetIndex, frozenData);
        });

        // 2. Refresh the app's frozen map
        this.frozenClusters = newFrozenClusters;

        // 3. LOG MAP DATA (Summary of current state)
        if (this.frozenClusters.size > 0) {
            const activeIndices = Array.from(this.frozenClusters.keys())
                .sort((a, b) => a - b)
                .map(idx => (idx + 1))
                .join(", ");
            console.log(`[Freeze] Active Map (1-indexed): [ ${activeIndices} ]`);
        }

        return clusters;
    }
}

window.app = new App();
