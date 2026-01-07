
import { FileSystemManager } from './file_system.js';
import { ProcessingManager } from './processing_manager.js';
import { ClusteringEngine } from './clustering_engine.js';
import { UIManager } from './ui_manager.js';

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
        this.thumbnailCache = new Map(); // Path -> Blob URL

        console.log("Antigravity v2 Orchestrator Initialized");
        this.init();
    }

    init() {
        this.ui.setCallbacks({
            onSelectFolder: () => this.handleSelectFolder(),
            onPauseResume: (shouldPause) => this.handlePauseResume(shouldPause),
            onApplySettings: (settings) => this.handleApplySettings(settings),
            onSave: () => this.handleSave(), // Phase 5
            onExcludeImage: (path) => this.handleExclude(path),
            onLoadThumbnail: (path) => this.loadThumbnail(path),
            onGetExcludedPaths: () => this.excludedPaths,
            onRestoreImage: (path) => this.handleRestore(path)
        });
    }

    handleApplySettings(settings) {
        console.log("[App] Applying user settings:", settings);
        this.refreshInterval = settings.refreshInterval;
        this.k = settings.k;
        this.threshold = settings.threshold;

        // Persist settings (optional, maybe to localStorage later)

        // Immediate Re-cluster
        console.log("[App] Triggering immediate re-cluster due to settings change.");
        this.refreshClusters();
    }

    async handleSelectFolder() {
        console.log("[App] User clicked Select Folder.");
        try {
            const dirName = await this.fs.selectDirectory();
            console.log(`[App] Selected: ${dirName}`);
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
        } else {
            this.processing.resume();
        }
        this.ui.setPauseState(shouldPause);
    }

    async handleExclude(path) {
        console.log("Excluding:", path);
        this.excludedPaths.add(path);
        this.processing.excludedPaths.add(path); // Sync

        // Persist immediately
        await this.fs.writeMetadata('manifest.json', {
            processedCount: this.currentEmbeddings.length,
            totalImagesFound: this.processing.allImages?.length || 0,
            lastUpdated: Date.now(),
            excludedImages: Array.from(this.excludedPaths)
        });

        // Immediate UI Refresh
        this.refreshClusters();
    }

    async handleRestore(path) {
        console.log("Restoring:", path);
        this.excludedPaths.delete(path);
        this.processing.excludedPaths.delete(path); // Sync

        // Persist immediately
        await this.fs.writeMetadata('manifest.json', {
            processedCount: this.currentEmbeddings.length,
            totalImagesFound: this.processing.allImages?.length || 0,
            lastUpdated: Date.now(),
            excludedImages: Array.from(this.excludedPaths)
        });
        console.log(`[App] Restored ${path}. Exclusions persisted to manifest.`);

        // Immediate UI Refresh
        this.refreshClusters();
    }

    async refreshClusters() {
        console.log("Refreshing clusters with", this.currentEmbeddings.length, "embeddings");
        // Filter out excluded
        const validEmbeddings = this.currentEmbeddings.filter(e => !this.excludedPaths.has(e.path));

        // Run Clustering (Warm Start)
        // Destructure result from engine
        const result = this.clustering.updateClusters(validEmbeddings, this.k, this.threshold, this.lastCentroids);

        // Handle both new object return and potential legacy array (safety)
        let clusters, centroids;
        if (Array.isArray(result)) {
            clusters = result; // Should not happen with new engine code
            centroids = null;
        } else {
            clusters = result.clusters;
            centroids = result.centroids;
        }

        this.currentClusters = clusters; // Store for saving
        this.lastCentroids = centroids; // Store for stability
        console.log(`[App] Clustering updated: ${clusters.length} groups. Stability(lastCentroids): ${centroids ? 'Active' : 'Missing'}`);

        // Update UI
        this.ui.renderClusters(clusters);

        // Ensure handle map exists if needed (in case updates happened)
        if (this.handleMap.size === 0) this.rebuildHandleMap();
    }

    async loadThumbnail(path) {
        // 1. Check Cache
        if (this.thumbnailCache.has(path)) {
            return this.thumbnailCache.get(path);
        }

        // Try looking up in our map
        let handle = this.handleMap.get(path);

        // Fallback: search processing list if map empty
        if (!handle && this.processing.allImages) {
            const found = this.processing.allImages.find(i => i.path === path);
            if (found) handle = found.handle;
        }

        if (handle) {
            try {
                const file = await handle.getFile();

                // 2. Generate Thumbnail Efficiently
                // Use createImageBitmap for GPU-accelerated decoding/resizing if supported
                let blob = null;
                const TARGET_WIDTH = 300;

                if (window.createImageBitmap) {
                    try {
                        const bitmap = await createImageBitmap(file, { resizeWidth: TARGET_WIDTH });

                        // Draw to canvas to get Blob
                        // We use an OffscreenCanvas if available for speed, else standard
                        if (window.OffscreenCanvas) {
                            const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
                            const ctx = canvas.getContext('2d');
                            ctx.drawImage(bitmap, 0, 0);
                            blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
                        } else {
                            const canvas = document.createElement('canvas');
                            canvas.width = bitmap.width;
                            canvas.height = bitmap.height;
                            const ctx = canvas.getContext('2d');
                            ctx.drawImage(bitmap, 0, 0);
                            blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.8));
                        }
                        bitmap.close();
                    } catch (err) {
                        console.warn("createImageBitmap failed, falling back to full file:", err);
                        blob = file; // Fallback
                    }
                } else {
                    blob = file; // Fallback for really old browsers (unlikely given context)
                }

                if (blob) {
                    const url = URL.createObjectURL(blob);
                    this.thumbnailCache.set(path, url);
                    return url;
                }
            } catch (e) {
                console.warn("Failed to load/resize file:", path, e);
            }
        }
        return null;
    }

    async handleSave() {
        try {
            if (this.currentEmbeddings.length === 0) {
                alert("No clusters to save yet. Process some images first.");
                return;
            }

            const btn = document.getElementById('btn-save-clusters');
            const originalText = btn.textContent;

            // 1. Determine which clusters to save
            const selectedIndices = this.ui.getSelectedClusterIndices();
            if (selectedIndices.length === 0) {
                alert("No clusters selected. Please check at least one cluster to save.");
                return;
            }

            btn.textContent = "SAVING...";
            btn.disabled = true;

            // 2. Use Cached CLUSTERS (WYSIWYG)
            // We do NOT re-calculate here because K-Means is non-deterministic.
            // We use exactly what the user is looking at.

            const allClusters = this.currentClusters;
            if (!allClusters || allClusters.length === 0) {
                // Should ideally rely on refreshClusters having run at least once.
                // Fallback if empty?
                console.warn("No cached clusters found, forcing refresh...");
                await this.refreshClusters();
                // Now use updated
            }

            // 3. Filter Clusters
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
            });

            this.ui.hideProgress();
            alert(`Curated clusters saved successfully to folder: ${folderName}`);

            btn.textContent = originalText;
            btn.disabled = false;
        } catch (e) {
            console.error("Save failed:", e);
            alert("Failed to save clusters. Check console for details.");
            this.ui.hideProgress();
            document.getElementById('btn-save-clusters').disabled = false;
            document.getElementById('btn-save-clusters').textContent = "💾 SAVE CLUSTERS";
        }
    }
}

window.app = new App();
