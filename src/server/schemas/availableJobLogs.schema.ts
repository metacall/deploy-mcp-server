import { z } from "zod";

export const AvailableJobLogsSchema = z.object({
  suffix: z
    .string()
    .describe(
      "Deployment suffix (usually the zip or repository name)."
    )
});
