const express = require("express");
const router = express.Router();
const Anthropic = require("@anthropic-ai/sdk");
const fs = require("fs");
const path = require("path");
const products = require("../data/products");

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const skillPath = path.join(__dirname, "../skills/shopping-assistant.md");
const SKILL_CONTENT = fs.readFileSync(skillPath, "utf-8");

const SYSTEM_PROMPT = `${SKILL_CONTENT}

## Available Tools
You have access to tools to help customers: search products, get product details, and check cart.
Always use tools to provide accurate, up-to-date product information rather than relying only on your knowledge.
`;

// Tool definitions
const TOOLS = [
  {
    name: "search_products",
    description: "Search and filter products from our catalog. Use this to find products matching customer criteria.",
    input_schema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Search term to match against product name or description"
        },
        category: {
          type: "string",
          description: "Filter by category: Electronice, Audio, Periferice, Monitoare",
          enum: ["Electronice", "Audio", "Periferice", "Monitoare"]
        },
        max_price: {
          type: "number",
          description: "Maximum price in RON"
        },
        min_price: {
          type: "number",
          description: "Minimum price in RON"
        }
      }
    }
  },
  {
    name: "get_product_details",
    description: "Get complete details for a specific product by ID",
    input_schema: {
      type: "object",
      properties: {
        product_id: {
          type: "number",
          description: "The numeric product ID (1-6)"
        }
      },
      required: ["product_id"]
    }
  },
  {
    name: "get_all_products",
    description: "Get the complete product catalog with all products",
    input_schema: {
      type: "object",
      properties: {}
    }
  },
  {
    name: "compare_products",
    description: "Compare multiple products side by side",
    input_schema: {
      type: "object",
      properties: {
        product_ids: {
          type: "array",
          items: { type: "number" },
          description: "Array of product IDs to compare"
        }
      },
      required: ["product_ids"]
    }
  }
];

// Tool executor
function executeTool(toolName, toolInput) {
  switch (toolName) {
    case "search_products": {
      let results = [...products];
      if (toolInput.query) {
        const q = toolInput.query.toLowerCase();
        results = results.filter(p =>
          p.name.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q) ||
          p.category.toLowerCase().includes(q)
        );
      }
      if (toolInput.category) {
        results = results.filter(p => p.category === toolInput.category);
      }
      if (toolInput.max_price) {
        results = results.filter(p => p.price <= toolInput.max_price);
      }
      if (toolInput.min_price) {
        results = results.filter(p => p.price >= toolInput.min_price);
      }
      return { found: results.length, products: results };
    }

    case "get_product_details": {
      const product = products.find(p => p.id === toolInput.product_id);
      if (!product) return { error: "Produs negăsit" };
      return product;
    }

    case "get_all_products": {
      return { total: products.length, products };
    }

    case "compare_products": {
      const compared = toolInput.product_ids.map(id =>
        products.find(p => p.id === id)
      ).filter(Boolean);
      return { compared };
    }

    default:
      return { error: `Tool necunoscut: ${toolName}` };
  }
}

// POST /api/assistant/chat - streaming response
router.post("/chat", async (req, res) => {
  const { messages } = req.body;
  if (!messages || !Array.isArray(messages)) {
    return res.status(400).json({ error: "messages array required" });
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");

  const sendEvent = (data) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    let conversationMessages = [...messages];
    let continueLoop = true;

    while (continueLoop) {
      const stream = await client.messages.stream({
        model: "claude-opus-4-7",
        max_tokens: 1024,
        thinking: { type: "adaptive" },
        system: SYSTEM_PROMPT,
        tools: TOOLS,
        messages: conversationMessages,
      });

      let fullText = "";
      let stopReason = null;
      let toolUseBlocks = [];
      let currentToolUse = null;
      let currentToolInput = "";

      for await (const event of stream) {
        if (event.type === "content_block_start") {
          if (event.content_block.type === "text") {
            // text block started
          } else if (event.content_block.type === "tool_use") {
            currentToolUse = {
              id: event.content_block.id,
              name: event.content_block.name,
              input: {}
            };
            currentToolInput = "";
          }
        } else if (event.type === "content_block_delta") {
          if (event.delta.type === "text_delta") {
            fullText += event.delta.text;
            sendEvent({ type: "text", text: event.delta.text });
          } else if (event.delta.type === "input_json_delta") {
            currentToolInput += event.delta.partial_json;
          }
        } else if (event.type === "content_block_stop") {
          if (currentToolUse) {
            try {
              currentToolUse.input = JSON.parse(currentToolInput || "{}");
            } catch {
              currentToolUse.input = {};
            }
            toolUseBlocks.push(currentToolUse);
            currentToolUse = null;
            currentToolInput = "";
          }
        } else if (event.type === "message_delta") {
          stopReason = event.delta.stop_reason;
        }
      }

      const finalMessage = await stream.finalMessage();

      if (stopReason === "tool_use" && toolUseBlocks.length > 0) {
        sendEvent({ type: "tool_use", tools: toolUseBlocks.map(t => t.name) });

        conversationMessages.push({
          role: "assistant",
          content: finalMessage.content
        });

        const toolResults = toolUseBlocks.map(tool => {
          const result = executeTool(tool.name, tool.input);
          return {
            type: "tool_result",
            tool_use_id: tool.id,
            content: JSON.stringify(result)
          };
        });

        conversationMessages.push({
          role: "user",
          content: toolResults
        });

      } else {
        continueLoop = false;
        sendEvent({ type: "done", fullText });
      }
    }
  } catch (err) {
    console.error("Assistant error:", err);
    sendEvent({ type: "error", message: "Eroare la procesarea cererii." });
  }

  res.end();
});

// GET /api/assistant/suggestions - quick suggestions
router.get("/suggestions", (_req, res) => {
  const suggestions = [
    "Care laptop îmi recomanzi pentru programare?",
    "Am un buget de 500 RON, ce pot cumpăra?",
    "Compară laptopul cu monitorul",
    "Ce periferice se potrivesc pentru gaming?",
    "Care produs are cel mai bun raport calitate/preț?",
    "Vreau să îmi dotez un birou de acasă"
  ];
  res.json(suggestions);
});

module.exports = router;
