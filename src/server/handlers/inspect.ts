import { api } from "../../protocol/client.js";
import { createToolHandler } from "../toolFactory.js";
import { InspectSchema } from "../schemas/inspect.schema.js";
import type { MCPToolDefinition } from "../types.js";

//inspect tool definition to list all deployments available in that specific MetaCall FaaS account
export const inspectTool: MCPToolDefinition = {
  name: "inspect",
  description:
  "Retrieves all deployments available in the current MetaCall FaaS account. \
  Use this tool when you need to discover existing deployed services, identify deployment suffixes, or inspect available deployments before invoking functions, retrieving logs, or deleting deployments. \
  Returns a list of deployments associated with the authenticated account.",
  schema: InspectSchema,
  annotations: {
    title: "List deployments",
    readOnlyHint: true
  },
  execute: createToolHandler(
    InspectSchema,
    async () => {
      const deployments = await api.inspect();
      return {
        count: deployments.length,
        deployments
      };
    }
  )
};