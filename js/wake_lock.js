/**
 * WakeLockManager
 * Uses the Screen Wake Lock API to prevent the screen from dimming or locking
 * when the application is active and processing.
 */
export class WakeLockManager {
    constructor() {
        this.wakeLock = null;
        this.isActive = false;

        // Re-request wake lock if page becomes visible again
        document.addEventListener('visibilitychange', () => {
            if (this.wakeLock !== null && document.visibilityState === 'visible') {
                this.request();
            }
        });
    }

    /**
     * Request a screen wake lock
     */
    async request() {
        if (!('wakeLock' in navigator)) {
            console.warn('[WakeLock] Screen Wake Lock API not supported in this browser.');
            return false;
        }

        try {
            this.wakeLock = await navigator.wakeLock.request('screen');
            this.isActive = true;
            
            this.wakeLock.addEventListener('release', () => {
                console.log('[WakeLock] Screen Wake Lock was released');
                this.isActive = false;
            });

            console.log('[WakeLock] Screen Wake Lock acquired');
            return true;
        } catch (err) {
            console.error(`[WakeLock] Failed to acquire wake lock: ${err.name}, ${err.message}`);
            return false;
        }
    }

    /**
     * Release the wake lock
     */
    async release() {
        if (!this.wakeLock) return;

        try {
            await this.wakeLock.release();
            this.wakeLock = null;
            this.isActive = false;
            console.log('[WakeLock] Manual release successful');
        } catch (err) {
            console.error(`[WakeLock] Failed to release wake lock: ${err.message}`);
        }
    }
}

export const wakeLockManager = new WakeLockManager();
