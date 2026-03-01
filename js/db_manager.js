/**
 * IndexedDB Manager
 * Handles persistent browser-side storage for image embeddings and metadata.
 */

class DatabaseManager {
    constructor() {
        this.dbName = 'ClusterAIDB';
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
     * Retrieve all projects in the database with stats.
     */
    async getAllProjects() {
        if (!this.db) {
            await this.initStub();
        }

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['projects', 'embeddings'], 'readonly');
            const projectStore = transaction.objectStore('projects');
            const embeddingStore = transaction.objectStore('embeddings');
            const index = embeddingStore.index('project');
            const request = projectStore.getAll();

            request.onsuccess = async () => {
                const projects = request.result;
                const statsPromises = projects.map(project => {
                    return new Promise((res) => {
                        const countReq = index.count(IDBKeyRange.only(project.id));
                        countReq.onsuccess = () => {
                            project.embeddingCount = countReq.result;
                            res(project);
                        };
                        countReq.onerror = () => res(project);
                    });
                });

                const results = await Promise.all(statsPromises);
                resolve(results);
            };
            request.onerror = (e) => reject(e.target.error);
        });
    }

    /**
     * Wipe everything from the database.
     */
    async deleteAllData() {
        if (!this.db) await this.initStub();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['embeddings', 'projects'], 'readwrite');
            const embeddingStore = transaction.objectStore('embeddings');
            const projectStore = transaction.objectStore('projects');

            embeddingStore.clear();
            projectStore.clear();

            transaction.oncomplete = () => {
                console.log(`%c[Database] All AI metadata cleared from browser memory`, "color: #ef4444; font-weight: bold;");
                resolve();
            };
            transaction.onerror = (e) => reject(e.target.error);
        });
    }

    /**
     * Delete all data associated with a project.
     * @param {string} projectId 
     */
    async deleteProjectData(projectId) {
        if (!this.db) await this.initStub();

        return new Promise((resolve, reject) => {
            const transaction = this.db.transaction(['embeddings', 'projects'], 'readwrite');

            // 1. Delete embeddings
            const embeddingStore = transaction.objectStore('embeddings');
            const index = embeddingStore.index('project');
            const embeddingRequest = index.openCursor(IDBKeyRange.only(projectId));

            embeddingRequest.onsuccess = (e) => {
                const cursor = e.target.result;
                if (cursor) {
                    cursor.delete();
                    cursor.continue();
                }
            };

            // 2. Delete project manifest
            const projectStore = transaction.objectStore('projects');
            projectStore.delete(projectId);

            transaction.oncomplete = () => {
                console.log(`%c[Database] Project ${projectId} data cleared`, "color: #ef4444; font-weight: bold;");
                resolve();
            };
            transaction.onerror = (e) => reject(e.target.error);
        });
    }

    /**
     * Internal helper to open DB without a specific project context if needed.
     */
    async initStub() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.dbVersion);
            request.onsuccess = (e) => {
                this.db = e.target.result;
                resolve(this.db);
            };
            request.onerror = (e) => reject(e.target.error);
        });
    }
}

export const db = new DatabaseManager();
