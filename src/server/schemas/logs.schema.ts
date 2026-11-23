import { z } from "zod";
import { LogType } from "@metacall/protocol";

export const LogsSchema = z.object({
  suffix: z
    .string()
    .describe(
      "Deployment suffix (usually the zip or repository name)."
    ),

  container: z
    .string()
    .describe(
      "Container name whose logs should be retrieved. For type \"job\", list the deployment's containers with availableJobLogs; for type \"deploy\" the container is usually the runtime language. Examples: python, node, rust."
    ),

  type: z
    .nativeEnum(LogType)
    .default(LogType.Deploy)
    .describe(
      "Which log stream to read: \"deploy\" for build and deployment output, \"job\" for output the running deployment produced. Defaults to \"deploy\"."
    )
});
