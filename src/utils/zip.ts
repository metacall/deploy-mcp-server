import { createReadStream, type ReadStream } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { Readable } from "node:stream";
import { ZipFile } from "yazl";
import { getWorkspaceRoot, isWithin, workspacePath } from "./workspace.js";
import { bufferUpload, MAX_UPLOAD_BYTES } from "./uploadLimits.js";

// Same layout as metacall/deploy: files come from protocol's generatePackage, already
// relative to the project root with POSIX separators, and are archived under that name.
export const zip = async (source: string, files: string[], maxBytes = MAX_UPLOAD_BYTES): Promise<Buffer> => {
  const root = await getWorkspaceRoot();
  // Validate every discovered file before opening any archive source. Protocol
  // discovery itself follows symlinks; this check prevents packaging escapes.
  const entries = [];
  for (const name of files) {
    const path = resolve(source, name);
    if (isAbsolute(name) || !isWithin(source, path)) throw new Error("Invalid project archive path.");
    entries.push({ name, ...await workspacePath(root, path, "file") });
  }

  const archive = new ZipFile();
  const output = archive.outputStream as Readable;
  const inputs = new Set<ReadStream>();
  archive.on("error", error => {
    for (const input of inputs) input.destroy();
    output.destroy(error);
  });

  try {
    for (const { name, path, stats } of entries) {
      archive.addReadStreamLazy(name, { size: stats.size, mtime: stats.mtime, mode: stats.mode }, callback => {
        const input = createReadStream(path);
        inputs.add(input);
        input.once("close", () => inputs.delete(input));
        input.on("error", error => archive.emit("error", error));
        callback(null, input);
      });
    }
    archive.end();
    return await bufferUpload(output, maxBytes);
  } catch (error) {
    // Setup may throw before the async iterator subscribes to output errors.
    output.destroy();
    archive.emit("error", error);
    throw error;
  }
};
