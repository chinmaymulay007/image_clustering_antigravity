/**
 * IndexedDB Manager
 * Handles persistent browser-side storage for image embeddings and metadata.
 */

class DatabaseManager {
    constructor() {
        this.dbName = 'AntigravityDB';
        this.dbVersion = 1;
        this.db = null;
        this.currentProject = null;
    }

    /**
     * Initialize the database and open a project-specific session.
     * @param {string} projectName - Unique name for the folder/project.
     */
    async init(projectName) {
        if (!projectName) throw new Error("Project name required for DB initialization");
        this.currentProject = projectName;

        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);

            request.onupgradeneeded = (e) => {
                const db = e.target.result;

                // Store project-level settings and stats
                if (!db.objectStoreNames.contains('projects')) {
                    db.createObjectStore('projects', { keyPath: 'id' });
                }

                // Store embeddings: Keyed by [project + path] for uniqueness
                if (!db.objectStoreNames.contains('embeddings')) {
                    const store = db.createObjectStore('embeddings', { keyPath: 'compositeKey' });
                    store.createIndex('project', 'project', { unique: false });
                }
            };

            request.onsuccess = (e) => {
                this.db = e.target.result;
                console.log(`%c[Database] Connected to project: ${projectName}`, "color: #2196f3; font-weight: bold;");
                resolve(this.db);
            };

            request.onerror = (e) => {
                console.error("%c[Database] Connection Error:", "color: #ef4444;", e.target.error);
                reject(e.target.error);
            };
        });
    }

    /**
     * Bulk save embeddings to the database.
     * @param {Array} records - Array of { path, embedding }
     */
    async upsertEmbeddings(records) {
        if (!this.db || !this.currentProject) return;

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['embeddings'], 'readwrite');
            const store = transaction.objectStore('embeddings');

            records.forEach(record => {
                const entry = {
                    ...record,
                    project: this.currentProject,
                    compositeKey: `${this.currentProject}|${record.path}`
                };
                store.put(entry);
            });

            transaction.oncomplete = () => {
                console.log(`%c[Database] Persisted ${records.length} records to IndexedDB`, "color: #2196f3;");
                resolve();
            };
            transaction.onerror = (e) => reject(e.target.error);
        });
    }

    /**
     * Retrieve all embeddings for the current project.
     * @returns {Promise<Array>}
     */
    async getEmbeddings() {
        if (!this.db || !this.currentProject) return [];

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['embeddings'], 'readonly');
            const store = transaction.objectStore('embeddings');
            const index = store.index('project');
            const request = index.getAll(IDBKeyRange.only(this.currentProject));

            request.onsuccess = () => {
                console.log(`%c[Database] Retreived ${request.result.length} previous processed images`, "color: #2196f3;");
                resolve(request.result);
            };
            request.onerror = (e) => reject(e.target.error);
        });
    }

    /**
     * Save project-wide manifest/state.
     * @param {Object} data 
     */
    async saveManifest(data) {
        if (!this.db || !this.currentProject) return;

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['projects'], 'readwrite');
            const store = transaction.objectStore('projects');
            store.put({
                id: this.currentProject,
                ...data,
                lastUpdated: Date.now()
            });

            transaction.oncomplete = () => {
                console.log(`%c[Database] Project manifest updated in browser storage`, "color: #2196f3; font-style: italic;");
                resolve();
            };
            transaction.onerror = (e) => reject(e.target.error);
        });
    }

    /**
     * Retrieve project manifest.
     */
    async getManifest() {
        if (!this.db || !this.currentProject) return null;

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['projects'], 'readonly');
            const store = transaction.objectStore('projects');
            const request = store.get(this.currentProject);

            request.onsuccess = () => resolve(request.result);
            request.onerror = (e) => reject(e.target.error);
        });
    }
}

export const db = new DatabaseManager();
