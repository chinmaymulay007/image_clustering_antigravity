/**
 * File System Access API Wrapper
 * Handles directory selection, file reading/writing, and folder management.
 */

export class FileSystemManager {
    constructor() {
        this.dirHandle = null;
    }

    /**
     * Prompt user to select a directory.
     * @returns {Promise<string>} The name of the selected directory.
     */
    async selectDirectory() {
        try {
            this.dirHandle = await window.showDirectoryPicker({
                mode: 'readwrite'
            });
            console.log(`[FileSystem] Directory selected: ${this.dirHandle.name}`);
            return this.dirHandle.name;
        } catch (error) {
            console.error('[FileSystem] Error selecting directory:', error);
            throw error;
        }
    }

    /**
     * Check if a directory is selected.
     * @returns {boolean}
     */
    hasDirectory() {
        return this.dirHandle !== null;
    }

    /**
     * Get a subdirectory handle, creating it if it doesn't exist.
     * @param {string} path - Path to the subdirectory (e.g., 'metadata/run_1').
     * @param {boolean} create - Whether to create the directory if missing.
     * @returns {Promise<FileSystemDirectoryHandle>}
     */
    async getDirectoryHandle(path, create = false) {
        if (!this.dirHandle) throw new Error("No directory selected");

        const parts = path.split('/').filter(p => p.length > 0);
        let currentHandle = this.dirHandle;

        for (const part of parts) {
            currentHandle = await currentHandle.getDirectoryHandle(part, { create });
        }
        return currentHandle;
    }

    /**
     * Write content to a file.
     * @param {string} path - Relative path to the file.
     * @param {string|Blob|BufferSource} content - Content to write.
     */
    async writeFile(path, content) {
        if (!this.dirHandle) throw new Error("No directory selected");

        const parts = path.split('/');
        const fileName = parts.pop();
        const dirPath = parts.join('/');

        const dirHandle = await this.getDirectoryHandle(dirPath, true);
        const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(content);
        await writable.close();
        console.log(`[FileSystem] Wrote file: ${path} (${typeof content === 'string' ? content.length : 'blob'} bytes)`);
    }

    /**
     * Read content from a file.
     * @param {string} path - Relative path to the file.
     * @param {string} type - 'text' or 'json' or 'blob'.
     * @returns {Promise<any>}
     */
    async readFile(path, type = 'text') {
        if (!this.dirHandle) throw new Error("No directory selected");

        try {
            const parts = path.split('/');
            const fileName = parts.pop();
            const dirPath = parts.join('/');

            const dirHandle = await this.getDirectoryHandle(dirPath);
            const fileHandle = await dirHandle.getFileHandle(fileName);
            const file = await fileHandle.getFile();

            if (type === 'json') {
                const text = await file.text();
                return JSON.parse(text);
            } else if (type === 'blob') {
                return file;
            } else {
                return await file.text();
            }
        } catch (error) {
            console.warn(`File not found or unreadable: ${path}`, error);
            return null;
        }
    }

    /**
     * List all subdirectories in a given path (e.g., 'metadata').
     * @param {string} path 
     * @returns {Promise<string[]>} List of directory names.
     */
    async listDirectories(path) {
        if (!this.dirHandle) return [];
        try {
            const dirHandle = await this.getDirectoryHandle(path);
            const dirs = [];
            for await (const [name, handle] of dirHandle.entries()) {
                if (handle.kind === 'directory') {
                    dirs.push(name);
                }
            }
            return dirs;
        } catch (error) {
            return []; // Directory might not exist yet
        }
    }

    /**
     * List all files in the root directory (for Step 1).
     * @returns {Promise<string[]>} List of filenames.
     */
    /**
     * Recursively scans the directory and its subdirectories for images.
     * @returns {Promise<Array<{path: string, handle: FileSystemFileHandle}>>} Flat list of images.
     */
    async scanAllImagesRecursive() {
        if (!this.dirHandle) throw new Error("No directory selected");

        const images = [];
        const validExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'];

        const scanDir = async (dirHandle, relativePath) => {
            for await (const [name, handle] of dirHandle.entries()) {
                if (handle.kind === 'file') {
                    const ext = name.substring(name.lastIndexOf('.')).toLowerCase();
                    if (validExtensions.includes(ext)) {
                        const fullPath = relativePath ? `${relativePath}/${name}` : name;
                        images.push({ path: fullPath, handle: handle });
                    }
                } else if (handle.kind === 'directory') {
                    // Skip hidden folders, metadata folder, or previous output folders
                    if (name.startsWith('.') || name === 'clusterai_metadata' || name.toLowerCase().startsWith('clusterai_')) continue;

                    const subDirPath = relativePath ? `${relativePath}/${name}` : name;
                    await scanDir(handle, subDirPath);
                }
            }
        };

        console.log("[FileSystem] Starting recursive image scan...");
        await scanDir(this.dirHandle, '');
        console.log(`[FileSystem] Scan complete. Found ${images.length} images.`);
        return images;
    }

    /**
     * ensures the 'clusterai_metadata' folder exists.
     * @returns {Promise<FileSystemDirectoryHandle>}
     */
    async ensureMetadataFolder() {
        if (!this.dirHandle) throw new Error("No directory selected");
        return await this.dirHandle.getDirectoryHandle('clusterai_metadata', { create: true });
    }

    /**
     * Specialized writer for metadata.
     * @param {string} filename 
     * @param {object|array} data 
     */
    async writeMetadata(filename, data) {
        const metaDir = await this.ensureMetadataFolder();
        const fileHandle = await metaDir.getFileHandle(filename, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(JSON.stringify(data)); // indent for debug? No, save space.
        await writable.close();
    }

    /**
     * Reads metadata file if exists
     */
    async readMetadata(filename) {
        try {
            const metaDir = await this.ensureMetadataFolder(); // will create if missing, ensuring non-null
            const fileHandle = await metaDir.getFileHandle(filename);
            const file = await fileHandle.getFile();
            const text = await file.text();
            return JSON.parse(text);
        } catch (e) {
            return null; // File doesn't exist
        }
    }
    /**
     * Saves the clustered images to disk (Selective: Only Representatives).
     * @param {Array} clusters - Array of cluster objects.
     * @param {Map} handleMap - Map of path -> FileHandle.
     * @param {Function} onProgress - Callback (current, total, text)
     * @param {FileSystemDirectoryHandle} [targetHandle] - Optional handle to save into.
     * @returns {Promise<string>} Name of the created folder.
     */
    async saveClusters(clusters, handleMap, onProgress, targetHandle = null) {
        const parentHandle = targetHandle || this.dirHandle;
        if (!parentHandle) throw new Error("No directory selected");

        // Create root save folder
        const now = new Date();
        const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;
        const rootFolderName = `clusterai_curated_${timestamp}`; // Renamed for clarity

        console.log(`[FileSystem] Initializing save folder: ${rootFolderName} in ${parentHandle.name}`);
        const rootDir = await parentHandle.getDirectoryHandle(rootFolderName, { create: true });

        // Calculate total files for progress
        let totalFiles = 0;
        clusters.forEach(c => totalFiles += c.representatives.length);
        let processedFiles = 0;

        // Process each cluster
        for (const [index, cluster] of clusters.entries()) {
            // Create cluster subfolder
            const safeLabel = cluster.label.replace(/[^a-z0-9]/gi, '_');
            const clusterDir = await rootDir.getDirectoryHandle(safeLabel, { create: true });

            // Iterate ONLY Visible Representatives
            for (const member of cluster.representatives) {
                const handle = handleMap.get(member.path);

                processedFiles++;
                if (onProgress) onProgress(processedFiles, totalFiles, `Saving ${originalName} to ${safeLabel}...`);

                if (!handle) {
                    console.warn(`Cannot find handle for ${member.path}, skipping save.`);
                    continue;
                }

                try {
                    const file = await handle.getFile();
                    // Create new file in destination
                    var originalName = member.path.split('/').pop();
                    const newFileHandle = await clusterDir.getFileHandle(originalName, { create: true });
                    const writable = await newFileHandle.createWritable();
                    await writable.write(file);
                    await writable.close();
                } catch (e) {
                    console.error(`Failed to copy ${member.path} to cluster folder:`, e);
                }
            }
        }

        console.log(`[FileSystem] Save complete. Folders created in: ${rootFolderName}`);
        return rootFolderName;
    }
}
