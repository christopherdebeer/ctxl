# YATC Proxy Server

Thin proxy for Anthropic API that enables browser-based apps to use local credentials.

## Setup

```bash
cd proxy
npm install
```

## Usage

### With Anthropic API Key

```bash
ANTHROPIC_API_KEY=sk-ant-... npm start
```

### With AWS Bedrock

If `ANTHROPIC_API_KEY` is NOT set, the proxy uses Bedrock with AWS credentials.

```bash
# Using a named profile
AWS_PROFILE=cline-profile AWS_REGION=us-east-1 npm start

# Or with SSO (login first)
aws sso login --profile cline-profile
AWS_PROFILE=cline-profile npm start
```

The proxy automatically maps model names to Bedrock model IDs:
- `claude-sonnet-4-20250514` → `us.anthropic.claude-sonnet-4-20250514-v1:0`
- `claude-3-5-sonnet-20241022` → `us.anthropic.claude-3-5-sonnet-20241022-v2:0`

## Endpoints

- `POST /api/chat` - Proxy to Anthropic/Bedrock Messages API
- `GET /health` - Health check with auth mode info

## Request Format

```json
{
  "system": "You are a helpful assistant",
  "messages": [{ "role": "user", "content": "Hello" }],
  "model": "claude-sonnet-4-20250514",
  "max_tokens": 8192
}
```

## Configure in YATC

1. Open Dev drawer (click "Dev" button)
2. Click "API" button
3. Select "Proxy Server" mode
4. Set URL to `http://localhost:3001/api/chat`
5. Click "Save"
