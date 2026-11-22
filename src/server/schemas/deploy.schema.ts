import { z } from "zod";
import { Plans, ResourceType } from "@metacall/protocol";

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

  version: z.string()
});
