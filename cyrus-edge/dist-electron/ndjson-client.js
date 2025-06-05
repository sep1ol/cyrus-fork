"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.NdjsonClient = void 0;
const events_1 = require("events");
const ndjson_readablestream_1 = __importDefault(require("ndjson-readablestream"));
class NdjsonClient extends events_1.EventEmitter {
    constructor(proxyUrl, edgeToken) {
        super();
        this.connected = false;
        this.abortController = null;
        this.reconnectTimeout = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;
        this.baseReconnectDelay = 1000;
        this.proxyUrl = proxyUrl;
        this.edgeToken = edgeToken;
    }
    async connect() {
        // Prevent duplicate connections
        if (this.connected) {
            console.log('[NDJSON] Already connected, skipping');
            return;
        }
        try {
            console.log(`[NDJSON] Connecting to ${this.proxyUrl}/events/stream`);
            this.abortController = new AbortController();
            const response = await fetch(`${this.proxyUrl}/events/stream`, {
                headers: {
                    'Authorization': `Bearer ${this.edgeToken}`,
                    'Accept': 'application/x-ndjson'
                },
                signal: this.abortController.signal
            });
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            console.log('[NDJSON] Connected successfully');
            this.connected = true;
            this.reconnectAttempts = 0;
            this.emit('connected');
            // Process the stream using ndjson-readablestream
            if (!response.body) {
                throw new Error('No response body');
            }
            // Process NDJSON stream
            this.processStream(response.body);
        }
        catch (error) {
            if (error?.name === 'AbortError') {
                // Connection was intentionally aborted
                return;
            }
            console.error('Connection error:', error);
            this.connected = false;
            this.emit('disconnected', error);
            // Attempt reconnection
            this.scheduleReconnect();
        }
    }
    async disconnect() {
        this.connected = false;
        if (this.abortController) {
            this.abortController.abort();
            this.abortController = null;
        }
        if (this.reconnectTimeout) {
            clearTimeout(this.reconnectTimeout);
            this.reconnectTimeout = null;
        }
        this.emit('disconnected');
    }
    scheduleReconnect() {
        // Don't reconnect if we're already connected or intentionally disconnected
        if (this.connected || !this.abortController) {
            return;
        }
        if (this.reconnectAttempts >= this.maxReconnectAttempts) {
            console.error('[NDJSON] Max reconnection attempts reached');
            this.emit('error', new Error('Max reconnection attempts reached'));
            return;
        }
        const delay = Math.min(this.baseReconnectDelay * Math.pow(2, this.reconnectAttempts), 30000 // Max 30 seconds
        );
        this.reconnectAttempts++;
        console.log(`[NDJSON] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
        this.reconnectTimeout = setTimeout(() => {
            this.connect();
        }, delay);
    }
    isConnected() {
        return this.connected;
    }
    async processStream(stream) {
        try {
            for await (const event of (0, ndjson_readablestream_1.default)(stream)) {
                if (!this.connected) {
                    console.log('[NDJSON] Stream processing stopped - disconnected');
                    break;
                }
                console.log('[NDJSON] Received event:', event.type, event.id || '');
                this.emit('event', event);
            }
            console.log('[NDJSON] Stream ended');
            this.connected = false;
            this.emit('disconnected');
            this.scheduleReconnect();
        }
        catch (error) {
            console.error('[NDJSON] Stream error:', error);
            this.connected = false;
            this.emit('disconnected', error);
            this.scheduleReconnect();
        }
    }
}
exports.NdjsonClient = NdjsonClient;
