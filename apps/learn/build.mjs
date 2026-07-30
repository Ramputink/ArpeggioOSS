/**
 * Bundle Arpeggio Learn into a self-contained static PWA in dist/.
 *
 *   node build.mjs           # production bundle
 *   node build.mjs --serve   # watch + dev server on http://localhost:5174
 *
 * Everything resolves through RELATIVE URLs so the same dist/ works from a
 * domain root, from a GitHub Pages sub-path (/ArpeggioOSS/) and from the OMR
 * backend. Code splitting keeps the heavy MOTOR 2 stack (Basic Pitch +
 * TensorFlow.js) in its own chunk, fetched only if the learner starts a
 * microphone session on a piece with chords.
 */
import { context, build } from "esbuild";
import { watch as watchDir } from "node:fs";
import { cp, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outdir = join(here, "dist");
const serve = process.argv.includes("--serve");

/** Copy the Basic Pitch TF.js model out of node_modules (a build artifact). */
async function copyBasicPitchModel() {
  try {
    const require = createRequire(import.meta.url);
    const modelSrc = join(dirname(require.resolve("@spotify/basic-pitch/package.json")), "model");
    await cp(modelSrc, join(outdir, "models", "basic-pitch"), { recursive: true });
  } catch (err) {
    console.warn("warning: Basic Pitch model not copied (chord detection needs it):", err.message);
  }
}

export const buildOptions = {
  // Two entry points: the page, and the worker that runs MOTOR 2 off the main
  // thread. Both are ESM, so the worker is instantiated with { type: "module" }
  // and shares esbuild's split chunks with the page.
  entryPoints: {
    app: join(here, "src/main.ts"),
    polyWorker: join(here, "src/polyWorker.ts"),
  },
  bundle: true,
  format: "esm",
  target: ["es2020", "safari15"],
  sourcemap: true,
  splitting: true,
  outdir,
  logLevel: "info",
  loader: { ".ts": "ts" },
};

export async function buildOnce({ minify = true } = {}) {
  await mkdir(outdir, { recursive: true });
  await cp(join(here, "public"), outdir, { recursive: true });
  await copyBasicPitchModel();
  await build({ ...buildOptions, minify });
  return outdir;
}

// Only run when invoked directly, so serve.mjs can import buildOnce().
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  if (serve) {
    await mkdir(outdir, { recursive: true });
    await cp(join(here, "public"), outdir, { recursive: true });
    await copyBasicPitchModel();
    const ctx = await context(buildOptions);
    await ctx.watch();
    // esbuild only watches the module graph, so index.html / styles.css / the
    // manifest would otherwise be whatever they were when the server started —
    // an easy way to spend ten minutes debugging a change that was never served.
    let pending = null;
    watchDir(join(here, "public"), { recursive: true }, () => {
      clearTimeout(pending);
      pending = setTimeout(async () => {
        await cp(join(here, "public"), outdir, { recursive: true });
        console.log("[watch] public/ copied");
      }, 60);
    });
    // 0.0.0.0 so a phone on the same Wi-Fi can open it. Note: the microphone
    // needs a secure context, so mic practice over the LAN requires
    // `npm run share` (HTTPS); on-screen keyboard practice works over plain HTTP.
    const { port } = await ctx.serve({ servedir: outdir, host: "0.0.0.0", port: 5174 });
    console.log(`dev server: http://localhost:${port}`);
  } else {
    await buildOnce();
    console.log("built dist/");
  }
}
