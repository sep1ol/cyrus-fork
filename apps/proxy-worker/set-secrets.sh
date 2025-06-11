#!/bin/bash

# Set secrets for Cloudflare Workers
echo "65da6e2fb5dffdd83e9a36c48b22abd6" | npx wrangler secret put LINEAR_CLIENT_ID
echo "c254938c2cfe5fcafb68e250cc6c74ec" | npx wrangler secret put LINEAR_CLIENT_SECRET
echo "lin_wh_dWOiypcjftqTynR1HygUik2ZqKC7kIkUEi12mzqyrABC" | npx wrangler secret put LINEAR_WEBHOOK_SECRET

# Generate a random encryption key
ENCRYPTION_KEY=$(openssl rand -hex 16)
echo "Generated encryption key: $ENCRYPTION_KEY"
echo "$ENCRYPTION_KEY" | npx wrangler secret put ENCRYPTION_KEY