// Local FaaS interpolates these values, and a directory derived from the raw
// URL, into child_process.exec commands. Do not normalize or shell-escape them:
// accept safe inputs unchanged and reject unsupported local forms before I/O.
export function validateLocalRepository(url: string, branch?: string): void {
  const invalidURL = () => new Error(
    "Local FaaS repository URL must be an HTTP(S) URL with shell-safe characters and no credentials, query, or fragment"
  );
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw invalidURL();
  }
  if (
    !["http:", "https:"].includes(parsed.protocol) ||
    parsed.username || parsed.password || parsed.search || parsed.hash ||
    !/^[A-Za-z0-9:/._~%-]+$/.test(url)
  ) {
    throw invalidURL();
  }

  if (branch !== undefined && (
    branch === "HEAD" || branch === "@" || branch.startsWith("-") || branch.startsWith("#") ||
    branch.endsWith(".") || branch.includes("..") ||
    /[\s\x00-\x1f\x7f~^:?*[\]\\`$"';&|<>(){}]/u.test(branch) ||
    branch.split("/").some(part => !part || part.startsWith(".") || part.endsWith(".lock"))
  )) {
    throw new Error("Local FaaS branch must be a valid Git branch name without shell metacharacters");
  }
}
