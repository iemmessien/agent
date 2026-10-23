"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.setAIFinderStatusListener = setAIFinderStatusListener;
exports.publishAIFinderStatus = publishAIFinderStatus;
let listener;
function setAIFinderStatusListener(next) {
    listener = next;
}
function publishAIFinderStatus(status) {
    listener?.(status);
}
//# sourceMappingURL=ai-finder-events.js.map