"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
// Custom APIs for renderer
const api = {
    // Config management
    getConfig: () => electron_1.ipcRenderer.invoke('get-config'),
    saveConfig: (config) => electron_1.ipcRenderer.invoke('save-config', config),
    // Connection management
    connect: () => electron_1.ipcRenderer.invoke('connect'),
    disconnect: () => electron_1.ipcRenderer.invoke('disconnect'),
    getConnectionStatus: () => electron_1.ipcRenderer.invoke('get-connection-status'),
    startOAuth: () => electron_1.ipcRenderer.invoke('start-oauth'),
    // File/folder selection
    selectFile: () => electron_1.ipcRenderer.invoke('select-file'),
    selectFolder: () => electron_1.ipcRenderer.invoke('select-folder'),
    validatePaths: (paths) => electron_1.ipcRenderer.invoke('validate-paths', paths),
    // Event listeners
    onSetupComplete: (callback) => {
        electron_1.ipcRenderer.on('setup-complete', (_, data) => callback(data));
    },
    onSetupError: (callback) => {
        electron_1.ipcRenderer.on('setup-error', (_, error) => callback(error));
    },
    onProxyConnected: (callback) => {
        electron_1.ipcRenderer.on('proxy-connected', callback);
    },
    onProxyDisconnected: (callback) => {
        electron_1.ipcRenderer.on('proxy-disconnected', callback);
    },
    onEventProcessed: (callback) => {
        electron_1.ipcRenderer.on('event-processed', (_, event) => callback(event));
    },
    onEventError: (callback) => {
        electron_1.ipcRenderer.on('event-error', (_, data) => callback(data));
    },
    // Remove listeners
    removeAllListeners: (channel) => {
        electron_1.ipcRenderer.removeAllListeners(channel);
    }
};
// Use contextBridge to expose protected methods
if (process.contextIsolated) {
    try {
        electron_1.contextBridge.exposeInMainWorld('cyrus', api);
    }
    catch (error) {
        console.error(error);
    }
}
else {
    globalThis.cyrus = api;
}
