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

// Protocol implements inspectByName as the full listing plus a find, so every
// suffix lookup downloads every deployment on the account. Hold the listing long
// enough to collapse a burst of lookups - a call that follows an inspectByName,
// a logs call that follows a delete - and short enough that a lookup still
// reflects the account. Readiness polling passes force and never reads it.
const DEPLOYMENTS_TTL_MS = 5000;

let listing: { at: number; deployments: Deployment[] } | undefined;
let inFlight: Promise<Deployment[]> | undefined;
let generation = 0;

export async function listDeployments(force = false): Promise<Deployment[]> {
  if (!force && listing && Date.now() - listing.at < DEPLOYMENTS_TTL_MS) {
    return listing.deployments;
  }

  if (!inFlight) {
    const started = generation;
    // Concurrent lookups wait on one request instead of issuing one each. An
    // in-flight request is fresh by construction, so force shares it too.
    inFlight = api.inspect()
      .then(deployments => {
        // A delete retires a request that may predate it; serve it, do not store it.
        if (started === generation) listing = { at: Date.now(), deployments };
        return deployments;
      })
      .finally(() => { inFlight = undefined; });
  }

  return inFlight;
}

export async function findDeployment(suffix: string, force = false): Promise<Deployment | undefined> {
  return (await listDeployments(force)).find(deployment => deployment.suffix === suffix);
}

export async function requireDeployment(suffix: string, force = false): Promise<Deployment> {
  const deployment = await findDeployment(suffix, force);
  // Protocol's own message for an absent suffix; handlers already report it.
  if (!deployment) throw new Error(`Deployment with suffix '${suffix}' not found`);
  return deployment;
}

// A completed delete leaves the listing wrong rather than stale.
export function invalidateDeployments(): void {
  listing = undefined;
  generation++;
}

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
    return setActiveDeployment(await requireDeployment(suffix));
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
