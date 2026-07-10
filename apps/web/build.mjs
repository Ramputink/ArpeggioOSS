/**
 * Bundle the Arpeggio web app into self-contained static assets in dist/.
 *
 *   node build.mjs           # one-shot production bundle
 *   node build.mjs --serve   # watch + local dev server on http://localhost:5173
 *
 * The bundle inlines @arpeggio/musicxml-parser and @arpeggio/practice-engine
 * (pure browser-safe TS). Code splitting is on so the heavy MOTOR 2 stack
 * (@arpeggio/motor2-basicpitch → Basic Pitch + TensorFlow.js) lands in a separate
 * chunk that is fetched lazily via its dynamic import — only when the user turns
 * on chord mode — keeping the initial app.js light. The OMR backend serves dist/
 * at "/" in production.
 */
import { context, build } from "esbuild";
import { cp, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outdir = join(here, "dist");
const serve = process.argv.includes("--serve");

/**
 * Copy the Basic Pitch TF.js model (~900 KB, model.json + weight shard) out of
 * node_modules into dist/models/basic-pitch, where BasicPitchDetector fetches it
 * (`/models/basic-pitch/model.json`). Kept out of git this way — it's a build
 * artifact, reproduced from the pinned @spotify/basic-pitch dependency.
 */
async function copyBasicPitchModel() {
  try {
    const require = createRequire(import.meta.url);
    const modelSrc = join(dirname(require.resolve("@spotify/basic-pitch/package.json")), "model");
    await cp(modelSrc, join(outdir, "models", "basic-pitch"), { recursive: true });
  } catch (err) {
    console.warn("warning: could not copy Basic Pitch model (chord mode needs it):", err.message);
  }
}

const opts = {
  entryPoints: { app: join(here, "src/main.ts") },
  bundle: true,
  format: "esm",
  target: ["es2020"],
  sourcemap: true,
  splitting: true,
  outdir,
  logLevel: "info",
  loader: { ".ts": "ts" },
};

await mkdir(outdir, { recursive: true });
await cp(join(here, "public"), outdir, { recursive: true });
await copyBasicPitchModel();

if (serve) {
  const ctx = await context(opts);
  await ctx.watch();
  const { host, port } = await ctx.serve({ servedir: outdir, host: "127.0.0.1", port: 5173 });
  console.log(`dev server: http://${host}:${port}`);
} else {
  await build({ ...opts, minify: true });
  console.log("built dist/app.js");
}
