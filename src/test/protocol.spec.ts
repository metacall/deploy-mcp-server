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
  version: "v3",
  packages: {
    node: [{
      name: "index.js",
      scope: {
        name: "index.js",
        funcs: [{
          name: "subtract",
          signature: {
            ret: { type: { name: "double", id: 6 } },
            args: ["a", "b"].map(name => ({ name, type: { name: "double", id: 6 } }))
          },
          async: false
        }],
        classes: [],
        objects: []
      }
    }]
  },
  ports: []
};

const otherDeployment = { ...deployment, prefix: "other-prefix", suffix: "other-suffix", version: "v7" };

// Returned as the body of a failing request, so it must never reach the client.
const secret = "s3cr3t-refresh-token";

const routes: Record<string, [number, string]> = {
  "/api/package/create": [200, JSON.stringify({ id: "uploaded-package" })],
  "/api/deploy/create": [200, JSON.stringify({ prefix: "test-prefix", suffix: "test-suffix", version: "v1" })],
  "/api/deploy/logs": [200, "TODO: Implement Logs..."],
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
  let inspections: typeof deployment[];
  let inspectStatus: number;
  let deleteStatus: number;

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
        const requestBody = Buffer.concat(chunks).toString("latin1");
        requests.push({ url, body: requestBody });

        let [status, body] = routes[url] ?? [404, ""];

        if (url === "/api/inspect") {
          [status, body] = [inspectStatus, JSON.stringify(inspectStatus === 200 ? inspections : { token: secret })];
        } else if (url === "/api/deploy/delete") {
          [status, body] = [deleteStatus, JSON.stringify("deleted")];
        } else if ([deployment, otherDeployment].some(({ prefix, suffix, version }) =>
          url === `/${prefix}/${suffix}/${version}/call/subtract`
        )) {
          // Local FaaS invokes positional arguments in JSON object key order.
          const [a, b] = Object.values(JSON.parse(requestBody)) as number[];
          [status, body] = [200, JSON.stringify(a - b)];
        }

        res.writeHead(status, { "Content-Type": "application/json" });
        res.end(body);
      });
    });

    await new Promise<void>(resolve => faas.listen(0, "127.0.0.1", resolve));
  });

  beforeEach(async () => {
    requests.length = 0;
    inspections = [deployment, otherDeployment];
    inspectStatus = 200;
    deleteStatus = 200;
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

  afterEach(async () => client?.close());

  after(async () => {
    if (faas?.listening) {
      faas.closeAllConnections();
      await new Promise<void>((resolve, reject) =>
        faas.close(err => (err ? reject(err) : resolve()))
      );
    }
  });

  const readResource = async (uri: string) => {
    const { contents } = await client.readResource({ uri });
    strictEqual(contents.length, 1);
    strictEqual(contents[0].uri, uri);
    strictEqual(contents[0].mimeType, "application/json");
    ok("text" in contents[0]);
    return JSON.parse(contents[0].text);
  };

  it("empty context resource", async () => {
    deepStrictEqual(await readResource("metacall://context"), { target: "local" });
    strictEqual(requests.length, 0);
  });

  it("context resource", async () => {
    await callTool("inspectByName", { suffix: "test-suffix" });
    await callTool("call", { function: "subtract", args: { a: 10, b: 3 } });
    const start = requests.length;
    const expected = {
      target: "local",
      activeDeployment: {
        prefix: "test-prefix", suffix: "test-suffix", version: "v3",
        functions: [{ name: "subtract", async: false, args: ["a", "b"] }]
      }
    };

    deepStrictEqual(await readResource("metacall://context"), expected);
    deepStrictEqual(await readResource("metacall://context"), expected);
    strictEqual(requests.length, start);
  });

  it("deployment list resource", async () => {
    await callTool("inspectByName", { suffix: "other-suffix" });
    const context = await readResource("metacall://context");
    const start = requests.length;

    deepStrictEqual(await readResource("metacall://deployments"), [deployment, otherDeployment]);
    inspections = [deployment];
    deepStrictEqual(await readResource("metacall://deployments"), [deployment]);
    deepStrictEqual(await readResource("metacall://context"), context);
    deepStrictEqual(requests.slice(start), [
      { url: "/api/inspect", body: "" },
      { url: "/api/inspect", body: "" }
    ]);
  });

  it("deployment detail resource", async () => {
    await callTool("inspectByName", { suffix: "other-suffix" });
    const context = await readResource("metacall://context");
    const start = requests.length;

    deepStrictEqual(await readResource("metacall://deployments/test-suffix"), deployment);
    inspections = [{ ...deployment, version: "v4" }];
    deepStrictEqual(await readResource("metacall://deployments/test%2Dsuffix"), inspections[0]);
    deepStrictEqual(await readResource("metacall://context"), context);
    deepStrictEqual(requests.slice(start), [
      { url: "/api/inspect", body: "" },
      { url: "/api/inspect", body: "" }
    ]);
  });

  it("resource errors", async () => {
    await callTool("inspectByName", { suffix: "other-suffix" });
    const context = await readResource("metacall://context");
    await rejects(client.readResource({ uri: "metacall://deployments/does-not-exist" }),
      /does-not-exist.*not found/i);
    inspectStatus = 503;

    for (const uri of ["metacall://deployments", "metacall://deployments/test-suffix"]) {
      await rejects(client.readResource({ uri }), (error: Error) => {
        match(error.message, /ProtocolError/);
        match(error.message, /503/);
        ok(!error.message.includes(secret));
        return true;
      });
    }
    deepStrictEqual(await readResource("metacall://context"), context);
  });

  it("invalid resource URI", async () => {
    for (const uri of [
      "file:///etc/passwd", "metacall://unknown", "metacall://deployments/",
      "metacall://deployments/test-suffix/functions", "metacall://deployments/%zz",
      "metacall://deployments/test-suffix?extra=1", "metacall://deployments/test-suffix#extra",
      "metacall://user@deployments/test-suffix", "metacall://deployments:123/test-suffix"
    ]) {
      await rejects(client.readResource({ uri }), /resource.*URI|unknown resource/i);
    }
    strictEqual(requests.length, 0);
  });

  it("prompts leave context", async () => {
    await callTool("inspectByName", { suffix: "other-suffix" });
    const context = await readResource("metacall://context");
    const start = requests.length;

    await client.getPrompt({ name: "deploy-project", arguments: { projectPath: "/unused", name: "demo" } });
    await client.getPrompt({ name: "invoke-function", arguments: { function: "subtract", suffix: "test-suffix" } });
    deepStrictEqual(await readResource("metacall://context"), context);
    strictEqual(requests.length, start);
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

  it("local argument order", async () => {
    const start = requests.length;
    const result = await callTool("call", {
      suffix: "test-suffix",
      function: "subtract",
      args: { b: 3, a: 10 }
    });

    deepStrictEqual(result, {
      deployment: "test-suffix",
      function: "subtract",
      invocationType: "call",
      version: "v3",
      result: 7
    });
    deepStrictEqual(requests.slice(start), [
      { url: "/api/inspect", body: "" },
      { url: "/test-prefix/test-suffix/v3/call/subtract", body: '{"a":10,"b":3}' }
    ]);
  });

  it("local argument fallback", async () => {
    const handle = deployment.packages.node[0];
    const fn = handle.scope.funcs[0];
    const cases: [typeof fn[], Record<string, number>, string, number | null][] = [
      [[fn], { extra: 99, b: 3, a: 10 }, '{"a":10,"b":3,"extra":99}', 7],
      [[], { b: 3, a: 10 }, '{"b":3,"a":10}', -7],
      [[fn, fn], { b: 3, a: 10 }, '{"b":3,"a":10}', -7],
      [[{ ...fn, signature: { ...fn.signature, args: [fn.signature.args[0], fn.signature.args[0]] } }],
        { extra: 99, a: 10 }, '{"extra":99,"a":10}', 89],
      [[fn], { b: 3 }, '{"b":3}', null]
    ];

    for (const [funcs, args, body, expected] of cases) {
      inspections = [{
        ...deployment,
        packages: { node: [{ ...handle, scope: { ...handle.scope, funcs } }] }
      }];
      const result = await callTool("call", { suffix: "test-suffix", function: "subtract", args });

      strictEqual(result.result, expected);
      strictEqual(requests.at(-1)?.body, body);
    }
  });

  it("missing context", async () => {
    await rejects(callTool("call", { function: "subtract", args: { a: 7, b: 2 } }), (error: Error) => {
      match(error.message, /no active deployment|no deployment.*context/i);
      match(error.message, /deploy|inspectByName|suffix/i);
      return true;
    });
    strictEqual(requests.length, 0);
  });

  it("deploy context", async () => {
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
    deepStrictEqual(await callTool("call", { function: "subtract", args: { b: 2, a: 7 } }), {
      deployment: "test-suffix",
      function: "subtract",
      invocationType: "call",
      version: "v3",
      result: 5
    });
    deepStrictEqual(requests.slice(start), [
      {
        url: "/api/deploy/create",
        body: '{"resourceType":"Package","suffix":"test-suffix","release":"main","env":[],"plan":"Essential","version":"v1"}'
      },
      { url: "/api/inspect", body: "" },
      { url: "/test-prefix/test-suffix/v3/call/subtract", body: '{"a":7,"b":2}' }
    ]);
  });

  it("inspectByName context", async () => {
    const inspected = await callTool("inspectByName", { suffix: "test-suffix" });
    strictEqual(inspected.found, true);
    const result = await callTool("call", { function: "subtract", args: { b: 3, a: 10 } });

    strictEqual(result.result, 7);
    strictEqual(result.version, "v3");
    deepStrictEqual(requests, [
      { url: "/api/inspect", body: "" },
      { url: "/test-prefix/test-suffix/v3/call/subtract", body: '{"a":10,"b":3}' }
    ]);
  });

  it("explicit suffix", async () => {
    await callTool("inspectByName", { suffix: "test-suffix" });
    const start = requests.length;
    await callTool("call", { suffix: "other-suffix", function: "subtract", args: { b: 4, a: 11 } });
    const result = await callTool("call", { function: "subtract", args: { b: 2, a: 12 } });

    strictEqual(result.deployment, "other-suffix");
    strictEqual(result.version, "v7");
    strictEqual(result.result, 10);
    deepStrictEqual(requests.slice(start), [
      { url: "/api/inspect", body: "" },
      { url: "/other-prefix/other-suffix/v7/call/subtract", body: '{"a":11,"b":4}' },
      { url: "/other-prefix/other-suffix/v7/call/subtract", body: '{"a":12,"b":2}' }
    ]);
  });

  it("inspect leaves context", async () => {
    await callTool("inspect", {});
    await rejects(callTool("call", { function: "subtract" }), /no active deployment|no deployment.*context/i);
    await callTool("inspectByName", { suffix: "test-suffix" });
    inspections = [otherDeployment];
    await callTool("inspect", {});
    const start = requests.length;
    const result = await callTool("call", { function: "subtract", args: { b: 2, a: 7 } });

    strictEqual(result.deployment, "test-suffix");
    strictEqual(result.result, 5);
    deepStrictEqual(requests.slice(start), [
      { url: "/test-prefix/test-suffix/v3/call/subtract", body: '{"a":7,"b":2}' }
    ]);
  });

  it("unrelated or failed delete", async () => {
    await callTool("inspectByName", { suffix: "test-suffix" });
    await callTool("deployDelete", { suffix: "other-suffix", version: "v7" });
    strictEqual((await callTool("call", { function: "subtract", args: { a: 7, b: 2 } })).result, 5);

    deleteStatus = 500;
    await rejects(callTool("deployDelete", { suffix: "test-suffix", version: "v3" }));
    const start = requests.length;
    strictEqual((await callTool("call", { function: "subtract", args: { a: 10, b: 3 } })).result, 7);
    deepStrictEqual(requests.slice(start), [
      { url: "/test-prefix/test-suffix/v3/call/subtract", body: '{"a":10,"b":3}' }
    ]);
  });

  it("local delete clears context", async () => {
    await callTool("inspectByName", { suffix: "test-suffix" });
    await callTool("deployDelete", { suffix: "test-suffix", version: "v1" });
    deepStrictEqual(requests.at(-1), {
      url: "/api/deploy/delete",
      body: '{"prefix":"test-prefix","suffix":"test-suffix","version":"v1"}'
    });
    const start = requests.length;

    await rejects(callTool("call", { function: "subtract", args: { a: 7, b: 2 } }), /no active deployment|no deployment.*context/i);
    strictEqual(requests.length, start);
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
