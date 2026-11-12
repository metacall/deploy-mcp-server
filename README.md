# MetaCall Deploy MCP Server

A [Model Context Protocol](https://modelcontextprotocol.io) server for [MetaCall FaaS](https://github.com/metacall/faas), using [`@metacall/protocol`](https://github.com/metacall/protocol) over stdio. MCP clients can upload projects, manage deployments and invoke functions on MetaCall Cloud or local FaaS. Functions run in FaaS through MetaCall Core.

## Features

- Deployment creation, readiness polling, inspection and deletion
- Project packaging with runner detection and MetaCall JSON generation
- Function invocation through `call` and cloud `await`
- Local FaaS support
- Session context with an active deployment and function catalog
- Deployment resources and deployment/invocation prompts

## Requirements

- Node.js 18 or newer; Node.js 24 is used in CI
- npm
- A MetaCall token for cloud access
- Docker for local FaaS (Docker Desktop on Windows)

## Install

From the repository directory:

```bash
npm ci
npm run build
```

## Configuration

Set these variables in the server process environment. The server does not load `.env` files; `.env.example` is a reference only.

| Variable | Purpose |
| --- | --- |
| `METACALL_TOKEN` | Required startup token for cloud authentication; use `local` for local FaaS. |
| `METACALL_BASE_URL` | Required API URL: `https://dashboard.metacall.io` for cloud or `http://localhost:9100` locally. |
| `METACALL_WORKSPACE_ROOT` | Absolute, existing directory required for `projectPath` and `zipPath` uploads. Paths and resolved symlinks must stay within it. |

`zipBase64` needs no filesystem access or workspace setting. Paths refer to the machine running the server. Choose a workspace containing only projects you intend to upload.

## Running

With the environment configured, start the stdio server:

```bash
node dist/index.js
```

## MCP client configuration

For clients using an `mcpServers` configuration:

```json
{
  "mcpServers": {
    "metacall": {
      "command": "node",
      "args": ["/absolute/path/to/deploy-mcp-server/dist/index.js"],
      "env": {
        "METACALL_TOKEN": "your_token_here",
        "METACALL_BASE_URL": "https://dashboard.metacall.io",
        "METACALL_WORKSPACE_ROOT": "/absolute/path/to/projects"
      }
    }
  }
}
```

On Windows, use absolute paths such as `C:/projects` or escape backslashes in JSON. For local FaaS, set the token to `local` and the base URL to `http://localhost:9100`.

## MCP Inspector

Run [MCP Inspector](https://github.com/modelcontextprotocol/inspector) with Node.js 24 from this repository after starting local FaaS:

```bash
npx @modelcontextprotocol/inspector \
  -e METACALL_TOKEN=local \
  -e METACALL_BASE_URL=http://localhost:9100 \
  -e METACALL_WORKSPACE_ROOT=/tmp \
  node dist/index.js
```

In PowerShell, enter the command on one line and replace `/tmp` with an existing absolute directory, such as `C:/projects`.

## Tools

`?` marks optional arguments; tools with no arguments accept `{}`.

| Tool | Arguments | Purpose |
| --- | --- | --- |
| `validate` | — | Validate authentication. |
| `deployEnabled` | — | Check deployment permission. |
| `refresh` | — | Renew cloud authentication in memory. |
| `listSubscriptions` | — | List account subscription plans. |
| `listSubscriptionsDeploys` | — | List deployments using subscriptions (see note below). |
| `inspect` | — | List deployments and exported functions. |
| `inspectByName` | `suffix` | Inspect and select a deployment. |
| `upload` | `name`, exactly one of `projectPath` / `zipPath` / `zipBase64`, `jsons?`, `runners?` | Upload a package. |
| `deploy` | `name`, `plan`, `resourceType`, `release`, `version`, `env?` | Deploy and wait for readiness. |
| `add` | `url`, `branch`, `jsons?` | Register a Git repository. |
| `deployDelete` | `suffix`, `version?` | Delete a deployment and its package. |
| `branchList` | `url` | List repository branches. |
| `fileList` | `url`, `branch` | List files in a repository branch. |
| `call` | `function`, `suffix?`, `args?` | Invoke a function. |
| `await` | `function`, `suffix?`, `args?` | Invoke an async function on cloud. |
| `logs` | `suffix`, `container` | Read cloud runtime logs. |

For `deploy`, `resourceType` is `Package` or `Repository`. Use the `packageId` returned by `upload` or the `repositoryId` returned by `add` as `name`. `release` is a deployment release identifier, not a Git branch. Cloud deployments require an available subscription plan; check `inspect` and `listSubscriptions` first. `env` defaults to `[]` and contains `{ "name": "KEY", "value": "value" }` entries. `deployDelete.version` defaults to `v1`.

> **Temporary limitation:** `@metacall/protocol` 0.1.35 sends `listSubscriptionsDeploys` to the subscription list endpoint, so it currently returns subscription plan entries rather than deployment associations. This is fixed upstream in [metacall/protocol#61](https://github.com/metacall/protocol/pull/61) but not yet released.

`call` and `await` take a named-argument object in `args`. Omitting `suffix` uses the active deployment, selected by a successful `deploy`, `inspectByName` or invocation with an explicit suffix. Local calls order arguments by the inspected signature when complete and unambiguous; otherwise input order is preserved. Inspection may include MetaCall runtime functions. Cloud log responses are limited to 64 KiB and redact credentials known to the server.

### Project packaging

`projectPath` packages files respecting `.gitignore`, detects dependency runners and uses existing `metacall.json` / `metacall-*.json` files. When none exist, it generates configurations for detected script languages, excluding the static-file catch-all. A project with no scripts needs its own MetaCall JSON. Generated configurations are embedded in the ZIP; the source directory is not changed.

With `projectPath`, omit `jsons` and `runners`. Existing zip uploads may supply them explicitly; supported dependency runners are `nodejs`, `python`, `ruby` and `csharp`. `zipPath` must name a regular `.zip` file. Uploads are limited to 150,000,000 bytes.

## Resources

All resources return JSON. Reading them does not select or change the active deployment.

- `metacall://deployments`: current deployments from FaaS
- `metacall://context`: session target, active deployment and function catalog
- `metacall://deployments/{suffix}`: resource template for current deployment details

## Prompts

Prompts provide guidance without executing tools or changing context.

- `deploy-project`: takes `projectPath` and `name` to guide upload and deployment
- `invoke-function`: takes `function`, optional `suffix` and optional `args` as JSON **text** to guide invocation

## Local FaaS

Build and run upstream FaaS:

```bash
git clone https://github.com/metacall/faas.git
cd faas

docker compose build faas

docker rm -f mcp-faas-e2e 2>/dev/null || true

docker run --rm -d \
  --name mcp-faas-e2e \
  -p 9100:9000 \
  metacall/faas

curl http://localhost:9100/api/readiness
```

Wait for readiness to return `OK` before deploying; retry the check while FaaS starts. FaaS listens on port `9000` inside the container; this maps host `9100` to container `9000`. Another free host port works if `METACALL_BASE_URL` matches. Use literal `localhost`; the server rejects `127.0.0.1` and `[::1]` at startup.

In PowerShell, run `docker run` on one line, omit the Bash-only cleanup redirection, and use `curl.exe` for readiness. Docker Desktop must be running.

### Local example

Create a temporary project outside this repository, within the configured workspace. For the `/tmp` Inspector example, use `/tmp/mcp-local-demo`. On Windows, substitute your project's absolute path.

Save this as `index.js`:

```js
function subtract(a, b) {
  return a - b;
}

module.exports = { subtract };
```

Add a `package.json` containing `{ "name": "mcp-local-demo", "version": "1.0.0" }` to exercise Node runner detection. No `metacall.json` is needed.

Run these tools in order with `METACALL_TOKEN=local` and `METACALL_BASE_URL=http://localhost:9100`:

| Step | Tool | Input |
| --- | --- | --- |
| Upload | `upload` | `{"name":"mcp-local-demo","projectPath":"/tmp/mcp-local-demo"}` |
| Deploy | `deploy` | `{"name":"mcp-local-demo","plan":"Essential","resourceType":"Package","release":"demo","version":"v1"}` |
| Inspect | `inspect` | `{}` |
| Call | `call` | `{"suffix":"mcp-local-demo","function":"subtract","args":{"b":3,"a":10}}` |
| Delete | `deployDelete` | `{"suffix":"mcp-local-demo"}` |

Use the returned `packageId` for deployment and the returned suffix for call/delete. `deploy` reports readiness, `inspect` discovers `subtract(a, b)`, and the reversed input keys still produce `7`. After deletion, `inspect` no longer lists the deployment. Local FaaS ignores cloud plan/release selection and deploys as `v1`.

Remove the temporary project after testing and stop FaaS:

```bash
docker stop mcp-faas-e2e
```

`--rm` removes the stopped container and its local deployment state.

### Local limitations

- `await`, `logs` and `refresh` return unsupported-operation errors locally. Local `call` also waits for async results.
- `@metacall/protocol` routes local invocations only for the hostname `localhost`, so `127.0.0.1` and `[::1]` base URLs are rejected at startup.
- Unignored `.env` files may be packaged; add sensitive files to the project's `.gitignore`.
- Path uploads require `METACALL_WORKSPACE_ROOT` and absolute paths.
- Upload names must be unique; delete before reusing a deployment name.
- Repository tools need network access from FaaS. Local URLs must be HTTP(S) without credentials, query strings, fragments or shell metacharacters; branches must be valid, shell-safe Git branch names.

## Authentication behavior

`METACALL_TOKEN` seeds cloud authentication at startup. Before API requests, the server proactively refreshes a still-valid token nearing expiry. The renewed token stays in memory and serves subsequent tools and API-backed resource reads. It is never returned to the MCP client, written to disk or written back to `process.env.METACALL_TOKEN` or client configuration. Restarting uses the original configured token again. Recovery from a fully expired startup token is not guaranteed by upstream refresh semantics.

## Development

```bash
npm ci
npm run build
npm test
```

Windows Developer Mode may be required for the symlink-based security tests.

## License

Apache License 2.0, see [LICENSE](LICENSE).
