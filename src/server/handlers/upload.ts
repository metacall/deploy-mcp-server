import fs from "fs";
import { api } from "../../protocol/client.js";
import { createToolHandler } from "../toolFactory.js";
import { UploadSchema } from "../schemas/upload.schema.js";
import type { MCPToolDefinition } from "../types.js";

//upload tool definition to upload a zip package to MetaCall Cloud before deploying.
export const uploadTool: MCPToolDefinition = {
  name: "upload",
  description:"Upload a zip package to MetaCall Cloud. Provide either:1) zipBase64 (preferred if file already loaded)2) zipPath (absolute path to a zip file accessible by the MCP server,IMPORTANT PATH RULES:1)The path must be an ABSOLUTE path.2)The file must exist and be accessible to the MCP server. 3)On Windows, escape backslashes or use forward slashes. Examples: Windows: C:\\Users\\username\\Desktop\\function.zip or C:/Users/username/Desktop/function.zip ,Linux / macOS: /home/user/function.zip",
  schema: UploadSchema,

  execute: createToolHandler(
    UploadSchema,
    async ({ name, zipPath, zipBase64, jsons = [], runners = [] }) => {

      let bytes: Buffer;

      if (zipPath) {
        if (!fs.existsSync(zipPath)) {
          throw new Error(`Zip file not found at path: ${zipPath}`);
        }

        bytes = fs.readFileSync(zipPath);
      } 
      else {
        bytes = Buffer.from(zipBase64!, "base64");
      }

      // FaaS rejects file parts whose MIME type is neither application/x-zip-compressed
      // nor application/zip, and api.upload only keeps it for a Blob, not a Readable.
      // Buffer is not a valid BlobPart, hence the view.
      const blob = new Blob([new Uint8Array(bytes)], {
        type: "application/x-zip-compressed"
      });

      const { id } = await api.upload(
        name,
        blob,
        jsons,
        runners
      );

      return {
        success: true,
        packageId: id
      };
    }
  )
};