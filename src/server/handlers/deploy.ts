import { api } from "../../protocol/client.js";
import { setActiveDeployment } from "../../context.js";
import { createToolHandler } from "../toolFactory.js";
import { DefaultWaitSeconds, DeploySchema } from "../schemas/deploy.schema.js";
import type { MCPToolDefinition } from "../types.js";
import { MaxRetryInterval, waitFor } from "@metacall/protocol";
import type { Deployment } from "@metacall/protocol";

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
- waitSeconds: how long to wait for readiness before returning (default 30, max 45).

A deployment that is still building when waitSeconds elapses is returned with
status "create". That is not a failure: poll inspectByName until it reports
"ready", and do not deploy again.
`,
  schema: DeploySchema,
  annotations: {
    title: "Deploy package or repository",
    readOnlyHint: false,
    destructiveHint: false,
    idempotentHint: false
  },
  execute: createToolHandler(
    DeploySchema,
    // Handler args are typed from the schema input, so the schema default is
    // restated here rather than inferred.
    async ({ name, env, plan, resourceType, release, version, waitSeconds = DefaultWaitSeconds }) => {
      
      const deployment = await api.deploy(
        name,
        env ?? [],
        plan,
        resourceType,
        release,
        version
      );

      // waitFor retries on every thrown error alike, so record whether the
      // deployment was ever observed building. A deploy response is proof it
      // exists, so once seen building it stays building: reporting a transient
      // /api/inspect failure as a deployment failure is what has the model
      // redeploy over a live deployment.
      let building = false;
      let inspected: Deployment | undefined;

      // Named so waitFor's failure message carries a label rather than this
      // function's source text.
      async function pollReadiness(): Promise<Deployment> {
        // api.inspectByName is api.inspect plus a lookup, and it reports an
        // unlisted suffix with the same thrown Error as a failed request. The
        // list is fetched here so a deployment the dashboard has not published
        // yet counts as building rather than as a lookup failure.
        const current = (await api.inspect()).find(
          ({ suffix }) => suffix === deployment.suffix
        );

        if (!current || current.status === "create") {
          building = true;
          throw new Error("Deployment not ready yet");
        }

        return current;
      }

      // waitFor sleeps between attempts but not after the last one, so one
      // attempt beyond the budget makes the sleeping equal waitSeconds. Zero
      // still reports the status once rather than returning blind. Deriving
      // this from waitSeconds alone rather than from a wall-clock deadline
      // keeps the number of status checks the same on every run.
      const attempts = 1 + Math.floor((waitSeconds * 1000) / MaxRetryInterval);
      // Polling is no finer than protocol's interval, so report what was
      // actually waited rather than what was asked for.
      const waitedSeconds = ((attempts - 1) * MaxRetryInterval) / 1000;

      try {
        inspected = await waitFor(pollReadiness, attempts, MaxRetryInterval);
      } catch (error) {
        // Transport, authentication and server failures are real failures.
        if (!building) {
          const detail = error instanceof Error ? error.message : String(error);
          throw new Error(
            `Could not confirm deployment '${deployment.suffix}': ${detail}`
          );
        }

        return {
          status: "create",
          message: `Deployment '${deployment.suffix}' is still building after ${waitedSeconds}s. \
Poll inspectByName until it reports "ready"; do not deploy again.`,
          deployment
        };
      }

      if (inspected.status !== "ready") {
        throw new Error(`Deployment '${deployment.suffix}' failed`);
      }

      setActiveDeployment(inspected);

      return {
        status: "ready",
        message: "Deployment is ready",
        deployment
      };
    }
  )
};
