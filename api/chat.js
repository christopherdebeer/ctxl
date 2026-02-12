/**
 * Vercel Serverless Function for Anthropic API proxy
 *
 * Set ANTHROPIC_API_KEY in Vercel environment variables.
 * For Bedrock, set AWS credentials as env vars.
 */

import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic();

export default async function handler(req, res) {
  // CORS headers
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const { system, messages, model, max_tokens, tools, tool_choice } = req.body;

  console.log(`[api/chat] Request: model=${model}, messages=${messages?.length}, tools=${tools?.length || 0}`);

  try {
    const params = {
      model: model || "claude-sonnet-4-5-20250929",
      max_tokens: max_tokens || 8192,
      system: system,
      messages: messages,
    };

    // Pass through tools and tool_choice if provided
    if (tools) params.tools = tools;
    if (tool_choice) params.tool_choice = tool_choice;

    const response = await anthropic.messages.create(params);

    const firstBlock = response.content?.[0];
    const charCount = firstBlock?.type === "tool_use"
      ? JSON.stringify(firstBlock.input).length
      : (firstBlock?.text?.length || 0);
    console.log(`[api/chat] Response: ${charCount} chars (${firstBlock?.type || "?"})`);
    return res.status(200).json(response);
  } catch (err) {
    console.error("[api/chat] Error:", err.message);
    return res.status(err.status || 500).json({
      error: { message: err.message, type: err.name }
    });
  }
}
