import { createToolHandler } from "../toolFactory.js";
import { CallSchema } from "../schemas/call.schema.js";
import type { MCPToolDefinition } from "../types.js";
import { api } from "../../protocol/client.js";

export const callTool: MCPToolDefinition = {
  name: "call",
  description:
    "Invoke a synchronous function from a deployed MetaCall service. Arguments must be provided as an object where keys match the function parameter names (e.g., add(a,b) → {\"a\":1,\"b\":2}). If required arguments are missing, ask the user for them.",
  schema: CallSchema,
  execute: createToolHandler(
    CallSchema,
    async ({ suffix, function: fn, args }) => {
      const deployment = await api.inspectByName(suffix);
      const result = await api.call(
        deployment.prefix,
        deployment.suffix,
        deployment.version,
        fn,
        args ?? {}
      );

      return {
        deployment: suffix,
        function: fn,
        invocationType: "call",
        version: deployment.version,
        result
      };
    }
  )
};
