import { z } from "zod";

export const CallSchema = z.object({
  suffix: z
    .string()
    .optional()
    .describe("Deployment suffix (usually the zip or repository name). Omit to use this session's active deployment."),

  function: z
    .string()
    .describe("Function name inside the deployed runtime"),

  args: z
    .record(z.any())
    .optional()
    .describe(
      "Object containing named arguments for the function. Keys MUST match the parameter names of the function. Examples: add(a,b) → {\"a\":1,\"b\":2}. greet(name) → {\"name\":\"Somsubhra\"}. If required arguments are missing, ask the user for them before calling the tool."
    )
});
