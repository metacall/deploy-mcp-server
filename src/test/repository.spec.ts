import { deepStrictEqual, match, strictEqual } from "node:assert";
import { spawnSync } from "node:child_process";

type RepositoryCall = {
  tool: "add" | "branchList" | "fileList";
  url: string;
  branch?: string;
};

function execute(baseURL: string, calls: RepositoryCall[]) {
  // The protocol client captures its environment at import time. Isolate each
  // backend without changing the module state used by the other test suites.
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", `
    const requests = [];
    globalThis.fetch = async (input, init) => {
      const url = new URL(input);
      requests.push({ path: url.pathname, body: JSON.parse(init.body) });
      if (url.pathname === '/api/repository/add') return Response.json({ id: 'owner-repo' });
      if (url.pathname === '/api/repository/branchlist') return Response.json({ branches: ['main'] });
      if (url.pathname === '/api/repository/filelist') return Response.json({ files: ['index.js'] });
      throw new Error('Unexpected request');
    };
    const results = [];
    for (const { tool, ...args } of JSON.parse(process.env.REPOSITORY_CALLS)) {
      const moduleURL = new URL(tool + '.js', process.env.REPOSITORY_HANDLERS);
      const handler = (await import(moduleURL))[tool + 'Tool'];
      const start = requests.length;
      try {
        results.push({ value: await handler.execute(args), requests: requests.slice(start) });
      } catch (error) {
        results.push({ error: error.message, requests: requests.slice(start) });
      }
    }
    process.stdout.write(JSON.stringify(results));
  `], {
    encoding: "utf8",
    timeout: 10000,
    env: {
      ...process.env,
      METACALL_TOKEN: "repository-test-token",
      METACALL_BASE_URL: baseURL,
      REPOSITORY_HANDLERS: new URL("../server/handlers/", import.meta.url).href,
      REPOSITORY_CALLS: JSON.stringify(calls)
    }
  });
  strictEqual(result.status, 0, result.stderr || result.error?.message);
  return JSON.parse(result.stdout) as {
    value?: unknown;
    error?: string;
    requests: { path: string; body: unknown }[];
  }[];
}

describe("Repository input security", () => {
  const url = "https://git.example.test/owner-name/repo-name.git";
  const tools = ["add", "branchList", "fileList"] as const;

  it("rejects unsafe local repository URLs before making requests", () => {
    const urls = [
      "https://example.test/repo.git;id",
      "https://example.test/$(id)",
      "https://example.test/`id`",
      "https://example.test/repo.git\nid",
      "https://example.test/repo.git\n",
      "https://example.test/repo.git\r",
      "https://example.test/repo.git\t",
      "https://example.test/repo name.git",
      "https://example.test/repo'quoted.git",
      "https://example.test/repo&other.git",
      "https://example.test/repo|other.git",
      "https://example.test/repo>other.git",
      "https://example.test/repo*.git",
      "https://example.test/repo\\name.git",
      "https://secret:password@example.test/repo.git",
      "https://example.test/repo.git?token=secret",
      "https://example.test/repo.git#secret",
      "file:///tmp/repo",
      "ext::sh -c id"
    ];
    const calls = urls.flatMap(url => tools.map(tool => ({ tool, url, branch: "main" })));
    const results = execute("http://localhost:9000", calls);
    for (let index = 0; index < results.length; index++) {
      const result = results[index];
      match(result.error ?? "", /Local FaaS.*repository URL/i, JSON.stringify(calls[index]));
      strictEqual(result.error!.includes(calls[index].url), false);
      strictEqual(result.error!.includes("secret"), false);
      deepStrictEqual(result.requests, []);
    }
  });

  it("rejects unsafe or invalid local branches before making requests", () => {
    const branches = [
      "main;id", "$(id)", "`id`", "main\nid", "main other", "main\"other",
      "main'other", "main&other", "main|other", "main>other", "#main",
      "--upload-pack=other", "/main", "main/", "main//other", ".main", "main/.other",
      "main..other", "main.lock", "main.lock/other", "main.", "HEAD", "@", "@{1}",
      "main~1", "main^1", "main:other", "main?", "main*", "main[1]", "main\\other"
    ];
    const calls = branches.flatMap(branch => (["add", "fileList"] as const).map(tool => ({ tool, url, branch })));
    const results = execute("http://localhost:9000", calls);
    for (let index = 0; index < results.length; index++) {
      match(results[index].error ?? "", /Local FaaS.*branch/i, JSON.stringify(calls[index]));
      deepStrictEqual(results[index].requests, []);
    }
  });

  it("preserves local repository and valid branch values", () => {
    const calls: RepositoryCall[] = [
      { tool: "branchList", url },
      { tool: "add", url, branch: "feature/fix-issue_42.v2" },
      { tool: "fileList", url: "http://git.example.test:8080/owner/repo.git", branch: "release+fix@team" }
    ];
    const results = execute("http://localhost:9000", calls);
    deepStrictEqual(results, [
      { value: { repository: url, branches: ["main"] }, requests: [{ path: "/api/repository/branchlist", body: { url } }] },
      { value: { repositoryId: "owner-repo", url, branch: "feature/fix-issue_42.v2" }, requests: [{ path: "/api/repository/add", body: { url, branch: "feature/fix-issue_42.v2", jsons: [] } }] },
      { value: { repository: "http://git.example.test:8080/owner/repo.git", branch: "release+fix@team", files: ["index.js"] }, requests: [{ path: "/api/repository/filelist", body: { url: "http://git.example.test:8080/owner/repo.git", branch: "release+fix@team" } }] }
    ]);
  });

  it("does not apply local restrictions to cloud repository inputs", () => {
    const cloudURL = "ssh://git@example.test/owner/repo.git?ref=main#branch";
    const calls = tools.map(tool => ({ tool, url: cloudURL, branch: "release;candidate" }));
    const results = execute("https://dashboard.metacall.io", calls);
    for (let index = 0; index < results.length; index++) {
      strictEqual(results[index].error, undefined);
      deepStrictEqual(results[index].requests, [{
        path: `/api/repository/${tools[index].toLowerCase()}`,
        body: tools[index] === "branchList" ? { url: cloudURL }
          : { url: cloudURL, branch: "release;candidate", ...(tools[index] === "add" ? { jsons: [] } : {}) }
      }]);
    }
  });
});
