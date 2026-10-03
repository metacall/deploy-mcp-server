import { api } from "../../protocol/client.js";
import { setActiveDeployment } from "../../context.js";
import { createToolHandler } from "../toolFactory.js";
import { InspectByNameSchema } from "../schemas/inspectByName.schema.js";
import type { MCPToolDefinition } from "../types.js";

//definition of inspectByName tool, which allows users to inspect a deployment by its suffix.
export const inspectByNameTool: MCPToolDefinition = {
  name: "inspectByName",
  description:
  "Retrieves detailed information about a specific MetaCall deployment using its suffix. \
    Use this tool when the deployment suffix is already known and you need to inspect its configuration, metadata, or runtime details. \
    If the suffix is unknown, use the 'inspect' tool first to list all available deployments.",
  schema: InspectByNameSchema,

  execute: createToolHandler(
    InspectByNameSchema,
    async ({ suffix }) => {
        try {
            const deployment = await api.inspectByName(suffix);
            if (deployment) setActiveDeployment(deployment);
            return {
                found: !!deployment,
                deployment: deployment ?? null
            };
        } catch (error) {
            return {
                found: false,
                deployment: null
            };
        }
    }
)
};
