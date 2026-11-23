import { z } from "zod";
import { Plans, ResourceType } from "@metacall/protocol";

export const DefaultWaitSeconds = 30;
export const MaxWaitSeconds = 45;

export const DeploySchema = z.object({
  name: z.string(),

  env: z
    .array(
      z.object({
        name: z.string(),
        value: z.string()
      })
    )
    .default([]),

  // Protocol types this as Plans; an unchecked string reached the API unvalidated
  // and left the accepted values out of the advertised input schema.
  plan: z.nativeEnum(Plans),

  resourceType: z.nativeEnum(ResourceType),

  release: z.string(),

  version: z.string(),

  // Readiness is polled inside the call, so this bounds how long one tools/call
  // blocks. It bounds the waiting between status checks; the ceiling leaves the
  // deploy request and the checks themselves room under the MCP SDK's 60s default
  // request timeout, which is what a client aborts the call on. A deployment still
  // creating at the deadline comes back as a result, not an error.
  waitSeconds: z
    .number()
    .int()
    .min(0)
    .max(MaxWaitSeconds)
    .default(DefaultWaitSeconds)
    .describe(
      "Seconds to wait for the deployment to become ready before returning. \
Status is checked every 5 seconds, so the wait is rounded down to that interval. \
At the deadline a deployment that is still building is returned with status \"create\", \
to be polled with inspectByName. At least one status check always runs."
    )
});
