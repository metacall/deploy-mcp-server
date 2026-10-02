import { deepStrictEqual, rejects, strictEqual } from "node:assert";
import https from "node:https";
import type { MCPToolDefinition } from "../server/types.js";

const deployments = [
  { prefix: "other-prefix", suffix: "other-suffix", version: "v1" },
  { prefix: "test-prefix", suffix: "test-suffix", version: "v3" }
];

describe("Unit Invocation", () => {
  const requests: { url: string; method: string; body?: BodyInit | null }[] = [];
  const originalFetch = globalThis.fetch;
  const originalRequest = https.request;
  const originalToken = process.env.METACALL_TOKEN;
  const originalBaseURL = process.env.METACALL_BASE_URL;
  let tools: MCPToolDefinition[];
  let invocationStatus: number;

  const execute = (name: string, args: Record<string, unknown>) =>
    tools.find(tool => tool.name === name)!.execute(args);

  before(async () => {
    process.env.METACALL_TOKEN = "invocation-token";
    process.env.METACALL_BASE_URL = "https://dashboard.metacall.io";
    ({ tools } = await import("../server/handlers/index.js"));
  });

  beforeEach(() => {
    requests.length = 0;
    invocationStatus = 200;

    // Keep legacy axios regressions offline too; protocol uses fetch.
    https.request = () => { throw new Error("Unexpected raw HTTPS request"); };
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      requests.push({ url, method: init?.method ?? "GET", body: init?.body });
      strictEqual(new Headers(init?.headers).get("Authorization"), "jwt invocation-token");

      if (url === "https://dashboard.metacall.io/api/inspect") {
        return Response.json(deployments);
      }

      if ([
        "https://v3-test-suffix-test-prefix.api.metacall.io/call/subtract",
        "https://v3-test-suffix-test-prefix.api.metacall.io/await/subtract"
      ].includes(url)) {
        strictEqual(new Headers(init?.headers).get("Content-Type"), "application/json");
        return Response.json(invocationStatus === 200 ? { value: 5 } : { token: "private-data" }, {
          status: invocationStatus,
          statusText: invocationStatus === 200 ? "OK" : "Bad Gateway"
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    https.request = originalRequest;
  });

  after(() => {
    if (originalToken === undefined) delete process.env.METACALL_TOKEN;
    else process.env.METACALL_TOKEN = originalToken;
    if (originalBaseURL === undefined) delete process.env.METACALL_BASE_URL;
    else process.env.METACALL_BASE_URL = originalBaseURL;
  });

  for (const name of ["call", "await"]) {
    it(`${name} protocol invocation`, async () => {
      for (const args of [{ left: 7, right: 2 }, undefined]) {
        requests.length = 0;
        const result = await execute(name, {
          suffix: "test-suffix",
          function: "subtract",
          ...(args === undefined ? {} : { args })
        });

        deepStrictEqual(result, {
          deployment: "test-suffix",
          function: "subtract",
          invocationType: name,
          version: "v3",
          result: { value: 5 }
        });
        deepStrictEqual(requests, [
          { url: "https://dashboard.metacall.io/api/inspect", method: "GET", body: undefined },
          {
            url: `https://v3-test-suffix-test-prefix.api.metacall.io/${name}/subtract`,
            method: "POST",
            body: args === undefined ? "{}" : '{"left":7,"right":2}'
          }
        ]);
      }
    });
  }

  it("missing deployment", async () => {
    for (const name of ["call", "await"]) {
      requests.length = 0;
      await rejects(execute(name, { suffix: "missing", function: "subtract" }), (error: Error) => {
        deepStrictEqual(JSON.parse(error.message), {
          type: "RuntimeError",
          message: "Deployment with suffix 'missing' not found"
        });
        return true;
      });
      deepStrictEqual(requests, [
        { url: "https://dashboard.metacall.io/api/inspect", method: "GET", body: undefined }
      ]);
    }
  });

  it("invocation protocol error", async () => {
    invocationStatus = 502;
    for (const name of ["call", "await"]) {
      await rejects(execute(name, { suffix: "test-suffix", function: "subtract" }), (error: Error) => {
        deepStrictEqual(JSON.parse(error.message), {
          type: "ProtocolError",
          message: `Request to https://v3-test-suffix-test-prefix.api.metacall.io/${name}/subtract failed: Bad Gateway.`,
          status: 502
        });
        return true;
      });
    }
  });
});
