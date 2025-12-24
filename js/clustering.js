import clustering from './vendor/density-clustering.js';
import { agnes } from './vendor/ml-hclust.js';

export class ClusteringStep {
    constructor(fileSystem, logger) {
        this.fs = fileSystem;
        this.log = logger;
    }

    async validateMetadata(sourceRun) {
        // Load all three metadata files
        const filenames = await this.fs.readFile(`metadata/${sourceRun}/filenamesArray.json`, 'json') || [];
        const captions = await this.fs.readFile(`metadata/${sourceRun}/captionsArray.json`, 'json') || [];
        const embeddings = await this.fs.readFile(`metadata/${sourceRun}/embeddingsArray.json`, 'json') || [];

        // Check if all have the same length
        const lengths = [filenames.length, captions.length, embeddings.length];
        const minLength = Math.min(...lengths);
        const maxLength = Math.max(...lengths);

        if (minLength !== maxLength) {
            const error = `❌ Metadata files are corrupted! Lengths: filenames=${lengths[0]}, captions=${lengths[1]}, embeddings=${lengths[2]}. Please re-run Step 1 or check the metadata folder.`;
            this.log(error, 'error');
            throw new Error(error);
        }

        if (minLength === 0) {
            throw new Error("❌ Metadata files are empty. Please run Step 1 first.");
        }

        // Check against actual folder image count
        const actualImages = await this.fs.listRootImages();
        if (minLength < actualImages.length) {
            const missing = actualImages.length - minLength;
            const proceed = await this.showWarningModal(
                '⚠️ Incomplete Metadata',
                `Metadata contains ${minLength} images but folder has ${actualImages.length} images.`,
                [
                    { label: 'In metadata:', value: `${minLength} images` },
                    { label: 'In folder:', value: `${actualImages.length} images` },
                    { label: 'Missing:', value: `${missing} image(s)` }
                ],
                'Continue Anyway',
                'Cancel'
            );
            if (!proceed) {
                this.log("Clustering cancelled by user.", 'error');
                throw new Error("User cancelled - metadata incomplete");
            }
            this.log(`⚠️ Proceeding with ${minLength}/${actualImages.length} images.`);
        }

        this.log(`✅ Metadata validation passed: ${minLength} images ready for clustering.`);
        return { filenames, captions, embeddings };
    }

    showWarningModal(title, message, stats, confirmText, cancelText) {
        return new Promise((resolve) => {
            const modal = document.createElement('div');
            modal.className = 'resume-modal';

            let statsHtml = '';
            if (stats && stats.length > 0) {
                statsHtml = `<div class="resume-stats">
                    ${stats.map(s => `<div><span>${s.label}</span><strong>${s.value}</strong></div>`).join('')}
                </div>`;
            }

            modal.innerHTML = `
                <div class="resume-modal-content">
                    <h2>${title}</h2>
                    <p>${message}</p>
                    ${statsHtml}
                    <div class="resume-modal-actions">
                        <button class="btn-new">${cancelText}</button>
                        <button class="btn-resume">${confirmText}</button>
                    </div>
                </div>
            `;

            document.body.appendChild(modal);

            modal.querySelector('.btn-resume').addEventListener('click', () => {
                document.body.removeChild(modal);
                resolve(true);
            });

            modal.querySelector('.btn-new').addEventListener('click', () => {
                document.body.removeChild(modal);
                resolve(false);
            });
        });
    }


    async run(sourceRun, config) {
        this.log(`Starting clustering on ${sourceRun} using ${config.algorithm}...`);
        console.log('Clustering run started with:', sourceRun, config);

        try {
            // Validate metadata integrity first
            console.log('About to validate metadata...');
            const { filenames, captions, embeddings } = await this.validateMetadata(sourceRun);
            console.log('Validation passed, got:', filenames.length, 'files');

            // Calculate Distance Matrix
            this.log("Calculating distance matrix...");
            console.log('Calculating distance matrix for', embeddings.length, 'embeddings');
            const distanceMatrix = embeddings.map(e1 => embeddings.map(e2 => this.cosineDistance(e1, e2)));
            console.log('Distance matrix calculated');

            // Visual Cue: Clustering in Progress
            const resultsArea = document.getElementById('clustering-results-area');
            if (resultsArea) {
                resultsArea.innerHTML = `
                <div style="text-align: center; padding: 2rem; color: var(--text-secondary);">
                    <div style="font-size: 2rem; margin-bottom: 1rem;">⏳</div>
                    <h3>Clustering in Progress...</h3>
                    <p>Running ${config.algorithm.toUpperCase()} on ${filenames.length} images.</p>
                    <small>This may take a few seconds...</small>
                </div>
                `;
            }

            // Allow UI to render the loading state
            await new Promise(r => setTimeout(r, 100));

            let clusters;
            if (config.algorithm === 'kmeans') {
                // K-Means uses raw embeddings, not distance matrix
                clusters = this.runKMEANS(embeddings, config);
            } else if (config.algorithm === 'hierarchical') {
                clusters = this.runHierarchical(distanceMatrix, config);
            } else if (config.algorithm === 'optics') {
                clusters = this.runOPTICS(distanceMatrix, config);
            } else if (config.algorithm === 'hdbscan') {
                clusters = this.runHDBSCAN(distanceMatrix, config);
            } else {
                // Default to DBSCAN
                clusters = this.runDBSCAN(distanceMatrix, config);
            }

            console.log(`${config.algorithm} completed, found ${clusters.length} clusters`);

            // Sort clusters by size
            const orderedClusters = clusters.sort((a, b) => b.length - a.length);

            this.log(`Clustering complete. Found ${orderedClusters.length} clusters.`);

            // Store state for saving later
            this.currentClusters = orderedClusters;
            this.currentFilenames = filenames;
            this.currentCaptions = captions;
            this.currentSourceRun = sourceRun;
            this.currentConfig = config;

            this.displayResults(orderedClusters, filenames, captions);

        } catch (error) {
            this.log(`Clustering failed: ${error.message}`, 'error');
            console.error('Clustering error:', error);

            const resultsArea = document.getElementById('clustering-results-area');
            if (resultsArea) {
                resultsArea.innerHTML = `
                <div class="alert-box error" style="margin: 20px; text-align: center; border: 1px solid #ef4444; background: rgba(239, 68, 68, 0.1); color: #ef4444; padding: 20px; border-radius: 8px;">
                    <div style="font-size: 2rem; margin-bottom: 10px;">⚠️</div>
                    <h3>Clustering Error</h3>
                    <p>${error.message}</p>
                    <button class="secondary-btn" onclick="location.reload()" style="margin-top: 15px;">Retry System</button>
                </div>
                `;
            }
        }
    }

    runDBSCAN(distanceMatrix, config) {
        this.log(`Running DBSCAN (Eps: ${config.epsilon}, MinPts: ${config.minPts})...`);
        const dbscan = new clustering.DBSCAN();
        return dbscan.run(distanceMatrix, config.epsilon, config.minPts);
    }

    runKMEANS(embeddings, config) {
        this.log(`Running K-Means (K: ${config.k})...`);
        const kmeans = new clustering.KMEANS();
        return kmeans.run(embeddings, config.k);
    }

    runOPTICS(distanceMatrix, config) {
        this.log(`Running OPTICS (Eps: ${config.epsilon}, MinPts: ${config.minPts})...`);
        const optics = new clustering.OPTICS();
        // OPTICS run returns clusters similar to DBSCAN in this library
        return optics.run(distanceMatrix, config.epsilon, config.minPts);
    }

    runHierarchical(distanceMatrix, config) {
        this.log(`Running Hierarchical Clustering (K: ${config.k}, Linkage: ${config.linkage})...`);

        try {
            const tree = agnes(distanceMatrix, {
                method: config.linkage || 'average',
                isDistanceMatrix: true
            });

            // Use group(k) to force k clusters
            const groups = tree.group(config.k);
            console.log('Hierarchical Tree Grouping:', groups);

            const clusters = [];

            // groups is Array<Cluster>
            for (const clusterNode of groups) {
                const indices = this.getAllIndices(clusterNode);
                if (indices.length > 0) clusters.push(indices);
            }
            console.log('Hierarchical found clusters:', clusters.length);
            return clusters;
        } catch (err) {
            console.error("Hierarchical error:", err);
            throw new Error("Hierarchical clustering failed: " + err.message);
        }
    }

    getAllIndices(node) {
        if (node.children) {
            let indices = [];
            for (const child of node.children) {
                indices = indices.concat(this.getAllIndices(child));
            }
            return indices;
        } else {
            // Leaf node, check check for undefined because index 0 is falsy
            if (node.index !== undefined && node.index !== null) {
                return [node.index];
            }
            return [];
        }
    }

    runHDBSCAN(distanceMatrix, config) {
        this.log(`Running HDBSCAN (via OPTICS, Eps: ${config.epsilon}, MinPts: ${config.minPts})...`);
        // Now using user-defined epsilon to allow manual tuning
        const optics = new clustering.OPTICS();
        const clusters = optics.run(distanceMatrix, config.epsilon, config.minPts);
        console.log('HDBSCAN found:', clusters.length, 'clusters');
        return clusters;
    }

    async saveSelectedClusters() {
        if (!this.currentClusters) return;

        const selectedIndices = this.getSelectedClusterIndices();
        if (selectedIndices.length === 0) {
            alert("No clusters selected to save.");
            return;
        }

        const clustersToSave = selectedIndices.map(i => this.currentClusters[i]);

        // Create Run Folder
        const runFolder = await this.fs.createRunFolder('cluster', this.currentSourceRun);
        console.log('Created run folder:', runFolder);

        // Save Results
        await this.fs.writeFile(`metadata/${runFolder}/clusters.json`, JSON.stringify(clustersToSave));
        await this.fs.writeFile(`metadata/${runFolder}/config.json`, JSON.stringify(this.currentConfig));

        this.log(`✅ Saved ${clustersToSave.length} selected clusters to ${runFolder}`);
        alert(`Saved ${clustersToSave.length} clusters successfully!`);
    }

    cosineDistance(a, b) {
        // Native implementation
        let dot = 0;
        let magA = 0;
        let magB = 0;
        for (let i = 0; i < a.length; i++) {
            dot += a[i] * b[i];
            magA += a[i] * a[i];
            magB += b[i] * b[i];
        }
        if (magA === 0 || magB === 0) return 1.0;

        const similarity = dot / (Math.sqrt(magA) * Math.sqrt(magB));
        return 1 - similarity;
    }

    async displayResults(clusters, filenames, captions) {
        const summaryContainer = document.getElementById('clustering-summary-area');
        const resultsContainer = document.getElementById('clustering-results-area');

        summaryContainer.hidden = false;
        resultsContainer.innerHTML = '';
        resultsContainer.style.display = 'block';
        // Removed fixed height to allow fluid layout as requested
        resultsContainer.style.overflowY = 'visible';
        resultsContainer.style.maxHeight = 'none';

        // Calculate summary stats
        const totalImages = clusters.reduce((sum, c) => sum + c.length, 0);
        const avgSize = clusters.length > 0 ? (totalImages / clusters.length).toFixed(1) : 0;
        const largestCluster = clusters.length > 0 ? clusters[0].length : 0;
        const smallestCluster = clusters.length > 0 ? clusters[clusters.length - 1].length : 0;

        // Render Summary Stats
        const statsDiv = document.getElementById('cluster-summary-stats');
        statsDiv.innerHTML = `
            <div class="stat-item">
                <span class="stat-value">${clusters.length}</span>
                <span class="stat-label">Clusters</span>
            </div>
            <div class="stat-item">
                <span class="stat-value">${totalImages}</span>
                <span class="stat-label">Total Images</span>
            </div>
            <div class="stat-item">
                <span class="stat-value">${avgSize}</span>
                <span class="stat-label">Avg Size</span>
            </div>
            <div class="stat-item">
                <span class="stat-value">${largestCluster}</span>
                <span class="stat-label">Largest</span>
            </div>
            <div class="stat-item">
                <span class="stat-value">${smallestCluster}</span>
                <span class="stat-label">Smallest</span>
            </div>
        `;

        // Render all clusters
        this.renderClusters(clusters, filenames, captions, resultsContainer, 1);

        // Attach listeners if not already attached
        if (!this.listenersAttached) {
            document.getElementById('btn-apply-filter').addEventListener('click', () => {
                const minSize = parseInt(document.getElementById('cluster-min-filter').value) || 1;
                this.renderClusters(this.currentClusters, this.currentFilenames, this.currentCaptions, resultsContainer, minSize);
            });

            document.getElementById('btn-select-all-clusters').addEventListener('click', () => {
                document.querySelectorAll('.cluster-checkbox').forEach(cb => cb.checked = true);
            });

            document.getElementById('btn-deselect-all-clusters').addEventListener('click', () => {
                document.querySelectorAll('.cluster-checkbox').forEach(cb => cb.checked = false);
            });

            this.listenersAttached = true;
        }
    }

    renderClusters(clusters, filenames, captions, container, minSize = 1) {
        container.innerHTML = '';

        const filteredClusters = clusters.map((c, i) => ({ cluster: c, originalIndex: i }))
            .filter(item => item.cluster.length >= minSize);

        if (filteredClusters.length === 0) {
            container.innerHTML = '<div class="placeholder-text">No clusters match the filter criteria.</div>';
            return;
        }

        filteredClusters.forEach(({ cluster, originalIndex }) => {
            const clusterDiv = document.createElement('div');
            clusterDiv.className = 'cluster-group';
            clusterDiv.dataset.clusterIndex = originalIndex;

            // Header with checkbox and collapse toggle
            const header = document.createElement('div');
            header.className = 'cluster-header';
            header.innerHTML = `
                <label class="cluster-select">
                    <input type="checkbox" class="cluster-checkbox" data-index="${originalIndex}" checked>
                </label>
                <h3 class="cluster-title">Cluster ${originalIndex + 1} <span class="cluster-count">(${cluster.length} images)</span></h3>
                <button class="collapse-btn">▶</button>
            `;
            clusterDiv.appendChild(header);

            // Collapsible content
            const content = document.createElement('div');
            content.className = 'cluster-content collapsed';

            const grid = document.createElement('div');
            grid.className = 'cluster-grid';

            // Lazy load images using IntersectionObserver
            const observer = new IntersectionObserver((entries, obs) => {
                entries.forEach(entry => {
                    if (entry.isIntersecting) {
                        const img = entry.target;
                        const idx = img.dataset.index;
                        this.fs.readFile(filenames[idx], 'blob').then(async (blob) => {
                            if (blob) {
                                try {
                                    // Create a thumbnail on the fly to save memory
                                    const imgBitmap = await createImageBitmap(blob);
                                    const canvas = document.createElement('canvas');
                                    const ctx = canvas.getContext('2d');

                                    // Set thumbnail size
                                    const size = 300;
                                    const scale = Math.min(size / imgBitmap.width, size / imgBitmap.height);
                                    canvas.width = imgBitmap.width * scale;
                                    canvas.height = imgBitmap.height * scale;

                                    ctx.drawImage(imgBitmap, 0, 0, canvas.width, canvas.height);

                                    img.src = canvas.toDataURL('image/jpeg', 0.85); // Compress to Jpeg
                                    imgBitmap.close(); // Immediate memory release
                                    img.removeAttribute('data-index');
                                    obs.unobserve(img);
                                } catch (e) {
                                    console.error("Thumbnail error:", e);
                                    // Fallback to original if canvas fails
                                    img.src = URL.createObjectURL(blob);
                                    img.removeAttribute('data-index');
                                    obs.unobserve(img);
                                }
                            }
                        });
                    }
                });
            }, { rootMargin: '100px' });

            cluster.forEach(imgIndex => {
                const imgContainer = document.createElement('div');
                imgContainer.className = 'cluster-image';

                const img = document.createElement('img');
                img.title = captions[imgIndex];
                img.dataset.index = imgIndex; // Store index for observer
                img.alt = "Loading...";

                // Show a placeholder or small icon first
                img.src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIxIiBoZWlnaHQ9IjEiPjxyZWN0IHdpZHRoPSIxIiBoZWlnaHQ9IjEiIGZpbGw9IiNmM2Y0ZjYiLz48L3N2Zz4=';

                observer.observe(img);

                imgContainer.appendChild(img);
                grid.appendChild(imgContainer);
            });

            content.appendChild(grid);
            clusterDiv.appendChild(content);
            container.appendChild(clusterDiv);

            // Collapse toggle
            header.querySelector('.collapse-btn').addEventListener('click', (e) => {
                e.stopPropagation();
                const isCollapsed = content.classList.toggle('collapsed');
                e.target.textContent = isCollapsed ? '▶' : '▼';
            });
        });
    }

    getSelectedClusterIndices() {
        const indices = [];
        document.querySelectorAll('.cluster-checkbox:checked').forEach(cb => {
            indices.push(parseInt(cb.dataset.index));
        });
        return indices;
    }
}

