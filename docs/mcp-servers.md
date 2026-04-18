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

Only header-based auth is supported in this release. If a server responds with `401` + `WWW-Authenticate`, OH raises:

> `MCP server '<name>' requires authentication. Add headers.Authorization to your config (OAuth flow is not yet supported).`

OAuth 2.1 (device code, DCR, keychain token storage) is planned for a follow-up release.
