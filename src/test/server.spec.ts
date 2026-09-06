import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { deepStrictEqual, ok, strictEqual } from "assert";

// The tools barrel intentionally leaves out "ready" (unavailable in the dashboard)
// and "invoke" (superseded by "call" and "await"), so neither must be advertised.
const expectedTools = [
  "validate",
  "deployEnabled",
  "refresh",
  "inspect",
  "inspectByName",
  "listSubscriptions",
  "upload",
  "deploy",
  "add",
  "deployDelete",
  "branchList",
  "fileList",
  "listSubscriptionsDeploys",
  "call",
  "await",
  "logs"
];

describe("Unit MCP Server", function () {
  this.timeout(60000);

  let client: Client;
  let tools: Tool[];

  before(async () => {
    client = new Client({ name: "metacall-mcp-server-test", version: "1.0.0" });

    // The server builds its protocol client at import time, so both variables must
    // be present, but neither initialization nor tools/list reaches the API.
    await client.connect(
      new StdioClientTransport({
        command: process.execPath,
        args: ["dist/index.js"],
        env: {
          METACALL_TOKEN: "yeet",
          METACALL_BASE_URL: "https://dashboard.metacall.io"
        }
      })
    );

    ({ tools } = await client.listTools());
  });

  after(async () => {
    await client.close();
  });

  it("server identity", () => {
    deepStrictEqual(client.getServerVersion(), {
      name: "metacall-mcp-server",
      version: "1.0.0"
    });
  });

  it("tools capability", () => {
    deepStrictEqual(client.getServerCapabilities()?.tools, {});
  });

  it("tools/list active tools", () => {
    deepStrictEqual(
      tools.map((tool) => tool.name),
      expectedTools
    );
  });

  it("tools/list tool metadata", () => {
    for (const tool of tools) {
      ok(tool.description, `${tool.name} must be described`);
      strictEqual(tool.inputSchema.type, "object", tool.name);
    }
  });

  it("tools/list upload required arguments", () => {
    const upload = tools.find((tool) => tool.name === "upload");

    // The "provide either zipPath or zipBase64" refinement is a Zod effect and does
    // not survive the JSON Schema conversion, so clients only see "name" required.
    deepStrictEqual(upload?.inputSchema.required, ["name"]);
  });
});
