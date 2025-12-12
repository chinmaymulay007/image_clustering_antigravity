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
            return this.dirHandle.name;
        } catch (error) {
            console.error('Error selecting directory:', error);
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
    async listRootImages() {
        if (!this.dirHandle) return [];
        const images = [];
        const validExtensions = ['.jpg', '.jpeg', '.png', '.webp'];

        for await (const [name, handle] of this.dirHandle.entries()) {
            if (handle.kind === 'file') {
                const ext = name.substring(name.lastIndexOf('.')).toLowerCase();
                if (validExtensions.includes(ext)) {
                    images.push(name);
                }
            }
        }
        return images;
    }

    /**
     * Create a new timestamped folder for a run.
     * @param {string} prefix - 'gen' or 'cluster'.
     * @param {string} suffix - Optional suffix (e.g., source run ID or mode).
     * @param {boolean} isRawSuffix - If true, appends suffix directly (e.g., '_random'). If false, uses '_from_' (e.g., '_from_run1').
     * @returns {Promise<string>} The name of the created folder.
     */
    async createRunFolder(prefix, suffix = '', isRawSuffix = false) {
        const now = new Date();
        // Use local timezone instead of GMT
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');

        const timestamp = `${year}-${month}-${day}_${hours}-${minutes}-${seconds}`;

        let suffixPart = '';
        if (suffix) {
            suffixPart = isRawSuffix ? `_${suffix}` : `_from_${suffix}`;
        }

        const folderName = `${prefix}_${timestamp}${suffixPart}`;
        await this.getDirectoryHandle(`metadata/${folderName}`, true);
        return folderName;
    }

    /**
     * Delete empty or invalid metadata folders.
     * @returns {Promise<string[]>} List of deleted folder names.
     */
    async deleteEmptyMetadataFolders() {
        if (!this.dirHandle) return [];

        const deleted = [];
        try {
            const metadataHandle = await this.getDirectoryHandle('metadata');

            for await (const [name, handle] of metadataHandle.entries()) {
                if (handle.kind !== 'directory') continue;

                let isEmpty = true;

                // Check if gen_ folder has filenamesArray.json with data
                if (name.startsWith('gen_')) {
                    const filenames = await this.readFile(`metadata/${name}/filenamesArray.json`, 'json');
                    if (filenames && filenames.length > 0) isEmpty = false;
                }
                // Check if cluster_ folder has clusters.json with data
                else if (name.startsWith('cluster_')) {
                    const clusters = await this.readFile(`metadata/${name}/clusters.json`, 'json');
                    if (clusters && clusters.length > 0) isEmpty = false;
                }

                if (isEmpty) {
                    // Delete the empty folder
                    await metadataHandle.removeEntry(name, { recursive: true });
                    deleted.push(name);
                }
            }
        } catch (error) {
            console.warn('Error cleaning up metadata folders:', error);
        }

        return deleted;
    }
}
