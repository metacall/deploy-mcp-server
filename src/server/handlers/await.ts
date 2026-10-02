import { createToolHandler } from "../toolFactory.js";
import { AwaitSchema } from "../schemas/await.schema.js";
import type { MCPToolDefinition } from "../types.js";
import { api } from "../../protocol/client.js";

const hostname = new URL(process.env.METACALL_BASE_URL!).hostname;

export const awaitTool: MCPToolDefinition = {
  name: "await",

  description:
    "Invoke an asynchronous function from a deployed MetaCall service. Use this tool when the function returns a Promise, coroutine, or async result. Arguments must be provided as an object where keys match the function parameter names (e.g., async_add(a,b) → {\"a\":1,\"b\":2}). If required arguments are missing, ask the user for them before invoking.",

  schema: AwaitSchema,

  execute: createToolHandler(
    AwaitSchema,
    async ({ suffix, function: fn, args }) => {
      const deployment = await api.inspectByName(suffix);

      if (["localhost", "127.0.0.1", "[::1]"].includes(hostname)) {
        throw new Error("Local FaaS does not support await");
      }

      const result = await api.await(
        deployment.prefix,
        deployment.suffix,
        deployment.version,
        fn,
        args ?? {}
      );

      return {
        deployment: suffix,
        function: fn,
        invocationType: "await",
        version: deployment.version,
        result
      };
    }
  )
};
