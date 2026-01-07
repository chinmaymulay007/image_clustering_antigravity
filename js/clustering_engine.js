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
    updateClusters(allEmbeddings, k = 6, dedupThreshold = 0.15, previousCentroids = null) {
        if (!allEmbeddings || allEmbeddings.length === 0) return { clusters: [], centroids: [] };
        if (allEmbeddings.length < k) k = allEmbeddings.length;

        // 1. Run K-Means (Warm Start if possible)
        const { centroids, assignments } = this.kMeans(allEmbeddings, k, previousCentroids);

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
        clusters.forEach(cluster => {
            cluster.representatives = this.selectClosestToCentroid(cluster.members, cluster.centroid, 16, dedupThreshold);
        });

        // 4. Sort by Size (Largest first)
        // Note: This changes the index order relative to centroids!
        // We must stick to the result format for stability.
        clusters.sort((a, b) => b.members.length - a.members.length);

        // 5. Re-label for consistency
        clusters.forEach((c, i) => {
            c.label = `Cluster ${i + 1}`;
        });

        // Return clusters AND the raw centroids (for next warm start)
        return { clusters, centroids };
    }


    /**
     * Standard K-Means (Lloyd's Algorithm) with K-Means++ initialization.
     */
    kMeans(embeddings, k, previousCentroids) {
        // A. Init Centroids
        let centroids;

        // Warm Start Logic
        // Check if previousCentroids exist AND dimensions fit (embeddings are 512d)
        // And importantly, if k matches.
        if (previousCentroids && previousCentroids.length === k) {
            // Deep copy to ensure we don't mutate state passed in if it matters
            centroids = previousCentroids.map(c => [...c]);
        } else {
            // Cold Start
            centroids = this.initKMeansPlusPlus(embeddings, k);
        }

        let assignments = new Array(embeddings.length).fill(-1);
        let changed = true;
        let p = 0;
        const maxIter = 20; // Fast convergence usually

        while (changed && p < maxIter) {
            changed = false;
            p++;

            // B. Assign Step
            for (let i = 0; i < embeddings.length; i++) {
                let minDist = Infinity;
                let bestC = -1;
                for (let c = 0; c < k; c++) {
                    const d = this.cosineDistance(embeddings[i].embedding, centroids[c]);
                    if (d < minDist) {
                        minDist = d;
                        bestC = c;
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
                    if (counts[c] > 0) {
                        for (let j = 0; j < 512; j++) {
                            centroids[c][j] = sums[c][j] / counts[c];
                        }
                    } else {
                        // Orphan centroid policy: 
                        // If warm start leads to empty cluster, it might be fine to re-init it,
                        // or just leave it alone (it effectively dies or moves next iter).
                        // Let's re-init randomly to keep K clusters alive.
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
}
