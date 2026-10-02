import { z } from "zod";

export const UploadSchema = z
  .object({
    name: z.string().min(1),

    projectPath: z.string().optional().describe("Absolute filesystem path to a local project directory accessible by the MCP server. Its files, runners and MetaCall JSONs are detected and zipped automatically. Example: /home/user/app"),
    zipPath: z.string().optional().describe("Absolute filesystem path to a zip file accessible by the MCP server. Example: /home/user/app.zip"),
    zipBase64: z.string().optional(),

    jsons: z.array(z.any()).optional(),
    runners: z.array(z.string()).optional()
  })
  .refine(
    (data) => [data.projectPath, data.zipPath, data.zipBase64].filter(Boolean).length === 1,
    {
      message: "Provide exactly one of projectPath, zipPath or zipBase64"
    }
  )
  .refine(
    (data) => !data.projectPath || (!data.jsons && !data.runners),
    {
      message: "jsons and runners are detected from projectPath, omit them"
    }
  );
