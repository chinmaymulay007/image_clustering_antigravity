/**
 * Performance & Health Monitor
 * Detects frame drops and logs them to the console to identify bottlenecks.
 */

class HealthMonitor {
    constructor() {
        this.lastTime = performance.now();
        this.frameThreshold = 100; // 100ms (10 FPS) is a major hitch
        this.enabled = true;
        this.running = false;
    }

    start() {
        if (this.running) return;
        this.running = true;
        console.info("%c[Health Monitor] Started. Watching for main-thread hitches...", "color: #8b5cf6; font-weight: bold;");
        this.check();
    }

    check() {
        const now = performance.now();
        const delta = now - this.lastTime;

        if (delta > this.frameThreshold) {
            console.warn(`%c[Health Check] ⚠️ Frame hitch detected: ${delta.toFixed(0)}ms. Main thread was blocked.`, "color: #ef4444; font-weight: bold;");
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
