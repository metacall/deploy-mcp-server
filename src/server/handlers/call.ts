import { createToolHandler } from "../toolFactory.js";
import { CallSchema } from "../schemas/call.schema.js";
import type { MCPToolDefinition } from "../types.js";
import { api, local } from "../../protocol/client.js";
import { resolveDeployment } from "../../context.js";

export const callTool: MCPToolDefinition = {
  name: "call",
  description:
    "Invoke a synchronous function from a deployed MetaCall service. Arguments must be provided as an object where keys match the function parameter names (e.g., add(a,b) → {\"a\":1,\"b\":2}). If required arguments are missing, ask the user for them.",
  schema: CallSchema,
  execute: createToolHandler(
    CallSchema,
    async ({ suffix, function: fn, args }) => {
      const deployment = await resolveDeployment(suffix);
      let parameters = args ?? {};
      if (local) {
        const matches = deployment.functions.filter(func => func.name === fn);
        const names = matches.length === 1 ? matches[0].args : undefined;
        // Only reorder complete, unambiguous signatures; preserve extra arguments.
        if (names && new Set(names).size === names.length && names.every(name => Object.hasOwn(parameters, name))) {
          parameters = Object.fromEntries([
            ...names.map(name => [name, parameters[name]]),
            ...Object.entries(parameters).filter(([name]) => !names.includes(name))
          ]);
        }
      }
      const result = await api.call(
        deployment.prefix,
        deployment.suffix,
        deployment.version,
        fn,
        parameters
      );

      return {
        deployment: deployment.suffix,
        function: fn,
        invocationType: "call",
        version: deployment.version,
        result
      };
    }
  )
};
