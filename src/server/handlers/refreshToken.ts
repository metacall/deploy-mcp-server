import { refreshAuthentication } from "../../protocol/client.js";
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
      await refreshAuthentication();
      return {
        success: true,
        message: "Authentication refreshed successfully"
      };
    },
    { authenticate: false }
  )
};
