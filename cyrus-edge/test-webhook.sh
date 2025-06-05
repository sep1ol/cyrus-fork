#!/bin/bash

# Test webhook script to verify edge worker connection

echo "Testing edge worker connection..."

# Check connected edges
echo "Connected edges:"
curl -s http://localhost:3456/admin/edges | jq .

# Send a test webhook
echo -e "\nSending test webhook..."
curl -X POST http://localhost:3456/webhook \
  -H "Content-Type: application/json" \
  -H "Linear-Signature: dummy" \
  -d '{
    "action": "create",
    "type": "Issue",
    "createdAt": "2025-01-02T19:30:00.000Z",
    "data": {
      "id": "test-issue-123",
      "identifier": "TEST-123",
      "title": "Test Issue for Edge Worker",
      "description": "This is a test issue to verify edge worker connection",
      "assignee": {
        "id": "user-123",
        "name": "Test User"
      }
    },
    "organization": {
      "id": "org-123"
    },
    "webhook": {
      "id": "webhook-123"
    }
  }'

echo -e "\n\nChecking proxy logs..."
tail -10 /Users/connor/code/cyrus/proxy.log