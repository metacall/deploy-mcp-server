import { api, local, redactCredentials } from "../../protocol/client.js";
import { createToolHandler } from "../toolFactory.js";
import { LogsSchema } from "../schemas/logs.schema.js";
import type { MCPToolDefinition } from "../types.js";
import { LogType } from "@metacall/protocol";

// Protocol has no log pagination. Keep at most 64 KiB of UTF-8 text per MCP
// response (roughly 16k English tokens); this is a context budget, not a server limit.
const MAX_LOG_BYTES = 64 * 1024;

export const logsTool: MCPToolDefinition = {
  name: "logs",

  description:
    "Retrieve logs from a MetaCall deployment container. The container usually matches the runtime language used in the deployment (e.g., python, node).Use this tool when debugging a deployment or checking runtime output.",

  schema: LogsSchema,

  execute: createToolHandler(
    LogsSchema,
    async ({ suffix, container }) => {
      if (local) {
        throw new Error("Local FaaS does not support logs");
      }

      const deployment = await api.inspectByName(suffix);
      const prefix = deployment.prefix;
      const version = deployment.version;
      const rawLogs = await api.logs(
        container,
        LogType.Deploy,
        prefix,
        suffix,
        version
      );
      const bytes = Buffer.from(redactCredentials(rawLogs));
      let end = Math.min(bytes.length, MAX_LOG_BYTES);
      // Do not cut a multibyte UTF-8 character in half.
      while (end < bytes.length && (bytes[end] & 0xc0) === 0x80) end--;
      return {
        deployment: suffix,
        container,
        version,
        logs: bytes.subarray(0, end).toString(),
        ...(bytes.length > MAX_LOG_BYTES ? { truncated: true, originalBytes: bytes.length } : {})
      };
    }
  )
};
