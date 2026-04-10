/**
 * Safe environment variable filtering.
 * Blocks credential-containing vars from being passed to subprocesses.
 */

/** Env var names that should never be passed to subprocesses */
const BLOCKED_PATTERNS = [
  /^ANTHROPIC_API_KEY$/i,
  /^OPENAI_API_KEY$/i,
  /^OPENROUTER_API_KEY$/i,
  /^AWS_SECRET/i,
  /^AWS_SESSION_TOKEN$/i,
  /^GCP_SERVICE_ACCOUNT/i,
  /^GOOGLE_APPLICATION_CREDENTIALS$/i,
  /^AZURE_.*KEY$/i,
  /^GITHUB_TOKEN$/i,
  /^GH_TOKEN$/i,
  /^NPM_TOKEN$/i,
  /^DOCKER_.*TOKEN$/i,
  /^SSH_.*KEY$/i,
  /^OH_CREDENTIAL/i,
];

/**
 * Filter process.env to remove credential-containing variables.
 * Merges optional extra env vars on top.
 */
export function safeEnv(extra?: Record<string, string>): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined) continue;
    if (BLOCKED_PATTERNS.some(p => p.test(key))) continue;
    env[key] = value;
  }
  if (extra) {
    Object.assign(env, extra);
  }
  return env;
}
