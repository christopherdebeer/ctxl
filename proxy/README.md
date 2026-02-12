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
export ANTHROPIC_API_KEY=sk-ant-...
npm start
```

### With AWS Bedrock

The SDK uses standard AWS credential chain (env vars, ~/.aws/credentials, IAM role):

```bash
# Optional: specify region and model
export AWS_REGION=us-east-1
export ANTHROPIC_MODEL=us.anthropic.claude-sonnet-4-20250514-v1:0

npm start
```

### With AWS SSO / Profile

```bash
aws sso login --profile my-profile
export AWS_PROFILE=my-profile
npm start
```

## Endpoints

- `POST /api/chat` - Proxy to Anthropic Messages API
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
