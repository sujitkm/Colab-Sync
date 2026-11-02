"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RemoteWatcher = void 0;
class RemoteWatcher {
    logger;
    onTick;
    timer = null;
    running = false;
    inTick = false;
    constructor(logger, onTick) {
        this.logger = logger;
        this.onTick = onTick;
    }
    get isRunning() {
        return this.running;
    }
    /** Start polling. intervalSeconds <= 0 disables polling. */
    start(intervalSeconds) {
        this.stop();
        if (intervalSeconds <= 0) {
            this.logger.info('Remote polling disabled (pollInterval = 0)');
            return;
        }
        this.running = true;
        this.logger.info(`Remote polling every ${intervalSeconds}s`);
        this.schedule(intervalSeconds);
    }
    stop() {
        this.running = false;
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
    }
    schedule(intervalSeconds) {
        this.timer = setTimeout(() => {
            void this.tick(intervalSeconds);
        }, intervalSeconds * 1000);
    }
    async tick(intervalSeconds) {
        if (!this.running || this.inTick) {
            return;
        }
        this.inTick = true;
        try {
            await this.onTick();
        }
        catch (error) {
            this.logger.warn(`Remote poll failed: ${error instanceof Error ? error.message : String(error)}`);
        }
        finally {
            this.inTick = false;
            if (this.running) {
                this.schedule(intervalSeconds);
            }
        }
    }
}
exports.RemoteWatcher = RemoteWatcher;
//# sourceMappingURL=remoteWatcher.js.map