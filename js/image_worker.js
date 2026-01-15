/**
 * Image Processing Worker
 * Handles heavy image decoding and resizing off the main thread.
 */

self.onmessage = async (e) => {
    const { file, targetWidth, path } = e.data;

    try {
        // 1. Decode & Resize using GPU/Hardware acceleration in Worker
        const bitmap = await createImageBitmap(file, {
            resizeWidth: targetWidth,
            resizeQuality: 'medium'
        });

        // 2. Convert to Blob using OffscreenCanvas
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const ctx = canvas.getContext('2d');
        ctx.drawImage(bitmap, 0, 0);

        const blob = await canvas.convertToBlob({
            type: 'image/jpeg',
            quality: 0.8
        });

        // 3. Close bitmap for memory efficiency
        bitmap.close();

        // 4. Send back the Blob (Transferrable)
        self.postMessage({ status: 'success', blob, path });
    } catch (err) {
        self.postMessage({ status: 'error', error: err.message, path });
    }
};
