import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { deepStrictEqual, match, ok, rejects, strictEqual } from "node:assert";

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

function promptText(result: Awaited<ReturnType<Client["getPrompt"]>>): string {
  ok(result.messages.length > 0, "prompt must contain guidance");
  ok(!JSON.stringify(result).includes("yeet"), "prompt must not expose credentials");
  return result.messages.map(({ content }) => {
    ok(content.type === "text", "prompt guidance must be text");
    return content.text;
  }).join("\n");
}

describe("Unit MCP Server", function () {
  this.timeout(60000);

  let client: Client;
  let tools: Tool[];

  before(async () => {
    client = new Client({ name: "metacall-mcp-server-test", version: "1.0.0" });

    // The server builds its protocol client at import time, so both variables must
    // be present, but initialization, discovery and prompts/get do not reach the API.
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

  it("capabilities", () => {
    deepStrictEqual(client.getServerCapabilities(), {
      tools: {},
      resources: {},
      prompts: {}
    });
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

    // The "exactly one of projectPath, zipPath or zipBase64" refinement is a Zod effect
    // and does not survive the JSON Schema conversion, so clients only see "name" required.
    deepStrictEqual(upload?.inputSchema.required, ["name"]);
  });

  it("resources/list", async () => {
    const { resources } = await client.listResources();
    deepStrictEqual(resources.map(({ uri }) => uri).sort(), [
      "metacall://context",
      "metacall://deployments"
    ]);
  });

  it("resources/templates/list", async () => {
    const { resourceTemplates } = await client.listResourceTemplates();
    deepStrictEqual(resourceTemplates.map(({ uriTemplate }) => uriTemplate), [
      "metacall://deployments/{suffix}"
    ]);
  });

  it("prompts/list", async () => {
    const { prompts } = await client.listPrompts();
    deepStrictEqual(prompts.map(({ name }) => name).sort(), ["deploy-project", "invoke-function"]);

    const deploy = prompts.find(({ name }) => name === "deploy-project");
    const invoke = prompts.find(({ name }) => name === "invoke-function");
    deepStrictEqual(deploy?.arguments?.map(({ name, required }) => ({ name, required: !!required })), [
      { name: "projectPath", required: true },
      { name: "name", required: true }
    ]);
    deepStrictEqual(invoke?.arguments?.map(({ name, required }) => ({ name, required: !!required })), [
      { name: "function", required: true },
      { name: "args", required: false },
      { name: "suffix", required: false }
    ]);
    const argsDescription = invoke?.arguments?.find(({ name }) => name === "args")?.description ?? "";
    match(argsDescription, /JSON/i);
    match(argsDescription, /text|string/i);
    for (const prompt of prompts) ok(prompt.description, `${prompt.name} must be described`);
  });

  it("deploy-project prompt", async () => {
    const projectPath = "/workspace/prompt-fixture";
    const name = "prompt-fixture-project";
    const text = promptText(await client.getPrompt({
      name: "deploy-project",
      arguments: { projectPath, name }
    }));

    ok(text.includes(projectPath));
    ok(text.includes(name));
    for (const keyword of ["upload", "projectPath", "deploy", "ready", "packageId"]) {
      ok(text.includes(keyword), `deployment guidance must mention ${keyword}`);
    }
  });

  for (const suffix of ["prompt-deployment", undefined]) {
    it(`invoke-function ${suffix ? "suffix" : "context"} prompt`, async () => {
      const args = '{"a":7,"b":3}';
      const text = promptText(await client.getPrompt({
        name: "invoke-function",
        arguments: { function: "subtract", args, ...(suffix ? { suffix } : {}) }
      }));

      ok(text.includes("subtract"));
      ok(text.includes(args), "guidance must preserve the explicit JSON arguments");
      match(text, /\bcall\b/);
      match(text, /\bawait\b/);
      match(text, /local[^.\n]*(?:unsupported|does not support|not supported)[^.\n]*await/i);
      if (suffix) {
        ok(text.includes(suffix));
        ok(text.includes("inspectByName"));
      } else {
        match(text, /active deployment/i);
        ok(text.includes("metacall://context"));
      }
    });
  }

  it("missing prompt argument", async () => {
    await rejects(client.getPrompt({ name: "deploy-project", arguments: { name: "fixture" } }), /projectPath/i);
    await rejects(client.getPrompt({ name: "deploy-project", arguments: { projectPath: "/workspace/fixture" } }), /name/i);
    await rejects(client.getPrompt({ name: "invoke-function", arguments: {} }), /function/i);
  });

  it("unknown prompt", async () => {
    await rejects(client.getPrompt({ name: "unknown-workflow" }), /unknown prompt|prompt.*not found/i);
  });

  it("invocation without context", async () => {
    for (const name of ["call", "await"]) {
      deepStrictEqual(tools.find(tool => tool.name === name)?.inputSchema.required, ["function"]);
      await rejects(client.callTool({ name, arguments: { function: "subtract" } }),
        /No active deployment.*suffix.*deploy.*inspect/i);
    }
  });
});
