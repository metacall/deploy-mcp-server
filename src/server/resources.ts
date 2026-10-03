import { ErrorCode, McpError } from "@modelcontextprotocol/sdk/types.js";
import type { ReadResourceResult, Resource, ResourceTemplate } from "@modelcontextprotocol/sdk/types.js";
import { getContext } from "../context.js";
import { api } from "../protocol/client.js";
import { safeExecute } from "../utils/errorBoundary.js";

export const resources: Resource[] = [
  {
    name: "deployments",
    uri: "metacall://deployments",
    description: "Current deployments from MetaCall.",
    mimeType: "application/json"
  },
  {
    name: "context",
    uri: "metacall://context",
    description: "Session target, active deployment and compact function catalog.",
    mimeType: "application/json"
  }
];

export const resourceTemplates: ResourceTemplate[] = [{
  name: "deployment",
  uriTemplate: "metacall://deployments/{suffix}",
  description: "Current deployment details for a deployment suffix.",
  mimeType: "application/json"
}];

function deploymentSuffix(uri: string): string {
  try {
    const url = new URL(uri);
    const suffix = decodeURIComponent(url.pathname.slice(1));

    if (url.protocol === "metacall:" && url.hostname === "deployments" &&
        !url.username && !url.password && !url.port && !url.search && !url.hash &&
        suffix && !suffix.includes("/")) {
      return suffix;
    }
  } catch {
    // Malformed URLs and percent escapes are not deployment resources.
  }
  throw new McpError(ErrorCode.InvalidParams, "Unknown resource URI");
}

export async function readResource(uri: string): Promise<ReadResourceResult> {
  let data: unknown;

  if (uri === "metacall://context") {
    data = getContext();
  } else if (uri === "metacall://deployments") {
    data = await safeExecute(() => api.inspect());
  } else {
    const suffix = deploymentSuffix(uri);
    // Tools select active deployments; resource reads only observe the protocol.
    data = await safeExecute(() => api.inspectByName(suffix));
  }

  // Serialize immediately so callers receive a snapshot, never context objects.
  return { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(data) }] };
}
