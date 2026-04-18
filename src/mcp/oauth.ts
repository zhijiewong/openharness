import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

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
