import clustering from 'https://cdn.jsdelivr.net/npm/density-clustering@1.3.0/+esm';

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
        this.log(`Starting clustering on ${sourceRun}...`);
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

            // Run DBSCAN
            this.log(`Running DBSCAN (Eps: ${config.epsilon}, MinPts: ${config.minPts})...`);
            const dbscan = new clustering.DBSCAN();
            const clusters = dbscan.run(distanceMatrix, config.epsilon, config.minPts);
            console.log('DBSCAN completed, found', clusters.length, 'clusters');

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
        }
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

            cluster.forEach(imgIndex => {
                const imgContainer = document.createElement('div');
                imgContainer.className = 'cluster-image';

                const img = document.createElement('img');
                img.title = captions[imgIndex];
                img.loading = 'lazy';

                this.fs.readFile(filenames[imgIndex], 'blob').then(blob => {
                    if (blob) img.src = URL.createObjectURL(blob);
                });

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

