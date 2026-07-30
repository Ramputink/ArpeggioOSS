#!/usr/bin/env node
/**
 * omr-client — end-to-end test client for the Arpeggio OMR service.
 *
 * Uploads an image/PDF score to the backend, saves the returned MusicXML, then
 * parses it locally and prints a quality report. Uses only Node's built-in
 * `fetch`/`FormData`/`Blob` (Node 20+), so it has no runtime deps beyond the
 * sibling parser package.
 *
 * Usage:
 *   omr-client ./score.pdf
 *   omr-client ./score.png --server http://192.168.0.23:8000 --out ./score.musicxml
 *   omr-client ./scan.jpg --no-preprocess
 *   omr-client --health
 *   omr-client --parse ./samples/demo.musicxml   # offline: parse + report only
 */
import { readFile, writeFile } from "node:fs/promises";
import { basename, extname, resolve } from "node:path";

import { formatReport, parseMusicXML, qualityReport } from "@arpeggio/musicxml-parser";

const DEFAULT_SERVER = process.env.OMR_SERVER ?? "http://192.168.0.23:8000";

interface Args {
  file?: string;
  server: string;
  out?: string;
  preprocess: boolean;
  health: boolean;
  parseOnly: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    server: DEFAULT_SERVER,
    preprocess: true,
    health: false,
    parseOnly: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    switch (a) {
      case "--server":
        args.server = argv[++i];
        break;
      case "--out":
        args.out = argv[++i];
        break;
      case "--no-preprocess":
        args.preprocess = false;
        break;
      case "--parse":
        args.parseOnly = true;
        args.file = argv[++i];
        break;
      case "--health":
        args.health = true;
        break;
      case "-h":
      case "--help":
        printUsage();
        process.exit(0);
        break;
      default:
        if (a.startsWith("-")) {
          fail(`Unknown option: ${a}`);
        } else if (!args.file) {
          args.file = a;
        }
    }
  }
  return args;
}

function printUsage(): void {
  console.log(
    [
      "omr-client — upload a score to the Arpeggio OMR service and parse the result.",
      "",
      "Usage:",
      "  omr-client <file> [--server URL] [--out PATH] [--no-preprocess]",
      "  omr-client --health [--server URL]",
      "  omr-client --parse <file.musicxml>",
      "",
      "Options:",
      `  --server URL      OMR service base URL (default ${DEFAULT_SERVER}, or $OMR_SERVER)`,
      "  --out PATH        Where to save the MusicXML (default <file>.musicxml)",
      "  --no-preprocess   Skip server-side OpenCV preprocessing",
      "  --health          Query the /health endpoint and exit",
      "  --parse FILE      Parse a local MusicXML and print the report (no server)",
    ].join("\n"),
  );
}

function fail(msg: string): never {
  console.error(`error: ${msg}`);
  process.exit(1);
}

async function checkHealth(server: string): Promise<void> {
  const url = `${server.replace(/\/$/, "")}/health`;
  const res = await fetch(url).catch((e) => fail(`cannot reach ${url}: ${e.message}`));
  if (!res.ok) fail(`health check failed: HTTP ${res.status}`);
  const body = await res.json();
  console.log(`✓ ${url}`);
  console.log(JSON.stringify(body, null, 2));
}

async function runOmr(args: Args): Promise<void> {
  const filePath = resolve(args.file!);
  const data = await readFile(filePath).catch((e) => fail(`cannot read ${filePath}: ${e.message}`));

  const url = new URL(`${args.server.replace(/\/$/, "")}/omr`);
  if (!args.preprocess) url.searchParams.set("preprocess", "false");

  const form = new FormData();
  form.append("file", new Blob([data]), basename(filePath));

  console.log(
    `→ POST ${url}  (${(data.length / 1024).toFixed(1)} KiB, ` + `preprocess=${args.preprocess})`,
  );
  const started = Date.now();
  const res = await fetch(url, { method: "POST", body: form }).catch((e) =>
    fail(`request failed: ${e.message}`),
  );
  const elapsed = ((Date.now() - started) / 1000).toFixed(1);

  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      if (j?.detail) detail += `: ${j.detail}`;
    } catch {
      /* non-JSON error body */
    }
    fail(`OMR failed (${detail})`);
  }

  const warning = res.headers.get("x-omr-warning");
  if (warning) console.warn(`⚠ server warning: ${warning}`);

  const musicxml = await res.text();
  console.log(`✓ received MusicXML in ${elapsed}s (${(musicxml.length / 1024).toFixed(1)} KiB)`);

  const outPath = args.out
    ? resolve(args.out)
    : filePath.slice(0, -extname(filePath).length) + ".musicxml";
  await writeFile(outPath, musicxml, "utf-8");
  console.log(`✓ saved ${outPath}`);

  // Parse locally and report quality.
  console.log("");
  try {
    const score = parseMusicXML(musicxml);
    console.log(formatReport(qualityReport(score)));
  } catch (e) {
    fail(`parsing the returned MusicXML failed: ${(e as Error).message}`);
  }
}

async function parseLocal(file: string): Promise<void> {
  const path = resolve(file);
  const xml = await readFile(path, "utf-8").catch((e) => fail(`cannot read ${path}: ${e.message}`));
  const score = parseMusicXML(xml);
  console.log(formatReport(qualityReport(score)));
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.health) {
    await checkHealth(args.server);
    return;
  }
  if (args.parseOnly) {
    if (!args.file) fail("--parse requires a file path");
    await parseLocal(args.file);
    return;
  }
  if (!args.file) {
    printUsage();
    process.exit(1);
  }
  await runOmr(args);
}

main().catch((e) => fail(e.message));
