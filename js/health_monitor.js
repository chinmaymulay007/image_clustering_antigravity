/**
 * Performance & Health Monitor
 * Detects frame drops and logs them to the console to identify bottlenecks.
 */

class HealthMonitor {
    constructor() {
        this.startTime = performance.now();
        this.lastTime = performance.now();
        this.frameThreshold = 250; // Increased to 250ms - only report major stutters
        this.enabled = true;
        this.running = false;
        this.gracePeriod = 5000; // 5s grace period to ignore noise during model/folder loading
    }

    start() {
        if (this.running) return;
        this.running = true;
        console.info("%c[Health Monitor] Monitoring main thread (Threshold: 250ms)...", "color: #8b5cf6; font-weight: bold;");
        this.check();
    }

    check() {
        const now = performance.now();
        const delta = now - this.lastTime;

        // Skip reporting during the initial heavy loading grace period
        if (delta > this.frameThreshold && (now - this.startTime) > this.gracePeriod) {
            console.warn(`%c[Health Check] ⚠️ Main thread hitch: ${delta.toFixed(0)}ms.`, "color: #ef4444; font-weight: bold;");
        }

        this.lastTime = now;
        if (this.enabled) {
            requestAnimationFrame(() => this.check());
        }
    }

    stop() {
        this.enabled = false;
        this.running = false;
    }
}

export const monitor = new HealthMonitor();
