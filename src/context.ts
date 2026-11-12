import type { Deployment } from "@metacall/protocol";
import { api, local } from "./protocol/client.js";

type FunctionContext = {
  name: string;
  async: boolean;
  args: string[];
};

type ActiveDeployment = Pick<Deployment, "prefix" | "suffix" | "version"> & {
  functions: FunctionContext[];
};

// One stdio process owns one session. Retain only identity and signatures.
let activeDeployment: ActiveDeployment | undefined;

export function getContext(): { target: "local" | "cloud"; activeDeployment?: ActiveDeployment } {
  return { target: local ? "local" : "cloud", activeDeployment };
}

export function setActiveDeployment(deployment: Deployment): ActiveDeployment {
  activeDeployment = {
    prefix: deployment.prefix,
    suffix: deployment.suffix,
    version: deployment.version,
    // Inspection has no reliable marker distinguishing runtime and user packages.
    functions: Object.values(deployment.packages ?? {}).flatMap(handles =>
      handles.flatMap(({ scope }) => scope.funcs.map(({ name, async, signature }) => ({
        name, async, args: signature.args.map(arg => arg.name)
      })))
    )
  };
  return activeDeployment;
}

export async function resolveDeployment(suffix?: string): Promise<ActiveDeployment> {
  if (suffix !== undefined) {
    return setActiveDeployment(await api.inspectByName(suffix));
  }
  if (!activeDeployment) {
    throw new Error("No active deployment. Provide a suffix or deploy/inspectByName a deployment first.");
  }
  return activeDeployment;
}

export function clearActiveDeployment(prefix: string, suffix: string, version: string): void {
  // Local FaaS deletes by suffix alone; cloud requests identify a version too.
  if (activeDeployment?.suffix === suffix && (local || (
    activeDeployment.prefix === prefix && activeDeployment.version === version
  ))) {
    activeDeployment = undefined;
  }
}
