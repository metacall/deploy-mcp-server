import { deepStrictEqual, match, rejects, strictEqual } from "node:assert";
import type { MCPToolDefinition } from "../server/types.js";

const created = {
  prefix: "test-prefix",
  suffix: "created-suffix",
  version: "v3"
};

describe("Unit Deploy", () => {
  const originalFetch = globalThis.fetch;
  const originalSetTimeout = globalThis.setTimeout;
  const originalToken = process.env.METACALL_TOKEN;
  const originalBaseURL = process.env.METACALL_BASE_URL;
  const requests: string[] = [];
  let statuses: string[] = [];
  let tool: MCPToolDefinition;

  const execute = () => tool.execute({
    name: "package-id",
    plan: "Essential",
    resourceType: "Package",
    release: "main",
    version: "v3"
  });

  before(async () => {
    process.env.METACALL_TOKEN = "invocation-token";
    process.env.METACALL_BASE_URL = "https://dashboard.metacall.io";
    const { tools } = await import("../server/handlers/index.js");
    tool = tools.find(tool => tool.name === "deploy")!;
  });

  beforeEach(() => {
    requests.length = 0;
    statuses = [];
    globalThis.setTimeout = ((callback: () => void) =>
      originalSetTimeout(callback, 0)) as typeof setTimeout;
    globalThis.fetch = async (input, init) => {
      const url = String(input);
      requests.push(url);

      if (url === "https://dashboard.metacall.io/api/deploy/create") {
        strictEqual(init?.method, "POST");
        return Response.json(created);
      }

      if (url === "https://dashboard.metacall.io/api/inspect") {
        return Response.json([{
          ...created,
          status: statuses.shift() ?? "create",
          packages: {},
          ports: []
        }]);
      }

      throw new Error(`Unexpected fetch: ${url}`);
    };
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    globalThis.setTimeout = originalSetTimeout;
  });

  after(() => {
    if (originalToken === undefined) delete process.env.METACALL_TOKEN;
    else process.env.METACALL_TOKEN = originalToken;
    if (originalBaseURL === undefined) delete process.env.METACALL_BASE_URL;
    else process.env.METACALL_BASE_URL = originalBaseURL;
  });

  it("ready", async () => {
    statuses = ["create", "create", "ready"];

    deepStrictEqual(await execute(), {
      message: "Deployment is ready",
      deployment: created
    });
    deepStrictEqual(requests, [
      "https://dashboard.metacall.io/api/deploy/create",
      "https://dashboard.metacall.io/api/inspect",
      "https://dashboard.metacall.io/api/inspect",
      "https://dashboard.metacall.io/api/inspect"
    ]);
  });

  it("failure", async () => {
    statuses = ["create", "fail"];

    await rejects(execute(), (error: Error) => {
      const payload = JSON.parse(error.message);
      strictEqual(payload.type, "RuntimeError");
      match(payload.message, /Deployment 'created-suffix' failed/);
      return true;
    });
    strictEqual(requests.length, 3);
  });

  it("timeout", async () => {
    await rejects(execute(), (error: Error) => {
      const payload = JSON.parse(error.message);
      strictEqual(payload.type, "RuntimeError");
      match(payload.message, /after 100 retries: Deployment not ready yet/);
      return true;
    });
    strictEqual(requests.length, 101);
  });
});
