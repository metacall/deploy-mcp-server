import { z } from "zod";
import { isAbsolute } from "node:path";
import { MAX_UPLOAD_BASE64_LENGTH } from "../../utils/uploadLimits.js";

const absolutePath = z.string().min(1).refine(isAbsolute, "Upload paths must be absolute.");

export const UploadSchema = z
  .object({
    name: z.string().min(1),

    projectPath: absolutePath.optional().describe("Absolute project directory inside the server's configured METACALL_WORKSPACE_ROOT. Files, runners and MetaCall JSONs are detected and zipped automatically."),
    zipPath: absolutePath.optional().describe("Absolute path to a regular .zip file inside the server's configured METACALL_WORKSPACE_ROOT."),
    zipBase64: z.string().min(1).max(MAX_UPLOAD_BASE64_LENGTH).optional(),

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
