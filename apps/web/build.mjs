/**
 * Bundle the Arpeggio web app into self-contained static assets in dist/.
 *
 *   node build.mjs           # one-shot production bundle
 *   node build.mjs --serve   # watch + local dev server on http://localhost:5173
 *
 * The bundle inlines @arpeggio/musicxml-parser and @arpeggio/practice-engine
 * (pure browser-safe TS), so the output is just dist/app.js + index.html + css.
 * The OMR backend serves dist/ at "/" in production.
 */
import { context, build } from "esbuild";
import { cp, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const outdir = join(here, "dist");
const serve = process.argv.includes("--serve");

const opts = {
  entryPoints: [join(here, "src/main.ts")],
  bundle: true,
  format: "esm",
  target: ["es2020"],
  sourcemap: true,
  outfile: join(outdir, "app.js"),
  logLevel: "info",
  loader: { ".ts": "ts" },
};

await mkdir(outdir, { recursive: true });
await cp(join(here, "public"), outdir, { recursive: true });

if (serve) {
  const ctx = await context(opts);
  await ctx.watch();
  const { host, port } = await ctx.serve({ servedir: outdir, host: "127.0.0.1", port: 5173 });
  console.log(`dev server: http://${host}:${port}`);
} else {
  await build({ ...opts, minify: true });
  console.log("built dist/app.js");
}
