import { findDeployment, setActiveDeployment } from "../../context.js";
import { createToolHandler } from "../toolFactory.js";
import { InspectByNameSchema } from "../schemas/inspectByName.schema.js";
import type { MCPToolDefinition } from "../types.js";

//definition of inspectByName tool, which allows users to inspect a deployment by its suffix.
export const inspectByNameTool: MCPToolDefinition = {
  name: "inspectByName",
  description:
  "Retrieves detailed information about a specific MetaCall deployment using its suffix. \
    Use this tool when the deployment suffix is already known and you need to inspect its configuration, metadata, or runtime details. \
    If the suffix is unknown, use the 'inspect' tool first to list all available deployments. \
    A found deployment becomes this session's active deployment, used by call and await when suffix is omitted.",
  schema: InspectByNameSchema,
  annotations: {
    title: "Inspect deployment by suffix",
    readOnlyHint: true
  },

  execute: createToolHandler(
    InspectByNameSchema,
    async ({ suffix }) => {
      // findDeployment returns undefined for a missing suffix. Every other
      // failure it propagates still throws, so transport, authentication and
      // server failures stay distinguishable from absence: reporting them as
      // found: false would have the model conclude a live deployment was gone.
      const deployment = await findDeployment(suffix);

      if (!deployment) {
        return {
          found: false,
          deployment: null
        };
      }

      setActiveDeployment(deployment);
      return {
        found: true,
        deployment
      };
    }
  )
};
