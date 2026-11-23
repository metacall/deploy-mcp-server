import { ZodSchema } from "zod";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

// Definition of the MCPToolDefinition interface, which describes the structure of a tool that can be registered with the MetaCall MCP server.
export interface MCPToolDefinition {
  name: string;
  description: string;
  schema: ZodSchema<any>;
  // Behavioural hints clients use to decide what may run without confirmation.
  // Every tool reaches a remote FaaS, so index.ts defaults openWorldHint to true.
  annotations?: ToolAnnotations;
  execute: (args: unknown) => Promise<any>;
}
