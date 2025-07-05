# cyrus-ai

AI development agent for Linear powered by Claude Code.

## Installation

```bash
npm install -g cyrus-ai
```

## Usage

```bash
cyrus
```

## Configuration

### Environment Variables

- `CYRUS_HOST_EXTERNAL` - Set to `true` to allow external connections (listens on `0.0.0.0` instead of `localhost`). Default: `false`
  - Use this when running in Docker containers or when you need external access to the webhook server
  - When `true`: Server listens on `0.0.0.0` (all interfaces)
  - When `false` or unset: Server listens on `localhost` (local access only)