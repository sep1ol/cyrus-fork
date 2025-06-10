#!/bin/bash

# Start connection in background
curl -s -N -H "Authorization: Bearer edge_1749085068025_bdtw9w" -H "Accept: application/x-ndjson" http://localhost:3456/events/stream > /tmp/edge-stream.log 2>&1 &
CURL_PID=$!

echo "Started edge connection with PID $CURL_PID"

# Wait a moment for connection to establish
sleep 1

# Check admin endpoint
echo "Checking connected edges:"
curl -s http://localhost:3456/admin/edges | jq .

# Keep the connection alive for testing
echo "Connection running. Press Ctrl+C to stop..."
trap "kill $CURL_PID 2>/dev/null" EXIT

# Keep script running
wait $CURL_PID