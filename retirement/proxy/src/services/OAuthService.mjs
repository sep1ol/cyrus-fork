/**
 * Standalone OAuth service for handling Linear authentication
 * Extracted from ExpressWebhookService to enable separation of concerns
 */
export class OAuthService {
  /**
   * @param {OAuthHelper} oauthHelper - OAuth helper utility
   * @param {Function} onAuthSuccess - Callback when authentication succeeds
   */
  constructor(oauthHelper, onAuthSuccess = null) {
    this.oauthHelper = oauthHelper
    this.onAuthSuccess = onAuthSuccess
  }

  /**
   * Register OAuth routes on an Express app
   * @param {Express} app - Express application instance
   */
  registerRoutes(app) {
    // Minimal public dashboard - no authentication status exposed
    app.get('/', async (req, res) => {
      try {
        const html = `
          <!DOCTYPE html>
          <html>
            <head>
              <title>Cyrus Proxy</title>
              <style>
                body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 40px; line-height: 1.6; }
                h1 { color: #333; border-bottom: 1px solid #eee; padding-bottom: 10px; }
                .info { margin: 20px 0; padding: 15px; border-radius: 5px; background-color: #f5f5f5; }
                .code { font-family: monospace; background-color: #282c34; color: #abb2bf; padding: 15px; border-radius: 3px; }
              </style>
            </head>
            <body>
              <h1>Cyrus Proxy</h1>
              <div class="info">
                <p>This is a Cyrus proxy server for routing Linear webhooks to edge workers.</p>
              </div>
            </body>
          </html>
        `
        
        res.send(html)
      } catch (error) {
        console.error('Error rendering dashboard:', error)
        res.status(500).send('Service unavailable')
      }
    })
    
    // OAuth authorization endpoint - redirects to Linear
    app.get('/oauth/authorize', (req, res) => {
      try {
        // Store the callback URL if provided (for edge workers)
        const { callback } = req.query
        
        // Pass callback URL in the OAuth state
        const state = callback ? Buffer.from(JSON.stringify({ callback })).toString('base64') : undefined
        const authUrl = this.oauthHelper.generateAuthorizationUrl(state)
        
        console.log(`Redirecting to Linear OAuth authorization URL`)
        res.redirect(authUrl)
      } catch (error) {
        console.error('Error generating OAuth URL:', error)
        res.status(500).send('Error setting up OAuth flow')
      }
    })
    
    // OAuth callback endpoint - handle the code from Linear
    app.get('/oauth/callback', async (req, res) => {
      try {
        const { code, state } = req.query
        
        if (!code) {
          return res.status(400).send('Authorization code missing')
        }
        
        console.log('Received OAuth callback')
        
        // Process the OAuth callback
        const tokenInfo = await this.oauthHelper.handleCallback(code, state)
        
        console.log('OAuth flow completed successfully')
        
        // Check if this is from an edge worker (has callback in state)
        let edgeCallback = null
        if (state) {
          try {
            const stateData = JSON.parse(Buffer.from(state, 'base64').toString())
            edgeCallback = stateData.callback
          } catch (e) {
            // Ignore parse errors
          }
        }
        
        // Store token info for edge setup
        this.latestTokenInfo = tokenInfo
        
        // Generate edge token (for now, just use a simple token)
        const edgeToken = `edge_${Date.now()}_${Math.random().toString(36).substring(7)}`
        
        // Store the edge token for later use
        this.latestEdgeToken = edgeToken
        
        // Call success callback if provided
        if (this.onAuthSuccess) {
          try {
            await this.onAuthSuccess(tokenInfo)
          } catch (callbackError) {
            console.error('Error in auth success callback:', callbackError)
          }
        }
        
        // Get workspace information
        let workspaceId = 'default'
        let workspaceName = 'Your Workspace'
        
        try {
          const workspaceInfo = await this.getWorkspaceInfo(tokenInfo.access_token)
          if (workspaceInfo) {
            workspaceId = workspaceInfo.id
            workspaceName = workspaceInfo.name
          }
        } catch (error) {
          console.error('Failed to retrieve workspace info:', error)
        }
        
        // If this is from an edge worker, redirect back with token
        if (edgeCallback) {
          const params = new URLSearchParams({
            token: tokenInfo.access_token,
            workspaceId: workspaceId,
            workspaceName: workspaceName
          })
          
          const redirectUrl = `${edgeCallback}?${params.toString()}`
          return res.redirect(redirectUrl)
        }
        
        
        // Build cyrus:// URL with parameters
        // Use HTTPS for all non-localhost URLs
        const host = req.get('host')
        const protocol = host.startsWith('localhost') || host.startsWith('127.0.0.1') ? req.protocol : 'https'
        
        const params = new URLSearchParams({
          proxyUrl: `${protocol}://${host}`,
          edgeToken: edgeToken,
          linearToken: tokenInfo.access_token,
          workspaceId: workspaceId,
          workspaceName: workspaceName,
          timestamp: Date.now().toString()
        })
        
        const cyrusUrl = `cyrus://setup?${params.toString()}`
        
        // HTML response that redirects to cyrus:// URL
        const html = `
          <!DOCTYPE html>
          <html>
            <head>
              <title>Authentication Successful</title>
              <meta http-equiv="refresh" content="0;url=${cyrusUrl}" />
              <style>
                body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 40px; line-height: 1.6; text-align: center; }
                .success { background-color: #d4edda; color: #155724; border: 1px solid #c3e6cb; padding: 20px; border-radius: 5px; }
                .manual { display: none; margin-top: 20px; padding: 20px; background: #f5f5f5; border-radius: 5px; }
                .code { font-family: monospace; background: #282c34; color: #abb2bf; padding: 10px; border-radius: 3px; word-break: break-all; }
              </style>
              <script>
                window.location.href = '${cyrusUrl}';
                setTimeout(() => {
                  document.getElementById('manual').style.display = 'block';
                }, 2000);
              </script>
            </head>
            <body>
              <div class="success">
                <h1>✅ Authentication Successful!</h1>
                <p>Opening Cyrus app...</p>
                <div id="manual" class="manual">
                  <p>If Cyrus doesn't open automatically:</p>
                  <a href="${cyrusUrl}" class="btn">Click here to open Cyrus</a>
                  <p style="margin-top: 15px;">Or manually configure your edge worker:</p>
                  <div class="code">
                    PROXY_URL=${req.protocol}://${req.get('host')}<br>
                    EDGE_TOKEN=${edgeToken}<br>
                    LINEAR_OAUTH_TOKEN=${tokenInfo}
                  </div>
                </div>
              </div>
            </body>
          </html>
        `
        
        res.status(200).send(html)
      } catch (error) {
        console.error('Error handling OAuth callback:', error)
        const errorHtml = `
          <!DOCTYPE html>
          <html>
            <head>
              <title>Authentication Error</title>
              <meta http-equiv="refresh" content="5;url=/" />
              <style>
                body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 40px; line-height: 1.6; text-align: center; }
                .error { background-color: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; padding: 20px; border-radius: 5px; }
              </style>
            </head>
            <body>
              <div class="error">
                <h1>⚠️ Authentication Error</h1>
                <p>An error occurred during authentication: ${error.message}</p>
                <p>Redirecting to dashboard in 5 seconds...</p>
                <p><a href="/">Click here if you are not redirected automatically</a></p>
              </div>
            </body>
          </html>
        `
        res.status(500).send(errorHtml)
      }
    })
    
    // OAuth reset endpoint - clear tokens and redirect to authorization
    app.get('/oauth/reset', async (req, res) => {
      try {
        console.log('Resetting OAuth tokens and starting new authorization flow')
        
        // Clear existing tokens
        await this.oauthHelper.clearTokens()
        
        // Redirect to the authorization endpoint
        res.redirect('/oauth/authorize')
      } catch (error) {
        console.error('Error resetting OAuth:', error)
        res.status(500).send('Error resetting OAuth: ' + error.message)
      }
    })
    
    // Remove public OAuth status endpoint - don't expose authentication state
    
    // Edge setup endpoint - provides configuration for edge workers
    app.get('/setup/start', async (req, res) => {
      try {
        // Check if we have valid OAuth tokens
        const hasValidToken = await this.oauthHelper.hasValidToken()
        if (!hasValidToken) {
          // Redirect to OAuth flow
          return res.redirect('/oauth/authorize')
        }
        
        // Get the current OAuth token
        const tokenInfo = await this.oauthHelper.getAccessToken()
        
        // Get workspace information
        let workspaceId = 'default'
        let workspaceName = 'Your Workspace'
        
        try {
          const workspaceInfo = await this.getWorkspaceInfo(tokenInfo)
          if (workspaceInfo) {
            workspaceId = workspaceInfo.id
            workspaceName = workspaceInfo.name
          }
        } catch (error) {
          console.error('Failed to retrieve workspace info for setup:', error)
        }
        
        // Generate edge token (for now, just use a simple token)
        const edgeToken = `edge_${Date.now()}_${Math.random().toString(36).substring(7)}`
        
        // Return setup page with configuration
        const html = `
          <!DOCTYPE html>
          <html>
            <head>
              <title>Edge Setup - Cyrus</title>
              <style>
                body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 40px; line-height: 1.6; }
                h1 { color: #333; }
                .config { background: #f5f5f5; padding: 20px; border-radius: 5px; margin: 20px 0; }
                .code { font-family: monospace; background: #282c34; color: #abb2bf; padding: 15px; border-radius: 3px; overflow-x: auto; }
                .btn { display: inline-block; padding: 10px 20px; background-color: #007bff; color: white; 
                       text-decoration: none; border-radius: 4px; font-weight: bold; }
              </style>
            </head>
            <body>
              <h1>Edge Worker Setup</h1>
              <p>Your Cyrus proxy is authenticated and ready for <strong>${workspaceName}</strong>.</p>
              <p>Set up your edge worker with this configuration:</p>
              
              <div class="config">
                <h3>1. Create .env.edge file:</h3>
                <div class="code">PROXY_URL=${req.protocol}://${req.get('host')}
EDGE_TOKEN=${edgeToken}
LINEAR_OAUTH_TOKEN=${tokenInfo}
LINEAR_WORKSPACE_ID=${workspaceId}
LINEAR_WORKSPACE_NAME=${workspaceName}
WORKSPACE_BASE_DIR=./workspaces
CLAUDE_PATH=/usr/local/bin/claude</div>
              </div>
              
              <div class="config">
                <h3>2. Start your edge worker:</h3>
                <div class="code">npm run edge</div>
              </div>
              
              <a class="btn" href="/">Back to Dashboard</a>
            </body>
          </html>
        `
        
        res.send(html)
      } catch (error) {
        console.error('Error in edge setup:', error)
        res.status(500).send('Setup error: ' + error.message)
      }
    })
  }
  
  /**
   * Get workspace information from Linear API
   * @param {string} accessToken - Linear access token
   * @returns {Promise<Object|null>} - Workspace info with id and name
   */
  async getWorkspaceInfo(accessToken) {
    try {
      const response = await fetch('https://api.linear.app/graphql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`
        },
        body: JSON.stringify({
          query: `
            query {
              viewer {
                id
                name
                organization {
                  id
                  name
                  urlKey
                }
              }
            }
          `
        })
      })
      
      if (!response.ok) {
        console.error('Failed to fetch workspace info:', response.status, response.statusText)
        return null
      }
      
      const data = await response.json()
      
      if (data.errors) {
        console.error('GraphQL errors:', data.errors)
        return null
      }
      
      if (data.data?.viewer?.organization) {
        const org = data.data.viewer.organization
        console.log(`Retrieved workspace info: ${org.name} (${org.id})`)
        return {
          id: org.id,
          name: org.name,
          urlKey: org.urlKey
        }
      }
      
      return null
    } catch (error) {
      console.error('Error fetching workspace info:', error)
      return null
    }
  }
}