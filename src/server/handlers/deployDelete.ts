import { api } from "../../protocol/client.js";
import { clearActiveDeployment } from "../../context.js";
import { createToolHandler } from "../toolFactory.js";
import { DeployDeleteSchema } from "../schemas/deployDelete.schema.js";
import type { MCPToolDefinition } from "../types.js";

//Definition of the tool to delete the deployment from MetaCall FaaS.
export const deployDeleteTool: MCPToolDefinition = {
  name: "deployDelete",
  description:
  "Deletes an existing deployment and its associated package from MetaCall FaaS. \
  Use this tool when the user wants to remove a deployed service or clean up an existing deployment. \
  Requires the deployment suffix and optionally the version. \
  This operation permanently removes the deployment and its resources from the MetaCall platform.",
  schema: DeployDeleteSchema,

  execute: createToolHandler(
    DeployDeleteSchema,
    // The schema defaults version to "v1"; handler args are typed from the schema input.
    async ({ suffix, version = "v1" }) => {
      // Resolve deployment metadata
      const { prefix } = await api.inspectByName(suffix);
      // Delete deployment
      const result = await api.deployDelete(prefix, suffix, version);
      clearActiveDeployment(prefix, suffix, version);
      return {
        message: "Deployment deleted successfully",
        deployment: {
          prefix,
          suffix,
          version
        },
        result
      };
    }
  )
};
