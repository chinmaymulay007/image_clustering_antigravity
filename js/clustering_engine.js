export class ClusteringEngine {
    constructor() {
        // No persistent state needed here, purely functional
    }

    /**
     * Main entry point to refresh clusters.
     * @param {Array} allEmbeddings - Array of {id, path, embedding}
     * @param {number} k - Number of clusters (default 6)
     * @param {number} dedupThreshold - Uniqueness threshold (default 0.15)
     * @returns {Array} - Array of formatted cluster objects
     */
    updateClusters(allEmbeddings, k = 6, dedupThreshold = 0.15, previousCentroids = null, lockedIndices = [], lockedRadii = {}, lockedCentroids = {}) {
        // Safety: Filter out any corrupted records (e.g. from previous worker crashes)
        allEmbeddings = allEmbeddings.filter(e => e && e.embedding && Array.isArray(e.embedding));

        if (!allEmbeddings || allEmbeddings.length === 0) return { clusters: [], centroids: [] };
        if (allEmbeddings.length < k) k = allEmbeddings.length;

        // 1. Run K-Means (Warm Start if possible)
        const { centroids, assignments } = this.kMeans(allEmbeddings, k, previousCentroids, lockedIndices, lockedRadii, lockedCentroids);

        // 2. Group by Assignment
        const clusters = centroids.map((centroid, index) => ({
            id: index,
            label: `Cluster ${index + 1}`,
            centroid: centroid,
            members: [],
            representatives: []
        }));

        assignments.forEach((clusterIndex, i) => {
            clusters[clusterIndex].members.push(allEmbeddings[i]);
        });

        // 3. Select Representatives
        clusters.forEach((cluster, index) => {
            // Note: If cluster is locked, the representatives selection might be overridden in app.js
            // but we still do a "natural" selection here for consistency if needed.
            cluster.representatives = this.selectClosestToCentroid(cluster.members, cluster.centroid, 16, dedupThreshold);
        });

        // 4. Sort by Size (Largest first) - DISABLING for stability if any are locked
        // If there are locked ones, we SHOULD NOT Sort, as indices are hard-coded to locked state.
        if (lockedIndices.length === 0) {
            clusters.sort((a, b) => b.members.length - a.members.length);
            // Re-label for consistency only if sorted
            clusters.forEach((c, i) => {
                c.label = `Cluster ${i + 1}`;
            });
        }

        // Return clusters AND the raw centroids (for next warm start)
        return { clusters, centroids };
    }


    /**
     * Standard K-Means (Lloyd's Algorithm) with K-Means++ initialization.
     * Modified to support Fixed Anchors and Radius Locks.
     */
    kMeans(embeddings, k, previousCentroids, lockedIndices = [], lockedRadii = {}, lockedCentroids = {}) {
        // A. Init Centroids
        let centroids;

        // Warm Start Logic
        if (previousCentroids && previousCentroids.length === k) {
            centroids = previousCentroids.map(c => [...c]);
        } else {
            // Cold Start
            centroids = this.initKMeansPlusPlus(embeddings, k);
        }

        // ANCHOR INJECTION: If K changed, our initial centroids might be random.
        // We MUST force-overwrite the locked indices with their original anchors.
        for (const idxString in lockedCentroids) {
            const idx = parseInt(idxString);
            if (idx < k) {
                centroids[idx] = [...lockedCentroids[idxString]];
            }
        }

        let assignments = new Array(embeddings.length).fill(-1);
        let changed = true;
        let p = 0;
        const maxIter = 20;

        while (changed && p < maxIter) {
            changed = false;
            p++;

            // B. Assign Step
            for (let i = 0; i < embeddings.length; i++) {
                let minDist = Infinity;
                let bestC = -1;

                // 1. CHECK RADIUS LOCKS (Inner Boundary)
                // If an image is within the "locked radius", it MUST stay in that cluster.
                for (const idx of lockedIndices) {
                    const radius = lockedRadii[idx];
                    if (radius === undefined || radius === null || !centroids[idx]) continue;

                    const d = this.cosineDistance(embeddings[i].embedding, centroids[idx]);
                    if (d <= radius) {
                        bestC = idx;
                        minDist = d;
                        break; // Hard Lock Found
                    }
                }

                // 2. STANDARD CLOSEST SEARCH (for non-locked images)
                if (bestC === -1) {
                    for (let c = 0; c < k; c++) {
                        const d = this.cosineDistance(embeddings[i].embedding, centroids[c]);
                        if (d < minDist) {
                            minDist = d;
                            bestC = c;
                        }
                    }
                }

                if (assignments[i] !== bestC) {
                    assignments[i] = bestC;
                    changed = true;
                }
            }

            // C. Update Centroids Step
            if (changed) {
                const sums = Array(k).fill(0).map(() => new Array(512).fill(0));
                const counts = Array(k).fill(0);

                for (let i = 0; i < embeddings.length; i++) {
                    const c = assignments[i];
                    const vec = embeddings[i].embedding;
                    for (let j = 0; j < 512; j++) {
                        sums[c][j] += vec[j];
                    }
                    counts[c]++;
                }

                for (let c = 0; c < k; c++) {
                    // ANCHOR: If this cluster is locked, skip moving its centroid!
                    if (lockedIndices.includes(c)) continue;

                    if (counts[c] > 0) {
                        for (let j = 0; j < 512; j++) {
                            centroids[c][j] = sums[c][j] / counts[c];
                        }
                    } else {
                        // Orphan centroid policy (only for non-locked)
                        const randIdx = Math.floor(Math.random() * embeddings.length);
                        centroids[c] = [...embeddings[randIdx].embedding];
                    }
                }
            }
        }

        return { centroids, assignments };
    }

    initKMeansPlusPlus(embeddings, k) {
        const centroids = [];
        // 1. Random first
        const firstIdx = Math.floor(Math.random() * embeddings.length);
        centroids.push([...embeddings[firstIdx].embedding]);

        // 2. Select remaining k-1
        while (centroids.length < k) {
            const dists = embeddings.map(e => {
                let minD = Infinity;
                for (const c of centroids) {
                    const d = this.cosineDistance(e.embedding, c);
                    if (d < minD) minD = d;
                }
                return minD;
            });

            // Weighted random selection based on distance^2
            let sum = 0;
            const distsSq = dists.map(d => {
                const sq = d * d;
                sum += sq;
                return sq;
            });

            const r = Math.random() * sum;
            let cum = 0;
            let nextCIdx = -1;
            for (let i = 0; i < distsSq.length; i++) {
                cum += distsSq[i];
                if (cum >= r) {
                    nextCIdx = i;
                    break;
                }
            }
            if (nextCIdx === -1) nextCIdx = distsSq.length - 1; // Fallback

            centroids.push([...embeddings[nextCIdx].embedding]);
        }
        return centroids;
    }

    /**
     * Selects up to 'limit' members that are closest to the cluster centroid.
     * Implements deduplication based on 'threshold' (Cosine Distance).
     */
    selectClosestToCentroid(members, centroid, limit, threshold) {
        if (members.length === 0) return [];

        // 1. Calculate all distances to centroid
        const withDist = members.map(m => ({
            member: m,
            dist: this.cosineDistance(m.embedding, centroid)
        }));

        // 2. Sort by closeness to centroid
        withDist.sort((a, b) => a.dist - b.dist);

        const representatives = [];

        // 3. Greedy Selection with Deduplication
        for (const item of withDist) {
            if (representatives.length >= limit) break;

            const candidate = item.member;

            // Check similarity against already picked representatives
            // threshold is "Uniqueness Threshold" (minimum cosine distance allowed)
            let tooSimilar = false;
            for (const rep of representatives) {
                const d = this.cosineDistance(candidate.embedding, rep.embedding);
                if (d < threshold) {
                    tooSimilar = true;
                    break;
                }
            }

            if (!tooSimilar) {
                representatives.push(candidate);
            }
        }

        // console.log(`[ClusteringEngine] Selected ${representatives.length} unique representatives from cluster of ${members.length}. Threshold: ${threshold}`);
        return representatives;
    }

    // Util: Cosine Distance = 1 - Cosine Similarity
    cosineDistance(vecA, vecB) {
        return 1 - this.cosineSimilarity(vecA, vecB);
    }

    cosineSimilarity(vecA, vecB) {
        let dot = 0;
        let magA = 0;
        let magB = 0;
        for (let i = 0; i < vecA.length; i++) {
            dot += vecA[i] * vecB[i];
            magA += vecA[i] * vecA[i];
            magB += vecB[i] * vecB[i];
        }
        if (magA === 0 || magB === 0) return 0; // Safety
        return dot / (Math.sqrt(magA) * Math.sqrt(magB));
    }

    /**
     * Timeline and Location Clustering
     * 1. Groups by day
     * 2. Subdivides by location (if spread > 50km)
     * 3. Selects representatives randomly (or chronologically)
     */
    async updateMetadataClusters(allEmbeddings, maxClusters = 10, dedupThreshold = 0.15) {
        if (!allEmbeddings || allEmbeddings.length === 0) return [];

        console.log(`[Metadata Clustering] Starting classification of ${allEmbeddings.length} items...`);

        // 1. Sort chronologically
        const sorted = [...allEmbeddings].sort((a, b) => (a.timestamp || 0) - (b.timestamp || 0));

        // 2. Group by Day (Local Time)
        const timeGroups = new Map();
        for (const item of sorted) {
            const date = new Date(item.timestamp);
            const dateKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
            if (!timeGroups.has(dateKey)) timeGroups.set(dateKey, []);
            timeGroups.get(dateKey).push(item);
        }

        let clusters = [];
        let clusterIdCounter = 0;

        // 3. Create clusters for each day
        for (const [dateKey, items] of timeGroups.entries()) {
            const dateObj = new Date(dateKey);
            const shortDateStr = Object.prototype.toString.call(dateObj) === "[object Date]" && !isNaN(dateObj) ? dateObj.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : dateKey;

            let visualCentroid = new Array(512).fill(0);
            let sumLat = 0, sumLon = 0, gpsCount = 0;

            items.forEach(m => {
                for(let i=0; i<512; i++) visualCentroid[i] += m.embedding[i];
                if (m.lat !== null && m.lon !== null && m.lat !== undefined && m.lon !== undefined && (m.lat !== 0 || m.lon !== 0)) {
                    sumLat += m.lat;
                    sumLon += m.lon;
                    gpsCount++;
                }
            });
            for(let i=0; i<512; i++) visualCentroid[i] /= items.length;

            clusters.push({
                id: `meta_${clusterIdCounter++}`,
                label: shortDateStr,
                members: items,
                centroid: visualCentroid,
                geoCentroid: gpsCount > 0 ? { lat: sumLat / gpsCount, lon: sumLon / gpsCount } : null,
                representatives: this.selectClosestToCentroid(items, visualCentroid, 16, dedupThreshold)
            });
        }

        // Sort by largest volume first
        clusters.sort((a, b) => b.members.length - a.members.length);
        
        return clusters;
    }

    // Geocoding cache to prevent spamming OSM
    geocodeCache = new Map();
    geocodeQueue = [];
    isProcessingGeocode = false;

    async reverseGeocode(lat, lon) {
        // Round to 2 decimal places (~1.1km precision) to maximize cache hits
        const roundLat = Math.round(lat * 100) / 100;
        const roundLon = Math.round(lon * 100) / 100;
        const cacheKey = `${roundLat},${roundLon}`;

        if (this.geocodeCache.has(cacheKey)) {
            return this.geocodeCache.get(cacheKey);
        }

        return new Promise((resolve) => {
            this.geocodeQueue.push({ lat: roundLat, lon: roundLon, cacheKey, resolve });
            this.processGeocodeQueue();
        });
    }

    async processGeocodeQueue() {
        if (this.isProcessingGeocode || this.geocodeQueue.length === 0) return;
        this.isProcessingGeocode = true;

        const { lat, lon, cacheKey, resolve } = this.geocodeQueue.shift();

        if (this.geocodeCache.has(cacheKey)) {
            resolve(this.geocodeCache.get(cacheKey));
            this.isProcessingGeocode = false;
            this.processGeocodeQueue();
            return;
        }

        try {
            const response = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lon}&format=json&zoom=12`);
            
            if (response.status === 429) {
                this.geocodeQueue.unshift({ lat, lon, cacheKey, resolve });
                setTimeout(() => {
                    this.isProcessingGeocode = false;
                    this.processGeocodeQueue();
                }, 2000);
                return;
            }

            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const data = await response.json();
            const addr = data.address || {};
            // Narrow resolution: only city/town level components
            const local = addr.city || addr.town || addr.village || addr.suburb || addr.municipality || addr.county || "";
            const state = addr.state || "";
            
            const locationName = local ? (state ? `${local}, ${state}` : local) : "";
            
            if (locationName) {
                console.log(`[Geocoding] (${lat}, ${lon}) -> ${locationName}`);
                this.geocodeCache.set(cacheKey, locationName);
                resolve(locationName);
            } else {
                console.log(`[Geocoding] (${lat}, ${lon}) -> No specific town found at zoom 12`);
                this.geocodeCache.set(cacheKey, ""); // Cache empty to avoid re-fetching
                resolve(null);
            }
        } catch (error) {
            console.warn(`[Geocoding] Failed for (${lat}, ${lon}):`, error);
            resolve(null);
        }

        setTimeout(() => {
            this.isProcessingGeocode = false;
            this.processGeocodeQueue();
        }, 1200);
    }
}
