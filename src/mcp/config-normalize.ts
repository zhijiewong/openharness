import type { McpHttpConfig, McpServerConfig, McpSseConfig, McpStdioConfig } from "../harness/config.js";

/** Discriminated-union result: either a validated config or a human-readable error. */
export type NormalizeResult = { kind: "ok"; cfg: NormalizedConfig } | { kind: "error"; message: string };

export type NormalizedConfig =
  | (McpStdioConfig & { type: "stdio" })
  | (McpHttpConfig & { inferredFromUrl?: boolean })
  | (McpSseConfig & { inferredFromUrl?: boolean });

const ENV_REF = /\$\{([A-Z_][A-Z0-9_]*)\}/g;

/** Replace ${VAR} references in `value` from `env`. Returns the new string or a missing-var name. */
function interpolate(
  value: string,
  env: Record<string, string | undefined>,
): { ok: true; value: string } | { ok: false; missing: string } {
  let missing: string | null = null;
  const out = value.replace(ENV_REF, (_match, varName) => {
    const v = env[varName];
    if (v === undefined) {
      if (missing === null) missing = varName;
      return "";
    }
    return v;
  });
  if (missing !== null) return { ok: false, missing };
  return { ok: true, value: out };
}

function interpolateHeaders(
  headers: Record<string, string> | undefined,
  env: Record<string, string | undefined>,
): { ok: true; headers: Record<string, string> | undefined } | { ok: false; missing: string } {
  if (!headers) return { ok: true, headers: undefined };
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    const r = interpolate(v, env);
    if (!r.ok) return { ok: false, missing: r.missing };
    out[k] = r.value;
  }
  return { ok: true, headers: out };
}

/**
 * Validate + normalize a raw MCP server config entry.
 * - Infers missing `type` from `command`/`url`.
 * - Interpolates ${ENV} in headers (http/sse only).
 * - Returns {kind:"error"} with a reason for any invalid combination.
 */
export function normalizeMcpConfig(raw: McpServerConfig, env: Record<string, string | undefined>): NormalizeResult {
  const hasCommand = "command" in raw && !!(raw as any).command;
  const hasUrl = "url" in raw && !!(raw as any).url;

  if (hasCommand && hasUrl) {
    return { kind: "error", message: `MCP '${raw.name}': config sets both 'command' and 'url'` };
  }

  const declaredType = raw.type;
  const effectiveType: "stdio" | "http" | "sse" | undefined =
    declaredType ?? (hasCommand ? "stdio" : hasUrl ? "http" : undefined);

  if (!effectiveType) {
    return { kind: "error", message: `MCP '${raw.name}': must set 'command' (stdio) or 'url' (http/sse)` };
  }

  if (effectiveType === "stdio") {
    if (!hasCommand) {
      return { kind: "error", message: `MCP '${raw.name}': type='stdio' requires 'command'` };
    }
    return { kind: "ok", cfg: { ...(raw as McpStdioConfig), type: "stdio" } };
  }

  // http or sse
  if (!hasUrl) {
    return { kind: "error", message: `MCP '${raw.name}': type='${effectiveType}' requires 'url'` };
  }
  const headers = (raw as McpHttpConfig | McpSseConfig).headers;
  const interp = interpolateHeaders(headers, env);
  if (!interp.ok) {
    return {
      kind: "error",
      message: `MCP '${raw.name}': env var '${interp.missing}' referenced in headers is not set`,
    };
  }

  const inferred = declaredType === undefined;
  const base = { ...(raw as McpHttpConfig | McpSseConfig), type: effectiveType, headers: interp.headers };
  return {
    kind: "ok",
    cfg: inferred ? ({ ...base, inferredFromUrl: true } as NormalizedConfig) : (base as NormalizedConfig),
  };
}
