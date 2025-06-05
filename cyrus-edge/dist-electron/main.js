"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const electron_1 = require("electron");
const path_1 = require("path");
const fs_1 = require("fs");
const main_1 = require("electron-conf/main");
const ndjson_client_1 = require("./ndjson-client");
const event_processor_1 = require("./event-processor");
// Add isQuitting property to app
const extendedApp = electron_1.app;
const store = new main_1.Conf({
    defaults: {
        claudePath: '/usr/local/bin/claude',
        workspaceBaseDir: (0, path_1.join)(electron_1.app.getPath('home'), 'cyrus-workspaces')
    }
});
let mainWindow = null;
let tray = null;
let ndjsonClient = null;
let eventProcessor = null;
let isConnecting = false;
// Register cyrus:// protocol
if (process.defaultApp) {
    if (process.argv.length >= 2) {
        electron_1.app.setAsDefaultProtocolClient('cyrus', process.execPath, [process.argv[1]]);
    }
}
else {
    electron_1.app.setAsDefaultProtocolClient('cyrus');
}
// Handle protocol on Windows/Linux
const gotTheLock = electron_1.app.requestSingleInstanceLock();
if (!gotTheLock) {
    electron_1.app.quit();
}
else {
    electron_1.app.on('second-instance', (event, commandLine) => {
        // Someone tried to run a second instance, we should focus our window instead.
        if (mainWindow) {
            if (mainWindow.isMinimized())
                mainWindow.restore();
            mainWindow.focus();
        }
        // Handle cyrus:// protocol
        const url = commandLine.find(arg => arg.startsWith('cyrus://'));
        if (url) {
            handleCyrusProtocol(url);
        }
    });
}
function createWindow() {
    mainWindow = new electron_1.BrowserWindow({
        width: 1200,
        height: 800,
        show: false,
        autoHideMenuBar: true,
        webPreferences: {
            preload: (0, path_1.join)(__dirname, 'preload.js'),
            sandbox: false
        }
    });
    mainWindow.on('ready-to-show', () => {
        mainWindow?.show();
    });
    mainWindow.webContents.setWindowOpenHandler((details) => {
        electron_1.shell.openExternal(details.url);
        return { action: 'deny' };
    });
    // Development vs production loading
    if (process.env['ELECTRON_RENDERER_URL']) {
        mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
    }
    else {
        mainWindow.loadFile((0, path_1.join)(__dirname, '../dist/index.html'));
    }
    // Hide instead of close
    mainWindow.on('close', (event) => {
        if (!extendedApp.isQuitting) {
            event.preventDefault();
            mainWindow?.hide();
        }
    });
}
function createTray() {
    try {
        // Use template icon for macOS
        const iconPath = process.platform === 'darwin'
            ? (0, path_1.join)(__dirname, '../../resources/tray-iconTemplate.png')
            : (0, path_1.join)(__dirname, '../../resources/tray-icon.png');
        console.log('Creating tray with icon path:', iconPath);
        tray = new electron_1.Tray(iconPath);
        const contextMenu = electron_1.Menu.buildFromTemplate([
            { label: 'Show Dashboard', click: () => mainWindow?.show() },
            { type: 'separator' },
            { label: 'Quit Cyrus', click: () => {
                    extendedApp.isQuitting = true;
                    electron_1.app.quit();
                } }
        ]);
        tray.setToolTip('Cyrus');
        tray.setContextMenu(contextMenu);
        tray.on('click', () => {
            mainWindow?.show();
        });
    }
    catch (error) {
        console.error('Failed to create tray:', error);
    }
}
function handleCyrusProtocol(url) {
    try {
        const parsedUrl = new URL(url);
        if (parsedUrl.hostname === 'setup') {
            const params = parsedUrl.searchParams;
            const config = {
                proxyUrl: params.get('proxyUrl'),
                edgeToken: params.get('edgeToken'),
                linearToken: params.get('linearToken'),
                workspaceId: params.get('workspaceId'),
                timestamp: parseInt(params.get('timestamp') || '0')
            };
            // Validate timestamp (5 minute expiry)
            if (Date.now() - config.timestamp > 5 * 60 * 1000) {
                mainWindow?.webContents.send('setup-error', 'Setup link has expired');
                return;
            }
            // Store configuration
            store.set('proxyUrl', config.proxyUrl);
            store.set('edgeToken', config.edgeToken);
            store.set('linearToken', config.linearToken);
            store.set('workspaceId', config.workspaceId);
            // Connect to proxy
            connectToProxy();
            // Notify renderer
            mainWindow?.webContents.send('setup-complete', {
                workspaceId: config.workspaceId
            });
        }
    }
    catch (error) {
        console.error('Error handling cyrus:// protocol:', error);
        mainWindow?.webContents.send('setup-error', error instanceof Error ? error.message : String(error));
    }
}
async function connectToProxy() {
    console.log('[Main] connectToProxy called');
    // Prevent concurrent connections
    if (isConnecting) {
        console.log('[Main] Already connecting, skipping');
        return;
    }
    // Check if already connected
    if (ndjsonClient?.isConnected()) {
        console.log('[Main] Already connected');
        return;
    }
    isConnecting = true;
    try {
        // Disconnect existing client if any
        if (ndjsonClient) {
            console.log('[Main] Disconnecting existing client');
            await ndjsonClient.disconnect();
            ndjsonClient = null;
        }
        const proxyUrl = store.get('proxyUrl');
        const edgeToken = store.get('edgeToken');
        const linearToken = store.get('linearToken');
        if (!proxyUrl || !edgeToken) {
            console.error('Missing proxy configuration');
            isConnecting = false;
            return;
        }
        console.log(`[Main] Connecting to proxy at ${proxyUrl}`);
        // Initialize event processor
        eventProcessor = new event_processor_1.EventProcessor({
            linearToken,
            claudePath: store.get('claudePath'),
            workspaceBaseDir: store.get('workspaceBaseDir')
        });
        // Listen to EventProcessor events
        eventProcessor.on('session-started', (data) => {
            console.log('Session started:', data);
            mainWindow?.webContents.send('session-started', data);
        });
        eventProcessor.on('session-ended', (data) => {
            console.log('Session ended:', data);
            mainWindow?.webContents.send('session-ended', data);
        });
        // Initialize NDJSON client
        ndjsonClient = new ndjson_client_1.NdjsonClient(proxyUrl, edgeToken);
        ndjsonClient.on('event', async (event) => {
            try {
                if (eventProcessor) {
                    await eventProcessor.processEvent(event);
                    mainWindow?.webContents.send('event-processed', event);
                }
            }
            catch (error) {
                console.error('Error processing event:', error);
                mainWindow?.webContents.send('event-error', { event, error: error instanceof Error ? error.message : String(error) });
            }
        });
        ndjsonClient.on('connected', () => {
            mainWindow?.webContents.send('proxy-connected');
        });
        ndjsonClient.on('disconnected', () => {
            mainWindow?.webContents.send('proxy-disconnected');
        });
        await ndjsonClient.connect();
    }
    finally {
        isConnecting = false;
    }
}
// App event handlers
electron_1.app.whenReady().then(() => {
    console.log('App ready, creating window...');
    // Handle cyrus:// protocol on macOS
    electron_1.app.on('open-url', (event, url) => {
        event.preventDefault();
        handleCyrusProtocol(url);
    });
    createWindow();
    createTray();
    // Auto-connect if configured
    if (store.get('proxyUrl') && store.get('edgeToken')) {
        connectToProxy();
    }
});
electron_1.app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        electron_1.app.quit();
    }
});
electron_1.app.on('activate', () => {
    if (electron_1.BrowserWindow.getAllWindows().length === 0) {
        createWindow();
    }
});
// IPC handlers
electron_1.ipcMain.handle('get-config', () => {
    // Return all stored config
    return store.store;
});
electron_1.ipcMain.handle('get-connection-status', () => {
    return {
        connected: ndjsonClient?.isConnected() || false,
        proxyUrl: store.get('proxyUrl'),
        hasToken: !!store.get('edgeToken')
    };
});
electron_1.ipcMain.handle('save-config', (_, config) => {
    Object.entries(config).forEach(([key, value]) => {
        if (value !== undefined && value !== null) {
            store.set(key, value);
        }
    });
});
electron_1.ipcMain.handle('connect', async () => {
    await connectToProxy();
});
electron_1.ipcMain.handle('disconnect', async () => {
    await ndjsonClient?.disconnect();
    ndjsonClient = null;
    eventProcessor = null;
});
electron_1.ipcMain.handle('start-oauth', async () => {
    const proxyUrl = store.get('proxyUrl') || 'http://localhost:3456';
    electron_1.shell.openExternal(`${proxyUrl}/oauth/authorize`);
});
electron_1.ipcMain.handle('get-active-sessions', () => {
    return eventProcessor?.getActiveSessions() || [];
});
electron_1.ipcMain.handle('select-file', async () => {
    const result = await electron_1.dialog.showOpenDialog(mainWindow, {
        properties: ['openFile'],
        filters: [
            { name: 'Executable', extensions: ['exe', 'sh', 'command', 'app', ''] },
            { name: 'All Files', extensions: ['*'] }
        ]
    });
    if (!result.canceled && result.filePaths.length > 0) {
        return result.filePaths[0];
    }
    return null;
});
electron_1.ipcMain.handle('select-folder', async () => {
    const result = await electron_1.dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory', 'createDirectory']
    });
    if (!result.canceled && result.filePaths.length > 0) {
        return result.filePaths[0];
    }
    return null;
});
electron_1.ipcMain.handle('validate-paths', async (_, paths) => {
    const errors = {};
    if (paths.claudePath) {
        // Expand ~ to home directory
        const expandedPath = paths.claudePath.replace(/^~/, electron_1.app.getPath('home'));
        if (!(0, fs_1.existsSync)(expandedPath)) {
            errors.claudePath = 'Claude executable not found at this path';
        }
    }
    if (paths.repository) {
        const expandedPath = paths.repository.replace(/^~/, electron_1.app.getPath('home'));
        if (!(0, fs_1.existsSync)(expandedPath)) {
            errors.repository = 'Repository directory not found';
        }
    }
    if (paths.workspaceBaseDir) {
        const expandedPath = paths.workspaceBaseDir.replace(/^~/, electron_1.app.getPath('home'));
        // For workspace directory, we'll create it if it doesn't exist
        // So we just check if the parent directory exists
        const parentDir = (0, path_1.join)(expandedPath, '..');
        if (!(0, fs_1.existsSync)(parentDir)) {
            errors.workspaceBaseDir = 'Parent directory does not exist';
        }
    }
    return errors;
});
