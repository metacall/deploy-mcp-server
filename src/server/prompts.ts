import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import type { GetPromptResult, Prompt } from "@modelcontextprotocol/sdk/types.js";
import { redactCredentials } from "../protocol/client.js";

export const prompts: Prompt[] = [
  {
    name: "deploy-project",
    description: "Upload a local project, deploy its package and confirm readiness.",
    arguments: [
      { name: "projectPath", description: "Absolute project directory accessible to the server.", required: true },
      { name: "name", description: "Package name to upload.", required: true }
    ]
  },
  {
    name: "invoke-function",
    description: "Invoke a function using the session context or a named deployment.",
    arguments: [
      { name: "function", description: "Function name.", required: true },
      { name: "args", description: "JSON text containing a named-argument object.", required: false },
      { name: "suffix", description: "Deployment suffix; omit to use the active deployment.", required: false }
    ]
  }
];

export function getPrompt(name: string, args: Record<string, string> = {}): GetPromptResult {
  const prompt = prompts.find(prompt => prompt.name === name);
  if (!prompt) {
    throw new McpError(ErrorCode.InvalidParams, `Unknown prompt: ${redactCredentials(name)}`);
  }
  for (const argument of prompt.arguments ?? []) {
    if (argument.required && !args[argument.name]?.trim()) {
      throw new McpError(ErrorCode.InvalidParams, `Missing required argument: ${argument.name}`);
    }
  }

  const text = name === "deploy-project" ? [
    `Deploy the local project at ${JSON.stringify(args.projectPath)} using upload with projectPath and name ${JSON.stringify(args.name)}.`,
    'Use upload\'s returned packageId as deploy\'s name with resourceType "Package". Ask for required plan, release and version if missing; follow deploy\'s prerequisites without assuming a plan.',
    "Wait for deploy to report ready; use inspectByName with the returned suffix if confirmation is needed."
  ].join("\n") : [
    `Invoke function ${JSON.stringify(args.function)}.`,
    args.suffix !== undefined
      ? `Use inspectByName with suffix ${JSON.stringify(args.suffix)} to select the named deployment and inspect its function catalog.`
      : "Use this session's active deployment from metacall://context; omit suffix when invoking. If none is active, ask for a suffix and use inspectByName.",
    args.args !== undefined ? `Use this JSON text as the named-argument object: ${args.args}` : "Ask for any required function arguments.",
    "Match argument names to the function signature/catalog before invoking through call.",
    "Use await only for asynchronous functions on cloud targets; local FaaS does not support await."
  ].join("\n");

  return { messages: [{ role: "user", content: { type: "text", text: redactCredentials(text) } }] };
}
