
import { ClusteringEngine } from './clustering_engine.js';

const engine = new ClusteringEngine();

self.onmessage = function (e) {
    const { embeddings, k, threshold, previousCentroids } = e.data;

    try {
        const start = performance.now();
        const result = engine.updateClusters(embeddings, k, threshold, previousCentroids);
        const end = performance.now();

        console.log(`%c[Clustering Worker] Re-calculated ${result.clusters.length} clusters in ${(end - start).toFixed(1)}ms`, "color: #8b5cf6;");
        self.postMessage({ status: 'success', result });
    } catch (err) {
        self.postMessage({ status: 'error', error: err.message });
    }
};
