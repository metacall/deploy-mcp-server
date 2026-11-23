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
  let inspectHttp: number[] = [];
  let listed = true;
  let tool: MCPToolDefinition;

  const execute = (args: Record<string, unknown> = {}) => tool.execute({
    name: "package-id",
    plan: "Essential",
    resourceType: "Package",
    release: "main",
    version: "v3",
    ...args
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
    inspectHttp = [];
    listed = true;
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
        const status = inspectHttp.shift() ?? 200;
        if (status !== 200) {
          return new Response("unavailable", { status });
        }

        if (!listed) {
          return Response.json([]);
        }

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
      status: "ready",
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

  it("still building at the deadline is a result, not a failure", async () => {
    const result = await execute() as { status: string; message: string };

    strictEqual(result.status, "create");
    match(result.message, /still building after 30s/);
    match(result.message, /inspectByName/);
    // 30s of protocol's 5s interval is 7 checks, since it sleeps between
    // attempts but not after the last. Plus the deployment request itself. The
    // unbounded default was 100 retries, about 500s inside one tools/call.
    strictEqual(requests.length, 8);
  });

  it("waitSeconds bounds the readiness poll", async () => {
    await execute({ waitSeconds: 10 });
    strictEqual(requests.length, 4);

    requests.length = 0;
    // Zero still reports the status once rather than returning blind.
    await execute({ waitSeconds: 0 });
    strictEqual(requests.length, 2);
  });

  it("a deployment the dashboard has not listed yet counts as building", async () => {
    listed = false;

    const result = await execute({ waitSeconds: 0 }) as { status: string };

    // A deploy response is proof the deployment exists, so absence from the
    // list is "not published yet", never a failed lookup.
    strictEqual(result.status, "create");
  });

  it("a transient inspect failure after the deployment was seen building stays a result", async () => {
    // Two checks observe it building, the third fails: the deployment is known
    // to exist, so the deadline is still a result and not a redeploy prompt.
    inspectHttp = [200, 200, 503];

    const result = await execute({ waitSeconds: 10 }) as { status: string };

    strictEqual(result.status, "create");
    strictEqual(requests.length, 4);
  });

  it("an inspect that never sees the deployment is a failure", async () => {
    inspectHttp = [503];

    await rejects(execute({ waitSeconds: 0 }), (error: Error) => {
      const payload = JSON.parse(error.message);
      strictEqual(payload.type, "RuntimeError");
      // The suffix has to travel with the error for the deployment to be
      // checkable, and the readiness poll has to be named rather than dumped
      // as source text by waitFor.
      match(payload.message, /Could not confirm deployment 'created-suffix'/);
      match(payload.message, /pollReadiness/);
      match(payload.message, /Request to .*\/api\/inspect failed/);
      return true;
    });
  });

  it("rejects a waitSeconds above the ceiling", async () => {
    await rejects(execute({ waitSeconds: 46 }), /45/);
  });
});
