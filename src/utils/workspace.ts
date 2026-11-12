import { realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";

export const getWorkspaceRoot = async (): Promise<string> => {
  const configured = process.env.METACALL_WORKSPACE_ROOT;
  if (!configured || !isAbsolute(configured)) {
    throw new Error("Set METACALL_WORKSPACE_ROOT to an absolute directory before uploading local paths.");
  }
  const root = await realpath(configured);
  if (!(await stat(root)).isDirectory()) {
    throw new Error("METACALL_WORKSPACE_ROOT must be a directory.");
  }
  return root;
};

export const isWithin = (root: string, path: string): boolean => {
  const child = relative(root, path);
  return child !== ".." && !child.startsWith(`..${sep}`) && !isAbsolute(child);
};

export const workspacePath = async (
  root: string,
  input: string,
  kind: "file" | "directory"
) => {
  if (!isAbsolute(input)) throw new Error("Upload paths must be absolute.");
  const path = await realpath(input);
  if (!isWithin(root, path)) throw new Error("Upload path is outside the configured workspace.");
  const stats = await stat(path);
  if (kind === "directory" ? !stats.isDirectory() : !stats.isFile()) {
    throw new Error(kind === "directory" ? "Upload path is not a directory." : "Upload path must be a regular file.");
  }
  return { path, stats };
};
