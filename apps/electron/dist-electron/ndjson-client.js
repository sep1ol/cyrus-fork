"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NdjsonClient = void 0;
const cyrus_ndjson_client_1 = require("cyrus-ndjson-client");
class NdjsonClient extends cyrus_ndjson_client_1.NdjsonClient {
    constructor(proxyUrl, edgeToken, webhookBaseUrl) {
        const config = {
            proxyUrl,
            token: edgeToken,
            transport: 'webhook',
            webhookPort: 3000 + Math.floor(Math.random() * 1000),
            webhookPath: '/webhook',
            webhookHost: 'localhost',
            name: `Electron-${process.platform}-${Date.now()}`,
            capabilities: ['linear-processing', 'claude-execution'],
            ...(webhookBaseUrl && { webhookBaseUrl })
        };
        super(config);
    }
    // Add methods for backward compatibility
    isConnected() {
        return super.isConnected();
    }
    async disconnect() {
        return super.disconnect();
    }
}
exports.NdjsonClient = NdjsonClient;
