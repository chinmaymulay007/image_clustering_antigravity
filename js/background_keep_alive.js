/**
 * BackgroundKeepAlive
 * Uses a silent audio loop to prevent mobile browsers from suspending 
 * JavaScript execution when the tab is in the background or the device is locked.
 */
export class BackgroundKeepAlive {
    constructor() {
        this.audio = null;
        this.isActive = false;
        this.initialized = false;
    }

    /**
     * Initialize the audio element. 
     * Must be called in response to a user interaction (click/touch).
     */
    init() {
        if (this.initialized) return;

        this.audio = document.createElement('audio');
        this.audio.id = 'bg-keep-alive-audio';
        this.audio.loop = true;
        this.audio.muted = true; // Still works for keep-alive on most platforms
        this.audio.setAttribute('playsinline', '');
        this.audio.style.display = 'none';

        // A very short, silent base64 MP3 (approx 100ms of silence)
        const silentMp3 = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
        this.audio.src = silentMp3;

        document.body.appendChild(this.audio);
        this.initialized = true;
        console.log('[KeepAlive] Audio initialized');
    }

    async start() {
        if (!this.initialized) this.init();
        if (this.isActive) return;

        try {
            await this.audio.play();
            this.isActive = true;
            console.log('[KeepAlive] Silent audio loop started');
        } catch (err) {
            console.warn('[KeepAlive] Could not start audio. User interaction might be required.', err.message);
        }
    }

    stop() {
        if (!this.audio || !this.isActive) return;

        this.audio.pause();
        this.isActive = false;
        console.log('[KeepAlive] Silent audio loop stopped');
    }
}

export const backgroundKeepAlive = new BackgroundKeepAlive();
