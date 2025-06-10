import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { ProxyServer } from '../../src/proxy/ProxyServer.mjs'
import { EdgeClient } from '../../src/edge/EdgeClient.mjs'

describe('Edge-Proxy Integration', () => {
  let proxy
  let proxyPort = 3456
  let edgeClient
  
  beforeAll(async () => {
    // Start proxy server
    proxy = new ProxyServer({
      LINEAR_CLIENT_ID: 'test-client-id',
      LINEAR_CLIENT_SECRET: 'test-client-secret',
      LINEAR_WEBHOOK_SECRET: 'test-webhook-secret',
      OAUTH_REDIRECT_URI: `http://localhost:${proxyPort}/oauth/callback`
    })
    
    await proxy.start(proxyPort)
  })
  
  afterAll(async () => {
    // Clean up
    if (edgeClient && edgeClient.isConnected()) {
      edgeClient.disconnect()
    }
    
    if (proxy) {
      await proxy.stop()
    }
  })
  
  it('should allow edge client to connect with valid token', async () => {
    edgeClient = new EdgeClient({
      proxyUrl: `http://localhost:${proxyPort}`,
      edgeToken: 'test-edge-token'
    })
    
    const connectedPromise = new Promise((resolve) => {
      edgeClient.once('connected', resolve)
    })
    
    await edgeClient.connect()
    await connectedPromise
    
    expect(edgeClient.isConnected()).toBe(true)
  })
  
  it('should stream events from proxy to edge', async () => {
    const receivedEvents = []
    
    edgeClient.on('webhook', (event) => {
      receivedEvents.push(event)
    })
    
    // Simulate webhook to proxy
    const webhookPayload = {
      type: 'Issue',
      action: 'create',
      data: {
        id: 'test-issue-id',
        identifier: 'TEST-1',
        title: 'Test Issue'
      }
    }
    
    // Send webhook to proxy
    const response = await fetch(`http://localhost:${proxyPort}/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'linear-signature': 'test-signature' // Would need proper signature in real test
      },
      body: JSON.stringify(webhookPayload)
    })
    
    expect(response.status).toBe(200)
    
    // Wait for event to propagate
    await new Promise(resolve => setTimeout(resolve, 100))
    
    // Verify edge received the webhook
    expect(receivedEvents).toHaveLength(1)
    expect(receivedEvents[0].type).toBe('Issue')
    expect(receivedEvents[0].action).toBe('create')
  })
  
  it('should handle edge client disconnection gracefully', async () => {
    const disconnectedPromise = new Promise((resolve) => {
      edgeClient.once('disconnected', resolve)
    })
    
    edgeClient.disconnect()
    await disconnectedPromise
    
    expect(edgeClient.isConnected()).toBe(false)
  })
})