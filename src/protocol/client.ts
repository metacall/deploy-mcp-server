import metacallProtocolImport, { expiresIn } from "@metacall/protocol";
import type { API } from "@metacall/protocol";

if (!process.env.METACALL_TOKEN) {
  throw new Error("Missing METACALL_TOKEN");
}

if (!process.env.METACALL_BASE_URL) {
  throw new Error("Missing METACALL_BASE_URL");
}

// Fix CommonJS default export 
const metacallProtocol =
  (metacallProtocolImport as any).default ??
  metacallProtocolImport;

const baseURL = process.env.METACALL_BASE_URL;
const credentials = new Set([process.env.METACALL_TOKEN]);
let activeCredential = process.env.METACALL_TOKEN;
export let api: API = metacallProtocol(activeCredential, baseURL);

// metacall/faas has no await/refresh and only a logs placeholder. Protocol only routes
// invocations to it when the hostname is literally localhost, not 127.0.0.1 or [::1].
export const local = ["localhost", "127.0.0.1", "[::1]"].includes(
  new URL(baseURL).hostname
);

let refreshing: Promise<void> | undefined;
let renewAfter = 0;
// Match metacall/deploy's renewTime. Decoding exp schedules renewal only; the
// upstream refresh endpoint still authenticates the credential itself.
const RENEW_WINDOW_MS = 15 * 24 * 60 * 60 * 1000;

export async function withAuthentication<T>(operation: () => Promise<T>): Promise<T> {
  if (!local && refreshing) {
    await refreshing;
  } else if (!local && Date.now() >= renewAfter) {
    const remaining = expiresIn(activeCredential);
    // Expired-JWT refresh and expiry-specific HTTP statuses are not documented.
    // Renew only while valid; do not retry operations after arbitrary 401/403s.
    if (remaining > 0 && remaining < RENEW_WINDOW_MS) await refreshAuthentication();
  }
  return operation();
}

export function refreshAuthentication(): Promise<void> {
  if (local) return Promise.reject(new Error("Local FaaS does not support refresh"));

  // Protocol captures its credential in a closure and exposes no setter. All
  // consumers import this live binding, so replacing it updates subsequent calls.
  refreshing ??= (async () => {
    const token = await api.refresh();
    if (!token || /\s/.test(token)) throw new Error("Authentication refresh returned an invalid credential");
    const refreshed = metacallProtocol(token, baseURL);
    credentials.add(token);
    activeCredential = token;
    api = refreshed;
    // A short-lived replacement must not trigger renewal on every operation.
    renewAfter = Date.now() + Math.max(0, expiresIn(token) / 2);
  })().finally(() => { refreshing = undefined; });
  return refreshing;
}

// Exact credentials from this process only; do not guess at secrets in user data.
// Retain retired values in memory so logs/errors cannot echo an earlier credential.
export function redactCredentials(text: string): string {
  for (const credential of credentials) {
    if (local && credential === "local") continue;
    text = text.split(credential).join("[REDACTED]");
  }
  return text;
}
