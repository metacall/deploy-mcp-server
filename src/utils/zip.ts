import { join } from "node:path";
import { ZipFile } from "yazl";

// Same layout as metacall/deploy: files come from protocol's generatePackage, already
// relative to the project root with POSIX separators, and are archived under that name.
export const zip = (source: string, files: string[]): Promise<Buffer> => {
  const archive = new ZipFile();

  for (const file of files) {
    archive.addFile(join(source, file), file);
  }

  archive.end();

  return new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    archive.on("error", reject);
    archive.outputStream.on("data", (chunk: Buffer) => chunks.push(chunk));
    archive.outputStream.on("end", () => resolve(Buffer.concat(chunks)));
  });
};
