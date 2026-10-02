import { api } from "../../protocol/client.js";
import { createToolHandler } from "../toolFactory.js";
import { LogsSchema } from "../schemas/logs.schema.js";
import type { MCPToolDefinition } from "../types.js";
import { LogType } from "@metacall/protocol";

export const logsTool: MCPToolDefinition = {
  name: "logs",

  description:
    "Retrieve logs from a MetaCall deployment container. The container usually matches the runtime language used in the deployment (e.g., python, node).Use this tool when debugging a deployment or checking runtime output.",

  schema: LogsSchema,

  execute: createToolHandler(
    LogsSchema,
    async ({ suffix, container }) => {
      const deployment = await api.inspectByName(suffix);
      const prefix = deployment.prefix;
      const version = deployment.version;
      const logs = await api.logs(
        container,
        LogType.Deploy,
        prefix,
        suffix,
        version
      );
      return {
        deployment: suffix,
        container,
        version,
        logs
      };
    }
  )
};