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

// Discovery phase. Converted once: the schemas are static and the result is
// returned verbatim on every tools/list.
const toolList = tools.map((tool) => ({
  name: tool.name,
  description: tool.description,
  // $refStrategy "none" keeps every argument self-contained. By default identical
  // subschemas collapse into an internal $ref (upload's zipPath pointed at
  // projectPath), which clients are not required to resolve and which discards the
  // sibling description under JSON Schema draft-07.
  inputSchema: zodToJsonSchema(tool.schema, { $refStrategy: "none" }),
  // Every tool talks to a remote FaaS, so the world is open unless stated otherwise.
  annotations: { openWorldHint: true, ...tool.annotations }
}));

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: toolList }));

// Execution phase
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  const tool = tools.find((t) => t.name === name);
  if (!tool) {
    throw new Error(`Unknown tool: ${redactCredentials(name)}`);
  }

  const result = await tool.execute(args);

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
