import {
	createServer,
	type IncomingMessage,
	type ServerResponse,
} from "node:http";
import { Logger } from "./utils/Logger.js";

const logger = new Logger({ name: "SharedWebhookServer" });

/**
 * Shared webhook server that can handle multiple Linear tokens
 * Each token has its own webhook secret for signature verification
 */
export class SharedWebhookServer {
	private server: ReturnType<typeof createServer> | null = null;
	private webhookHandlers = new Map<
		string,
		{
			secret: string;
			handler: (body: string, signature: string, timestamp?: string) => boolean;
		}
	>();
	private port: number;
	private host: string;
	private isListening = false;

	constructor(port: number = 3456, host: string = "localhost") {
		this.port = port;
		this.host = host;
	}

	/**
	 * Start the shared webhook server
	 */
	async start(): Promise<void> {
		if (this.isListening) {
			return; // Already listening
		}

		return new Promise((resolve, reject) => {
			this.server = createServer((req, res) => {
				this.handleWebhookRequest(req, res);
			});

			this.server.listen(this.port, this.host, () => {
				this.isListening = true;
				logger.info("Shared webhook server listening", {
					host: this.host,
					port: this.port,
					pid: process.pid,
				});
				resolve();
			});

			this.server.on("error", (error) => {
				this.isListening = false;
				reject(error);
			});
		});
	}

	/**
	 * Stop the shared webhook server
	 */
	async stop(): Promise<void> {
		if (this.server && this.isListening) {
			return new Promise((resolve) => {
				this.server!.close(() => {
					this.isListening = false;
					logger.info("Shared webhook server stopped");
					resolve();
				});
			});
		}
	}

	/**
	 * Register a webhook handler for a specific token
	 */
	registerWebhookHandler(
		token: string,
		secret: string,
		handler: (body: string, signature: string, timestamp?: string) => boolean,
	): void {
		this.webhookHandlers.set(token, { secret, handler });
		logger.info("Registered webhook handler", {
			tokenSuffix: token.slice(-4),
		});
	}

	/**
	 * Unregister a webhook handler
	 */
	unregisterWebhookHandler(token: string): void {
		this.webhookHandlers.delete(token);
		logger.info("Unregistered webhook handler", {
			tokenSuffix: token.slice(-4),
		});
	}

	/**
	 * Get the webhook URL for registration with proxy
	 */
	getWebhookUrl(): string {
		return `http://${this.host}:${this.port}/webhook`;
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

			if (req.url !== "/webhook") {
				logger.warn("Rejected request to wrong URL", { url: req.url });
				res.writeHead(404, { "Content-Type": "text/plain" });
				res.end("Not Found");
				return;
			}

			// Read request body with size limit (10MB)
			const MAX_BODY_SIZE = 10 * 1024 * 1024; // 10MB
			let body = "";
			let bodySize = 0;
			let sizeExceeded = false;

			req.on("data", (chunk) => {
				bodySize += chunk.length;

				// Check if size limit exceeded
				if (bodySize > MAX_BODY_SIZE) {
					if (!sizeExceeded) {
						sizeExceeded = true;
						logger.error("Webhook rejected: Payload too large", {
							bodySize,
							maxSize: MAX_BODY_SIZE,
						});
						res.writeHead(413, { "Content-Type": "text/plain" });
						res.end("Payload Too Large");
						req.destroy(); // Abort the request
					}
					return;
				}

				body += chunk.toString();
			});

			req.on("end", () => {
				// Skip processing if size was exceeded
				if (sizeExceeded) {
					return;
				}

				try {
					const signature = req.headers["x-webhook-signature"] as string;
					const timestamp = req.headers["x-webhook-timestamp"] as string;

					logger.info("Webhook received", {
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
}
