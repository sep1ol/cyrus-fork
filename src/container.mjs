import { LinearClient } from '@linear/sdk';

import { env } from './config/index.mjs';
import { 
  LinearIssueService, 
  FSWorkspaceService, 
  NodeClaudeService, 
  ExpressWebhookService 
} from './adapters/index.mjs';
import { SessionManager } from './services/index.mjs';
import { FileSystem, ProcessManager, HttpServer, OAuthHelper } from './utils/index.mjs';

/**
 * Simple dependency injection container
 */
export class Container {
  constructor() {
    this.services = new Map();
  }
  
  /**
   * Register a service with the container
   * @param {string} name - Service name
   * @param {Function} factory - Factory function to create the service
   */
  register(name, factory) {
    this.services.set(name, {
      factory,
      instance: null
    });
  }
  
  /**
   * Get a service from the container
   * @param {string} name - Service name
   * @returns {any} - The service instance
   */
  get(name) {
    const service = this.services.get(name);
    
    if (!service) {
      throw new Error(`Service '${name}' not registered`);
    }
    
    if (!service.instance) {
      service.instance = service.factory(this);
    }
    
    return service.instance;
  }
}

/**
 * Create and configure the container
 * @returns {Container} - The configured container
 */
export function createContainer() {
  const container = new Container();
  
  // Register environment config
  container.register('config', () => env);
  
  // Register Linear client
  container.register('linearClient', (c) => {
    const config = c.get('config');
    const oauthHelper = c.get('oauthHelper');
    
    // Create a function to get the access token or fall back to API key
    const getAuthToken = async () => {
      // First try: Check if we have a valid OAuth token
      const hasValidOAuth = await oauthHelper.hasValidToken();
      
      if (hasValidOAuth) {
        try {
          // Validate token against the API (more reliable)
          const isApiValid = await oauthHelper.validateTokenWithApi();
          
          if (isApiValid) {
            const token = await oauthHelper.getAccessToken();
            console.log(`Successfully retrieved validated OAuth token: ****${token.slice(-4)}`);
            return { token, type: 'oauth' };
          } else {
            console.log('OAuth token is not valid with API, clearing token and falling back to API key');
            await oauthHelper.clearTokens(); // Clear the invalid token
          }
        } catch (oauthError) {
          console.error('Error validating OAuth token:', oauthError);
        }
      } else {
        console.log('No valid OAuth token available based on local check');
      }
      
      // Fall back to API key if OAuth fails or is not available
      if (config.linear.apiToken) {
        console.log('Using API key as fallback authentication');
        return { token: config.linear.apiToken, type: 'apiKey' };
      }
      
      // Last resort: try to use a personal access token if configured
      if (config.linear.personalAccessToken) {
        console.log('Using personal access token as last resort authentication');
        return { token: config.linear.personalAccessToken, type: 'personalAccessToken' };
      }
      
      throw new Error('No authentication method available (neither OAuth token nor API key)');
    };
    
    // Create a placeholder client (will be initialized with token later)
    let client = null;
    let authType = null;
    let lastInitTime = 0;
    
    // Return a proxy that initializes the client on first use
    return new Proxy({}, {
      get(target, prop, receiver) {
        // Intercept the function call
        return async function(...args) {
          const now = Date.now();
          
          // Initialize the client if needed or if it's been more than 5 minutes
          if (!client || (now - lastInitTime > 5 * 60 * 1000)) {
            console.log('Initializing Linear client with authentication...');
            
            try {
              // Get the auth info (token and type)
              const authInfo = await getAuthToken();
              authType = authInfo.type;
              
              console.log(`Using ${authInfo.type === 'oauth' ? 'OAuth Access Token' : 'API Key'} (masked): ****${authInfo.token.slice(-4)}`);
              
              // Create the client with the appropriate authentication
              if (authInfo.type === 'apiKey') {
                client = new LinearClient({
                  apiKey: authInfo.token
                });
              } else if (authInfo.type === 'personalAccessToken') {
                // Personal access tokens use the same parameter as OAuth access tokens
                client = new LinearClient({
                  accessToken: authInfo.token
                });
              } else { // OAuth token
                client = new LinearClient({
                  accessToken: authInfo.token
                });
              }
              
              lastInitTime = now;
              console.log('Linear client successfully initialized');
              
              // Test connection with a simple query
              try {
                console.log('Testing Linear API connection...');
                await client.viewer;
                console.log('✅ Linear API connection test successful');
              } catch (testError) {
                console.error('❌ Linear API connection test failed:', testError);
                // Reset client to force re-initialization on next call
                client = null;
                throw new Error('Linear API connection test failed');
              }
            } catch (error) {
              console.error('Failed to initialize Linear client:', error);
              throw new Error('Failed to initialize Linear client');
            }
          }
          
          // Get the method from the actual client
          const method = client[prop];
          
          if (typeof method !== 'function') {
            return method;
          }
          
          // Log the API call - condensed format
          console.log(`Linear API (${authType}): ${prop}${args.length > 0 ? ' with params' : ''}`);
          
          // Only log detailed arguments if DEBUG_LINEAR_API is true
          if (process.env.DEBUG_LINEAR_API === 'true' && args.length > 0) {
            console.log('Arguments:', JSON.stringify(args, null, 2));
          }
          
          try {
            // Call the method and return the result
            const result = await method.apply(client, args);
            // Minimal success logging
            return result;
          } catch (error) {
            // Simplified error logging
            const errorMessage = error.message || String(error);
            console.error(`Linear API error in ${prop}: ${errorMessage.substring(0, 150)}`);
            
            // If the error is an authentication error, reset the client to force re-initialization
            if (error.type === 'AuthenticationError') {
              console.log('Authentication error detected, will re-initialize client on next call');
              client = null;
            }
            
            // Detailed error logging only in debug mode
            if (process.env.DEBUG_LINEAR_API === 'true') {
              console.error('Full error details:', error);
            }
            
            throw error;
          }
        };
      }
    });
  });
  
  // Register session manager
  container.register('sessionManager', () => new SessionManager());
  
  // Register utilities
  container.register('fileSystem', () => new FileSystem());
  container.register('processManager', () => new ProcessManager());
  container.register('httpServer', () => new HttpServer());
  
  // Register OAuth helper
  container.register('oauthHelper', (c) => {
    const config = c.get('config');
    const fileSystem = c.get('fileSystem');
    
    return new OAuthHelper({
      clientId: config.linear.oauthClientId,
      clientSecret: config.linear.oauthClientSecret,
      redirectUri: config.linear.oauthRedirectUri,
      tokenStoragePath: config.workspace.baseDir
    }, fileSystem);
  });
  
  // Register workspace service
  container.register('workspaceService', (c) => {
    const config = c.get('config');
    const fileSystem = c.get('fileSystem');
    const processManager = c.get('processManager');
    return new FSWorkspaceService(
      config.workspace.baseDir,
      fileSystem,
      processManager
    );
  });
  
  // Register issue service - circular dependency is resolved at runtime
  container.register('issueService', (c) => {
    const config = c.get('config');
    const linearClient = c.get('linearClient');
    const sessionManager = c.get('sessionManager');
    
    // These will be lazy-loaded when needed to avoid circular dependencies
    const claudeService = () => c.get('claudeService');
    const workspaceService = () => c.get('workspaceService');
    
    return new LinearIssueService(
      linearClient, 
      config.linear.userId,
      sessionManager,
      {
        startSession: (...args) => claudeService().startSession(...args),
        sendComment: (...args) => claudeService().sendComment(...args)
      },
      {
        getWorkspaceForIssue: (...args) => workspaceService().getWorkspaceForIssue(...args),
        createWorkspace: (...args) => workspaceService().createWorkspace(...args)
      }
    );
  });
  
  // Register Claude service
  container.register('claudeService', (c) => {
    const config = c.get('config');
    const issueService = c.get('issueService');
    const fileSystem = c.get('fileSystem');
    const processManager = c.get('processManager');
    
    return new NodeClaudeService(
      config.claude.path,
      config.claude.promptTemplatePath,
      {
        createComment: (...args) => issueService.createComment(...args)
      },
      fileSystem,
      processManager
    );
  });
  
  // Register webhook service
  container.register('webhookService', (c) => {
    const config = c.get('config');
    const issueService = c.get('issueService');
    const httpServer = c.get('httpServer');
    const oauthHelper = c.get('oauthHelper');
    
    return new ExpressWebhookService(
      config.linear.webhookSecret,
      issueService,
      httpServer,
      oauthHelper
    );
  });
  
  return container;
}