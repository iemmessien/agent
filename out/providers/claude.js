"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ClaudeProvider = void 0;
const base_1 = require("./base");
const selectors_1 = require("../selectors");
// Toți selectorii sunt în src/selectors.json (auto-reparați la nevoie).
const ID = 'claude';
class ClaudeProvider {
    name = ID;
    /** v1.7.1: thinking-ul modelului (extended thinking) → pasul „Thinking" din chat. */
    onThinking;
    get url() {
        return selectors_1.selectors.url(ID);
    }
    async open(page) {
        await (0, base_1.openProvider)(page, ID, 'Claude');
    }
    async newChat(page) {
        await (0, base_1.newChatVia)(page, ID, 'Claude');
    }
    async send(page, message, signal, opts) {
        return (0, base_1.sendAndWait)(page, message, {
            providerId: ID,
            label: 'Claude',
            signal,
            ...opts,
            // v2.5.1: erorile site-ului (out of messages / rate limit / CAPTCHA) sunt
            // detectate central în sendAndWait — vezi src/providerErrors.ts.
            // v1.7.1: thinking-ul modelului → pasul „Thinking" din chat (verbose)
            onThinking: this.onThinking
        });
    }
    async stop(page) {
        return (0, base_1.clickStop)(page, ID);
    }
}
exports.ClaudeProvider = ClaudeProvider;
//# sourceMappingURL=claude.js.map