import { api, local } from "../../protocol/client.js";
import { createToolHandler } from "../toolFactory.js";
import { RefreshTokenSchema } from "../schemas/refresh.schema.js";
import type { MCPToolDefinition } from "../types.js";

//refresh tool definition to refresh the MetaCall authentication token
export const refreshTokenTool: MCPToolDefinition = {
  name: "refresh",
  description: "Refreshes the MetaCall authentication token.",
  schema: RefreshTokenSchema,

  execute: createToolHandler(
    RefreshTokenSchema,
    async () => {
      if (local) {
        throw new Error("Local FaaS does not support refresh");
      }

      const newToken = await api.refresh();
      return {
        token: newToken,
        message: "Authentication token refreshed successfully"
      };
    }
  )
};