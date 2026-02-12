#!/usr/bin/env node
/**
 * Thin proxy server for Anthropic API
 *
 * Auth detection:
 * - If ANTHROPIC_API_KEY is set: uses direct Anthropic API
 * - Otherwise: uses AWS Bedrock (respects AWS_PROFILE, AWS_REGION, etc.)
 *
 * Usage with API key:
 *   ANTHROPIC_API_KEY=sk-ant-... node server.js
 *
 * Usage with Bedrock:
 *   AWS_PROFILE=my-profile AWS_REGION=us-east-1 node server.js
 */

import express from "express";
import cors from "cors";

const PORT = process.env.PORT || 3001;
const USE_BEDROCK = !process.env.ANTHROPIC_API_KEY;

// Bedrock model mapping (API model -> Bedrock model ID)
const BEDROCK_MODELS = {
  "claude-sonnet-4-20250514": "us.anthropic.claude-sonnet-4-20250514-v1:0",
  "claude-opus-4-20250514": "us.anthropic.claude-opus-4-20250514-v1:0 ",
  "claude-3-5-sonnet-20241022": "us.anthropic.claude-3-5-sonnet-20241022-v2:0",
  "claude-3-5-haiku-20241022": "us.anthropic.claude-3-5-haiku-20241022-v1:0",
};

let client;

async function initClient() {
  if (USE_BEDROCK) {
    const { AnthropicBedrock } = await import("@anthropic-ai/bedrock-sdk");
    client = new AnthropicBedrock({
      awsRegion: process.env.AWS_REGION || "us-east-1",
    });
    console.log(`[proxy] Using Bedrock (profile: ${process.env.AWS_PROFILE || "default"}, region: ${process.env.AWS_REGION || "us-east-1"})`);
  } else {
    const Anthropic = (await import("@anthropic-ai/sdk")).default;
    client = new Anthropic();
    console.log("[proxy] Using direct Anthropic API");
  }
}

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.post("/api/chat", async (req, res) => {
  const { system, messages, model, max_tokens } = req.body;

  // Map model name for Bedrock
  const resolvedModel = USE_BEDROCK
    ? (BEDROCK_MODELS[model] || BEDROCK_MODELS["claude-sonnet-4-20250514"])
    : (model || "claude-sonnet-4-20250514");

  console.log(`[proxy] Request: model=${resolvedModel}, messages=${messages?.length}, max_tokens=${max_tokens}`);

  try {
    const response = await client.messages.create({
      model: resolvedModel,
      max_tokens: max_tokens || 8192,
      system: system,
      messages: messages,
    });

    console.log(`[proxy] Response: ${response.content?.[0]?.text?.length || 0} chars`);
    res.json(response);
  } catch (err) {
    console.error("[proxy] Error:", err.message);
    res.status(err.status || 500).json({
      error: { message: err.message, type: err.name }
    });
  }
});

app.get("/health", (req, res) => {
  res.json({ status: "ok", mode: USE_BEDROCK ? "bedrock" : "api_key" });
});

// Initialize client then start server
initClient().then(() => {
  app.listen(PORT, () => {
    console.log(`[proxy] Listening on http://localhost:${PORT}`);
  });
}).catch(err => {
  console.error("[proxy] Failed to initialize:", err);
  process.exit(1);
});
