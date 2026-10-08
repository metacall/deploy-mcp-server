import { deepStrictEqual, doesNotThrow, rejects, strictEqual, throws } from "node:assert";
import { mkdir, mkdtemp, rm, symlink, truncate, writeFile } from "node:fs/promises";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { Readable } from "node:stream";
import type { MCPToolDefinition } from "../server/types.js";
import { zip } from "../utils/zip.js";
import { assertUploadSize, bufferUpload, decodeZipBase64 } from "../utils/uploadLimits.js";

describe("Upload filesystem boundary", () => {
  const originalFetch = globalThis.fetch;
  const originalEnv = {
    METACALL_TOKEN: process.env.METACALL_TOKEN,
    METACALL_BASE_URL: process.env.METACALL_BASE_URL,
    METACALL_WORKSPACE_ROOT: process.env.METACALL_WORKSPACE_ROOT
  };
  let uploadTool: MCPToolDefinition;
  let temporary: string;
  let workspace: string;
  let outside: string;
  const uploads: FormData[] = [];

  const upload = (source: Record<string, unknown>) =>
    uploadTool.execute({ name: "fixture", ...source });

  const denied = async (source: Record<string, unknown>, error: RegExp) => {
    await rejects(upload(source), error);
    strictEqual(uploads.length, 0, "rejected input must not reach the FaaS API");
  };

  before(async () => {
    process.env.METACALL_TOKEN = "upload-test-token";
    process.env.METACALL_BASE_URL = "https://dashboard.metacall.io";
    ({ uploadTool } = await import("../server/handlers/upload.js"));
  });

  beforeEach(async () => {
    temporary = await mkdtemp(join(tmpdir(), "mcp-upload-"));
    workspace = join(temporary, "workspace");
    outside = join(temporary, "workspace-other");
    await mkdir(workspace);
    await mkdir(outside);
    process.env.METACALL_WORKSPACE_ROOT = workspace;
    uploads.length = 0;
    globalThis.fetch = async (_input, init) => {
      uploads.push(init!.body as FormData);
      return Response.json({ id: "fixture" });
    };
  });

  afterEach(async () => {
    globalThis.fetch = originalFetch;
    await rm(temporary, { recursive: true, force: true });
  });

  after(() => {
    for (const [name, value] of Object.entries(originalEnv)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  it("requires an explicit workspace for local paths", async () => {
    await writeFile(join(workspace, "index.js"), "exports.value = 1;");
    delete process.env.METACALL_WORKSPACE_ROOT;
    await denied({ projectPath: workspace }, /METACALL_WORKSPACE_ROOT/);
  });

  it("rejects a relative workspace setting", async () => {
    await writeFile(join(workspace, "app.zip"), "PK");
    process.env.METACALL_WORKSPACE_ROOT = relative(process.cwd(), workspace);
    await denied({ zipPath: join(workspace, "app.zip") }, /workspace.*absolute|METACALL_WORKSPACE_ROOT.*absolute/i);
  });

  it("rejects relative upload paths", async () => {
    await writeFile(join(workspace, "app.zip"), "PK");
    await denied({ zipPath: relative(process.cwd(), join(workspace, "app.zip")) }, /absolute/i);
  });

  it("rejects projects outside the workspace", async () => {
    await writeFile(join(outside, "index.js"), "exports.value = 1;");
    await denied({ projectPath: outside }, /outside.*workspace/i);
    await denied({ projectPath: `${workspace}/../workspace-other` }, /outside.*workspace/i);
  });

  it("rejects sibling-prefix and traversal zip paths", async () => {
    await writeFile(join(outside, "app.zip"), "PK");
    await denied({ zipPath: join(outside, "app.zip") }, /outside.*workspace/i);
    await denied({ zipPath: `${workspace}/../workspace-other/app.zip` }, /outside.*workspace/i);
  });

  it("rejects a zip symlink to an external file", async () => {
    await writeFile(join(outside, "app.zip"), "PK");
    await symlink(join(outside, "app.zip"), join(workspace, "app.zip"));
    await denied({ zipPath: join(workspace, "app.zip") }, /outside.*workspace/i);
  });

  it("rejects a project symlink to an external directory", async () => {
    await writeFile(join(outside, "index.js"), "exports.value = 1;");
    await symlink(outside, join(workspace, "linked"));
    await denied({ projectPath: join(workspace, "linked") }, /outside.*workspace/i);
  });

  it("checks discovered files behind directory symlinks", async () => {
    await writeFile(join(outside, "index.js"), "exports.value = 1;");
    await symlink(outside, join(workspace, "linked"));
    await denied({ projectPath: workspace }, /outside.*workspace/i);
  });

  it("checks discovered file symlinks", async () => {
    await writeFile(join(outside, "index.js"), "exports.value = 1;");
    await symlink(join(outside, "index.js"), join(workspace, "index.js"));
    await denied({ projectPath: workspace }, /outside.*workspace/i);
  });

  it("requires zipPath to name a regular .zip file", async () => {
    await writeFile(join(workspace, "secret.txt"), "private fixture");
    await denied({ zipPath: join(workspace, "secret.txt") }, /\.zip/i);
    await mkdir(join(workspace, "directory.zip"));
    await denied({ zipPath: join(workspace, "directory.zip") }, /regular file/i);
  });

  it("rejects an oversized zip from metadata before reading it", async () => {
    const path = join(workspace, "large.zip");
    await writeFile(path, "");
    // Sparse metadata exercises the real stat boundary without allocating the payload.
    await truncate(path, 150_000_001);
    await denied({ zipPath: path }, /upload.*limit|upload.*exceed/i);
  });

  it("keeps original archive names for contained symlinks and honors .gitignore", async () => {
    await mkdir(join(workspace, "src"));
    await writeFile(join(workspace, "src", "index.js"), "exports.value = 1;");
    await symlink(join(workspace, "src", "index.js"), join(workspace, "alias.js"));
    await writeFile(join(workspace, ".gitignore"), "ignored.txt\n");
    await writeFile(join(workspace, "ignored.txt"), "ignored fixture");
    await writeFile(join(workspace, ".env"), "EXAMPLE=fixture\n");
    await upload({ projectPath: workspace });
    const bytes = Buffer.from(await (uploads[0].get("raw") as Blob).arrayBuffer());
    const end = bytes.lastIndexOf(Buffer.from("PK\x05\x06", "latin1"));
    const names: string[] = [];
    let entry = bytes.readUInt32LE(end + 16);
    for (let i = 0; i < bytes.readUInt16LE(end + 10); i++) {
      const length = bytes.readUInt16LE(entry + 28);
      names.push(bytes.toString("utf8", entry + 46, entry + 46 + length));
      entry += 46 + length + bytes.readUInt16LE(entry + 30) + bytes.readUInt16LE(entry + 32);
    }
    deepStrictEqual(names.sort(), [".env", "alias.js", "src/index.js"]);
  });

  it("allows base64 without filesystem configuration", async () => {
    delete process.env.METACALL_WORKSPACE_ROOT;
    deepStrictEqual(await upload({ zipBase64: "UEs=" }), { success: true, packageId: "fixture" });
    strictEqual(uploads.length, 1);
  });

  it("rejects malformed base64 instead of silently discarding characters", async () => {
    await denied({ zipBase64: "***" }, /base64/i);
  });

  it("stops buffering an archive when its byte ceiling is exceeded", async () => {
    await writeFile(join(workspace, "index.js"), "exports.value = 1;");
    await rejects(zip(workspace, ["index.js"], 20), /upload.*limit|upload.*exceed/i);
  });

  it("closes opened sources when a later archive name is rejected", async function () {
    if (process.platform === "win32") this.skip();
    await writeFile(join(workspace, "index.js"), "exports.value = 1;");
    // Legal on POSIX, but yazl rejects this name as a drive path.
    await writeFile(join(workspace, "C:bad"), "fixture");
    const inputs: fs.ReadStream[] = [];
    const original = fs.createReadStream;
    fs.createReadStream = (path, options) => {
      const input = original(path, options);
      inputs.push(input);
      return input;
    };
    syncBuiltinESMExports();
    try {
      await rejects(zip(workspace, ["index.js", "C:bad"]), /absolute path/i);
      strictEqual(inputs.length, 1);
      strictEqual(inputs[0].destroyed, true, "the already-open source must be closed on setup failure");
    } finally {
      for (const input of inputs) input.destroy();
      fs.createReadStream = original;
      syncBuiltinESMExports();
    }
  });
});

describe("Upload byte limits", () => {
  it("accepts the ceiling and rejects the next byte", () => {
    doesNotThrow(() => assertUploadSize(150_000_000));
    throws(() => assertUploadSize(150_000_001), /limit/i);
  });

  it("checks base64 decoded size, padding and encoded length before allocation", () => {
    strictEqual(decodeZipBase64("UEs=", 2).toString(), "PK");
    strictEqual(decodeZipBase64("UEs", 2).toString(), "PK");
    throws(() => decodeZipBase64("UEs=", 1), /limit/i);
    throws(() => decodeZipBase64("AAAA", 2), /limit/i);
    throws(() => decodeZipBase64("AAAAAAAA", 2), /limit/i);
    for (const encoded of ["A", "AA=", "=AAA", "AA==AAAA", "AA A", "AA\nA"]) {
      throws(() => decodeZipBase64(encoded), /base64/i);
    }
  });

  it("closes the source when streamed bytes exceed the ceiling", async () => {
    const source = Readable.from([Buffer.from("PK"), Buffer.from("extra")]);
    await rejects(bufferUpload(source, 2), /limit/i);
    strictEqual(source.destroyed, true);
  });
});
