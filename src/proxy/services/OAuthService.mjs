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
    // Dashboard showing authentication status
    app.get('/', async (req, res) => {
      try {
        const authStatus = await this.oauthHelper.hasValidToken()
        
        let html = `
          <!DOCTYPE html>
          <html>
            <head>
              <title>Cyrus Proxy Dashboard</title>
              <style>
                body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 40px; line-height: 1.6; }
                h1 { color: #333; border-bottom: 1px solid #eee; padding-bottom: 10px; }
                .status { margin: 20px 0; padding: 15px; border-radius: 5px; }
                .success { background-color: #d4edda; color: #155724; border: 1px solid #c3e6cb; }
                .error { background-color: #f8d7da; color: #721c24; border: 1px solid #f5c6cb; }
                .warning { background-color: #fff3cd; color: #856404; border: 1px solid #ffeeba; }
                .action { margin: 20px 0; }
                .btn { display: inline-block; padding: 10px 20px; background-color: #007bff; color: white; 
                       text-decoration: none; border-radius: 4px; font-weight: bold; }
                .btn-reset { background-color: #6c757d; }
                .code { font-family: monospace; background-color: #f5f5f5; padding: 10px; border-radius: 3px; }
              </style>
            </head>
            <body>
              <h1>Cyrus Proxy Dashboard</h1>
        `
        
        // Authentication status box
        if (authStatus) {
          html += `
            <div class="status success">
              <h2>✅ Authentication Status: Authenticated</h2>
              <p>Your Cyrus proxy is successfully authenticated with Linear.</p>
            </div>
            <div class="action">
              <a class="btn" href="/health">Check Health</a>
              <a class="btn btn-reset" href="/oauth/reset">Reset Authentication</a>
            </div>
          `
        } else {
          html += `
            <div class="status error">
              <h2>❌ Authentication Status: Not Authenticated</h2>
              <p>You need to authenticate with Linear to use Cyrus.</p>
            </div>
            <div class="action">
              <a class="btn" href="/oauth/authorize">Authenticate with Linear</a>
            </div>
          `
        }
        
        // Add edge worker information
        html += `
          <h2>Edge Worker Setup</h2>
          <p>To connect an edge worker to this proxy:</p>
          <div class="code">
            <p>1. Install Cyrus edge client on your local machine</p>
            <p>2. Run: <strong>cyrus setup</strong></p>
            <p>3. The edge client will automatically connect to this proxy</p>
          </div>
        `
        
        html += `
            </body>
          </html>
        `
        
        res.send(html)
      } catch (error) {
        console.error('Error rendering dashboard:', error)
        res.status(500).send('Error rendering dashboard: ' + error.message)
      }
    })
    
    // OAuth authorization endpoint - redirects to Linear
    app.get('/oauth/authorize', (req, res) => {
      try {
        const authUrl = this.oauthHelper.generateAuthorizationUrl()
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
        
        // Store token info for edge setup
        this.latestTokenInfo = tokenInfo
        
        // Call success callback if provided
        if (this.onAuthSuccess) {
          try {
            await this.onAuthSuccess(tokenInfo)
          } catch (callbackError) {
            console.error('Error in auth success callback:', callbackError)
          }
        }
        
        // HTML response with auto-redirect to dashboard
        const html = `
          <!DOCTYPE html>
          <html>
            <head>
              <title>Authentication Successful</title>
              <meta http-equiv="refresh" content="3;url=/" />
              <style>
                body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 40px; line-height: 1.6; text-align: center; }
                .success { background-color: #d4edda; color: #155724; border: 1px solid #c3e6cb; padding: 20px; border-radius: 5px; }
              </style>
            </head>
            <body>
              <div class="success">
                <h1>✅ Authentication Successful!</h1>
                <p>You have successfully authenticated with Linear.</p>
                <p>Redirecting to dashboard in 3 seconds...</p>
                <p><a href="/">Click here if you are not redirected automatically</a></p>
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
    
    // OAuth status endpoint - check if we have valid tokens
    app.get('/oauth/status', async (req, res) => {
      try {
        const hasValidToken = await this.oauthHelper.hasValidToken()
        res.json({
          authenticated: hasValidToken,
          authType: hasValidToken ? 'oauth' : 'none'
        })
      } catch (error) {
        console.error('Error checking OAuth status:', error)
        res.status(500).json({
          authenticated: false,
          error: error.message
        })
      }
    })
    
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
              <p>Your Cyrus proxy is authenticated and ready. Set up your edge worker with this configuration:</p>
              
              <div class="config">
                <h3>1. Create .env.edge file:</h3>
                <div class="code">PROXY_URL=${req.protocol}://${req.get('host')}
EDGE_TOKEN=${edgeToken}
LINEAR_OAUTH_TOKEN=${tokenInfo}
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
}