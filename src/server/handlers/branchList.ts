import { api, local } from "../../protocol/client.js";
import { validateLocalRepository } from "../../utils/repository.js";
import { createToolHandler } from "../toolFactory.js";
import { BranchListSchema } from "../schemas/branchList.schema.js";
import type { MCPToolDefinition } from "../types.js";

//Definition of the "branchList" tool.
export const branchListTool: MCPToolDefinition = {
  name: "branchList",
  description:
  "Retrieves the list of branches available in a Git repository. \
  Use this tool when you need to determine which branch should be inspected, deployed, or used for repository-based deployments. \
  Requires the repository URL as input and returns all available branch names.",
  schema: BranchListSchema,

  execute: createToolHandler(
    BranchListSchema,
    async ({ url }) => {
      if (local) validateLocalRepository(url);

      const branches = await api.branchList(url);

      return {
        repository: url,
        branches: branches.branches
      };
    }
  )
};
