"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ConversationStore = void 0;
const log_1 = require("./log");
const log = (msg) => (0, log_1.logLine)('conv', msg);
const STORAGE_KEY = 'freekit.conversations';
const ACTIVE_KEY = 'freekit.activeConversationId';
const MAX_CONVERSATIONS = 50;
/** Default title for a new empty conversation (can be changed on the first prompt). */
const DEFAULT_TITLE = 'New conversation';
class ConversationStore {
    conversations = [];
    activeId = null;
    gs;
    constructor(globalState) {
        this.gs = globalState;
        this.load();
    }
    load() {
        const data = this.gs.get(STORAGE_KEY, []);
        this.conversations = Array.isArray(data) ? data : [];
        const saved = this.gs.get(ACTIVE_KEY, null);
        this.activeId = saved ?? null;
        // robustețe: un id activ care nu mai există (conversație ștearsă/trunchiată)
        if (this.activeId &&
            !this.conversations.some((c) => c.id === this.activeId)) {
            this.activeId = this.conversations[0]?.id ?? null;
        }
        log('loaded ' + this.conversations.length + ' conversations, active=' + this.activeId);
    }
    async save() {
        await this.gs.update(STORAGE_KEY, this.conversations);
        await this.gs.update(ACTIVE_KEY, this.activeId);
    }
    getActive() {
        if (!this.activeId)
            return null;
        return this.conversations.find((c) => c.id === this.activeId) || null;
    }
    getActiveId() {
        return this.activeId;
    }
    /** v2.5.10 (bug #20): chatul din browser al conversației active (dacă există). */
    getBrowserChat() {
        return this.getActive()?.browser ?? null;
    }
    /** v2.5.10 (bug #20): reține chatul din browser pentru mesajele următoare. */
    async setBrowserChat(providerId, url) {
        const conv = this.getActive();
        if (!conv || !providerId || !url)
            return;
        conv.browser = { providerId, url };
        conv.updatedAt = Date.now();
        await this.save();
        log('browser chat: ' + providerId + ' → ' + url);
    }
    /** v2.5.10 (bug #20): uită chatul din browser (Clear / edit prompt / restore). */
    async clearBrowserChat() {
        const conv = this.getActive();
        if (!conv || !conv.browser)
            return;
        delete conv.browser;
        conv.updatedAt = Date.now();
        await this.save();
        log('browser chat cleared: ' + conv.id);
    }
    list() {
        return [...this.conversations].sort((a, b) => b.updatedAt - a.updatedAt);
    }
    async create(title) {
        const conv = {
            id: 'conv-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
            title: title.slice(0, 40) + (title.length > 40 ? '...' : ''),
            createdAt: Date.now(),
            updatedAt: Date.now(),
            messages: []
        };
        this.conversations.unshift(conv);
        // Trim la 50
        if (this.conversations.length > MAX_CONVERSATIONS) {
            this.conversations = this.conversations.slice(0, MAX_CONVERSATIONS);
        }
        this.activeId = conv.id;
        await this.save();
        log('created: ' + conv.id);
        return conv;
    }
    async appendMessage(msg) {
        const conv = this.getActive();
        if (!conv)
            return;
        conv.messages.push(msg);
        conv.updatedAt = Date.now();
        await this.save();
    }
    async switchTo(id) {
        const conv = this.conversations.find((c) => c.id === id);
        if (!conv)
            return null;
        this.activeId = id;
        await this.save();
        log('switched to: ' + id);
        return conv;
    }
    async deleteConversation(id) {
        this.conversations = this.conversations.filter((c) => c.id !== id);
        if (this.activeId === id) {
            this.activeId = this.conversations[0]?.id || null;
        }
        await this.save();
        log('deleted: ' + id);
    }
    /**
     * Edit prompt: șterge din istoric tot ce vine după messageId
     */
    async truncateAfter(messageId) {
        const conv = this.getActive();
        if (!conv)
            return [];
        const idx = conv.messages.findIndex((m) => m.messageId === messageId);
        if (idx === -1)
            return conv.messages;
        conv.messages = conv.messages.slice(0, idx + 1);
        conv.updatedAt = Date.now();
        await this.save();
        log('truncated after: ' + messageId + ' → ' + conv.messages.length + ' messages');
        return conv.messages;
    }
    /**
     * v1.9.0 (edit): păstrează doar mesajele dinaintea lui messageId —
     * mesajul editat și tot ce a urmat sunt șterse (retrimiterea îl adaugă iar).
     */
    async truncateBefore(messageId) {
        const conv = this.getActive();
        if (!conv)
            return [];
        const idx = conv.messages.findIndex((m) => m.messageId === messageId);
        if (idx === -1)
            return conv.messages;
        conv.messages = conv.messages.slice(0, idx);
        conv.updatedAt = Date.now();
        await this.save();
        log('truncated before: ' + messageId + ' → ' + conv.messages.length + ' messages');
        return conv.messages;
    }
    /**
     * Fork: creează conversație nouă din messageId
     */
    async forkFrom(messageId) {
        const parent = this.getActive();
        if (!parent)
            return null;
        const idx = parent.messages.findIndex((m) => m.messageId === messageId);
        if (idx === -1)
            return null;
        // Fork cu toate mesajele până la messageId (inclusiv)
        const forkedMessages = parent.messages.slice(0, idx + 1);
        const forked = {
            id: 'conv-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8),
            title: '[Fork] ' + parent.title.slice(0, 30),
            createdAt: Date.now(),
            updatedAt: Date.now(),
            parentId: parent.id,
            forkedFromMessageId: messageId,
            messages: forkedMessages
        };
        this.conversations.unshift(forked);
        if (this.conversations.length > MAX_CONVERSATIONS) {
            this.conversations = this.conversations.slice(0, MAX_CONVERSATIONS);
        }
        this.activeId = forked.id;
        await this.save();
        log('forked from: ' + messageId + ' → ' + forked.id);
        return forked;
    }
    async clearActive() {
        const conv = this.getActive();
        if (!conv)
            return;
        conv.messages = [];
        conv.updatedAt = Date.now();
        await this.save();
    }
    /**
     * v1.9.0 (migrare): importă istoricul legacy (freekit.history) într-o
     * conversație nouă — se întâmplă o singură dată, la prima pornire după update.
     */
    async importLegacy(messages, title) {
        const conv = await this.create(title || 'Imported conversation');
        conv.messages = Array.isArray(messages) ? messages.slice() : [];
        conv.updatedAt = Date.now();
        await this.save();
        log('imported legacy history: ' + conv.messages.length + ' messages → ' + conv.id);
        return conv;
    }
    /**
     * v1.9.0: primul prompt al unei conversații „Conversație nouă” o redenumește
     * (titlul devine promptul). Întoarce true doar când titlul chiar s-a schimbat.
     */
    async retitleDefault(text) {
        const conv = this.getActive();
        if (!conv)
            return false;
        if (!conv.title.startsWith(DEFAULT_TITLE))
            return false;
        const t = String(text ?? '').trim();
        if (!t)
            return false;
        conv.title = t.slice(0, 40) + (t.length > 40 ? '...' : '');
        conv.updatedAt = Date.now();
        await this.save();
        log('retitled: ' + conv.id + ' → ' + conv.title);
        return true;
    }
}
exports.ConversationStore = ConversationStore;
//# sourceMappingURL=conversations.js.map