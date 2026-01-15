
import { ClusteringEngine } from './clustering_engine.js';

const engine = new ClusteringEngine();

self.onmessage = function (e) {
    const { embeddings, k, threshold, previousCentroids } = e.data;

    try {
        const result = engine.updateClusters(embeddings, k, threshold, previousCentroids);
        self.postMessage({ status: 'success', result });
    } catch (err) {
        self.postMessage({ status: 'error', error: err.message });
    }
};
