import { api, local } from "../../protocol/client.js";
import { validateLocalRepository } from "../../utils/repository.js";
import { createToolHandler } from "../toolFactory.js";
import { AddSchema } from "../schemas/add.schema.js";
import type { MCPToolDefinition } from "../types.js";

//Definition of the "add" tool.It registers a repository in MetaCall FaaS for deployment.
export const addTool: MCPToolDefinition = {
  name: "add",
  description:"Registers a Git repository in MetaCall FaaS so it can be deployed as a serverless function.\
  Use this tool when the user wants to deploy code directly from a repository instead of uploading a zip file.\
  Requires the repository URL and branch name.\
  Returns the repository identifier that will later be used for deployments.",
  schema: AddSchema,

  execute: createToolHandler(
    AddSchema,
    async ({ url, branch, jsons = [] }) => {
      if (local) validateLocalRepository(url, branch);

      const result = await api.add(
        url,
        branch,
        jsons
      );

      return {
        repositoryId: result.id,
        url,
        branch
      };
    }
  )
};
