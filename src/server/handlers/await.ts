import { createToolHandler } from "../toolFactory.js";
import { AwaitSchema } from "../schemas/await.schema.js";
import type { MCPToolDefinition } from "../types.js";
import { api, local } from "../../protocol/client.js";
import { resolveDeployment } from "../../context.js";

export const awaitTool: MCPToolDefinition = {
  name: "await",

  description:
    "Invoke an asynchronous function from a deployed MetaCall service. Use this tool when the function returns a Promise, coroutine, or async result. Arguments must be provided as an object where keys match the function parameter names (e.g., async_add(a,b) → {\"a\":1,\"b\":2}). If required arguments are missing, ask the user for them before invoking.",

  schema: AwaitSchema,

  execute: createToolHandler(
    AwaitSchema,
    async ({ suffix, function: fn, args }) => {
      if (local) {
        throw new Error("Local FaaS does not support await");
      }

      const deployment = await resolveDeployment(suffix);
      const result = await api.await(
        deployment.prefix,
        deployment.suffix,
        deployment.version,
        fn,
        args ?? {}
      );

      return {
        deployment: deployment.suffix,
        function: fn,
        invocationType: "await",
        version: deployment.version,
        result
      };
    }
  )
};
