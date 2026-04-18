# MCP Servers

OpenHarness connects to Model Context Protocol (MCP) servers via three transports:

| Transport | Use for |
|---|---|
| `stdio` (default) | Local subprocess servers (most open-source MCP servers) |
| `http` | Remote Streamable HTTP servers (Linear, Sentry, GitHub managed, Anthropic-hosted) |
| `sse` | Legacy HTTP+SSE servers |

Configure servers in `.oh/config.yaml` under the top-level `mcpServers:` key.

## stdio (default)

```yaml
mcpServers:
  - name: filesystem
    command: mcp-server-fs
    args: [--root, /tmp]
    env: { LOG_LEVEL: debug }
```

`type` defaults to `stdio` when `command` is set.

## Streamable HTTP

```yaml
mcpServers:
  - name: linear
    type: http
    url: https://mcp.linear.app/mcp
    headers:
      Authorization: "Bearer ${LINEAR_API_KEY}"
```

Header values support `${VAR}` interpolation from `process.env`. If the referenced var is not set, OH skips the server with a warning and continues.

## Legacy SSE

```yaml
mcpServers:
  - name: self-hosted
    type: sse
    url: https://mcp.internal.example.com/sse
    headers:
      X-API-Key: "${INTERNAL_KEY}"
```

## Auto-fallback

When you provide `url:` without `type:`, OH tries Streamable HTTP first and falls back to legacy SSE on HTTP 4xx. Set `type:` explicitly to disable fallback.

## Authentication

OpenHarness supports two auth modes for HTTP and SSE transports:

### Static bearer token

Set `headers.Authorization` in the config. OAuth is not attempted.

```yaml
mcpServers:
  - name: linear
    type: http
    url: https://mcp.linear.app/mcp
    headers:
      Authorization: "Bearer ${LINEAR_API_KEY}"
```

### OAuth 2.1 (auto)

If no `headers.Authorization` is set, OpenHarness attempts OAuth automatically when the server returns `401 + WWW-Authenticate`. The flow uses Authorization Code + PKCE with Dynamic Client Registration (RFC 7591):

```yaml
mcpServers:
  - name: linear
    type: http
    url: https://mcp.linear.app/mcp
```

On first connect, OH:
1. Discovers the OAuth server metadata.
2. Dynamically registers as a client (if the server supports DCR).
3. Binds a local callback listener on `127.0.0.1:<ephemeral-port>`.
4. Opens your system browser to the authorization URL.
5. On approval, exchanges the code for tokens and stores them at `~/.oh/credentials/mcp/<name>.json` (mode `0600`).

On subsequent connects, OH uses stored tokens and refreshes them automatically.

### Forcing OAuth before a 401

Set `auth: "oauth"` to run the flow on first connect without waiting for a 401:

```yaml
mcpServers:
  - name: linear
    type: http
    url: https://mcp.linear.app/mcp
    auth: oauth
```

### Disabling OAuth

Set `auth: "none"` to suppress the OAuth auto-flow. A 401 response will surface as an error instead.

## Slash commands

- `/mcp` — show connected servers with per-server transport + auth state.
- `/mcp-login <name>` — force a fresh OAuth flow (useful after token revocation or to switch accounts).
- `/mcp-logout <name>` — wipe local tokens for the given server. Server-side session is not revoked.

## Token storage

Tokens and dynamically registered client info live at `~/.oh/credentials/mcp/<server-name>.json` with file mode `0600` and directory mode `0700` on Linux/macOS (mode checks do not apply on Windows). Corrupt files are treated as "no tokens" without crashing.

OS keychain storage is not supported in this release and is tracked as a future enhancement.
