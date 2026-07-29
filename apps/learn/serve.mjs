/**
 * Serve the built app over HTTPS on the local network, so a phone can open it.
 *
 *   npm run share -w @arpeggio/learn
 *
 * Why HTTPS: browsers only expose `getUserMedia` (microphone) and only install
 * a PWA to the home screen in a *secure context*. `localhost` counts as secure,
 * but `http://192.168.x.x` does not — so practising with a real piano from the
 * phone needs TLS even on a private LAN.
 *
 * The certificate is self-signed and generated on first run into `.cert/`
 * (git-ignored), which means the phone will show a "not private" warning once:
 * tap Advanced -> Visit anyway. That is expected for a LAN dev certificate.
 */
import { execFileSync } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:https";
import { networkInterfaces } from "node:os";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

import { buildOnce } from "./build.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const certDir = join(here, ".cert");
const keyPath = join(certDir, "key.pem");
const crtPath = join(certDir, "cert.pem");
const PORT = Number(process.env.PORT ?? 5174);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".bin": "application/octet-stream",
  ".map": "application/json; charset=utf-8",
};

/** All non-internal IPv4 addresses, i.e. the ones a phone can reach. */
function lanAddresses() {
  return Object.values(networkInterfaces())
    .flat()
    .filter((n) => n && n.family === "IPv4" && !n.internal)
    .map((n) => n.address);
}

function ensureCert() {
  if (existsSync(keyPath) && existsSync(crtPath)) return;
  mkdirSync(certDir, { recursive: true });
  const hosts = ["localhost", ...lanAddresses()];
  // subjectAltName is what modern browsers actually check; a bare CN is ignored.
  const san = hosts
    .map((h) => (/^\d+\.\d+\.\d+\.\d+$/.test(h) ? `IP:${h}` : `DNS:${h}`))
    .join(",");
  console.log("generating a self-signed certificate for", hosts.join(", "));
  execFileSync(
    "openssl",
    [
      "req", "-x509", "-newkey", "rsa:2048", "-nodes",
      "-keyout", keyPath, "-out", crtPath,
      "-days", "365", "-subj", "/CN=arpeggio-learn",
      "-addext", `subjectAltName=${san}`,
    ],
    { stdio: "inherit" },
  );
}

const outdir = await buildOnce({ minify: true });
ensureCert();

createServer(
  { key: readFileSync(keyPath), cert: readFileSync(crtPath) },
  (req, res) => {
    const url = decodeURIComponent((req.url ?? "/").split("?")[0]);
    // normalize() collapses ".." so a request can never escape dist/.
    let file = join(outdir, normalize(url));
    if (!file.startsWith(outdir)) file = outdir;
    if (!existsSync(file) || statSync(file).isDirectory()) file = join(outdir, "index.html");
    res.writeHead(200, {
      "content-type": MIME[extname(file)] ?? "application/octet-stream",
      "cache-control": "no-cache",
    });
    createReadStream(file).pipe(res);
  },
).listen(PORT, "0.0.0.0", () => {
  console.log("\n  Arpeggio Learn is being served over HTTPS:\n");
  console.log(`    https://localhost:${PORT}`);
  for (const ip of lanAddresses()) console.log(`    https://${ip}:${PORT}   <- open this on your phone`);
  console.log("\n  The certificate is self-signed: accept the browser warning once.\n");
});
