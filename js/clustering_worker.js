
import { ClusteringEngine } from './clustering_engine.js';

const engine = new ClusteringEngine();

self.onmessage = function (e) {
    const { embeddings, k, threshold, previousCentroids, lockedIndices, lockedRadii, lockedCentroids } = e.data;

    try {
        const start = performance.now();
        const result = engine.updateClusters(embeddings, k, threshold, previousCentroids, lockedIndices, lockedRadii, lockedCentroids);
        const end = performance.now();

        console.log(`[Clustering Worker] Re-calculated ${result.clusters.length} clusters in ${(end - start).toFixed(1)}ms`);
        self.postMessage({ status: 'success', result });
    } catch (err) {
        self.postMessage({ status: 'error', error: err.message });
    }
};
