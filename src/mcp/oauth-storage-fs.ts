import { promises as fs } from "node:fs";
import { dirname, join } from "node:path";

export type OhCredentials = {
  issuerUrl: string;
  clientInformation: { client_id: string; client_secret?: string } & Record<string, unknown>;
  tokens: {
    access_token: string;
    refresh_token?: string;
    expires_at?: number;
    token_type?: string;
    scope?: string;
  };
  codeVerifier?: string;
  updatedAt: string;
};

function pathFor(storageDir: string, name: string): string {
  return join(storageDir, `${name}.json`);
}

/** Atomically write credentials for one server. Creates the directory with 0o700 on first use. */
export async function saveCredentials(storageDir: string, name: string, creds: OhCredentials): Promise<void> {
  const filePath = pathFor(storageDir, name);
  const tmpPath = `${filePath}.tmp`;
  await fs.mkdir(dirname(filePath), { recursive: true, mode: 0o700 });
  const body = JSON.stringify(creds, null, 2);
  await fs.writeFile(tmpPath, body, { mode: 0o600 });
  await fs.rename(tmpPath, filePath);
}

/** Load credentials. Returns undefined on missing file OR corrupt JSON. Warns on world/group-readable mode. */
export async function loadCredentials(storageDir: string, name: string): Promise<OhCredentials | undefined> {
  const filePath = pathFor(storageDir, name);
  let raw: string;
  try {
    raw = await fs.readFile(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw err;
  }
  try {
    if (process.platform !== "win32") {
      const s = await fs.stat(filePath);
      if ((s.mode & 0o077) !== 0) {
        console.warn(`[mcp] credentials file for '${name}' is world/group-readable; run 'chmod 600 ${filePath}'`);
      }
    }
  } catch {
    // stat failure is non-fatal for load
  }
  try {
    return JSON.parse(raw) as OhCredentials;
  } catch {
    console.warn(`[mcp] credentials file for '${name}' is corrupt; ignoring`);
    return undefined;
  }
}

/** Idempotent delete — ENOENT is swallowed. */
export async function deleteCredentials(storageDir: string, name: string): Promise<void> {
  const filePath = pathFor(storageDir, name);
  try {
    await fs.unlink(filePath);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") return;
    throw err;
  }
}
