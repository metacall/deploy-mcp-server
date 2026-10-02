import fs from "fs";
import { stat } from "fs/promises";
import { resolve } from "path";
import {
  generateJsonsFromFiles,
  generatePackage,
  PackageError
} from "@metacall/protocol";
import { api } from "../../protocol/client.js";
import { createToolHandler } from "../toolFactory.js";
import { UploadSchema } from "../schemas/upload.schema.js";
import type { MCPToolDefinition } from "../types.js";
import { zip } from "../../utils/zip.js";

//upload tool definition to upload a zip package to MetaCall Cloud before deploying.
export const uploadTool: MCPToolDefinition = {
  name: "upload",
  description:"Upload a package to MetaCall Cloud. Provide exactly one of:1) projectPath (absolute path to a local project directory, preferred: files, runners and MetaCall JSONs are detected and zipped automatically, so jsons and runners must be omitted)2) zipBase64 (if a zip file is already loaded)3) zipPath (absolute path to a zip file accessible by the MCP server,IMPORTANT PATH RULES:1)The path must be an ABSOLUTE path.2)The file or directory must exist and be accessible to the MCP server. 3)On Windows, escape backslashes or use forward slashes. Examples: Windows: C:\\Users\\username\\Desktop\\function.zip or C:/Users/username/Desktop/function.zip ,Linux / macOS: /home/user/function.zip",
  schema: UploadSchema,

  execute: createToolHandler(
    UploadSchema,
    async ({ name, projectPath, zipPath, zipBase64, jsons = [], runners = [] }) => {

      let bytes: Buffer;

      if (projectPath) {
        const rootPath = resolve(projectPath);
        const stats = await stat(rootPath).catch(() => undefined);

        if (!stats) {
          throw new Error(`Invalid root path: "${rootPath}" not found.`);
        }

        if (!stats.isDirectory()) {
          throw new Error(`Invalid root path: "${rootPath}" is not a directory.`);
        }

        const descriptor = await generatePackage(rootPath);

        switch (descriptor.error) {
          case PackageError.Empty: {
            throw new Error(`The directory you specified (${rootPath}) is empty.`);
          }
          case PackageError.JsonNotFound: {
            // metacall/deploy asks which languages and scripts to load at this point. Without
            // a terminal every detected language is taken, except the "file" catch-all, which
            // matches any extension and would load the whole project as static files.
            jsons = generateJsonsFromFiles(descriptor.files).filter(
              (json) => json.language_id !== "file"
            );

            if (jsons.length === 0) {
              throw new Error(`No metacall.json found in ${rootPath} and no scripts to generate one from, add a metacall.json.`);
            }
            break;
          }
        }

        runners = descriptor.runners;
        bytes = await zip(rootPath, descriptor.files);
      }
      else if (zipPath) {
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