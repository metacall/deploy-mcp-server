#!/usr/bin/env node
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema
} from "@modelcontextprotocol/sdk/types.js";

import { tools } from "./server/handlers/index.js";
import { resources, resourceTemplates, readResource } from "./server/resources.js";
import { prompts, getPrompt } from "./server/prompts.js";
import { zodToJsonSchema } from "zod-to-json-schema";
import { redactCredentials } from "./protocol/client.js";

const server = new Server(
  {
    name: "deploy-mcp-server",
    version: "1.0.0"
  },
  {
    capabilities: {
      tools: {},
      resources: {},
      prompts: {}
    }
  }
);

server.setRequestHandler(ListResourcesRequestSchema, async () => ({ resources }));
server.setRequestHandler(ListResourceTemplatesRequestSchema, async () => ({ resourceTemplates }));
server.setRequestHandler(ReadResourceRequestSchema, request => readResource(request.params.uri));
server.setRequestHandler(ListPromptsRequestSchema, async () => ({ prompts }));
server.setRequestHandler(GetPromptRequestSchema, async request =>
  getPrompt(request.params.name, request.params.arguments)
);

// Discovery phase
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: zodToJsonSchema(tool.schema) 
    }))
  };
});

// Execution phase
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  const tool = tools.find((t) => t.name === name);
  if (!tool) {
    // No such tool is a protocol failure rather than a tool result.
    throw new Error(`Unknown tool: ${redactCredentials(name)}`);
  }

  let result;
  try {
    result = await tool.execute(args);
  } catch (error) {
    // A tool that ran and failed is reported as a result with isError, not as a
    // JSON-RPC error: clients surface protocol errors to the user without
    // handing them back to the model, so an invalid argument, a missing active
    // deployment or an unsupported local operation was invisible to the one
    // participant that could correct it.
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: redactCredentials(error instanceof Error ? error.message : String(error))
        }
      ]
    };
  }

  return {
    content: [
      {
        type: "text",
        text: redactCredentials(JSON.stringify(result, null, 2))
      }
    ]
  };
});

const transport = new StdioServerTransport();
await server.connect(transport);
