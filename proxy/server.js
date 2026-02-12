#!/usr/bin/env node
/**
 * Thin proxy server for Anthropic API
 *
 * The Anthropic SDK automatically determines auth based on environment:
 * - ANTHROPIC_API_KEY: Direct API access
 * - AWS credentials (env vars, ~/.aws/credentials, IAM role): Bedrock
 *
 * Usage:
 *   npm install @anthropic-ai/sdk express cors
 *   node server.js
 *
 * Or with Bedrock:
 *   npm install @anthropic-ai/sdk @anthropic-ai/bedrock-sdk express cors
 *   ANTHROPIC_BEDROCK_MODEL_ID=anthropic.claude-sonnet-4-20250514-v1:0 node server.js
 */

import Anthropic from "@anthropic-ai/sdk";
import express from "express";
import cors from "cors";

const PORT = process.env.PORT || 3001;

// Initialize client - SDK auto-detects auth method
const anthropic = new Anthropic();

const app = express();
app.use(cors());
app.use(express.json({ limit: "1mb" }));

app.post("/api/chat", async (req, res) => {
  const { system, messages, model, max_tokens } = req.body;

  console.log(`[proxy] Request: model=${model}, messages=${messages?.length}, max_tokens=${max_tokens}`);

  try {
    const response = await anthropic.messages.create({
      model: model || "claude-sonnet-4-20250514",
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
  res.json({ status: "ok", auth: anthropic._options?.apiKey ? "api_key" : "bedrock" });
});

app.listen(PORT, () => {
  console.log(`[proxy] Listening on http://localhost:${PORT}`);
  console.log(`[proxy] Auth mode: ${process.env.ANTHROPIC_API_KEY ? "API Key" : "Bedrock/AWS"}`);
});
