import { api } from "../../protocol/client.js";
import { createToolHandler } from "../toolFactory.js";
import { DeployEnabledSchema } from "../schemas/account.schema.js";
import type { MCPToolDefinition } from "../types.js";

//deployEnabled tool definition to check if deployment is enabled for this specific MetaCall account
export const deployEnabledTool: MCPToolDefinition = {
  name: "deployEnabled",

  description: "Checks whether the current MetaCall account is allowed to deploy serverless functions. \
  Use this tool before attempting to upload or deploy packages to ensure the account has deployment permissions enabled. \
  Returns a boolean indicating whether deployments are permitted for the authenticated account.",

  schema: DeployEnabledSchema,
  annotations: {
    title: "Check deploy permission",
    readOnlyHint: true
  },
  execute: createToolHandler(
    DeployEnabledSchema,
    async () => {
      const enabled = await api.deployEnabled();

      return {
        deployEnabled: enabled
      };
    }
  )
};