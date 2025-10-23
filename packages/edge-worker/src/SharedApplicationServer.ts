import { randomUUID } from "node:crypto";
import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import { URL } from "node:url";
import { forward } from "@ngrok/ngrok";
import { DEFAULT_PROXY_URL, type OAuthCallbackHandler } from "cyrus-core";
import { Logger } from "./utils/Logger.js";

const logger = new Logger({ name: "SharedApplicationServer" });

/**
 * OAuth callback state for tracking flows
 */
export interface OAuthCallback {
	resolve: (credentials: {
		linearToken: string;
		linearWorkspaceId: string;
		linearWorkspaceName: string;
	}) => void;
	reject: (error: Error) => void;
	id: string;
}

/**
 * Approval callback state for tracking approval workflows
 */
export interface ApprovalCallback {
	resolve: (approved: boolean, feedback?: string) => void;
	reject: (error: Error) => void;
	sessionId: string;
	createdAt: number;
}

/**
 * Shared application server that handles both webhooks and OAuth callbacks on a single port
 * Consolidates functionality from SharedWebhookServer and CLI OAuth server
 */
export class SharedApplicationServer {
	private server: ReturnType<typeof createServer> | null = null;
	private webhookHandlers = new Map<
		string,
		{
			secret: string;
			handler: (body: string, signature: string, timestamp?: string) => boolean;
		}
	>();
	// Separate handlers for LinearWebhookClient that handle raw req/res
	private linearWebhookHandlers = new Map<
		string,
		(req: IncomingMessage, res: ServerResponse) => Promise<void>
	>();
	private oauthCallbacks = new Map<string, OAuthCallback>();
	private oauthCallbackHandler: OAuthCallbackHandler | null = null;
	private oauthStates = new Map<
		string,
		{ createdAt: number; redirectUri?: string }
	>();
	private pendingApprovals = new Map<string, ApprovalCallback>();
	private port: number;
	private host: string;
	private isListening = false;
	private ngrokListener: any = null;
	private ngrokAuthToken: string | null = null;
	private ngrokUrl: string | null = null;
	private proxyUrl: string;

	constructor(
		port: number = 3456,
		host: string = "localhost",
		ngrokAuthToken?: string,
		proxyUrl?: string,
	) {
		this.port = port;
		this.host = host;
		this.ngrokAuthToken = ngrokAuthToken || null;
		this.proxyUrl = proxyUrl || process.env.PROXY_URL || DEFAULT_PROXY_URL;
	}

	/**
	 * Start the shared application server
	 */
	async start(): Promise<void> {
		if (this.isListening) {
			return; // Already listening
		}

		return new Promise((resolve, reject) => {
			this.server = createServer((req, res) => {
				this.handleRequest(req, res);
			});

			this.server.listen(this.port, this.host, async () => {
				this.isListening = true;
				logger.info("Shared application server listening", {
					host: this.host,
					port: this.port,
					pid: process.pid,
				});

				// Start ngrok tunnel if auth token is provided and not external host
				const isExternalHost =
					process.env.CYRUS_HOST_EXTERNAL?.toLowerCase().trim() === "true";
				if (this.ngrokAuthToken && !isExternalHost) {
					try {
						await this.startNgrokTunnel();
					} catch (error) {
						logger.error("Failed to start ngrok tunnel", error);
						// Don't reject here - server can still work without ngrok
					}
				}

				resolve();
			});

			this.server.on("error", (error) => {
				this.isListening = false;
				reject(error);
			});
		});
	}

	/**
	 * Stop the shared application server
	 */
	async stop(): Promise<void> {
		// Reject all pending approvals before shutdown
		for (const [sessionId, approval] of this.pendingApprovals) {
			approval.reject(new Error("Server shutting down"));
			logger.info("Rejected pending approval due to shutdown", { sessionId });
		}
		this.pendingApprovals.clear();

		// Stop ngrok tunnel first
		if (this.ngrokListener) {
			try {
				await this.ngrokListener.close();
				this.ngrokListener = null;
				this.ngrokUrl = null;
				logger.info("Ngrok tunnel stopped");
			} catch (error) {
				logger.error("Failed to stop ngrok tunnel", error);
			}
		}

		if (this.server && this.isListening) {
			return new Promise((resolve) => {
				this.server!.close(() => {
					this.isListening = false;
					logger.info("Shared application server stopped");
					resolve();
				});
			});
		}
	}

	/**
	 * Get the port number the server is listening on
	 */
	getPort(): number {
		return this.port;
	}

	/**
	 * Get the base URL for the server (ngrok URL if available, otherwise local URL)
	 */
	getBaseUrl(): string {
		if (this.ngrokUrl) {
			return this.ngrokUrl;
		}
		return process.env.CYRUS_BASE_URL || `http://${this.host}:${this.port}`;
	}

	/**
	 * Start ngrok tunnel for the server
	 */
	private async startNgrokTunnel(): Promise<void> {
		if (!this.ngrokAuthToken) {
			return;
		}

		try {
			logger.info("Starting ngrok tunnel", { port: this.port });
			this.ngrokListener = await forward({
				addr: this.port,
				authtoken: this.ngrokAuthToken,
			});

			this.ngrokUrl = this.ngrokListener.url();
			logger.info("Ngrok tunnel active", { url: this.ngrokUrl });

			// Override CYRUS_BASE_URL with ngrok URL
			process.env.CYRUS_BASE_URL = this.ngrokUrl || undefined;
		} catch (error) {
			logger.error("Failed to start ngrok tunnel", error);
			throw error;
		}
	}

	/**
	 * Register a webhook handler for a specific token
	 * Supports two signatures:
	 * 1. For ndjson-client: (token, secret, handler)
	 * 2. For linear-webhook-client: (token, handler) where handler takes (req, res)
	 */
	registerWebhookHandler(
		token: string,
		secretOrHandler:
			| string
			| ((req: IncomingMessage, res: ServerResponse) => Promise<void>),
		handler?: (body: string, signature: string, timestamp?: string) => boolean,
	): void {
		if (typeof secretOrHandler === "string" && handler) {
			// ndjson-client style registration
			this.webhookHandlers.set(token, { secret: secretOrHandler, handler });
			logger.info("Registered webhook handler (proxy-style)", {
				tokenSuffix: token.slice(-4),
			});
		} else if (typeof secretOrHandler === "function") {
			// linear-webhook-client style registration
			this.linearWebhookHandlers.set(token, secretOrHandler);
			logger.info("Registered webhook handler (direct-style)", {
				tokenSuffix: token.slice(-4),
			});
		} else {
			throw new Error("Invalid webhook handler registration parameters");
		}
	}

	/**
	 * Unregister a webhook handler
	 */
	unregisterWebhookHandler(token: string): void {
		const hadProxyHandler = this.webhookHandlers.delete(token);
		const hadDirectHandler = this.linearWebhookHandlers.delete(token);
		if (hadProxyHandler || hadDirectHandler) {
			logger.info("Unregistered webhook handler", {
				tokenSuffix: token.slice(-4),
			});
		}
	}

	/**
	 * Register an OAuth callback handler
	 */
	registerOAuthCallbackHandler(handler: OAuthCallbackHandler): void {
		this.oauthCallbackHandler = handler;
		logger.info("Registered OAuth callback handler");
	}

	/**
	 * Start OAuth flow and return promise that resolves when callback is received
	 */
	async startOAuthFlow(proxyUrl: string): Promise<{
		linearToken: string;
		linearWorkspaceId: string;
		linearWorkspaceName: string;
	}> {
		return new Promise<{
			linearToken: string;
			linearWorkspaceId: string;
			linearWorkspaceName: string;
		}>((resolve, reject) => {
			// Generate unique ID for this flow
			const flowId = Date.now().toString();

			// Store callback for this flow
			this.oauthCallbacks.set(flowId, { resolve, reject, id: flowId });

			// Check if we should use direct Linear OAuth (when self-hosting)
			const isExternalHost =
				process.env.CYRUS_HOST_EXTERNAL?.toLowerCase().trim() === "true";
			const useDirectOAuth = isExternalHost && process.env.LINEAR_CLIENT_ID;

			const callbackBaseUrl = this.getBaseUrl();
			let authUrl: string;

			if (useDirectOAuth) {
				// Use local OAuth authorize endpoint
				authUrl = `${callbackBaseUrl}/oauth/authorize?callback=${encodeURIComponent(`${callbackBaseUrl}/callback`)}`;
				logger.info("Using direct OAuth mode", {
					mode: "direct",
					externalHost: true,
				});
			} else {
				// Use proxy OAuth endpoint
				authUrl = `${proxyUrl}/oauth/authorize?callback=${encodeURIComponent(`${callbackBaseUrl}/callback`)}`;
			}

			logger.info("Opening browser to authorize with Linear", { authUrl });

			// Timeout after 5 minutes
			setTimeout(
				() => {
					if (this.oauthCallbacks.has(flowId)) {
						this.oauthCallbacks.delete(flowId);
						reject(new Error("OAuth timeout"));
					}
				},
				5 * 60 * 1000,
			);
		});
	}

	/**
	 * Get the public URL (ngrok URL if available, otherwise base URL)
	 */
	getPublicUrl(): string {
		// Use ngrok URL if available
		if (this.ngrokUrl) {
			return this.ngrokUrl;
		}
		// If CYRUS_BASE_URL is set (could be from external proxy), use that
		if (process.env.CYRUS_BASE_URL) {
			return process.env.CYRUS_BASE_URL;
		}
		// Default to local URL
		return `http://${this.host}:${this.port}`;
	}

	/**
	 * Get the webhook URL for registration with proxy
	 */
	getWebhookUrl(): string {
		return `${this.getPublicUrl()}/webhook`;
	}

	/**
	 * Get the OAuth callback URL for registration with proxy
	 */
	getOAuthCallbackUrl(): string {
		return `http://${this.host}:${this.port}/callback`;
	}

	/**
	 * Handle incoming requests (both webhooks and OAuth callbacks)
	 */
	private async handleRequest(
		req: IncomingMessage,
		res: ServerResponse,
	): Promise<void> {
		try {
			const url = new URL(req.url!, `http://${this.host}:${this.port}`);

			if (url.pathname === "/webhook") {
				await this.handleWebhookRequest(req, res);
			} else if (url.pathname === "/callback") {
				await this.handleOAuthCallback(req, res, url);
			} else if (url.pathname === "/oauth/authorize") {
				await this.handleOAuthAuthorize(req, res, url);
			} else if (url.pathname === "/approval") {
				await this.handleApprovalRequest(req, res, url);
			} else {
				res.writeHead(404, { "Content-Type": "text/plain" });
				res.end("Not Found");
			}
		} catch (error) {
			logger.error("Request handling error", error, { url: req.url });
			res.writeHead(500, { "Content-Type": "text/plain" });
			res.end("Internal Server Error");
		}
	}

	/**
	 * Handle incoming webhook requests
	 */
	private async handleWebhookRequest(
		req: IncomingMessage,
		res: ServerResponse,
	): Promise<void> {
		try {
			logger.info("Incoming webhook request", {
				method: req.method,
				url: req.url,
			});

			if (req.method !== "POST") {
				logger.warn("Rejected non-POST request", { method: req.method });
				res.writeHead(405, { "Content-Type": "text/plain" });
				res.end("Method Not Allowed");
				return;
			}

			// Check if this is a direct Linear webhook (has linear-signature header)
			const linearSignature = req.headers["linear-signature"] as string;
			const isDirectWebhook = !!linearSignature;

			if (isDirectWebhook && this.linearWebhookHandlers.size > 0) {
				// For direct Linear webhooks, pass the raw request to the handler
				// The LinearWebhookClient will handle its own signature verification
				logger.info("Direct Linear webhook received", {
					handlerCount: this.linearWebhookHandlers.size,
				});

				// Try each direct handler
				for (const [token, handler] of this.linearWebhookHandlers) {
					try {
						// The handler will manage the response
						await handler(req, res);
						logger.info("Direct webhook delivered", {
							tokenSuffix: token.slice(-4),
						});
						return;
					} catch (error) {
						logger.error("Error in direct webhook handler", error, {
							tokenSuffix: token.slice(-4),
						});
					}
				}

				// No direct handler could process it
				logger.error("Direct webhook processing failed for all handlers", {
					handlerCount: this.linearWebhookHandlers.size,
				});
				res.writeHead(401, { "Content-Type": "text/plain" });
				res.end("Unauthorized");
				return;
			}

			// Otherwise, handle as proxy-style webhook
			// Read request body
			let body = "";
			req.on("data", (chunk) => {
				body += chunk.toString();
			});

			req.on("end", () => {
				try {
					// For proxy-style webhooks, we need the signature header
					const signature = req.headers["x-webhook-signature"] as string;
					const timestamp = req.headers["x-webhook-timestamp"] as string;

					logger.info("Proxy webhook received", {
						bodySize: body.length,
						handlerCount: this.webhookHandlers.size,
					});

					if (!signature) {
						logger.warn("Webhook rejected: Missing signature header");
						res.writeHead(400, { "Content-Type": "text/plain" });
						res.end("Missing signature");
						return;
					}

					// Try each registered handler until one verifies the signature
					let handlerAttempts = 0;
					for (const [token, { handler }] of this.webhookHandlers) {
						handlerAttempts++;
						try {
							if (handler(body, signature, timestamp)) {
								// Handler verified signature and processed webhook
								res.writeHead(200, { "Content-Type": "text/plain" });
								res.end("OK");
								logger.info("Webhook delivered", {
									tokenSuffix: token.slice(-4),
									attempt: handlerAttempts,
									totalHandlers: this.webhookHandlers.size,
								});
								return;
							}
						} catch (error) {
							logger.error("Error in webhook handler", error, {
								tokenSuffix: token.slice(-4),
							});
						}
					}

					// No handler could verify the signature
					logger.error(
						"Webhook signature verification failed for all handlers",
						{
							handlerCount: this.webhookHandlers.size,
						},
					);
					res.writeHead(401, { "Content-Type": "text/plain" });
					res.end("Unauthorized");
				} catch (error) {
					logger.error("Error processing webhook", error);
					res.writeHead(400, { "Content-Type": "text/plain" });
					res.end("Bad Request");
				}
			});

			req.on("error", (error) => {
				logger.error("Request error", error);
				res.writeHead(500, { "Content-Type": "text/plain" });
				res.end("Internal Server Error");
			});
		} catch (error) {
			logger.error("Webhook request error", error);
			res.writeHead(500, { "Content-Type": "text/plain" });
			res.end("Internal Server Error");
		}
	}

	/**
	 * Handle OAuth callback requests
	 */
	private async handleOAuthCallback(
		_req: IncomingMessage,
		res: ServerResponse,
		url: URL,
	): Promise<void> {
		try {
			const code = url.searchParams.get("code");
			const state = url.searchParams.get("state");

			// Check if this is a direct Linear callback (has code and state)
			const isExternalHost =
				process.env.CYRUS_HOST_EXTERNAL?.toLowerCase().trim() === "true";
			const isDirectWebhooks =
				process.env.LINEAR_DIRECT_WEBHOOKS?.toLowerCase().trim() === "true";

			// Handle direct callback if both external host and direct webhooks are enabled
			if (code && state && isExternalHost && isDirectWebhooks) {
				await this.handleDirectLinearCallback(_req, res, url);
				return;
			}

			// Otherwise handle as proxy callback
			const token = url.searchParams.get("token");
			const workspaceId = url.searchParams.get("workspaceId");
			const workspaceName = url.searchParams.get("workspaceName");

			if (token && workspaceId && workspaceName) {
				// Success! Return the Linear credentials
				const linearCredentials = {
					linearToken: token,
					linearWorkspaceId: workspaceId,
					linearWorkspaceName: workspaceName,
				};

				// Send success response
				res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
				res.end(`
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="UTF-8">
              <title>Authorization Successful</title>
            </head>
            <body style="font-family: system-ui; max-width: 600px; margin: 50px auto; padding: 20px;">
              <h1>✅ Authorization Successful!</h1>
              <p>You can close this window and return to the terminal.</p>
              <p>Your Linear workspace <strong>${workspaceName}</strong> has been connected.</p>
              <p style="margin-top: 30px;">
                <a href="${this.proxyUrl}/oauth/authorize?callback=${process.env.CYRUS_BASE_URL || `http://${this.host}:${this.port}`}/callback"
                   style="padding: 10px 20px; background: #5E6AD2; color: white; text-decoration: none; border-radius: 5px;">
                  Connect Another Workspace
                </a>
              </p>
              <script>setTimeout(() => window.close(), 10000)</script>
            </body>
          </html>
        `);

				logger.info("OAuth callback received", {
					workspaceId,
					workspaceName,
				});

				// Resolve any waiting promises
				if (this.oauthCallbacks.size > 0) {
					const callback = this.oauthCallbacks.values().next().value;
					if (callback) {
						callback.resolve(linearCredentials);
						this.oauthCallbacks.delete(callback.id);
					}
				}

				// Call the registered OAuth callback handler
				if (this.oauthCallbackHandler) {
					try {
						await this.oauthCallbackHandler(token, workspaceId, workspaceName);
					} catch (error) {
						logger.error("Error in OAuth callback handler", error);
					}
				}
			} else {
				res.writeHead(400, { "Content-Type": "text/html" });
				res.end("<h1>Error: No token received</h1>");

				// Reject any waiting promises
				for (const [id, callback] of this.oauthCallbacks) {
					callback.reject(new Error("No token received"));
					this.oauthCallbacks.delete(id);
				}
			}
		} catch (error) {
			logger.error("OAuth callback error", error);
			res.writeHead(500, { "Content-Type": "text/plain" });
			res.end("Internal Server Error");
		}
	}

	/**
	 * Handle OAuth authorization requests for direct Linear OAuth
	 */
	private async handleOAuthAuthorize(
		_req: IncomingMessage,
		res: ServerResponse,
		_url: URL,
	): Promise<void> {
		try {
			// Check if we're in external host mode with direct webhooks
			const isExternalHost =
				process.env.CYRUS_HOST_EXTERNAL?.toLowerCase().trim() === "true";
			const isDirectWebhooks =
				process.env.LINEAR_DIRECT_WEBHOOKS?.toLowerCase().trim() === "true";

			// Only handle OAuth locally if both external host AND direct webhooks are enabled
			if (!isExternalHost || !isDirectWebhooks) {
				// Redirect to proxy OAuth endpoint
				const callbackBaseUrl = this.getBaseUrl();
				const proxyAuthUrl = `${this.proxyUrl}/oauth/authorize?callback=${callbackBaseUrl}/callback`;
				res.writeHead(302, { Location: proxyAuthUrl });
				res.end();
				return;
			}

			// Check for LINEAR_CLIENT_ID
			const clientId = process.env.LINEAR_CLIENT_ID;
			if (!clientId) {
				res.writeHead(400, { "Content-Type": "text/plain" });
				res.end(
					"LINEAR_CLIENT_ID environment variable is required for direct OAuth",
				);
				return;
			}

			// Generate state for CSRF protection
			const state = randomUUID();

			// Store state with expiration (10 minutes)
			this.oauthStates.set(state, {
				createdAt: Date.now(),
				redirectUri: `${this.getBaseUrl()}/callback`,
			});

			// Clean up expired states (older than 10 minutes)
			const now = Date.now();
			for (const [stateKey, stateData] of this.oauthStates) {
				if (now - stateData.createdAt > 10 * 60 * 1000) {
					this.oauthStates.delete(stateKey);
				}
			}

			// Build Linear OAuth URL
			const authUrl = new URL("https://linear.app/oauth/authorize");
			authUrl.searchParams.set("client_id", clientId);
			authUrl.searchParams.set("redirect_uri", `${this.getBaseUrl()}/callback`);
			authUrl.searchParams.set("response_type", "code");
			authUrl.searchParams.set("state", state);
			authUrl.searchParams.set(
				"scope",
				"read,write,app:assignable,app:mentionable",
			);
			authUrl.searchParams.set("actor", "app");
			authUrl.searchParams.set("prompt", "consent");

			logger.info("Redirecting to Linear OAuth", {
				authUrl: authUrl.toString(),
			});

			// Redirect to Linear OAuth
			res.writeHead(302, { Location: authUrl.toString() });
			res.end();
		} catch (error) {
			logger.error("OAuth authorize error", error);
			res.writeHead(500, { "Content-Type": "text/plain" });
			res.end("Internal Server Error");
		}
	}

	/**
	 * Handle direct Linear OAuth callback (exchange code for token)
	 */
	private async handleDirectLinearCallback(
		_req: IncomingMessage,
		res: ServerResponse,
		url: URL,
	): Promise<void> {
		try {
			const code = url.searchParams.get("code");
			const state = url.searchParams.get("state");

			if (!code || !state) {
				res.writeHead(400, { "Content-Type": "text/plain" });
				res.end("Missing code or state parameter");
				return;
			}

			// Validate state
			const stateData = this.oauthStates.get(state);
			if (!stateData) {
				res.writeHead(400, { "Content-Type": "text/plain" });
				res.end("Invalid or expired state");
				return;
			}

			// Delete state after use
			this.oauthStates.delete(state);

			// Exchange code for token
			const tokenResponse = await this.exchangeCodeForToken(code);

			// Get workspace info using the token
			const workspaceInfo = await this.getWorkspaceInfo(
				tokenResponse.access_token,
			);

			// Success! Return the Linear credentials
			const linearCredentials = {
				linearToken: tokenResponse.access_token,
				linearWorkspaceId: workspaceInfo.organization.id,
				linearWorkspaceName: workspaceInfo.organization.name,
			};

			// Send success response
			res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
			res.end(`
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="UTF-8">
            <title>Authorization Successful</title>
          </head>
          <body style="font-family: system-ui; max-width: 600px; margin: 50px auto; padding: 20px;">
            <h1>✅ Authorization Successful!</h1>
            <p>You can close this window and return to the terminal.</p>
            <p>Your Linear workspace <strong>${workspaceInfo.organization.name}</strong> has been connected.</p>
            <p style="margin-top: 30px;">
              <a href="${this.getBaseUrl()}/oauth/authorize" 
                 style="padding: 10px 20px; background: #5E6AD2; color: white; text-decoration: none; border-radius: 5px;">
                Connect Another Workspace
              </a>
            </p>
            <script>setTimeout(() => window.close(), 10000)</script>
          </body>
        </html>
      `);

			logger.info("Direct OAuth callback received", {
				workspaceId: workspaceInfo.organization.id,
				workspaceName: workspaceInfo.organization.name,
			});

			// Resolve any waiting promises
			if (this.oauthCallbacks.size > 0) {
				const callback = this.oauthCallbacks.values().next().value;
				if (callback) {
					callback.resolve(linearCredentials);
					this.oauthCallbacks.delete(callback.id);
				}
			}

			// Call the registered OAuth callback handler
			if (this.oauthCallbackHandler) {
				try {
					await this.oauthCallbackHandler(
						tokenResponse.access_token,
						workspaceInfo.organization.id,
						workspaceInfo.organization.name,
					);
				} catch (error) {
					logger.error("Error in OAuth callback handler", error);
				}
			}
		} catch (error) {
			logger.error("Direct Linear callback error", error);
			res.writeHead(500, { "Content-Type": "text/plain" });
			res.end(`OAuth failed: ${(error as Error).message}`);

			// Reject any waiting promises
			for (const [id, callback] of this.oauthCallbacks) {
				callback.reject(error as Error);
				this.oauthCallbacks.delete(id);
			}
		}
	}

	/**
	 * Exchange authorization code for access token
	 */
	private async exchangeCodeForToken(code: string): Promise<any> {
		const clientId = process.env.LINEAR_CLIENT_ID;
		const clientSecret = process.env.LINEAR_CLIENT_SECRET;

		if (!clientId || !clientSecret) {
			throw new Error("LINEAR_CLIENT_ID and LINEAR_CLIENT_SECRET are required");
		}

		const response = await fetch("https://api.linear.app/oauth/token", {
			method: "POST",
			headers: {
				"Content-Type": "application/x-www-form-urlencoded",
			},
			body: new URLSearchParams({
				grant_type: "authorization_code",
				client_id: clientId,
				client_secret: clientSecret,
				redirect_uri: `${this.getBaseUrl()}/callback`,
				code: code,
			}),
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
	private async getWorkspaceInfo(accessToken: string): Promise<any> {
		const response = await fetch("https://api.linear.app/graphql", {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				Authorization: `Bearer ${accessToken}`,
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
        `,
			}),
		});

		if (!response.ok) {
			throw new Error("Failed to get workspace info");
		}

		const data = (await response.json()) as any;

		if (data.errors) {
			throw new Error(`GraphQL errors: ${JSON.stringify(data.errors)}`);
		}

		return {
			userId: data.data.viewer.id,
			userEmail: data.data.viewer.email,
			organization: data.data.viewer.organization,
		};
	}

	/**
	 * Escape HTML special characters to prevent XSS attacks
	 */
	private escapeHtml(unsafe: string): string {
		return unsafe
			.replace(/&/g, "&amp;")
			.replace(/</g, "&lt;")
			.replace(/>/g, "&gt;")
			.replace(/"/g, "&quot;")
			.replace(/'/g, "&#039;");
	}

	/**
	 * Register an approval request and get approval URL
	 */
	registerApprovalRequest(sessionId: string): {
		promise: Promise<{ approved: boolean; feedback?: string }>;
		url: string;
	} {
		// Clean up expired approvals (older than 30 minutes)
		const now = Date.now();
		for (const [key, approval] of this.pendingApprovals) {
			if (now - approval.createdAt > 30 * 60 * 1000) {
				approval.reject(new Error("Approval request expired"));
				this.pendingApprovals.delete(key);
			}
		}

		// Create promise for this approval request
		const promise = new Promise<{ approved: boolean; feedback?: string }>(
			(resolve, reject) => {
				this.pendingApprovals.set(sessionId, {
					resolve: (approved, feedback) => resolve({ approved, feedback }),
					reject,
					sessionId,
					createdAt: now,
				});
			},
		);

		// Generate approval URL
		const url = `${this.getBaseUrl()}/approval?session=${encodeURIComponent(sessionId)}`;

		logger.info("Registered approval request", { sessionId, url });

		return { promise, url };
	}

	/**
	 * Handle approval requests
	 */
	private async handleApprovalRequest(
		_req: IncomingMessage,
		res: ServerResponse,
		url: URL,
	): Promise<void> {
		try {
			const sessionId = url.searchParams.get("session");
			const action = url.searchParams.get("action"); // "approve" or "reject"
			const feedback = url.searchParams.get("feedback");

			if (!sessionId) {
				res.writeHead(400, { "Content-Type": "text/html; charset=utf-8" });
				res.end(`
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="UTF-8">
              <title>Invalid Request</title>
            </head>
            <body style="font-family: system-ui; max-width: 600px; margin: 50px auto; padding: 20px;">
              <h1>❌ Invalid Request</h1>
              <p>Missing session parameter.</p>
            </body>
          </html>
        `);
				return;
			}

			const approval = this.pendingApprovals.get(sessionId);

			// If no action specified, show approval UI
			if (!action) {
				const approvalExists = !!approval;
				res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
				res.end(`
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="UTF-8">
              <title>Approval Required</title>
              <style>
                body {
                  font-family: system-ui, -apple-system, sans-serif;
                  max-width: 700px;
                  margin: 50px auto;
                  padding: 20px;
                  background: #f5f5f5;
                }
                .card {
                  background: white;
                  padding: 30px;
                  border-radius: 8px;
                  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
                }
                h1 {
                  margin-top: 0;
                  color: #333;
                }
                .status {
                  padding: 15px;
                  border-radius: 5px;
                  margin: 20px 0;
                }
                .status.pending {
                  background: #fff3cd;
                  border-left: 4px solid #ffc107;
                }
                .status.resolved {
                  background: #d4edda;
                  border-left: 4px solid #28a745;
                }
                .buttons {
                  display: flex;
                  gap: 10px;
                  margin-top: 20px;
                }
                button {
                  padding: 12px 24px;
                  font-size: 16px;
                  border: none;
                  border-radius: 5px;
                  cursor: pointer;
                  transition: opacity 0.2s;
                }
                button:hover:not(:disabled) {
                  opacity: 0.9;
                }
                button:disabled {
                  opacity: 0.5;
                  cursor: not-allowed;
                }
                .approve-btn {
                  background: #28a745;
                  color: white;
                  flex: 1;
                }
                .reject-btn {
                  background: #dc3545;
                  color: white;
                  flex: 1;
                }
                textarea {
                  width: 100%;
                  padding: 10px;
                  border: 1px solid #ddd;
                  border-radius: 5px;
                  font-family: inherit;
                  margin-top: 10px;
                  resize: vertical;
                }
                label {
                  display: block;
                  margin-top: 15px;
                  color: #666;
                  font-size: 14px;
                }
              </style>
            </head>
            <body>
              <div class="card">
                ${
									approvalExists
										? `
                  <h1>🔔 Approval Required</h1>
                  <div class="status pending">
                    <strong>Status:</strong> Waiting for your decision
                  </div>
                  <p>The agent is requesting your approval to proceed with the next step of the workflow.</p>

                  <label for="feedback">Optional feedback or instructions:</label>
                  <textarea id="feedback" rows="3" placeholder="Enter any feedback or additional instructions..."></textarea>

                  <div class="buttons">
                    <button class="approve-btn" onclick="handleAction('approve')">
                      ✅ Approve
                    </button>
                    <button class="reject-btn" onclick="handleAction('reject')">
                      ❌ Reject
                    </button>
                  </div>
                `
										: `
                  <h1>ℹ️ Approval Already Processed</h1>
                  <div class="status resolved">
                    This approval request has already been processed or has expired.
                  </div>
                  <p>You can close this window.</p>
                `
								}
              </div>

              <script>
                async function handleAction(action) {
                  const feedback = document.getElementById('feedback')?.value || '';
                  const url = new URL(window.location.href);
                  url.searchParams.set('action', action);
                  if (feedback) {
                    url.searchParams.set('feedback', feedback);
                  }

                  // Disable buttons
                  document.querySelectorAll('button').forEach(btn => btn.disabled = true);

                  // Navigate to confirmation
                  window.location.href = url.toString();
                }
              </script>
            </body>
          </html>
        `);
				return;
			}

			// Handle approval/rejection
			if (!approval) {
				res.writeHead(410, { "Content-Type": "text/html; charset=utf-8" });
				res.end(`
          <!DOCTYPE html>
          <html>
            <head>
              <meta charset="UTF-8">
              <title>Approval Expired</title>
            </head>
            <body style="font-family: system-ui; max-width: 600px; margin: 50px auto; padding: 20px;">
              <h1>⏰ Approval Expired</h1>
              <p>This approval request has already been processed or has expired.</p>
              <p>You can close this window.</p>
            </body>
          </html>
        `);
				return;
			}

			// Process the approval/rejection
			const approved = action === "approve";
			approval.resolve(approved, feedback || undefined);
			this.pendingApprovals.delete(sessionId);

			logger.info(`Approval ${approved ? "granted" : "rejected"}`, {
				sessionId,
				approved,
				hasFeedback: !!feedback,
			});

			// Send success response
			res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
			res.end(`
        <!DOCTYPE html>
        <html>
          <head>
            <meta charset="UTF-8">
            <title>Approval ${approved ? "Granted" : "Rejected"}</title>
          </head>
          <body style="font-family: system-ui; max-width: 600px; margin: 50px auto; padding: 20px;">
            <h1>${approved ? "✅ Approval Granted" : "❌ Approval Rejected"}</h1>
            <p>Your decision has been recorded. The agent will ${approved ? "proceed with the next step" : "stop the current workflow"}.</p>
            ${feedback ? `<p><strong>Feedback provided:</strong> ${this.escapeHtml(feedback)}</p>` : ""}
            <p style="margin-top: 30px; color: #666;">You can close this window and return to Linear.</p>
            <script>setTimeout(() => window.close(), 5000)</script>
          </body>
        </html>
      `);
		} catch (error) {
			logger.error("Approval request error", error);
			res.writeHead(500, { "Content-Type": "text/plain" });
			res.end("Internal Server Error");
		}
	}
}
