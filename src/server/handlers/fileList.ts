import { api, local } from "../../protocol/client.js";
import { validateLocalRepository } from "../../utils/repository.js";
import { createToolHandler } from "../toolFactory.js";
import { FileListSchema } from "../schemas/fileList.schema.js";
import type { MCPToolDefinition } from "../types.js";

//Definition of the "fileList" tool.
export const fileListTool: MCPToolDefinition = {
  name: "fileList",
  description:
  "Lists the files available in a specific branch of a Git repository. \
  Use this tool when you need to inspect the files of a repository branch, verify the presence of certain files, or explore the repository structure before deploying or analyzing code. \
  Requires the repository URL and branch name, and returns the list of file paths found in that branch.",
  schema: FileListSchema,

  execute: createToolHandler(
    FileListSchema,
    async ({ url, branch }) => {
      if (local) validateLocalRepository(url, branch);

      const files = await api.fileList(url, branch);

      return {
        repository: url,
        branch,
        files
      };
    }
  )
};
