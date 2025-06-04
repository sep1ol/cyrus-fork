# Native Edge Client Design

## Overview

A minimal native app for the Cyrus edge client focused on simplicity and ease of development.

## Technology Choice: Electron

### Why Electron?

1. **Proven Ecosystem**: Battle-tested with apps like VS Code, Discord, Slack
2. **Familiar Stack**: JavaScript/TypeScript throughout
3. **Rich Package Ecosystem**: NPM packages work directly
4. **Developer Experience**: Hot reload, Chrome DevTools
5. **Code Reuse**: Can share code with existing Node.js codebase

### Trade-offs Accepted
- **Bundle Size**: ~150MB (but users expect this from Electron apps)
- **Memory Usage**: Higher than native (but fine for our simple app)
- **Performance**: Good enough for streaming JSON and running Claude

## App Design

### Core Features - Enhanced Design

#### Main Dashboard View
```
┌─────────────────────────────────────────────────────────────────┐
│  Cyrus - Acme Corp                                        [⚙️][_─✕] │
├─────────────────────────────────────────────────────────────────┤
│ ┌─────────────────┬─────────────────────────────────────────────┐ │
│ │ ACTIVE ISSUES   │  LIN-123: Fix user authentication bug      │ │
│ │                 │  ─────────────────────────────────────────   │ │
│ │ 🟢 LIN-123  3m  │                                             │ │
│ │ 🟡 LIN-456  12m │  [10:23] Starting work on authentication... │ │
│ │ ⏸️  LIN-789  2h  │  [10:23] Reading src/auth/login.js         │ │
│ │                 │  [10:24] Found the issue in validateUser() │ │
│ │ COMPLETED       │  [10:24] Updating password validation...   │ │
│ │                 │  [10:25] Running tests...                  │ │
│ │ ✅ LIN-234  ✓   │  [10:26] All tests passing                 │ │
│ │ ✅ LIN-567  ✓   │  [10:26] Creating commit...               │ │
│ │ ✅ LIN-890  ✓   │  [10:27] Pushed changes to branch ▌        │ │
│ │                 │                                             │ │
│ │ + New Issue     │  Branch: fix/lin-123-auth-bug             │ │
│ └─────────────────┴─────────────────────────────────────────────┘ │
│ Status: 3 active • 15 completed today • Connected               │ │
└─────────────────────────────────────────────────────────────────┘
```

#### Configuration View
```
┌─────────────────────────────────────────────────────────────────┐
│  Cyrus - Settings                                         [✕] │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Claude Configuration                                           │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Claude Path:    [/usr/local/bin/claude          ] [Browse] │ │
│  │ Model:          [Claude 3 Opus              ▼]            │ │
│  │ Context Limit:  [200000                     ]             │ │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Workspace Settings                                             │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Base Directory: [~/cyrus-workspaces          ] [Browse]   │ │
│  │ Git Strategy:   (•) Worktrees  ( ) Branches              │ │
│  │ Auto-cleanup:   [✓] Remove after completion              │ │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Behavior                                                       │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Auto-start:     [✓] Start with system                    │ │
│  │ Notifications:  [✓] Show when issues complete            │ │
│  │ Log Level:      [Info                      ▼]            │ │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  [Save]  [Cancel]  [Reset to Defaults]                         │
└─────────────────────────────────────────────────────────────────┘
```

#### Detailed Issue View (Click on an issue)
```
┌─────────────────────────────────────────────────────────────────┐
│  LIN-123: Fix user authentication bug                    [←][✕] │
├─────────────────────────────────────────────────────────────────┤
│ Status: 🟢 Active • Branch: fix/lin-123-auth-bug • 15 min      │
├─────────────────────────────────────────────────────────────────┤
│ ┌─────────────────────────────────────────────────────────────┐ │
│ │ ┌─────────────────────────────────────────────────────────┐ │ │
│ │ │ 👤 Connor: @claude can you fix the authentication bug   │ │ │
│ │ │ where users can't log in with special characters?       │ │ │
│ │ └─────────────────────────────────────────────────────────┘ │ │
│ │                                                             │ │
│ │ ┌─────────────────────────────────────────────────────────┐ │ │
│ │ │ 🤖 Claude: I'll help you fix the authentication bug.    │ │ │
│ │ │ Let me start by examining the authentication code...    │ │ │
│ │ │                                                         │ │ │
│ │ │ Looking at src/auth/login.js...                        │ │ │
│ │ │ Found the issue in the validateUser() function on      │ │ │
│ │ │ line 45. The regex pattern is too restrictive.         │ │ │
│ │ │                                                         │ │ │
│ │ │ I'll update it to properly handle special characters:  │ │ │
│ │ │ ```javascript                                          │ │ │
│ │ │ - const validPassword = /^[a-zA-Z0-9]+$/              │ │ │
│ │ │ + const validPassword = /^.{8,}$/                     │ │ │
│ │ │ ```                                                    │ │ │
│ │ │                                                         │ │ │
│ │ │ Running tests now...                                   │ │ │
│ │ └─────────────────────────────────────────────────────────┘ │ │
│ └─────────────────────────────────────────────────────────────┘ │
│                                                                 │
│ [⏸️ Pause] [🔄 Restart] [📋 Copy Log] [🔗 Open in Linear]        │
└─────────────────────────────────────────────────────────────────┘
```

#### Compact Mode (System Tray Dropdown)
```
┌───────────────────────────────┐
│ Cyrus • Acme Corp            │
├───────────────────────────────┤
│ 🟢 LIN-123  Auth bug     3m  │
│ 🟡 LIN-456  API refactor 12m │
│ ⏸️ LIN-789  Tests        2h  │
├───────────────────────────────┤
│ ⚙️ Settings                   │
│ 📊 Open Dashboard             │
│ ❌ Quit                       │
└───────────────────────────────┘
```

## User Experience Flows

### 1. First-Time Onboarding Flow

#### Step 1: Welcome Screen
```
┌─────────────────────────────────────────────────────────────────┐
│  Welcome to Cyrus                                         [✕] │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│                        🤖 Cyrus                                 │
│                                                                 │
│         Your AI teammate that handles Linear issues             │
│                                                                 │
│     • Automatically works on issues assigned to you             │
│     • Runs Claude Code in isolated environments                 │
│     • Posts updates back to Linear                              │
│                                                                 │
│                    [Get Started →]                              │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

#### Step 2: Connect Linear
```
┌─────────────────────────────────────────────────────────────────┐
│  Connect Your Linear Workspace                            [✕] │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│     We'll open your browser to connect Cyrus to Linear.        │
│                                                                 │
│     You'll need to:                                             │
│     1. Log in to Linear (if not already)                        │
│     2. Authorize Cyrus to access your workspace                 │
│     3. You'll be redirected back here automatically             │
│                                                                 │
│                  [Connect Linear →]                             │
│                                                                 │
│     🔒 Your credentials stay secure in the cloud proxy          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

#### Step 3: Verifying Claude
```
┌─────────────────────────────────────────────────────────────────┐
│  Checking Claude Installation                             [✕] │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│     ✅ Linear connected to: Acme Corp                          │
│                                                                 │
│     Checking for Claude Code CLI...                             │
│                                                                 │
│     ⏳ Looking for claude at /usr/local/bin/claude...          │
│                                                                 │
│     [Skip] [Browse...]                                          │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

#### Step 4: Select Repository
```
┌─────────────────────────────────────────────────────────────────┐
│  Select Your Repository                                   [✕] │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│     Which repository should Cyrus work on?                      │
│                                                                 │
│     📁 Recent Git Repositories:                                 │
│     ┌─────────────────────────────────────────────────────┐   │
│     │ • ~/code/acme-app          (main)                    │   │
│     │ • ~/projects/api-server    (develop)                 │   │
│     │ • ~/work/frontend          (main)                    │   │
│     └─────────────────────────────────────────────────────┘   │
│                                                                 │
│     Or browse for a different repository:                       │
│     [                                          ] [Browse...]     │
│                                                                 │
│     💡 Cyrus will create worktrees in this repo for each issue │
│                                                                 │
│                    [Next →]                                     │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

#### Step 5: Configuration
```
┌─────────────────────────────────────────────────────────────────┐
│  Final Configuration                                      [✕] │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│     Repository: ~/code/acme-app ✓                               │
│                                                                 │
│     Where should Cyrus create issue workspaces?                │
│     [~/code/acme-app/.worktrees               ] [Browse]       │
│                                                                 │
│     How should Cyrus handle Git?                               │
│     (•) Use worktrees (recommended)                            │
│     ( ) Use branches                                            │
│     ( ) No Git (standalone workspaces)                         │
│                                                                 │
│     Start Cyrus when you log in?                               │
│     [✓] Yes, start automatically                               │
│                                                                 │
│                    [Finish Setup]                               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

#### Step 6: Success!
```
┌─────────────────────────────────────────────────────────────────┐
│  You're All Set! 🎉                                      [✕] │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│     Cyrus is now connected and ready to work!                  │
│                                                                 │
│     • Assign issues to yourself in Linear                       │
│     • Cyrus will automatically start working                    │
│     • Watch progress right here in the dashboard                │
│                                                                 │
│     You currently have 0 assigned issues.                       │
│                                                                 │
│                  [Open Dashboard]                               │
│                                                                 │
│     💡 Tip: Cyrus lives in your system tray                    │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 2. Day-to-Day Experience

#### Morning: System Tray Shows Activity
```
[System tray icon changes from gray to green]

Notification bubble:
┌──────────────────────────────┐
│ Cyrus                        │
│ 3 new issues assigned        │
│ • LIN-892: Update API docs   │
│ • LIN-893: Fix date parsing  │
│ • LIN-894: Add unit tests    │
└──────────────────────────────┘
```

#### Click Tray Icon - Quick Status
```
┌────────────────────────────────┐
│ Cyrus • Acme Corp             │
├────────────────────────────────┤
│ WORKING ON:                    │
│ 🟢 LIN-892  API docs      2m  │
│                                │
│ QUEUED:                        │
│ ⏳ LIN-893  Date parsing       │
│ ⏳ LIN-894  Unit tests         │
│                                │
│ RECENT:                        │
│ ✅ LIN-891  Nav fix       ✓   │
│ ✅ LIN-890  Auth update   ✓   │
├────────────────────────────────┤
│ 📊 Open Dashboard              │
│ ⚙️ Settings                    │
│ ❌ Quit                        │
└────────────────────────────────┘
```

#### Open Dashboard - Live View
```
┌─────────────────────────────────────────────────────────────────┐
│  Cyrus - Acme Corp                                        [⚙️][_─✕] │
├─────────────────────────────────────────────────────────────────┤
│ ┌─────────────────┬─────────────────────────────────────────────┐ │
│ │ TODAY (8)       │  LIN-892: Update API docs                   │ │
│ │                 │  ─────────────────────────────────────────   │ │
│ │ Working:        │                                             │ │
│ │ 🟢 LIN-892  8m  │  [9:45] Starting work on API documentation │ │
│ │                 │  [9:45] Analyzing current docs structure... │ │
│ │ Queued:         │  [9:46] Found 3 endpoints missing docs:    │ │
│ │ ⏳ LIN-893      │         - POST /api/users/invite           │ │
│ │ ⏳ LIN-894      │         - DELETE /api/sessions/:id         │ │
│ │                 │         - GET /api/analytics/usage         │ │
│ │ Completed:      │  [9:47] Adding documentation for invite...  │ │
│ │ ✅ LIN-891  ✓   │  [9:48] Testing endpoint examples...       │ │
│ │ ✅ LIN-890  ✓   │  [9:49] All examples verified ✓            │ │
│ │ ✅ LIN-889  ✓   │  [9:49] Updating OpenAPI spec...           │ │
│ │ ✅ LIN-888  ✓   │  [9:50] Running documentation linter... ▌   │ │
│ │ ✅ LIN-887  ✓   │                                             │ │
│ └─────────────────┴─────────────────────────────────────────────┘ │
│ 📊 5 completed • 1 active • 2 queued • 12h saved this week      │ │
└─────────────────────────────────────────────────────────────────┘
```

#### Completion Notification
```
[Desktop notification]
┌──────────────────────────────┐
│ Cyrus                        │
│ ✅ Completed: LIN-892        │
│                              │
│ Updated API documentation    │
│ • Added 3 missing endpoints  │
│ • Fixed 12 example errors    │
│ • Created pull request       │
│                              │
│ [View PR] [Next Issue]       │
└──────────────────────────────┘
```

#### End of Day Summary (5 PM)
```
┌─────────────────────────────────────────────────────────────────┐
│  Daily Summary - Friday, Jan 19                          [✕] │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│     Great work today! Here's what Cyrus accomplished:          │
│                                                                 │
│     ✅ Completed Issues (12)                                   │
│     • LIN-892: Update API docs (45 min)                        │
│     • LIN-893: Fix date parsing (1h 20min)                     │
│     • LIN-894: Add unit tests (2h 10min)                       │
│     ... and 9 more                                             │
│                                                                 │
│     📊 Statistics                                               │
│     • Total time saved: ~8 hours                               │
│     • Lines changed: 1,247                                     │
│     • Tests added: 34                                          │
│     • PRs created: 12                                          │
│                                                                 │
│     🔄 Still in progress (2)                                   │
│     • LIN-895: Refactor auth module                            │
│     • LIN-896: Update dependencies                             │
│                                                                 │
│                    [Close]                                      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### Design Principles

1. **Multi-Pane Layout**: 
   - Left sidebar shows all issues with status indicators
   - Right pane shows selected issue's live log
   - Clear visual hierarchy

2. **Status Indicators**:
   - 🟢 Active (currently processing)
   - 🟡 Waiting (in queue or waiting for response)
   - ⏸️ Paused (manually paused or inactive)
   - ✅ Completed (successfully finished)
   - ❌ Failed (error occurred)

3. **Live Transparency**:
   - Real-time streaming of Claude's actions
   - Timestamps for each action
   - Full conversation history preserved
   - Shows actual file changes and commands

4. **Configuration over Environment**:
   - GUI settings replace env vars
   - Stored in electron-store
   - Validation and helpful defaults
   - Import/export settings

### System Tray Mode

```
System Tray Icon: 🟢 (green = connected, 🔴 = disconnected)

Right-click menu:
- Status: Connected to Acme Corp
- Current: Processing LIN-123
- ─────────────
- Open Dashboard
- View Logs
- ─────────────
- Disconnect
- Quit
```

## Implementation Architecture

### Main Process

```javascript
// main.js
const { app, BrowserWindow, Tray, Menu, ipcMain } = require('electron')
const { NdjsonClient } = require('./ndjson-client')

let mainWindow
let tray
let ndjsonClient

app.whenReady().then(() => {
  // Create system tray
  tray = new Tray('icon.png')
  updateTrayMenu()
  
  // Create hidden window
  mainWindow = new BrowserWindow({
    width: 400,
    height: 500,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  })
  
  mainWindow.loadFile('index.html')
})

// Handle edge connection
ipcMain.handle('connect', async (event, { proxyUrl, token }) => {
  ndjsonClient = new NdjsonClient(proxyUrl, token)
  
  ndjsonClient.on('event', (event) => {
    // Forward to existing SessionManager/LinearIssueService
    // The existing code already handles all the Claude processing
    eventProcessor.handleEvent(event)
    mainWindow.webContents.send('status-update', getStatus())
  })
  
  await ndjsonClient.connect()
})
```

### NDJSON Client

```javascript
// ndjson-client.js
const EventEmitter = require('events')
const fetch = require('node-fetch')
const { createInterface } = require('readline')

class NdjsonClient extends EventEmitter {
  constructor(proxyUrl, token) {
    super()
    this.proxyUrl = proxyUrl
    this.token = token
    this.connected = false
  }
  
  async connect() {
    const response = await fetch(`${this.proxyUrl}/events/stream`, {
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Accept': 'application/x-ndjson'
      }
    })
    
    const rl = createInterface({
      input: response.body,
      crlfDelay: Infinity
    })
    
    rl.on('line', (line) => {
      try {
        const event = JSON.parse(line)
        this.emit('event', event)
      } catch (err) {
        console.error('Failed to parse event:', err)
      }
    })
    
    this.connected = true
    this.emit('connected')
  }
}
```

### Renderer Process

```javascript
// renderer.js
const { ipcRenderer } = window.electron

// Get status updates
ipcRenderer.on('status-update', (event, status) => {
  updateUI(status)
})

// Connect button
document.getElementById('connect').addEventListener('click', async () => {
  const result = await ipcRenderer.invoke('setup-oauth')
  if (result.success) {
    updateUI(result.status)
  }
})
```

### OAuth Setup Flow

```javascript
// oauth-setup.js
const { shell, app } = require('electron')

// Register URL scheme handler
app.setAsDefaultProtocolClient('cyrus')

// Handle the URL scheme callback
app.on('open-url', (event, url) => {
  event.preventDefault()
  handleOAuthCallback(url)
})

// Windows/Linux handling
app.on('second-instance', (event, commandLine) => {
  const url = commandLine.find(arg => arg.startsWith('cyrus://'))
  if (url) {
    handleOAuthCallback(url)
  }
})

function handleOAuthCallback(url) {
  const urlObj = new URL(url)
  if (urlObj.protocol === 'cyrus:' && urlObj.host === 'setup') {
    const token = urlObj.searchParams.get('token')
    if (token) {
      // Store token and connect
      store.set('edgeToken', token)
      connectToProxy(token)
    }
  }
}

async function startOAuthFlow() {
  // Just open the browser - callback will come via URL scheme
  shell.openExternal('https://cyrus-proxy.example.com/setup')
}
```

## Key Implementation Details

### 1. Auto-Updates

```javascript
// auto-updater.js
const { autoUpdater } = require('electron-updater')

autoUpdater.checkForUpdatesAndNotify()

autoUpdater.on('update-downloaded', () => {
  const response = dialog.showMessageBoxSync({
    type: 'question',
    buttons: ['Restart', 'Later'],
    defaultId: 0,
    message: 'A new version has been downloaded. Restart now?'
  })
  
  if (response === 0) {
    autoUpdater.quitAndInstall()
  }
})
```

### 2. Secure Storage

```javascript
// Use electron-store for encrypted storage
const Store = require('electron-store')

const store = new Store({
  encryptionKey: 'some-encryption-key',
  schema: {
    edgeToken: { type: 'string' },
    proxyUrl: { type: 'string' },
    workspaceId: { type: 'string' }
  }
})
```

### 3. System Startup

```javascript
// Auto-start on login
app.setLoginItemSettings({
  openAtLogin: true,
  openAsHidden: true
})
```

## Development Workflow

### Quick Start
```bash
# Create new Electron app
npx create-electron-app cyrus-edge

# Install dependencies
cd cyrus-edge
npm install electron-builder electron-updater electron-store node-fetch

# Development
npm start

# Build
npm run make
```

### Project Structure
```
cyrus-edge/
├── src/
│   ├── main.js           # Main process
│   ├── preload.js        # Preload script
│   ├── renderer.js       # Renderer process
│   ├── index.html        # UI
│   ├── ndjson-client.js  # Streaming client
│   ├── claude-manager.js # Process management
│   └── oauth-setup.js    # OAuth flow
├── assets/
│   └── icon.png          # App icon
└── package.json
```

## Distribution

### macOS
- `.dmg` via electron-builder
- Code signing with Apple Developer cert
- Auto-update via electron-updater

### Windows
- `.exe` installer
- Code signing certificate
- Auto-update support

### Linux
- `.AppImage` for universal support
- `.deb` and `.rpm` packages

## Benefits of Electron

1. **Fast Development**: Use existing Node.js code
2. **Cross-Platform**: One codebase for all platforms
3. **Native APIs**: File system, notifications, etc.
4. **Debugging**: Chrome DevTools built-in
5. **Community**: Huge ecosystem of Electron apps

## Simplicity First

- **Minimal UI**: Just status + setup
- **No configuration**: Everything from proxy
- **Auto-updates**: Seamless updates
- **Tray-first**: Runs in background
- **One-click setup**: OAuth flow handles everything

This gives us a familiar Electron app that's quick to build and maintain using our existing JavaScript expertise.