/**
 * File System Manager (Universal Mode)
 * Handles file selection and management using standard web APIs.
 */

export class FileSystemManager {
    constructor() {
        this.allFiles = [];
        this.projectName = "Default Project";
    }

    /**
     * Process the selected FileList from the universal input.
     * @param {FileList} fileList 
     * @returns {Promise<{projectName: string, imageCount: number}>}
     */
    async setFiles(fileList) {
        this.allFiles = Array.from(fileList);
        
        // Infer project name from the first file's path if available
        if (this.allFiles.length > 0) {
            const firstFile = this.allFiles[0];
            const relativePath = firstFile.webkitRelativePath || "";
            const rootFolder = relativePath.split('/')[0];
            this.projectName = rootFolder || "Selected Folder";
        }

        const images = this.filterImages();
        return {
            projectName: this.projectName,
            imageCount: images.length
        };
    }

    /**
     * Filter the stored files for valid images.
     */
    filterImages() {
        const validExtensions = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp'];
        
        return this.allFiles.filter(file => {
            const name = file.name;
            const ext = name.substring(name.lastIndexOf('.')).toLowerCase();
            const relativePath = file.webkitRelativePath || name;

            // Skip hidden folders or system folders
            const isHidden = relativePath.split('/').some(part => 
                part.startsWith('.') || 
                part === 'clusterai_metadata' || 
                part.toLowerCase().startsWith('clusterai_')
            );

            return validExtensions.includes(ext) && !isHidden;
        });
    }

    /**
     * Returns a flat list of images for the processing manager.
     * @returns {Promise<Array<{path: string, file: File}>>}
     */
    async scanAllImagesRecursive() {
        console.log("%c[FileSystem] Scanning internal file list for images...", "color: #fb8c00; font-weight: bold;");
        
        const images = this.filterImages().map(file => ({
            path: file.webkitRelativePath || file.name,
            file: file
        }));

        console.log(`%c[FileSystem] Found ${images.length} images.`, "color: #fb8c00; font-weight: bold;");
        return images;
    }

    /**
     * Check if files are loaded.
     */
    hasDirectory() {
        return this.allFiles.length > 0;
    }

    // --- Legacy Metadata Fallbacks ---
    // Since we can't write back to the folder easily without FSP API, 
    // metadata is now handled purely via DB manager in this version.
    async writeMetadata(filename, data) { 
        console.warn("[FileSystem] Direct metadata writing is disabled in universal mode.");
    }

    async readMetadata(filename) {
        return null;
    }
}
