import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { OAuthClientProvider } from "@modelcontextprotocol/sdk/client/auth.js";
import type {
  OAuthClientInformationMixed,
  OAuthClientMetadata,
  OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import { loadCredentials, type OhCredentials, saveCredentials } from "./oauth-storage.js";

export type OAuthCallbackResult = { code: string; state: string };

export type PendingCallback = {
  /** The full redirect URI clients should be sent to. */
  readonly redirectUri: string;
  /** Resolves with the captured code+state; rejects on timeout or close. */
  readonly done: Promise<OAuthCallbackResult>;
  /** Close the listener immediately. Idempotent. */
  close: () => void;
};

const SUCCESS_HTML = `<!doctype html><html><body style="font-family: system-ui; padding: 2rem">
<h2>Authorization complete</h2>
<p>You can close this tab and return to openHarness.</p>
</body></html>`;

/**
 * Bind a single-shot HTTP listener on 127.0.0.1 to receive the OAuth redirect.
 * Returns after the server has bound (so redirectUri is available synchronously on the result).
 * The `done` promise resolves when a valid /oauth/callback arrives, or rejects on timeout/close.
 */
export async function awaitOAuthCallback(opts: { timeoutMs: number }): Promise<PendingCallback> {
  const server: Server = createServer();
  await new Promise<void>((resolve, reject) => {
    server.once("listening", () => resolve());
    server.once("error", reject);
    server.listen(0, "127.0.0.1");
  });
  const addr = server.address() as AddressInfo;
  const redirectUri = `http://127.0.0.1:${addr.port}/oauth/callback`;

  let closed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let resolveResult!: (r: OAuthCallbackResult) => void;
  let rejectResult!: (e: Error) => void;
  const done = new Promise<OAuthCallbackResult>((res, rej) => {
    resolveResult = res;
    rejectResult = rej;
  });

  function cleanup(): void {
    if (closed) return;
    closed = true;
    if (timer) clearTimeout(timer);
    timer = null;
    server.close();
  }

  server.on("request", (req, res) => {
    const host = req.headers.host ?? "";
    if (!host.startsWith("127.0.0.1:")) {
      res.statusCode = 403;
      res.end("forbidden");
      return;
    }
    const url = new URL(req.url ?? "/", `http://${host}`);
    if (req.method !== "GET" || url.pathname !== "/oauth/callback") {
      res.statusCode = 404;
      res.end("not found");
      return;
    }
    const code = url.searchParams.get("code") ?? "";
    const state = url.searchParams.get("state") ?? "";
    res.statusCode = 200;
    res.setHeader("content-type", "text/html; charset=utf-8");
    res.end(SUCCESS_HTML);
    cleanup();
    resolveResult({ code, state });
  });

  timer = setTimeout(() => {
    cleanup();
    rejectResult(new Error(`OAuth callback timeout after ${opts.timeoutMs}ms`));
  }, opts.timeoutMs);

  return {
    redirectUri,
    done,
    close: () => {
      if (closed) return;
      cleanup();
      rejectResult(new Error("OAuth callback closed before completion"));
    },
  };
}

/** Strip access_token=, refresh_token=, and "Bearer <x>" from a log message. */
export function redactToken(msg: string): string {
  return msg
    .replace(/(access_token|refresh_token|code)=[^&\s"']+/gi, "$1=<redacted>")
    .replace(/Bearer\s+[^\s"']+/gi, "Bearer <redacted>");
}

const CALLBACK_TIMEOUT_MS = 5 * 60 * 1_000;

export type OhOAuthProviderOptions = {
  name: string;
  storageDir: string;
  /** Browser launch hook — injected for tests; production wires to `open` from the npm package. */
  openFn: (url: string) => Promise<void>;
};

/**
 * Implements the SDK's OAuthClientProvider backed by OhCredentials on disk.
 * Lazily binds the callback listener on ready() (called before the SDK reads redirectUrl).
 */
export class OhOAuthProvider implements OAuthClientProvider {
  private readonly name: string;
  private readonly storageDir: string;
  private readonly openFn: (url: string) => Promise<void>;

  private pending: PendingCallback | null = null;
  private _redirectUri: string | null = null;
  private inMemoryCodeVerifier: string | null = null;

  constructor(opts: OhOAuthProviderOptions) {
    this.name = opts.name;
    this.storageDir = opts.storageDir;
    this.openFn = opts.openFn;
  }

  /** Bind the callback listener and prepare redirectUri. Call before first SDK access. */
  async ready(): Promise<void> {
    if (this.pending) return;
    this.pending = await awaitOAuthCallback({ timeoutMs: CALLBACK_TIMEOUT_MS });
    this._redirectUri = this.pending.redirectUri;
  }

  /** Release the callback listener (no-op if already resolved/closed). */
  close(): void {
    if (this.pending) {
      // Attach a no-op catch so the rejected `done` promise doesn't become an unhandled rejection.
      this.pending.done.catch(() => {});
      this.pending.close();
    }
    this.pending = null;
    this._redirectUri = null;
  }

  get redirectUrl(): string | URL | undefined {
    return this._redirectUri ?? undefined;
  }

  get clientMetadata(): OAuthClientMetadata {
    return {
      client_name: "openharness",
      redirect_uris: this._redirectUri ? [this._redirectUri] : [],
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      token_endpoint_auth_method: "none",
    };
  }

  async clientInformation(): Promise<OAuthClientInformationMixed | undefined> {
    const creds = await loadCredentials(this.storageDir, this.name);
    return creds?.clientInformation as OAuthClientInformationMixed | undefined;
  }

  async saveClientInformation(info: OAuthClientInformationMixed): Promise<void> {
    const creds = (await loadCredentials(this.storageDir, this.name)) ?? this.emptyCreds();
    creds.clientInformation = info as OhCredentials["clientInformation"];
    creds.updatedAt = new Date().toISOString();
    await saveCredentials(this.storageDir, this.name, creds);
  }

  async tokens(): Promise<OAuthTokens | undefined> {
    const creds = await loadCredentials(this.storageDir, this.name);
    if (!creds?.tokens?.access_token) return undefined;
    return {
      access_token: creds.tokens.access_token,
      refresh_token: creds.tokens.refresh_token,
      token_type: creds.tokens.token_type ?? "Bearer",
      scope: creds.tokens.scope,
      expires_in:
        creds.tokens.expires_at && creds.tokens.expires_at > Date.now()
          ? Math.floor((creds.tokens.expires_at - Date.now()) / 1000)
          : 0,
    } as OAuthTokens;
  }

  async saveTokens(tokens: OAuthTokens): Promise<void> {
    const creds = (await loadCredentials(this.storageDir, this.name)) ?? this.emptyCreds();
    creds.tokens = {
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_type: tokens.token_type ?? "Bearer",
      scope: tokens.scope,
      expires_at: tokens.expires_in ? Date.now() + Number(tokens.expires_in) * 1000 : undefined,
    };
    creds.codeVerifier = undefined;
    this.inMemoryCodeVerifier = null;
    creds.updatedAt = new Date().toISOString();
    await saveCredentials(this.storageDir, this.name, creds);
  }

  async redirectToAuthorization(url: URL): Promise<void> {
    await this.openFn(url.toString());
  }

  async saveCodeVerifier(verifier: string): Promise<void> {
    this.inMemoryCodeVerifier = verifier;
    const creds = (await loadCredentials(this.storageDir, this.name)) ?? this.emptyCreds();
    creds.codeVerifier = verifier;
    creds.updatedAt = new Date().toISOString();
    await saveCredentials(this.storageDir, this.name, creds);
  }

  async codeVerifier(): Promise<string> {
    if (this.inMemoryCodeVerifier) return this.inMemoryCodeVerifier;
    const creds = await loadCredentials(this.storageDir, this.name);
    if (!creds?.codeVerifier) {
      throw new Error(`no code verifier saved for '${this.name}'`);
    }
    return creds.codeVerifier;
  }

  /** Await a resolved callback from the listener bound in ready(). */
  async awaitCallback(): Promise<OAuthCallbackResult> {
    if (!this.pending) throw new Error("awaitCallback called before ready()");
    return this.pending.done;
  }

  private emptyCreds(): OhCredentials {
    return {
      issuerUrl: "",
      clientInformation: { client_id: "" },
      tokens: { access_token: "" },
      updatedAt: new Date().toISOString(),
    };
  }
}
