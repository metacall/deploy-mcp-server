import { api } from "../../protocol/client.js";
import { setActiveDeployment } from "../../context.js";
import { createToolHandler } from "../toolFactory.js";
import { DeploySchema } from "../schemas/deploy.schema.js";
import type { MCPToolDefinition } from "../types.js";
import { waitFor } from "@metacall/protocol";

export const deployTool: MCPToolDefinition = {
  name: "deploy",
  description: `
Deploy a package or repository to MetaCall Cloud.

Parameters:
- name:
    - For resourceType "Package" -> the packageId returned by the upload tool
    - For resourceType "Repository" -> The exact "id" returned by the Add repository tool. Do NOT use the Git URL.
- resourceType: "Package" or "Repository".
- plan: Subscription plan type (Essential, Standard, or Premium).
- release: deployment release identifier (e.g. a timestamp or label). It is not a Git branch.
- version: deployment version (e.g. v1)
`,
  schema: DeploySchema,

  execute: createToolHandler(
    DeploySchema,
    async ({ name, env, plan, resourceType, release, version }) => {
      
      const deployment = await api.deploy(
        name,
        env ?? [],
        plan as any,
        resourceType,
        release,
        version
      );

      const inspected = await waitFor(async () => {
        const current = await api.inspectByName(deployment.suffix);

        if (current.status === "create") {
          throw new Error("Deployment not ready yet");
        }

        return current;
      });

      if (inspected.status !== "ready") {
        throw new Error(`Deployment '${deployment.suffix}' failed`);
      }

      setActiveDeployment(inspected);

      return {
        message: "Deployment is ready",
        deployment
      };
    }
  )
};
