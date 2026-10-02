import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { match, ok, rejects, strictEqual } from "assert";
import { mkdtemp, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";

const deployment = {
  prefix: "test-prefix",
  suffix: "test-suffix",
  version: "v3"
};

// Returned as the body of a failing request, so it must never reach the client.
const secret = "s3cr3t-refresh-token";

const routes: Record<string, [number, string]> = {
  "/api/package/create": [200, JSON.stringify({ id: "uploaded-package" })],
  "/api/inspect": [200, JSON.stringify([deployment])],
  "/api/deploy/logs": [200, "log line"],
  "/validate": [401, JSON.stringify({ token: secret })]
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
        args: ["dist/index.js"],
        env: {
          METACALL_TOKEN: "yeet",
          METACALL_BASE_URL: `http://127.0.0.1:${
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

  it("logs prefix and suffix ordering", async () => {
    const result = await callTool("logs", {
      suffix: "test-suffix",
      container: "node"
    });

    strictEqual(result.logs, "log line");

    const [logs] = requests.filter(
      request => request.url === "/api/deploy/logs"
    );

    strictEqual(
      logs.body,
      JSON.stringify({
        container: "node",
        type: "deploy",
        prefix: "test-prefix",
        suffix: "test-suffix",
        version: "v3"
      })
    );
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
});
