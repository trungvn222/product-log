#!/usr/bin/env node
import { execSync, spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TOML = path.join(ROOT, "shopify.app.toml");
const PORT = process.env.PORT || 3000;

function log(msg) {
  console.log(`\x1b[36m[dev]\x1b[0m ${msg}`);
}

// Kill any process on PORT and existing ngrok
try {
  execSync(`lsof -ti tcp:${PORT} | xargs kill -9`, { stdio: "ignore" });
} catch {}
try {
  execSync("pkill -f ngrok", { stdio: "ignore" });
} catch {}
await new Promise((r) => setTimeout(r, 600));

// Start ngrok
log(`Starting ngrok on port ${PORT}...`);
const ngrok = spawn("ngrok", ["http", String(PORT)], {
  stdio: "ignore",
  detached: true,
});
ngrok.unref();

// Poll ngrok API until tunnel is ready (max 20s)
let ngrokUrl = "";
for (let i = 0; i < 20; i++) {
  await new Promise((r) => setTimeout(r, 1000));
  try {
    const raw = execSync("curl -s http://localhost:4040/api/tunnels").toString();
    const data = JSON.parse(raw);
    const tunnel = data.tunnels?.find((t) => t.proto === "https");
    if (tunnel?.public_url) {
      ngrokUrl = tunnel.public_url;
      break;
    }
  } catch {}
}

if (!ngrokUrl) {
  console.error("Failed to get ngrok URL after 20s. Is ngrok authenticated?");
  process.exit(1);
}

log(`ngrok URL: \x1b[32m${ngrokUrl}\x1b[0m`);

// Update shopify.app.toml
let toml = fs.readFileSync(TOML, "utf8");

toml = toml.replace(
  /application_url\s*=\s*"[^"]*"/,
  `application_url = "${ngrokUrl}"`,
);

toml = toml.replace(/redirect_urls\s*=\s*\[[\s\S]*?\]/, () => {
  const paths = [
    "/auth/callback",
    "/auth/shopify/callback",
    "/api/auth/callback",
  ];
  const lines = paths.map((p) => `  "${ngrokUrl}${p}"`).join(",\n");
  return `redirect_urls = [\n${lines}\n]`;
});

fs.writeFileSync(TOML, toml);
log("Updated shopify.app.toml");

// Update .env SHOPIFY_APP_URL
const ENV_PATH = path.join(ROOT, ".env");
let env = fs.readFileSync(ENV_PATH, "utf8");
if (/^SHOPIFY_APP_URL=/m.test(env)) {
  env = env.replace(/^SHOPIFY_APP_URL=.*/m, `SHOPIFY_APP_URL=${ngrokUrl}`);
} else {
  env += `\nSHOPIFY_APP_URL=${ngrokUrl}`;
}
fs.writeFileSync(ENV_PATH, env);
log("Updated .env SHOPIFY_APP_URL");

// Push config to Shopify Partners
log("Pushing config to Shopify...");
try {
  execSync("npx shopify app deploy --allow-updates --no-build", {
    stdio: "inherit",
    cwd: ROOT,
  });
  log("Config pushed successfully");
} catch (e) {
  console.warn(
    "\x1b[33m[dev]\x1b[0m Warning: shopify deploy failed, continuing anyway...",
  );
}

// Start dev server
log("Starting dev server...");
const dev = spawn("npm", ["run", "dev:vite"], {
  stdio: "inherit",
  env: { ...process.env, SHOPIFY_APP_URL: ngrokUrl },
  cwd: ROOT,
});

dev.on("exit", (code) => process.exit(code ?? 0));
