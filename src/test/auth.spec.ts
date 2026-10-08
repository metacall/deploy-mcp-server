import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { deepStrictEqual, match, ok, rejects, strictEqual } from "node:assert";
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

const sensitive = "private-backend-data";
const credential = (remainingSeconds: number) => [
  Buffer.from('{"alg":"HS256"}').toString("base64url"),
  Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + remainingSeconds })).toString("base64url"),
  "fixture"
].join(".");

describe("Cloud authentication", function () {
  this.timeout(15000);
  let backend: Server;
  let client: Client;
  let refreshStatus: number;
  let requestStatus: number;
  let logs: string;
  let prefix: string;
  let refreshedCredential: string;
  let pendingRefresh: ((response: ServerResponse) => void) | undefined;
  const requests: { url: string; authorization?: string }[] = [];

  const call = (name: string, args: Record<string, unknown> = {}) =>
    client.callTool({ name, arguments: args });

  const connect = async (token = "token-a", local = false) => {
    client = new Client({ name: "cloud-auth-test", version: "1.0.0" });
    await client.connect(new StdioClientTransport({
      command: process.execPath,
      args: ["--dns-result-order=ipv4first", "dist/index.js"],
      env: {
        METACALL_TOKEN: token,
        // The trailing dot keeps the fake backend on loopback while exercising cloud mode.
        METACALL_BASE_URL: `http://${local ? "localhost" : "localhost."}:${(backend.address() as AddressInfo).port}`
      }
    }));
  };

  before(async () => {
    backend = createServer((req, res) => {
      const url = req.url ?? "";
      requests.push({ url, authorization: req.headers.authorization });
      if (url === "/api/account/refresh-token") {
        if (pendingRefresh) return pendingRefresh(res);
        res.writeHead(refreshStatus);
        res.end(refreshStatus === 200 ? refreshedCredential : JSON.stringify({
          body: sensitive, Authorization: "jwt token-a", jwt: "token-b",
          config: { headers: { Authorization: "jwt token-a" } }
        }));
      } else if (url === "/api/inspect") {
        res.setHeader("Content-Type", "application/json");
        res.end(JSON.stringify([{ prefix, suffix: "demo", version: "v1", packages: {} }]));
      } else if (url === "/api/deploy/logs") {
        res.end(logs);
      } else {
        res.writeHead(requestStatus, requestStatus === 200 ? "OK" : "Rejected jwt token-a");
        res.end(requestStatus === 200 ? "true" : sensitive);
      }
    });
    await new Promise<void>(resolve => backend.listen(0, "127.0.0.1", resolve));
  });

  beforeEach(async () => {
    requests.length = 0;
    refreshStatus = 200;
    requestStatus = 200;
    logs = "log line";
    prefix = "p";
    refreshedCredential = "token-b";
    pendingRefresh = undefined;
    await connect();
  });

  afterEach(async () => client?.close());
  after(async () => {
    backend.closeAllConnections();
    await new Promise<void>((resolve, reject) => backend.close(err => err ? reject(err) : resolve()));
  });

  it("refresh activates credential", async () => {
    await call("validate");
    await call("refresh");
    await call("validate");
    await client.readResource({ uri: "metacall://deployments" });
    deepStrictEqual(requests, [
      { url: "/validate", authorization: "jwt token-a" },
      { url: "/api/account/refresh-token", authorization: "jwt token-a" },
      { url: "/validate", authorization: "jwt token-b" },
      { url: "/api/inspect", authorization: "jwt token-b" }
    ]);
  });

  it("near-expiry authentication renews before requests", async () => {
    await client.close();
    const initial = credential(1800);
    refreshedCredential = credential(3600);
    await connect(initial);
    await client.readResource({ uri: "metacall://deployments" });
    await call("validate");
    await call("validate");
    deepStrictEqual(requests, [
      { url: "/api/account/refresh-token", authorization: `jwt ${initial}` },
      { url: "/api/inspect", authorization: `jwt ${refreshedCredential}` },
      { url: "/validate", authorization: `jwt ${refreshedCredential}` },
      { url: "/validate", authorization: `jwt ${refreshedCredential}` }
    ]);
  });

  it("failed preflight stops the operation and permits later refresh", async () => {
    await client.close();
    await connect(credential(1800));
    refreshStatus = 401;
    await rejects(call("validate"), /401/);
    deepStrictEqual(requests.map(req => req.url), ["/api/account/refresh-token"]);
    refreshStatus = 200;
    await call("validate");
    deepStrictEqual(requests.map(req => req.url), [
      "/api/account/refresh-token", "/api/account/refresh-token", "/validate"
    ]);
    strictEqual(requests.at(-1)?.authorization, "jwt token-b");
  });

  it("preflight does not retry a rejected operation", async () => {
    await client.close();
    await connect(credential(1800));
    refreshedCredential = credential(3600);
    requestStatus = 401;
    await rejects(call("validate"), /401/);
    deepStrictEqual(requests.map(req => req.url), ["/api/account/refresh-token", "/validate"]);
  });

  it("expired and long-lived credentials do not trigger speculative refresh", async () => {
    for (const remaining of [-60, 30 * 24 * 60 * 60]) {
      await client.close();
      await connect(credential(remaining));
      requestStatus = remaining < 0 ? 401 : 200;
      if (remaining < 0) await rejects(call("validate"), /401/);
      else await call("validate");
    }
    deepStrictEqual(requests.map(req => req.url), ["/validate", "/validate"]);
  });

  it("local requests never renew even a near-expiry credential", async () => {
    await client.close();
    await connect(credential(1800), true);
    await call("validate");
    await rejects(call("refresh"), /Local FaaS does not support refresh/);
    deepStrictEqual(requests.map(req => req.url), ["/validate"]);
  });

  it("refresh response secrecy", async () => {
    const result = await call("refresh");
    const text = (result.content as { text: string }[])[0].text;
    const response = JSON.parse(text);
    strictEqual(response.success, true);
    ok(!/token|jwt|authorization/i.test(text));
    const context = await client.readResource({ uri: "metacall://context" });
    const prompt = await client.getPrompt({ name: "invoke-function", arguments: { function: "sum" } });
    ok(!/token-a|token-b|Authorization/.test(JSON.stringify({ context, prompt })));
    deepStrictEqual(JSON.parse((context.contents[0] as { text: string }).text), { target: "cloud" });
  });

  it("concurrent refresh shares one request", async () => {
    let release!: ServerResponse;
    const started = new Promise<void>(resolve => {
      pendingRefresh = response => { release = response; resolve(); };
    });
    const first = call("refresh");
    await started;
    const second = call("refresh");
    const operation = call("validate");
    // A subsequent request through the same stdio transport is a barrier: the
    // server has accepted the second refresh before we release the first one.
    await client.listTools();
    pendingRefresh = undefined;
    release.end("token-b");
    await Promise.all([first, second, operation]);
    await call("validate");
    strictEqual(requests.filter(req => req.url.includes("refresh-token")).length, 1);
    ok(requests.filter(req => req.url === "/validate").every(req => req.authorization === "jwt token-b"));
  });

  it("failed refresh stays sanitized", async () => {
    refreshStatus = 401;
    await rejects(call("refresh"), (err: Error) => {
      match(err.message, /refresh/i);
      match(err.message, /401/);
      ok(!/private-backend-data|token-a|token-b|Authorization|config/.test(err.message));
      return true;
    });
    await call("validate");
    strictEqual(requests.at(-1)?.authorization, "jwt token-a");
    strictEqual(requests.filter(req => req.url.includes("refresh-token")).length, 1);
  });

  it("request errors do not guess refreshability", async () => {
    for (const status of [400, 401, 403, 404, 500]) {
      requestStatus = status;
      await rejects(call("validate"), (err: Error) => {
        match(err.message, new RegExp(String(status)));
        ok(!/token-a|private-backend-data/.test(err.message));
        return true;
      });
    }
    strictEqual(requests.length, 5);
    ok(requests.every(req => req.url === "/validate"));
  });

  it("backend echoes cannot disclose credentials through tools or resources", async () => {
    await call("refresh");
    prefix = "token-b";
    const inspection = await call("inspectByName", { suffix: "demo" });
    const context = await client.readResource({ uri: "metacall://context" });
    const deployments = await client.readResource({ uri: "metacall://deployments" });
    const detail = await client.readResource({ uri: "metacall://deployments/demo" });
    ok(!/token-a|token-b/.test(JSON.stringify({ inspection, context, deployments, detail })));
  });

  it("prompt and validation errors redact known credential echoes", async () => {
    await call("refresh");
    const prompt = await client.getPrompt({ name: "invoke-function", arguments: { function: "token-b" } });
    ok(!JSON.stringify(prompt).includes("token-b"));
    for (const [request, expected] of [
      [() => call("token-b"), /Unknown tool/],
      [() => client.getPrompt({ name: "token-b" }), /Unknown prompt/],
      [() => call("deploy", { name: "demo", plan: "Essential", resourceType: "token-b", release: "stable", version: "v1" }), /invalid_enum_value/]
    ] as const) {
      await rejects(request(), (err: Error) => {
        match(err.message, expected);
        ok(!/token-a|token-b/.test(err.message));
        return true;
      });
    }
  });

  it("logs redact known credentials", async () => {
    await call("refresh");
    logs = "before token-a and jwt token-b after";
    const result = await call("logs", { suffix: "demo", container: "node" });
    const text = (result.content as { text: string }[])[0].text;
    ok(!/token-a|token-b/.test(text));
    match(text, /before/);
    match(text, /after/);
  });

  it("logs bound returned text", async () => {
    logs = "é".repeat(32768);
    let result = await call("logs", { suffix: "demo", container: "node" });
    let data = JSON.parse((result.content as { text: string }[])[0].text);
    strictEqual(data.logs, logs);
    ok(!data.truncated);
    logs = "a".repeat(65535) + "étail";
    result = await call("logs", { suffix: "demo", container: "node" });
    data = JSON.parse((result.content as { text: string }[])[0].text);
    strictEqual(data.truncated, true);
    strictEqual(data.originalBytes, 65541);
    ok(Buffer.byteLength(data.logs) <= 65536);
    ok(!data.logs.includes("\ufffd"));
  });
});
