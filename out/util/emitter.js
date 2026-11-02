"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.Emitter = void 0;
class Emitter {
    listeners = [];
    get event() {
        return (listener) => this.add(listener);
    }
    add(listener) {
        this.listeners.push(listener);
        return () => {
            this.listeners = this.listeners.filter((l) => l !== listener);
        };
    }
    fire(event) {
        for (const listener of [...this.listeners]) {
            try {
                listener(event);
            }
            catch {
                // Listener errors must never break the emitter's owner.
            }
        }
    }
    clear() {
        this.listeners = [];
    }
}
exports.Emitter = Emitter;
//# sourceMappingURL=emitter.js.map