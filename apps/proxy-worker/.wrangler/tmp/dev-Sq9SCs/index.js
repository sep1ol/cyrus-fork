var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// .wrangler/tmp/bundle-TVfM5D/checked-fetch.js
var urls = /* @__PURE__ */ new Set();
function checkURL(request, init) {
  const url = request instanceof URL ? request : new URL(
    (typeof request === "string" ? new Request(request, init) : request).url
  );
  if (url.port && url.port !== "443" && url.protocol === "https:") {
    if (!urls.has(url.toString())) {
      urls.add(url.toString());
      console.warn(
        `WARNING: known issue with \`fetch()\` requests to custom HTTPS ports in published Workers:
 - ${url.toString()} - the custom port will be ignored when the Worker is published using the \`wrangler deploy\` command.
`
      );
    }
  }
}
__name(checkURL, "checkURL");
globalThis.fetch = new Proxy(globalThis.fetch, {
  apply(target, thisArg, argArray) {
    const [request, init] = argArray;
    checkURL(request, init);
    return Reflect.apply(target, thisArg, argArray);
  }
});

// .wrangler/tmp/bundle-TVfM5D/strip-cf-connecting-ip-header.js
function stripCfConnectingIPHeader(input, init) {
  const request = new Request(input, init);
  request.headers.delete("CF-Connecting-IP");
  return request;
}
__name(stripCfConnectingIPHeader, "stripCfConnectingIPHeader");
globalThis.fetch = new Proxy(globalThis.fetch, {
  apply(target, thisArg, argArray) {
    return Reflect.apply(target, thisArg, [
      stripCfConnectingIPHeader.apply(null, argArray)
    ]);
  }
});

// ../../node_modules/.pnpm/itty-router@4.2.2/node_modules/itty-router/index.mjs
var e = /* @__PURE__ */ __name(({ base: e2 = "", routes: t = [], ...o2 } = {}) => ({ __proto__: new Proxy({}, { get: (o3, s2, r, n) => "handle" == s2 ? r.fetch : (o4, ...a) => t.push([s2.toUpperCase?.(), RegExp(`^${(n = (e2 + o4).replace(/\/+(\/|$)/g, "$1")).replace(/(\/?\.?):(\w+)\+/g, "($1(?<$2>*))").replace(/(\/?\.?):(\w+)/g, "($1(?<$2>[^$1/]+?))").replace(/\./g, "\\.").replace(/(\/?)\*/g, "($1.*)?")}/*$`), a, n]) && r }), routes: t, ...o2, async fetch(e3, ...o3) {
  let s2, r, n = new URL(e3.url), a = e3.query = { __proto__: null };
  for (let [e4, t2] of n.searchParams)
    a[e4] = a[e4] ? [].concat(a[e4], t2) : t2;
  for (let [a2, c2, i2, l2] of t)
    if ((a2 == e3.method || "ALL" == a2) && (r = n.pathname.match(c2))) {
      e3.params = r.groups || {}, e3.route = l2;
      for (let t2 of i2)
        if (null != (s2 = await t2(e3.proxy ?? e3, ...o3)))
          return s2;
    }
} }), "e");
var o = /* @__PURE__ */ __name((e2 = "text/plain; charset=utf-8", t) => (o2, { headers: s2 = {}, ...r } = {}) => void 0 === o2 || "Response" === o2?.constructor.name ? o2 : new Response(t ? t(o2) : o2, { headers: { "content-type": e2, ...s2.entries ? Object.fromEntries(s2) : s2 }, ...r }), "o");
var s = o("application/json; charset=utf-8", JSON.stringify);
var c = o("text/plain; charset=utf-8", String);
var i = o("text/html");
var l = o("image/jpeg");
var p = o("image/png");
var d = o("image/webp");

// src/utils/crypto.ts
var TokenEncryption = class {
  constructor(secretKey) {
    this.secretKey = secretKey;
  }
  encryptionKey = null;
  /**
   * Get or create the encryption key
   */
  async getEncryptionKey() {
    if (!this.encryptionKey) {
      const encoder = new TextEncoder();
      const keyData = encoder.encode(this.secretKey.padEnd(32, "0").slice(0, 32));
      this.encryptionKey = await crypto.subtle.importKey(
        "raw",
        keyData,
        { name: "AES-GCM" },
        false,
        ["encrypt", "decrypt"]
      );
    }
    return this.encryptionKey;
  }
  /**
   * Encrypt an OAuth token
   */
  async encryptToken(token) {
    const key = await this.getEncryptionKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoder = new TextEncoder();
    const accessTokenData = encoder.encode(token.accessToken);
    const encryptedAccessToken = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      accessTokenData
    );
    let encryptedRefreshToken;
    if (token.refreshToken) {
      const refreshTokenData = encoder.encode(token.refreshToken);
      encryptedRefreshToken = await crypto.subtle.encrypt(
        { name: "AES-GCM", iv },
        key,
        refreshTokenData
      );
    }
    return {
      ...token,
      accessToken: this.arrayBufferToBase64(encryptedAccessToken),
      refreshToken: encryptedRefreshToken ? this.arrayBufferToBase64(encryptedRefreshToken) : void 0,
      iv: this.arrayBufferToBase64(iv)
    };
  }
  /**
   * Decrypt an OAuth token
   */
  async decryptToken(encrypted) {
    const key = await this.getEncryptionKey();
    const iv = this.base64ToArrayBuffer(encrypted.iv);
    const decoder = new TextDecoder();
    const encryptedAccessToken = this.base64ToArrayBuffer(encrypted.accessToken);
    const decryptedAccessToken = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      encryptedAccessToken
    );
    let refreshToken;
    if (encrypted.refreshToken) {
      const encryptedRefreshToken = this.base64ToArrayBuffer(encrypted.refreshToken);
      const decryptedRefreshToken = await crypto.subtle.decrypt(
        { name: "AES-GCM", iv },
        key,
        encryptedRefreshToken
      );
      refreshToken = decoder.decode(decryptedRefreshToken);
    }
    return {
      ...encrypted,
      accessToken: decoder.decode(decryptedAccessToken),
      refreshToken,
      iv: void 0
      // Remove IV from decrypted token
    };
  }
  /**
   * Hash a token for storage (one-way)
   */
  async hashToken(token) {
    const encoder = new TextEncoder();
    const data = encoder.encode(token);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    return this.arrayBufferToHex(hashBuffer);
  }
  /**
   * Convert ArrayBuffer to base64
   */
  arrayBufferToBase64(buffer) {
    const bytes = new Uint8Array(buffer);
    const binary = String.fromCharCode(...bytes);
    return btoa(binary);
  }
  /**
   * Convert base64 to ArrayBuffer
   */
  base64ToArrayBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i2 = 0; i2 < binary.length; i2++) {
      bytes[i2] = binary.charCodeAt(i2);
    }
    return bytes.buffer;
  }
  /**
   * Convert ArrayBuffer to hex string
   */
  arrayBufferToHex(buffer) {
    const bytes = new Uint8Array(buffer);
    return Array.from(bytes).map((b) => b.toString(16).padStart(2, "0")).join("");
  }
};
__name(TokenEncryption, "TokenEncryption");

// src/services/KVOAuthStorage.ts
var KVOAuthStorage = class {
  constructor(kv, encryptionKey) {
    this.kv = kv;
    this.crypto = new TokenEncryption(encryptionKey);
  }
  crypto;
  /**
   * Save an OAuth token to KV
   */
  async saveToken(workspaceId, tokenData) {
    const encrypted = await this.crypto.encryptToken(tokenData);
    const ttl = tokenData.expiresAt ? Math.max(1, Math.floor((tokenData.expiresAt - Date.now()) / 1e3)) : void 0;
    await this.kv.put(
      `oauth:token:${workspaceId}`,
      JSON.stringify(encrypted),
      { expirationTtl: ttl }
    );
  }
  /**
   * Get an OAuth token from KV
   */
  async getToken(workspaceId) {
    const data = await this.kv.get(`oauth:token:${workspaceId}`);
    if (!data)
      return null;
    try {
      const encrypted = JSON.parse(data);
      return await this.crypto.decryptToken(encrypted);
    } catch (error) {
      console.error("Failed to decrypt token:", error);
      await this.deleteToken(workspaceId);
      return null;
    }
  }
  /**
   * Delete an OAuth token
   */
  async deleteToken(workspaceId) {
    await this.kv.delete(`oauth:token:${workspaceId}`);
  }
  /**
   * Refresh an OAuth token (to be implemented with Linear API)
   */
  async refreshToken(workspaceId) {
    const currentToken = await this.getToken(workspaceId);
    if (!currentToken) {
      throw new Error("No token found to refresh");
    }
    if (!currentToken.refreshToken) {
      throw new Error("No refresh token available");
    }
    throw new Error("Token refresh not yet implemented");
  }
};
__name(KVOAuthStorage, "KVOAuthStorage");

// src/services/OAuthService.ts
var OAuthService = class {
  constructor(env, onAuthSuccess) {
    this.env = env;
    this.onAuthSuccess = onAuthSuccess;
    this.tokenStorage = new KVOAuthStorage(env.OAUTH_TOKENS, env.ENCRYPTION_KEY);
  }
  tokenStorage;
  /**
   * Handle OAuth authorization request
   */
  async handleAuthorize(request) {
    const state = crypto.randomUUID();
    await this.env.OAUTH_STATE.put(
      `oauth:state:${state}`,
      JSON.stringify({
        createdAt: Date.now(),
        redirectUri: this.env.OAUTH_REDIRECT_URI
      }),
      { expirationTtl: 600 }
      // 10 minutes
    );
    const authUrl = new URL("https://linear.app/oauth/authorize");
    authUrl.searchParams.set("client_id", this.env.LINEAR_CLIENT_ID);
    authUrl.searchParams.set("redirect_uri", this.env.OAUTH_REDIRECT_URI);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("state", state);
    authUrl.searchParams.set("scope", "read write issues:create comments:create");
    authUrl.searchParams.set("actor", "application");
    authUrl.searchParams.set("prompt", "consent");
    return Response.redirect(authUrl.toString(), 302);
  }
  /**
   * Handle OAuth callback
   */
  async handleCallback(request) {
    const url = new URL(request.url);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    if (!code || !state) {
      return new Response("Missing code or state", { status: 400 });
    }
    const stateData = await this.env.OAUTH_STATE.get(`oauth:state:${state}`);
    if (!stateData) {
      return new Response("Invalid or expired state", { status: 400 });
    }
    await this.env.OAUTH_STATE.delete(`oauth:state:${state}`);
    try {
      const tokenResponse = await this.exchangeCodeForToken(code);
      const workspaceInfo = await this.getWorkspaceInfo(tokenResponse.access_token);
      const token = {
        accessToken: tokenResponse.access_token,
        refreshToken: tokenResponse.refresh_token,
        expiresAt: Date.now() + tokenResponse.expires_in * 1e3,
        obtainedAt: Date.now(),
        scope: tokenResponse.scope.split(" "),
        tokenType: tokenResponse.token_type,
        userId: workspaceInfo.userId,
        userEmail: workspaceInfo.userEmail,
        workspaceName: workspaceInfo.organization.name
      };
      await this.tokenStorage.saveToken(workspaceInfo.organization.id, token);
      await this.storeWorkspaceMetadata(workspaceInfo);
      if (this.onAuthSuccess) {
        await this.onAuthSuccess(token, {
          id: workspaceInfo.organization.id,
          name: workspaceInfo.organization.name,
          urlKey: workspaceInfo.organization.urlKey,
          organizationId: workspaceInfo.organization.id,
          teams: workspaceInfo.organization.teams?.nodes || []
        });
      }
      const edgeToken = await this.generateEdgeToken([workspaceInfo.organization.id]);
      return new Response(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>OAuth Success - Cyrus</title>
          <style>
            body { font-family: system-ui; max-width: 600px; margin: 50px auto; padding: 20px; }
            .success { color: #10b981; }
            .token-box { background: #f3f4f6; padding: 20px; border-radius: 8px; margin: 20px 0; }
            .token { font-family: monospace; word-break: break-all; }
            button { background: #3b82f6; color: white; padding: 10px 20px; border: none; border-radius: 6px; cursor: pointer; }
            button:hover { background: #2563eb; }
          </style>
        </head>
        <body>
          <h1 class="success">\u2705 Authorization Successful!</h1>
          <p>You've successfully connected <strong>${workspaceInfo.organization.name}</strong> to Cyrus.</p>
          
          <div class="token-box">
            <h3>Your Edge Worker Configuration:</h3>
            <p>Add these to your edge worker's environment:</p>
            <pre>
PROXY_URL=${url.origin}
EDGE_TOKEN=<span class="token" id="token">${edgeToken}</span>
LINEAR_OAUTH_TOKEN=<span class="token">[Already stored securely]</span>
            </pre>
            <button onclick="copyToken()">Copy Edge Token</button>
          </div>
          
          <p>The OAuth token has been securely stored and will be used by the proxy to authenticate with Linear.</p>
          
          <script>
            function copyToken() {
              const token = document.getElementById('token').textContent;
              navigator.clipboard.writeText(token).then(() => {
                alert('Edge token copied to clipboard!');
              });
            }
          <\/script>
        </body>
        </html>
      `, {
        status: 200,
        headers: { "Content-Type": "text/html" }
      });
    } catch (error) {
      console.error("OAuth callback error:", error);
      return new Response(`OAuth failed: ${error.message}`, { status: 500 });
    }
  }
  /**
   * Exchange authorization code for access token
   */
  async exchangeCodeForToken(code) {
    const response = await fetch("https://api.linear.app/oauth/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: this.env.LINEAR_CLIENT_ID,
        client_secret: this.env.LINEAR_CLIENT_SECRET,
        redirect_uri: this.env.OAUTH_REDIRECT_URI,
        code
      })
    });
    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Token exchange failed: ${error}`);
    }
    return await response.json();
  }
  /**
   * Get workspace information using access token
   */
  async getWorkspaceInfo(accessToken) {
    const response = await fetch("https://api.linear.app/graphql", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${accessToken}`
      },
      body: JSON.stringify({
        query: `
          query {
            viewer {
              id
              name
              email
              organization {
                id
                name
                urlKey
                teams {
                  nodes {
                    id
                    key
                    name
                  }
                }
              }
            }
          }
        `
      })
    });
    if (!response.ok) {
      throw new Error("Failed to get workspace info");
    }
    const data = await response.json();
    if (data.errors) {
      throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
    }
    return {
      userId: data.data.viewer.id,
      userEmail: data.data.viewer.email,
      organization: data.data.viewer.organization
    };
  }
  /**
   * Store workspace metadata in KV
   */
  async storeWorkspaceMetadata(workspaceInfo) {
    const metadata = {
      id: workspaceInfo.organization.id,
      name: workspaceInfo.organization.name,
      urlKey: workspaceInfo.organization.urlKey,
      organizationId: workspaceInfo.organization.id,
      teams: workspaceInfo.organization.teams?.nodes || []
    };
    await this.env.WORKSPACE_METADATA.put(
      `workspace:meta:${metadata.id}`,
      JSON.stringify(metadata),
      { expirationTtl: 86400 }
      // 24 hours
    );
  }
  /**
   * Generate an edge token for the given workspace IDs
   */
  async generateEdgeToken(workspaceIds) {
    const tokenBytes = crypto.getRandomValues(new Uint8Array(32));
    const token = btoa(String.fromCharCode(...tokenBytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
    const hashedToken = await this.hashToken(token);
    await this.env.EDGE_TOKENS.put(
      `edge:token:${hashedToken}`,
      JSON.stringify({
        workspaceIds,
        createdAt: Date.now(),
        lastUsed: Date.now(),
        permissions: ["read", "write"]
      })
    );
    return token;
  }
  /**
   * Hash a token using SHA-256
   */
  async hashToken(token) {
    const encoder = new TextEncoder();
    const data = encoder.encode(token);
    const hashBuffer = await crypto.subtle.digest("SHA-256", data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
  }
};
__name(OAuthService, "OAuthService");

// src/services/WebhookReceiver.ts
var WebhookReceiver = class {
  constructor(env, onWebhook) {
    this.env = env;
    this.onWebhook = onWebhook;
  }
  /**
   * Handle incoming webhook
   */
  async handleWebhook(request) {
    const signature = request.headers.get("linear-signature");
    if (!signature) {
      return new Response("Missing signature", { status: 401 });
    }
    const rawBody = await request.text();
    const isValid = await this.verifyWebhookSignature(rawBody, signature);
    if (!isValid) {
      return new Response("Invalid signature", { status: 401 });
    }
    try {
      const webhook = JSON.parse(rawBody);
      console.log(`Received webhook: ${webhook.type}/${webhook.action || webhook.notification?.type}`);
      await this.onWebhook(webhook);
      return new Response("OK", { status: 200 });
    } catch (error) {
      console.error("Webhook processing error:", error);
      return new Response("Processing error", { status: 500 });
    }
  }
  /**
   * Verify webhook signature using HMAC-SHA256
   */
  async verifyWebhookSignature(payload, signature) {
    try {
      const encoder = new TextEncoder();
      const key = await crypto.subtle.importKey(
        "raw",
        encoder.encode(this.env.LINEAR_WEBHOOK_SECRET),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign", "verify"]
      );
      const signatureBuffer = await crypto.subtle.sign(
        "HMAC",
        key,
        encoder.encode(payload)
      );
      const computedSignature = Array.from(new Uint8Array(signatureBuffer)).map((b) => b.toString(16).padStart(2, "0")).join("");
      return computedSignature === signature;
    } catch (error) {
      console.error("Signature verification error:", error);
      return false;
    }
  }
};
__name(WebhookReceiver, "WebhookReceiver");

// src/services/EventStreamer.ts
var EventStreamer = class {
  constructor(env) {
    this.env = env;
    this.crypto = new TokenEncryption(env.ENCRYPTION_KEY);
  }
  crypto;
  eventCounter = 0;
  /**
   * Handle event stream request
   */
  async handleStream(request) {
    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response("Missing or invalid authorization header", { status: 401 });
    }
    const edgeToken = authHeader.substring(7);
    const workspaceIds = await this.validateEdgeToken(edgeToken);
    if (!workspaceIds || workspaceIds.length === 0) {
      return new Response("Invalid token or no workspace access", { status: 401 });
    }
    const edgeId = await this.crypto.hashToken(edgeToken);
    const durableObjectId = this.env.EVENT_STREAM.idFromName(edgeId);
    const durableObject = this.env.EVENT_STREAM.get(durableObjectId);
    const url = new URL(request.url);
    url.searchParams.set("workspaceIds", workspaceIds.join(","));
    return durableObject.fetch(new Request(url, request));
  }
  /**
   * Handle status update from edge worker
   */
  async handleStatus(request) {
    const { eventId, status, error } = await request.json();
    const authHeader = request.headers.get("authorization");
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return new Response("Missing or invalid authorization header", { status: 401 });
    }
    const edgeToken = authHeader.substring(7);
    const edgeId = await this.crypto.hashToken(edgeToken);
    console.log(`Edge ${edgeId.substring(0, 8)}... reported status for event ${eventId}: ${status}`);
    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" }
    });
  }
  /**
   * Validate edge token and return workspace IDs
   */
  async validateEdgeToken(token) {
    const hashedToken = await this.crypto.hashToken(token);
    const data = await this.env.EDGE_TOKENS.get(`edge:token:${hashedToken}`);
    if (!data)
      return null;
    const tokenData = JSON.parse(data);
    await this.env.EDGE_TOKENS.put(
      `edge:token:${hashedToken}`,
      JSON.stringify({
        ...tokenData,
        lastUsed: Date.now()
      })
    );
    return tokenData.workspaceIds;
  }
  /**
   * Transform webhook to streaming event
   */
  transformWebhookToEvent(webhook) {
    this.eventCounter++;
    return {
      id: `evt_${this.eventCounter}_${Date.now()}`,
      type: "webhook",
      timestamp: (/* @__PURE__ */ new Date()).toISOString(),
      data: webhook
    };
  }
  /**
   * Broadcast event to edge workers for a workspace
   */
  async broadcastToWorkspace(event, workspaceId) {
    const edgeWorkers = await this.getEdgeWorkersForWorkspace(workspaceId);
    let successCount = 0;
    for (const edgeId of edgeWorkers) {
      try {
        const durableObjectId = this.env.EVENT_STREAM.idFromName(edgeId);
        const durableObject = this.env.EVENT_STREAM.get(durableObjectId);
        const response = await durableObject.fetch(
          new Request("http://internal/send-event", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(event)
          })
        );
        if (response.ok) {
          successCount++;
        }
      } catch (error) {
        console.error(`Failed to send event to edge ${edgeId}:`, error);
      }
    }
    return successCount;
  }
  /**
   * Get all edge workers that have access to a workspace
   */
  async getEdgeWorkersForWorkspace(workspaceId) {
    const edgeWorkers = [];
    const list = await this.env.EDGE_TOKENS.list({ prefix: "edge:token:" });
    for (const key of list.keys) {
      const data = await this.env.EDGE_TOKENS.get(key.name);
      if (data) {
        const tokenData = JSON.parse(data);
        if (tokenData.workspaceIds.includes(workspaceId)) {
          const edgeId = key.name.replace("edge:token:", "");
          edgeWorkers.push(edgeId);
        }
      }
    }
    return edgeWorkers;
  }
};
__name(EventStreamer, "EventStreamer");

// src/services/EventStreamDurableObject.ts
var EventStreamDurableObject = class {
  state;
  env;
  connections = /* @__PURE__ */ new Map();
  workspaceIds = [];
  heartbeatInterval;
  constructor(state, env) {
    this.state = state;
    this.env = env;
  }
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/send-event" && request.method === "POST") {
      return this.handleSendEvent(request);
    }
    if (url.pathname === "/events/stream") {
      return this.handleEventStream(request);
    }
    return new Response("Not found", { status: 404 });
  }
  /**
   * Handle NDJSON event stream connection
   */
  async handleEventStream(request) {
    const url = new URL(request.url);
    const workspaceIdsParam = url.searchParams.get("workspaceIds");
    if (workspaceIdsParam) {
      this.workspaceIds = workspaceIdsParam.split(",");
    }
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const connectionId = crypto.randomUUID();
    await this.sendEvent(writer, {
      type: "connection",
      status: "connected",
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    });
    const response = new Response(readable, {
      headers: {
        "Content-Type": "application/x-ndjson",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no"
      }
    });
    this.connections.set(connectionId, { response, writer });
    if (!this.heartbeatInterval) {
      this.heartbeatInterval = setInterval(() => {
        this.sendHeartbeat();
      }, 3e4);
    }
    request.signal.addEventListener("abort", () => {
      this.connections.delete(connectionId);
      writer.close().catch(() => {
      });
      if (this.connections.size === 0 && this.heartbeatInterval) {
        clearInterval(this.heartbeatInterval);
        this.heartbeatInterval = void 0;
      }
    });
    return response;
  }
  /**
   * Handle sending event to all connections
   */
  async handleSendEvent(request) {
    try {
      const event = await request.json();
      const promises = [];
      const deadConnections = [];
      for (const [id, connection] of this.connections) {
        promises.push(
          this.sendEvent(connection.writer, event).catch(() => {
            deadConnections.push(id);
          })
        );
      }
      await Promise.all(promises);
      for (const id of deadConnections) {
        this.connections.delete(id);
      }
      return new Response(JSON.stringify({ sent: this.connections.size }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      });
    } catch (error) {
      return new Response("Failed to send event", { status: 500 });
    }
  }
  /**
   * Send event to a writer
   */
  async sendEvent(writer, event) {
    const fullEvent = {
      ...event,
      id: event.id || `evt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
    };
    const line = JSON.stringify(fullEvent) + "\n";
    const encoder = new TextEncoder();
    await writer.write(encoder.encode(line));
  }
  /**
   * Send heartbeat to all connections
   */
  async sendHeartbeat() {
    const heartbeat = {
      type: "heartbeat",
      timestamp: (/* @__PURE__ */ new Date()).toISOString()
    };
    const deadConnections = [];
    for (const [id, connection] of this.connections) {
      try {
        await this.sendEvent(connection.writer, heartbeat);
      } catch {
        deadConnections.push(id);
      }
    }
    for (const id of deadConnections) {
      this.connections.delete(id);
    }
    if (this.connections.size === 0 && this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = void 0;
    }
  }
};
__name(EventStreamDurableObject, "EventStreamDurableObject");

// src/index.ts
var router = e();
router.get("/", (request, env) => {
  return new Response(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Cyrus Edge Proxy</title>
      <style>
        body { font-family: system-ui; max-width: 600px; margin: 50px auto; padding: 20px; }
        .endpoint { background: #f3f4f6; padding: 15px; margin: 10px 0; border-radius: 8px; }
        .method { font-weight: bold; color: #3b82f6; }
        a { color: #3b82f6; text-decoration: none; }
        a:hover { text-decoration: underline; }
      </style>
    </head>
    <body>
      <h1>\u{1F680} Cyrus Edge Proxy (Cloudflare Workers)</h1>
      <p>A distributed OAuth and webhook handler for Linear integration.</p>
      
      <h2>Available Endpoints:</h2>
      
      <div class="endpoint">
        <span class="method">GET</span> <a href="/oauth/authorize">/oauth/authorize</a>
        <p>Start OAuth flow with Linear</p>
      </div>
      
      <div class="endpoint">
        <span class="method">GET</span> /oauth/callback
        <p>OAuth callback endpoint (configure in Linear app)</p>
      </div>
      
      <div class="endpoint">
        <span class="method">POST</span> /webhook
        <p>Webhook receiver endpoint</p>
      </div>
      
      <div class="endpoint">
        <span class="method">GET</span> /events/stream
        <p>NDJSON event stream for edge workers</p>
      </div>
      
      <div class="endpoint">
        <span class="method">POST</span> /events/status
        <p>Status updates from edge workers</p>
      </div>
      
      <h2>Configuration:</h2>
      <p>Edge workers should connect to: <strong>${request.url.replace(/\/$/, "")}</strong></p>
    </body>
    </html>
  `, {
    status: 200,
    headers: { "Content-Type": "text/html" }
  });
});
router.get("/oauth/authorize", async (request, env) => {
  const oauthService = new OAuthService(env);
  return oauthService.handleAuthorize(request);
});
router.get("/oauth/callback", async (request, env) => {
  const oauthService = new OAuthService(env);
  return oauthService.handleCallback(request);
});
router.post("/webhook", async (request, env, ctx) => {
  const eventStreamer = new EventStreamer(env);
  const webhookReceiver = new WebhookReceiver(env, async (webhook) => {
    const workspaceId = webhook.organizationId;
    if (!workspaceId) {
      console.error("No organizationId in webhook, cannot route to edges");
      return;
    }
    const event = eventStreamer.transformWebhookToEvent(webhook);
    ctx.waitUntil(
      eventStreamer.broadcastToWorkspace(event, workspaceId).then((count) => console.log(`Webhook for workspace ${workspaceId} forwarded to ${count} edge worker(s)`)).catch((error) => console.error("Failed to broadcast webhook:", error))
    );
  });
  return webhookReceiver.handleWebhook(request);
});
router.get("/events/stream", async (request, env) => {
  const eventStreamer = new EventStreamer(env);
  return eventStreamer.handleStream(request);
});
router.post("/events/status", async (request, env) => {
  const eventStreamer = new EventStreamer(env);
  return eventStreamer.handleStatus(request);
});
router.all("*", () => {
  return new Response("Not found", { status: 404 });
});
var src_default = {
  async fetch(request, env, ctx) {
    try {
      return await router.handle(request, env, ctx);
    } catch (error) {
      console.error("Worker error:", error);
      return new Response("Internal server error", { status: 500 });
    }
  }
};

// ../../node_modules/.pnpm/wrangler@3.114.9_@cloudflare+workers-types@4.20250610.0/node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e2) {
      console.error("Failed to drain the unused request body.", e2);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// ../../node_modules/.pnpm/wrangler@3.114.9_@cloudflare+workers-types@4.20250610.0/node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e2) {
  return {
    name: e2?.name,
    message: e2?.message ?? String(e2),
    stack: e2?.stack,
    cause: e2?.cause === void 0 ? void 0 : reduceError(e2.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e2) {
    const error = reduceError(e2);
    return Response.json(error, {
      status: 500,
      headers: { "MF-Experimental-Error-Stack": "true" }
    });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-TVfM5D/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = src_default;

// ../../node_modules/.pnpm/wrangler@3.114.9_@cloudflare+workers-types@4.20250610.0/node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-TVfM5D/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof __Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
__name(__Facade_ScheduledController__, "__Facade_ScheduledController__");
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = (request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    };
    #dispatcher = (type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    };
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  EventStreamDurableObject,
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=index.js.map
