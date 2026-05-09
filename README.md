# MetaCall Deploy MCP Server

A [Model Context Protocol (MCP)](https://modelcontextprotocol.io) server implemented in TypeScript on top of the [`metacall/protocol`](https://github.com/metacall/protocol) API. It exposes the complete [MetaCall FaaS](https://dashboard.metacall.io) surface as MCP tools.

---

## Architecture

```
┌────────────────────────────┐
│         MCP Client         │
│ (CLI / IDE / Local LLM)    │
└─────────────┬──────────────┘
              │ (JSON-RPC over stdio)
              ▼
┌────────────────────────────┐
│      MCP Server (TS)       │
│  - Tool Router             │
│  - Zod Validation          │
│  - Tool Handlers           │
│  - Error Boundary          │
└─────────────┬──────────────┘
              │ (Function Calls)
              ▼
┌────────────────────────────┐
│      Protocol Client       │
│  (metacall/protocol API)   │
└─────────────┬──────────────┘
              │ (Fetch REST)
              ▼
┌────────────────────────────┐
│        MetaCall FaaS       │
│  (Deploy + Runtime Layer)  │
└────────────────────────────┘
```

---

## Exposed Tools

### System

| Tool | Description |
|------|-------------|
| `refresh` | Refresh the MetaCall JWT authentication token |
| `ready` | Check if the server is ready |
| `validate` | Validate the current auth token |
| `deployEnabled` | Check if deployments are enabled |

### Subscriptions

| Tool | Description |
|------|-------------|
| `listSubscriptions` | List all active subscriptions |
| `listSubscriptionsDeploys` | List deployments for subscriptions |

### Deployment

| Tool | Description |
|------|-------------|
| `inspect` | Inspect all deployments |
| `inspectByName` | Inspect a deployment by name |
| `upload` | Upload a zip package/blob into the FaaS |
| `add` | Add a new deployment |
| `deploy` | Trigger a deployment |
| `deployDelete` | Delete a deployment |
| `logs` | Retrieve deployment logs |

### Repository

| Tool | Description |
|------|-------------|
| `branchList` | List branches in the repository |
| `fileList` | List files in the repository |

### Invocation

| Tool | Description |
|------|-------------|
| `invoke` | Invoke a deployed function |
| `call` | Call a function directly |
| `await` | Await an async function result |

---

## Design Principles

- **1:1 abstraction** over the protocol API
- **Async-safe** Promise-based handlers
- **Structured error boundary** for consistent error handling
- **Retry support** via `waitFor`
- **Zod-based input validation** for all tool inputs
- **Clean separation of concerns** across layers

## Installation & Setup

### Prerequisites
- **Node.js**: v18 or higher.
- **MetaCall Token**: You need an active authentication token. You can get this by logging into [dashboard.metacall.io](https://dashboard.metacall.io).

---

### 1. Build the Server

First, clone this repository to your local machine, install the dependencies, and compile the TypeScript code:

```bash
git clone https://github.com/metacall/deploy-mcp-server.git
cd deploy-mcp-server
npm install
npm run build
```

> **Note:** Get the absolute path of your `deploy-mcp-server/dist/index.js` file as we will need it for the client configuration.

---

### 2. Client Configuration

The Model Context Protocol (MCP) allows us to use this server across various AI clients. Below are the setup instructions for **Claude Desktop** and **Google Antigravity**.

---

#### Option A: Claude Desktop

1. Open your Claude Desktop configuration file based on your operating system:
   - **macOS:** `~/Library/Application Support/Claude/claude_desktop_config.json`
   - **Linux:** `~/.config/Claude/claude_desktop_config.json`
   - **Windows:** `%APPDATA%\Claude\claude_desktop_config.json`

2. Add the MetaCall server to your `mcpServers` object. Replace the `args` path with the actual absolute path to `dist/index.js`, and insert your MetaCall token:

```json
{
  "mcpServers": {
    "metacall-faas": {
      "command": "node",
      "args": [
        "/ABSOLUTE/PATH/TO/deploy-mcp-server/dist/index.js"
      ],
      "env": {
        "METACALL_TOKEN": "your_jwt_token_here",
        "METACALL_BASE_URL": "https://dashboard.metacall.io"
      }
    }
  }
}
```

> **Windows Users:** Remember to use double backslashes. e.g., `C:\\Users\\Name\\deploy-mcp-server\\dist\\index.js`

3. Restart Claude Desktop.

---

#### Option B: Google Antigravity

1. Open your Antigravity configuration file based on your operating system:
   - **macOS / Linux:** `~/.gemini/antigravity/mcp_config.json`
   - **Windows:** `%USERPROFILE%\.gemini\antigravity\mcp_config.json`

2. Add the exact same JSON configuration block used for Claude Desktop (above) into your `mcp_config.json` file:

```json
{
  "mcpServers": {
    "metacall-faas": {
      "command": "node",
      "args": [
        "/ABSOLUTE/PATH/TO/deploy-mcp-server/dist/index.js"
      ],
      "env": {
        "METACALL_TOKEN": "your_jwt_token_here",
        "METACALL_BASE_URL": "https://dashboard.metacall.io"
      }
    }
  }
}
```

3. In the Antigravity UI, navigate to the **Agent Manager** panel, click **Manage MCP Servers**, and hit **Refresh**. The server will be connected.

# Upload Tool – How to Provide the Zip Package

The upload tool sends a zip package to MetaCall Cloud before deploying it. The MetaCall API expects the package as a binary buffer. The zip file must be encoded as a base64 string and then reconstructed into a buffer inside the MCP server.

Base64 works across all MCP clients because it is simply a text representation of the binary zip file.

Two ways of providing the zip package are supported:

---

## 1. zipBase64 (Recommended and works for all)

This is the portable method and works with all MCP clients such as Claude, antigravity and others.

### Steps

1. Create a zip file containing your source code. The source files should be at the root of the zip archive.

   Example structure:
   ```
   package.zip
   └── abc.js
   ```

2. Convert the zip file to a base64 string.

   **Linux:**
   ```bash
   base64 package.zip
   ```

   **macOS:**
   ```bash
   base64 package.zip
   ```

   **Windows (PowerShell):**
   ```powershell
   [Convert]::ToBase64String([IO.File]::ReadAllBytes("absolute path of the zip file"))
   ```

3. Pass the base64 string to the upload tool.

   Example tool input:
   ```json
   {
     "name": "myPackage",
     "zipBase64": "ABCDEF...",
     "runners": ["node"]
   }
   ```

The MCP server will convert the base64 string back into a binary buffer and send it to the MetaCall API.

---

## 2. zipPath (Local Development Only)

When the MCP server has direct access to the local filesystem (for example when testing locally or using tools like Antigravity), the zip file can be provided as a file path.

Example:
```json
{
  "name": "myPackage",
  "zipPath": "./package.zip"
}
```

The MCP server reads the file from disk using the provided path and uploads it to MetaCall.

> **Note:** `zipPath` may not work with remote LLM clients like Claude because those clients cannot access files on the MCP server's filesystem.

---

## Recommendation

For compatibility across all MCP clients, using **`zipBase64`** is recommended.
