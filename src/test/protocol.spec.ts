import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { deepStrictEqual, match, ok, rejects, strictEqual } from "node:assert";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { inflateRawSync } from "node:zlib";

const deployment = {
  status: "ready",
  prefix: "test-prefix",
  suffix: "test-suffix",
  version: "v3"
};

// Returned as the body of a failing request, so it must never reach the client.
const secret = "s3cr3t-refresh-token";

const routes: Record<string, [number, string]> = {
  "/api/package/create": [200, JSON.stringify({ id: "uploaded-package" })],
  "/api/deploy/create": [200, JSON.stringify({ prefix: "test-prefix", suffix: "test-suffix", version: "v1" })],
  "/api/inspect": [200, JSON.stringify([deployment])],
  "/api/deploy/logs": [200, "TODO: Implement Logs..."],
  "/test-prefix/test-suffix/v3/call/subtract": [200, "5"],
  "/validate": [401, JSON.stringify({ token: secret })]
};

const project = async (files: Record<string, string>): Promise<string> => {
  const root = await mkdtemp(join(tmpdir(), "mcp-"));

  for (const [file, content] of Object.entries(files)) {
    await mkdir(dirname(join(root, file)), { recursive: true });
    await writeFile(join(root, file), content);
  }

  return root;
};

const multipart = (body: string): Record<string, string> => {
  const boundary = body.slice(0, body.indexOf("\r\n"));

  return Object.fromEntries(
    body.split(boundary).slice(1, -1).map(part => [
      /name="([^"]+)"/.exec(part)![1],
      part.slice(part.indexOf("\r\n\r\n") + 4, -2)
    ])
  );
};

// Walks the central directory, which is enough for the small archives uploaded here.
const unzip = (archive: Buffer): Record<string, string> => {
  const end = archive.lastIndexOf(Buffer.from("PK\x05\x06", "latin1"));
  const files: Record<string, string> = {};
  let entry = archive.readUInt32LE(end + 16);

  for (let i = 0; i < archive.readUInt16LE(end + 10); i++) {
    const nameLength = archive.readUInt16LE(entry + 28);
    const local = archive.readUInt32LE(entry + 42);
    const start = local + 30 + archive.readUInt16LE(local + 26) + archive.readUInt16LE(local + 28);
    const data = archive.subarray(start, start + archive.readUInt32LE(entry + 20));

    files[archive.toString("utf8", entry + 46, entry + 46 + nameLength)] = (
      archive.readUInt16LE(entry + 10) === 8 ? inflateRawSync(data) : data
    ).toString();

    entry += 46 + nameLength + archive.readUInt16LE(entry + 30) + archive.readUInt16LE(entry + 32);
  }

  return files;
};

describe("Unit Protocol Client", function () {
  this.timeout(60000);

  const requests: { url: string; body: string }[] = [];

  let faas: Server;
  let client: Client;

  const callTool = async (
    name: string,
    args: Record<string, unknown>
  ): Promise<Record<string, unknown>> => {
    const result = await client.callTool({ name, arguments: args });
    const [content] = result.content as { text: string }[];
    return JSON.parse(content.text) as Record<string, unknown>;
  };

  before(async () => {
    faas = createServer((req, res) => {
      const chunks: Buffer[] = [];

      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        const url = req.url ?? "";

        // Multipart bodies carry binary zip bytes, latin1 keeps the part headers intact.
        requests.push({ url, body: Buffer.concat(chunks).toString("latin1") });

        const [status, body] = routes[url] ?? [404, ""];
        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(body);
      });
    });

    await new Promise<void>(resolve => faas.listen(0, "127.0.0.1", resolve));

    client = new Client({ name: "metacall-mcp-server-test", version: "1.0.0" });

    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: ["--dns-result-order=ipv4first", "dist/index.js"],
        env: {
          METACALL_TOKEN: "yeet",
          METACALL_BASE_URL: `http://localhost:${
            (faas.address() as AddressInfo).port
          }`
        }
      })
    );
  });

  after(async () => {
    await client?.close();

    if (faas?.listening) {
      faas.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        faas.close(err => (err ? reject(err) : resolve()))
      );
    }
  });

  it("upload zipBase64", async () => {
    const result = await callTool("upload", {
      name: "uploaded-package",
      zipBase64: Buffer.from("PK").toString("base64")
    });

    strictEqual(result.packageId, "uploaded-package");

    const [upload] = requests.filter(
      request => request.url === "/api/package/create"
    );

    match(
      upload.body,
      /name="raw"[\s\S]*?Content-Type: application\/x-zip-compressed/
    );
  });

  it("upload zipPath", async () => {
    const zipPath = join(await mkdtemp(join(tmpdir(), "mcp-")), "app.zip");
    await writeFile(zipPath, "PK");

    const result = await callTool("upload", {
      name: "uploaded-package",
      zipPath
    });

    strictEqual(result.packageId, "uploaded-package");
  });

  it("upload projectPath", async () => {
    const projectPath = await project({
      ".git/HEAD": "ref: refs/heads/master",
      ".gitignore": "*.log",
      "debug.log": "",
      "index.js": "module.exports = { sum: (a, b) => a + b };",
      "package.json": "{}",
      "requirements.txt": "",
      "src/index.py": "def add(a, b):\n\treturn a + b\n"
    });

    const result = await callTool("upload", {
      name: "uploaded-package",
      projectPath
    });

    strictEqual(result.packageId, "uploaded-package");

    const { body } = requests.filter(
      request => request.url === "/api/package/create"
    ).pop()!;
    const fields = multipart(body);

    match(body, /name="raw"[\s\S]*?Content-Type: application\/x-zip-compressed/);
    deepStrictEqual(JSON.parse(fields.runners).sort(), ["nodejs", "python"]);
    deepStrictEqual(JSON.parse(fields.jsons), [
      { language_id: "node", path: ".", scripts: ["index.js"] },
      { language_id: "py", path: ".", scripts: ["src/index.py"] }
    ]);
    deepStrictEqual(unzip(Buffer.from(fields.raw, "latin1")), {
      "index.js": "module.exports = { sum: (a, b) => a + b };",
      "package.json": "{}",
      "requirements.txt": "",
      "src/index.py": "def add(a, b):\n\treturn a + b\n"
    });
  });

  it("upload projectPath metacall.json", async () => {
    const metacall = JSON.stringify({
      language_id: "py",
      path: ".",
      scripts: ["index.py"]
    });
    const projectPath = await project({
      "index.py": "def add(a, b):\n\treturn a + b\n",
      "metacall.json": metacall
    });

    await callTool("upload", { name: "uploaded-package", projectPath });

    const fields = multipart(requests.filter(
      request => request.url === "/api/package/create"
    ).pop()!.body);

    deepStrictEqual(JSON.parse(fields.jsons), []);
    deepStrictEqual(JSON.parse(fields.runners), []);
    strictEqual(unzip(Buffer.from(fields.raw, "latin1"))["metacall.json"], metacall);
  });

  it("upload invalid source", async () => {
    const start = requests.length;
    const projectPath = join(await project({ "app.zip": "PK" }), "app.zip");

    await rejects(
      callTool("upload", { name: "uploaded-package", projectPath }),
      /is not a directory/
    );
    await rejects(
      callTool("upload", { name: "uploaded-package", projectPath, zipPath: projectPath }),
      /Provide exactly one of projectPath, zipPath or zipBase64/
    );
    await rejects(
      callTool("upload", { name: "uploaded-package", projectPath: tmpdir(), runners: ["python"] }),
      /jsons and runners are detected from projectPath/
    );
    strictEqual(requests.length, start);
  });

  it("protocol error status without response data", () =>
    rejects(callTool("validate", {}), (error: Error) => {
      const payload = JSON.parse(
        error.message.slice(error.message.indexOf("{"))
      ) as Record<string, unknown>;

      strictEqual(payload.type, "ProtocolError");
      strictEqual(payload.status, 401);
      ok(!("code" in payload), "code was an AxiosError field");
      ok(!error.message.includes(secret), "response data must stay hidden");

      return true;
    }));

  it("call local deployment", async () => {
    const start = requests.length;
    const result = await callTool("call", {
      suffix: "test-suffix",
      function: "subtract",
      args: { left: 7, right: 2 }
    });

    deepStrictEqual(result, {
      deployment: "test-suffix",
      function: "subtract",
      invocationType: "call",
      version: "v3",
      result: 5
    });
    deepStrictEqual(requests.slice(start), [
      { url: "/api/inspect", body: "" },
      { url: "/test-prefix/test-suffix/v3/call/subtract", body: '{"left":7,"right":2}' }
    ]);
  });

  it("deploy local deployment", async () => {
    const start = requests.length;
    const result = await callTool("deploy", {
      name: "test-suffix",
      plan: "Essential",
      resourceType: "Package",
      release: "main",
      version: "v1"
    });

    deepStrictEqual(result, {
      message: "Deployment is ready",
      deployment: { prefix: "test-prefix", suffix: "test-suffix", version: "v1" }
    });
    deepStrictEqual(requests.slice(start), [
      {
        url: "/api/deploy/create",
        body: '{"resourceType":"Package","suffix":"test-suffix","release":"main","env":[],"plan":"Essential","version":"v1"}'
      },
      { url: "/api/inspect", body: "" }
    ]);
  });

  it("local unsupported", async () => {
    const start = requests.length;
    const tools: [string, Record<string, unknown>][] = [
      ["await", { suffix: "test-suffix", function: "subtract" }],
      ["logs", { suffix: "test-suffix", container: "node" }],
      ["refresh", {}]
    ];

    for (const [name, args] of tools) {
      await rejects(callTool(name, args), new RegExp(`Local FaaS does not support ${name}`));
    }

    strictEqual(requests.length, start);
  });
});
