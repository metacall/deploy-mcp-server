import { api, local } from "../../protocol/client.js";
import { createToolHandler } from "../toolFactory.js";
import { AvailableJobLogsSchema } from "../schemas/availableJobLogs.schema.js";
import type { MCPToolDefinition } from "../types.js";

export const availableJobLogsTool: MCPToolDefinition = {
  name: "availableJobLogs",

  description:
    "Lists the container names a deployment has job logs for. Use this before reading job logs instead of guessing a container name; the answer comes from the deployment itself. Cloud only.",

  schema: AvailableJobLogsSchema,

  execute: createToolHandler(
    AvailableJobLogsSchema,
    async ({ suffix }) => {
      if (local) {
        throw new Error("Local FaaS does not support availableJobLogs");
      }

      const containers = await api.availableJobLogs(suffix);
      return {
        deployment: suffix,
        count: containers.length,
        containers
      };
    }
  )
};
