// OpenRouter OAuth PKCE flow for desktop apps
// Spins up a local HTTP server, opens browser for auth, catches callback, exchanges for API key.

import * as http from "http";
import * as crypto from "crypto";
import * as fs from "fs";
import * as path from "path";
import { shell } from "electron";

const AUTH_URL = "https://openrouter.ai/auth";
const KEY_EXCHANGE_URL = "https://openrouter.ai/api/v1/auth/keys";
const CALLBACK_PORT = 3000; // OpenRouter only allows ports 443 and 3000
const CALLBACK_URL = `http://localhost:${CALLBACK_PORT}/callback`;

function getConfigPath(): string {
  return path.join(
    process.env.APPDATA || process.env.HOME || ".",
    "ForeverPapere",
    "config.json"
  );
}

function readConfig(): Record<string, unknown> {
  try {
    return JSON.parse(fs.readFileSync(getConfigPath(), "utf-8"));
  } catch {
    return {};
  }
}

function writeConfig(config: Record<string, unknown>): void {
  const dir = path.dirname(getConfigPath());
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2));
}

export function getApiKey(): string {
  return (readConfig().openRouterApiKey as string) || "";
}

export function saveApiKey(key: string): void {
  const config = readConfig();
  config.openRouterApiKey = key;
  writeConfig(config);
}

export function hasApiKey(): boolean {
  return getApiKey().length > 0;
}

// Generate PKCE code verifier and challenge
function generatePKCE(): { verifier: string; challenge: string } {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto
    .createHash("sha256")
    .update(verifier)
    .digest("base64url");
  return { verifier, challenge };
}

// Start OAuth flow: open browser, wait for callback, exchange for key
export function startOAuthFlow(): Promise<string> {
  return new Promise((resolve, reject) => {
    const { verifier, challenge } = generatePKCE();
    let server: http.Server;

    const timeout = setTimeout(() => {
      try { server?.close(); } catch (_) {}
      reject(new Error("OAuth timed out (2 minutes)"));
    }, 120_000);

    server = http.createServer(async (req, res) => {
      const url = new URL(req.url || "/", `http://localhost:${CALLBACK_PORT}`);

      if (url.pathname === "/callback") {
        const code = url.searchParams.get("code");

        if (!code) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end("<h2>Error: No authorization code received.</h2><p>Please try again.</p>");
          clearTimeout(timeout);
          server.close();
          reject(new Error("No code in callback"));
          return;
        }

        // Exchange code for API key
        try {
          const response = await fetch(KEY_EXCHANGE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              code,
              code_verifier: verifier,
              code_challenge_method: "S256",
            }),
          });

          if (!response.ok) {
            const err = await response.text();
            throw new Error(`Key exchange failed: ${response.status} ${err}`);
          }

          const data = await response.json();
          const apiKey = data.key;

          if (!apiKey) throw new Error("No key in response");

          saveApiKey(apiKey);

          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(`
            <html><body style="font-family:system-ui;text-align:center;padding:60px;background:#1a1a2e;color:#eee">
              <h2>Authenticated!</h2>
              <p>You can close this tab and return to ForeverPapere.</p>
              <script>setTimeout(()=>window.close(),2000)</script>
            </body></html>
          `);

          clearTimeout(timeout);
          server.close();
          resolve(apiKey);
        } catch (err: any) {
          res.writeHead(500, { "Content-Type": "text/html" });
          res.end(`<h2>Error</h2><p>${err.message}</p>`);
          clearTimeout(timeout);
          server.close();
          reject(err);
        }
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    });

    server.listen(CALLBACK_PORT, () => {
      const authUrl = `${AUTH_URL}?callback_url=${encodeURIComponent(CALLBACK_URL)}&code_challenge=${challenge}&code_challenge_method=S256`;
      console.log("[openrouter] Opening browser for OAuth...");
      shell.openExternal(authUrl);
    });

    server.on("error", (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}
