import { api } from "../../protocol/client.js";
import { createToolHandler } from "../toolFactory.js";
import { ValidateAuthSchema } from "../schemas/auth.schema.js";
import type { MCPToolDefinition } from "../types.js";

//validate tool definition to check if the current MetaCall authentication token is valid
export const validateAuthTool: MCPToolDefinition = {
  name: "validate",

  description:
  "Validates the current MetaCall authentication token used to access the MetaCall FaaS API. \
  Use this tool when you need to confirm that the authentication token is still valid before performing operations such as deploying packages, invoking serverless functions, or retrieving account information. \
  Returns a boolean indicating whether the token is valid.",

  schema: ValidateAuthSchema,
  annotations: {
    title: "Validate authentication token",
    readOnlyHint: true
  },
  execute: createToolHandler(
    ValidateAuthSchema,

    async () => {
      const valid = await api.validate();

      return {
        valid,
        message: valid
          ? "Authentication token is valid"
          : "Authentication token is invalid"
      };
    }
  )
};