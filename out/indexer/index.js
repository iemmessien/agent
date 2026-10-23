"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.INDEX_VERSION = exports.ollamaAvailable = exports.embedText = exports.cosineSimilarity = exports.workspaceRoot = exports.semanticConfig = exports.searchSemantic = exports.isSemanticEnabled = exports.isOllamaUp = exports.initIndexer = exports.indexWorkspace = exports.indexStatusText = exports.indexSingleFile = exports.indexFilePath = exports.hasIndex = exports.formatSearchResults = exports.clearIndex = exports.DEFAULT_EMBED_MODEL = void 0;
/* v1.10.0 — punctul de intrare al modulului de indexare semantică. */
var indexer_1 = require("./indexer");
Object.defineProperty(exports, "DEFAULT_EMBED_MODEL", { enumerable: true, get: function () { return indexer_1.DEFAULT_EMBED_MODEL; } });
Object.defineProperty(exports, "clearIndex", { enumerable: true, get: function () { return indexer_1.clearIndex; } });
Object.defineProperty(exports, "formatSearchResults", { enumerable: true, get: function () { return indexer_1.formatSearchResults; } });
Object.defineProperty(exports, "hasIndex", { enumerable: true, get: function () { return indexer_1.hasIndex; } });
Object.defineProperty(exports, "indexFilePath", { enumerable: true, get: function () { return indexer_1.indexFilePath; } });
Object.defineProperty(exports, "indexSingleFile", { enumerable: true, get: function () { return indexer_1.indexSingleFile; } });
Object.defineProperty(exports, "indexStatusText", { enumerable: true, get: function () { return indexer_1.indexStatusText; } });
Object.defineProperty(exports, "indexWorkspace", { enumerable: true, get: function () { return indexer_1.indexWorkspace; } });
Object.defineProperty(exports, "initIndexer", { enumerable: true, get: function () { return indexer_1.initIndexer; } });
Object.defineProperty(exports, "isOllamaUp", { enumerable: true, get: function () { return indexer_1.isOllamaUp; } });
Object.defineProperty(exports, "isSemanticEnabled", { enumerable: true, get: function () { return indexer_1.isSemanticEnabled; } });
Object.defineProperty(exports, "searchSemantic", { enumerable: true, get: function () { return indexer_1.searchSemantic; } });
Object.defineProperty(exports, "semanticConfig", { enumerable: true, get: function () { return indexer_1.semanticConfig; } });
Object.defineProperty(exports, "workspaceRoot", { enumerable: true, get: function () { return indexer_1.workspaceRoot; } });
var embeddings_1 = require("./embeddings");
Object.defineProperty(exports, "cosineSimilarity", { enumerable: true, get: function () { return embeddings_1.cosineSimilarity; } });
Object.defineProperty(exports, "embedText", { enumerable: true, get: function () { return embeddings_1.embedText; } });
Object.defineProperty(exports, "ollamaAvailable", { enumerable: true, get: function () { return embeddings_1.ollamaAvailable; } });
var store_1 = require("./store");
Object.defineProperty(exports, "INDEX_VERSION", { enumerable: true, get: function () { return store_1.INDEX_VERSION; } });
//# sourceMappingURL=index.js.map