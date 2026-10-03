# MetaCall Deploy MCP Server

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server for [MetaCall FaaS](https://metacall.io). It exposes the FaaS API from [`@metacall/protocol`](https://github.com/metacall/protocol) as MCP tools over stdio, so an MCP client can upload projects, deploy them, inspect deployments and call their functions, either on [MetaCall Cloud](https://dashboard.metacall.io) or on a local [MetaCall FaaS](https://github.com/metacall/faas).

```text
MCP client
   │  stdio
   ▼
deploy-mcp-server
   │
   ▼
@metacall/protocol
   │  HTTP
   ▼
MetaCall FaaS (cloud or local)
   │
   ▼
MetaCall Core
```

The server never runs user code itself. Functions run inside FaaS, on MetaCall Core.

## Features

- Upload a local project directory, a zip file or a base64 encoded zip
- Deploy packages or Git repositories, and wait until the deployment is ready
- Call deployed functions
- Inspect and delete deployments
- Query account, subscription and repository information

## Install

Requires Node.js 18 or newer.

```bash
git clone https://github.com/metacall/deploy-mcp-server.git
cd deploy-mcp-server
npm ci
npm run build
```

## Configuration

The server reads two environment variables, both required. It fails to start if either is missing, and it does not load `.env` files.

| Variable            | Description                |
| ------------------- | -------------------------- |
| `METACALL_TOKEN`    | MetaCall API token         |
| `METACALL_BASE_URL` | Base URL of the FaaS API   |

```bash
# MetaCall Cloud
METACALL_BASE_URL=https://dashboard.metacall.io
METACALL_TOKEN=<your token>

# Local FaaS (see below)
METACALL_BASE_URL=http://localhost:9100
METACALL_TOKEN=local
```

For the cloud, get a token from the [dashboard](https://dashboard.metacall.io). If you have logged in with [`metacall-deploy`](https://github.com/metacall/deploy), the token is also stored in `~/.metacall/deploy/config.ini`.

Local FaaS does not check tokens. `local` is just the placeholder `metacall-deploy --dev` uses; it is not a cloud credential.

## Run

The server speaks MCP over stdio, so normally your MCP client starts it:

```bash
METACALL_TOKEN=... \
METACALL_BASE_URL=... \
node dist/index.js
```

For clients configured with an `mcpServers` JSON file, the entry looks like this (on Windows, escape the backslashes in the path):

```json
{
  "mcpServers": {
    "metacall-faas": {
      "command": "node",
      "args": ["/absolute/path/to/deploy-mcp-server/dist/index.js"],
      "env": {
        "METACALL_TOKEN": "<your token>",
        "METACALL_BASE_URL": "https://dashboard.metacall.io"
      }
    }
  }
}
```

## MCP Inspector

[MCP Inspector](https://github.com/modelcontextprotocol/inspector) is handy for trying the tools by hand. Pass the environment with `-e` so it reaches the server process:

```bash
npx @modelcontextprotocol/inspector \
  -e METACALL_TOKEN=local \
  -e METACALL_BASE_URL=http://localhost:9100 \
  node dist/index.js
```

Inspector has its own Node.js requirement (currently 22.19 or newer).

## Tools

| Tool                       | Arguments                                                    | Description                                                         |
| -------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------- |
| `validate`                 |                                                              | Check that the token is valid                                       |
| `deployEnabled`            |                                                              | Check that the account is allowed to deploy                         |
| `refresh`                  |                                                              | Get a new token                                                     |
| `listSubscriptions`        |                                                              | List subscription plans and how many of each the account has        |
| `listSubscriptionsDeploys` |                                                              | List the subscriptions being used by deployments                    |
| `inspect`                  |                                                              | List deployments with their status and exported functions           |
| `inspectByName`            | `suffix`                                                     | Get a single deployment                                             |
| `upload`                   | `name`, one of `projectPath` / `zipPath` / `zipBase64`       | Upload a package                                                    |
| `deploy`                   | `name`, `plan`, `resourceType`, `release`, `version`, `env?` | Deploy an uploaded package or added repository and wait until ready |
| `add`                      | `url`, `branch`, `jsons?`                                    | Register a Git repository for deployment                            |
| `deployDelete`             | `suffix`, `version?`                                         | Delete a deployment                                                 |
| `branchList`               | `url`                                                        | List the branches of a Git repository                               |
| `fileList`                 | `url`, `branch`                                              | List the files of a repository branch                               |
| `call`                     | `suffix`, `function`, `args?`                                | Call a function of a deployment                                     |
| `await`                    | `suffix`, `function`, `args?`                                | Call an async function of a deployment                              |
| `logs`                     | `suffix`, `container`                                        | Get the deployment logs of a runtime container                      |

Notes:

- `deploy`: `plan` is `Essential`, `Standard` or `Premium`. On the cloud it must be a plan returned by `listSubscriptions`. `resourceType` is `Package` for uploads and `Repository` for repositories, in which case `name` is the id returned by `add`. `env` is a list of `{ "name": ..., "value": ... }`.
- `call` and `await`: `args` is an object with the function arguments, e.g. `{ "a": 5, "b": 3 }`.
- `deployDelete`: `version` defaults to `v1`.

### Uploading a project

With `projectPath`, the server packages the directory itself:

```text
list the project files (respecting .gitignore)
→ detect the runners needed to install dependencies (package.json, requirements.txt, ...)
→ generate MetaCall JSON when the project has none
→ zip
→ upload
```

If the project has a `metacall.json` (or `metacall-*.json`), it is used as is. Otherwise one is generated for each script language found (`.js`, `.ts`, `.py`, `.rb`, `.cs`, ...), loading every script of that language. Other files are packaged but not loaded. If no script is found, the upload fails and asks for a `metacall.json`.

`zipPath` and `zipBase64` upload an existing zip. With those, `jsons` and `runners` (`nodejs`, `python`, `ruby`, `csharp`) can be passed when the zip has no `metacall.json` or needs dependencies installed.

`projectPath` and `zipPath` are read by the server process, so they must be absolute paths on the machine running the server. Use `zipBase64` when the client cannot share files with it.

## Local FaaS

[metacall/faas](https://github.com/metacall/faas) is a local reimplementation of the MetaCall FaaS API. The server talks to it the same way it talks to the cloud.

### Start FaaS

```bash
git clone https://github.com/metacall/faas.git
cd faas

docker compose build faas

docker rm -f mcp-faas-e2e 2>/dev/null || true

docker run --rm -d \
  --name mcp-faas-e2e \
  -p 9100:9000 \
  metacall/faas

sleep 2

curl http://localhost:9100/api/readiness
```

The readiness check prints `OK`.

FaaS listens on port `9000` inside the container. This example maps it to `9100` on the host to avoid collisions with anything already using `9000`; any free port works, as long as `METACALL_BASE_URL` matches. The image is run with `docker run` because the compose file uses host networking, which Docker Desktop on macOS does not expose to the host by default.

Point the server at it with `METACALL_BASE_URL=http://localhost:9100` and `METACALL_TOKEN=local`, for example through [Inspector](#mcp-inspector). Use `localhost` rather than `127.0.0.1` (see [limitations](#local-limitations)).

### Example: upload, deploy and call a Node project

Create a small project:

```bash
rm -rf /tmp/mcp-local-demo
mkdir -p /tmp/mcp-local-demo

cat > /tmp/mcp-local-demo/index.js <<'EOF'
function sum(a, b) {
  return a + b;
}

function hello(name) {
  return `Hello ${name}`;
}

module.exports = {
  sum,
  hello
};
EOF

cat > /tmp/mcp-local-demo/package.json <<'EOF'
{
  "name": "mcp-local-demo",
  "version": "1.0.0"
}
EOF
```

**1. Upload** with `upload`:

```json
{
  "name": "mcp-local-demo",
  "projectPath": "/tmp/mcp-local-demo"
}
```

```json
{
  "success": true,
  "packageId": "mcp-local-demo"
}
```

There is no `metacall.json`, so one is generated for `index.js`. The `package.json` makes FaaS install the Node.js dependencies.

**2. Deploy** with `deploy`:

```json
{
  "name": "mcp-local-demo",
  "env": [],
  "plan": "Essential",
  "resourceType": "Package",
  "release": "main",
  "version": "v1"
}
```

```json
{
  "message": "Deployment is ready",
  "deployment": {
    "prefix": "<local-faas-hostname>",
    "suffix": "mcp-local-demo",
    "version": "v1"
  }
}
```

`deploy` returns once inspection reports the deployment as ready, and fails if it reports a failure. Local FaaS ignores `plan` and `release`, and always deploys as `v1`.

**3. Inspect** with `inspect` (output trimmed):

```json
{
  "count": 1,
  "deployments": [
    {
      "status": "ready",
      "suffix": "mcp-local-demo",
      "version": "v1"
    }
  ]
}
```

Each deployment also has a `packages` field with the loaded scripts and their function signatures, here `sum(a, b)` and `hello(name)`. It currently includes MetaCall runtime functions as well, such as `command_register` or `repl_evaluate`.

**4. Call** with `call`:

```json
{
  "suffix": "mcp-local-demo",
  "function": "sum",
  "args": {
    "a": 5,
    "b": 3
  }
}
```

```json
{
  "deployment": "mcp-local-demo",
  "function": "sum",
  "invocationType": "call",
  "version": "v1",
  "result": 8
}
```

**5. Delete** with `deployDelete`:

```json
{
  "suffix": "mcp-local-demo"
}
```

Running `inspect` again no longer lists the deployment.

The same flow works for Python projects; it has been run end to end with both Node.js and Python.

### Stop FaaS

```bash
docker stop mcp-faas-e2e
```

The container was started with `--rm`, so Docker removes it once stopped, together with any deployments still in it.

### Local limitations

- Local FaaS has no await endpoint, so `await` returns an error. Use `call`, which already waits for async functions locally.
- The local logs endpoint is a stub, so `logs` returns an error instead of placeholder output.
- `refresh` only makes sense for cloud tokens and returns an error locally.
- Use `localhost` in `METACALL_BASE_URL`. The protocol library only routes function calls to a local FaaS when the host is literally `localhost`; with `127.0.0.1` or `[::1]` they are sent to cloud addresses.
- FaaS passes arguments positionally, using `Object.values` of the request body, so `args` keys must be in the order of the function parameters. Names are not matched.
- Upload names must be unique. Delete a deployment before uploading the same name again.
- `add`, `branchList` and `fileList` run `git` inside FaaS and need network access from the container. They are not covered by the example above.

## Development

```bash
npm ci
npm run build
npm test
```

`npm test` rebuilds and runs the Mocha suite in `src/test`. The tests use a fake FaaS HTTP server and mocked requests, so they need neither a token nor Docker. `npm run dev` recompiles on changes.

CI type checks, builds and runs the tests on every pull request and on pushes to `main`.

## License

Apache License 2.0, see [LICENSE](LICENSE).
