"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.GeminiProvider = void 0;
const base_1 = require("./base");
const selectors_1 = require("../selectors");
// Toți selectorii sunt în src/selectors.json (auto-reparați la nevoie).
const ID = 'gemini';
class GeminiProvider {
    name = ID;
    /** v1.7.1: thinking-ul modelului → pasul „Thinking" din chat. */
    onThinking;
    get url() {
        return selectors_1.selectors.url(ID);
    }
    async open(page) {
        await (0, base_1.openProvider)(page, ID, 'Gemini');
    }
    async newChat(page) {
        await (0, base_1.newChatVia)(page, ID, 'Gemini');
    }
    async send(page, message, signal, opts) {
        return (0, base_1.sendAndWait)(page, message, {
            providerId: ID,
            label: 'Gemini',
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
exports.GeminiProvider = GeminiProvider;
//# sourceMappingURL=gemini.js.map