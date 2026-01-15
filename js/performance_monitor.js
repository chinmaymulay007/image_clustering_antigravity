
/**
 * Monitors UI performance (FPS/Hitching) and triggers "Low Performance Mode"
 * if the device is struggling.
 */
export class PerformanceMonitor {
    constructor() {
        this.hitches = 0;
        this.maxHitches = 5;
        this.threshold = 100; // ms per frame (10fps) considered a severe hitch
        this.isActive = true;
        this.lastTime = performance.now();
        this.onLowPerfDetected = null;

        // Start after a 3s grace period to ignore initial load hitching
        setTimeout(() => this.start(), 3000);
    }

    start() {
        const check = (time) => {
            if (!this.isActive) return;

            const delta = time - this.lastTime;
            this.lastTime = time;

            if (delta > this.threshold) {
                this.hitches++;
                console.warn(`%c[PerfMonitor] Hitch detected: ${delta.toFixed(1)}ms. (${this.hitches}/${this.maxHitches})`, "color: #ef4444;");

                if (this.hitches >= this.maxHitches) {
                    this.triggerLowPerf();
                    return;
                }
            }

            requestAnimationFrame(check);
        };

        requestAnimationFrame(check);
    }

    triggerLowPerf() {
        this.isActive = false;
        console.info("%c[PerfMonitor] Low performance detected. Disabling animations to prioritize stability.", "color: #ef4444; font-weight: bold;");
        document.body.setAttribute('data-low-perf', 'true');

        if (this.onLowPerfDetected) {
            this.onLowPerfDetected();
        }
    }

    stop() {
        this.isActive = false;
    }
}
