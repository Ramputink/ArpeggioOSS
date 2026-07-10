/**
 * Generate the iPhone design mockup (apps/mockup/iphone.html) — a self-contained,
 * interactive "boceto" of the Arpeggio piano-tutor iOS app. Six screens across
 * the full flow, in a nocturnal amber/teal identity with a light ("Daytime")
 * theme toggle. The Practice and Chord screens animate the REAL right-hand line
 * of the OMR'd Minuet / a synthesized triad, using the model the working web app
 * renders. Opens standalone in any browser (no server, no external assets).
 *
 *   node apps/mockup/gen.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// The right-hand melody of the OMR'd Minuet, checked in so the mockup
// regenerates without the OMR backend.
const MEL_PATH = process.env.MELODY_JSON || join(here, "melody.json");
const melody = readFileSync(MEL_PATH, "utf-8");

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Arpeggio — iPhone concept</title>
<style>
  /* ===== Tokens ==========================================================
     Two layers: page tokens (the backdrop the phones sit on) and screen
     tokens (the app UI inside each phone). Both follow the OS theme and the
     on-page toggle, so the "Daytime" light version is one switch. */
  :root {
    /* page backdrop (dark default) */
    --page-bg: #0a0c10; --page-bg2: #10141c; --page-fg: #e8ecf3;
    --page-muted: #7f8aa0; --page-line: #222a38;
    /* app screen (dark default) */
    --s-bg: #0b0e14; --s-fg: #eef2f8; --s-mut: #7b8598;
    --s-elev: rgba(255,255,255,0.045); --s-line: rgba(255,255,255,0.08);
    --s-key: #e9edf4; --s-blk: #10151d; --s-roll: #070a0f; --s-tab: rgba(10,13,20,0.9);
    /* accents (shared across themes) */
    --amber: #f2b441; --teal: #33d6c0; --violet: #a78bfa; --rose: #ff6b6b;
  }
  @media (prefers-color-scheme: light) {
    :root {
      --page-bg: #eceff5; --page-bg2: #e2e7f0; --page-fg: #1a2230;
      --page-muted: #5b6577; --page-line: #d3dae5;
      --s-bg: #f6f7fc; --s-fg: #17202f; --s-mut: #5c6678;
      --s-elev: rgba(12,18,32,0.04); --s-line: rgba(12,18,32,0.09);
      --s-key: #ffffff; --s-blk: #2a3346; --s-roll: #eef1f8; --s-tab: rgba(246,247,252,0.92);
    }
  }
  :root[data-theme="dark"] {
    --page-bg: #0a0c10; --page-bg2: #10141c; --page-fg: #e8ecf3; --page-muted: #7f8aa0; --page-line: #222a38;
    --s-bg: #0b0e14; --s-fg: #eef2f8; --s-mut: #7b8598;
    --s-elev: rgba(255,255,255,0.045); --s-line: rgba(255,255,255,0.08);
    --s-key: #e9edf4; --s-blk: #10151d; --s-roll: #070a0f; --s-tab: rgba(10,13,20,0.9);
  }
  :root[data-theme="light"] {
    --page-bg: #eceff5; --page-bg2: #e2e7f0; --page-fg: #1a2230; --page-muted: #5b6577; --page-line: #d3dae5;
    --s-bg: #f6f7fc; --s-fg: #17202f; --s-mut: #5c6678;
    --s-elev: rgba(12,18,32,0.04); --s-line: rgba(12,18,32,0.09);
    --s-key: #ffffff; --s-blk: #2a3346; --s-roll: #eef1f8; --s-tab: rgba(246,247,252,0.92);
  }

  * { box-sizing: border-box; }
  html, body { margin: 0; }
  body {
    background:
      radial-gradient(120% 80% at 50% -10%, rgba(242,180,65,0.06), transparent 60%),
      radial-gradient(90% 60% at 15% 20%, rgba(51,214,192,0.05), transparent 55%),
      linear-gradient(180deg, var(--page-bg), var(--page-bg2));
    color: var(--page-fg);
    font: 15px/1.5 -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif;
    min-height: 100vh;
  }
  .serif { font-family: "SF Pro Display", ui-serif, Georgia, "Times New Roman", serif; }

  .wrap { max-width: 1120px; margin: 0 auto; padding: 34px 20px 64px; position: relative; }

  .themebtn {
    position: absolute; top: 30px; right: 20px; z-index: 5;
    background: var(--s-elev); color: var(--page-fg); border: 1px solid var(--page-line);
    border-radius: 999px; padding: 8px 14px; font-size: 13px; font-weight: 600; cursor: pointer;
  }
  .themebtn:hover { border-color: var(--page-muted); }
  .themebtn:focus-visible { outline: 2px solid var(--amber); outline-offset: 2px; }

  header.top { text-align: center; margin-bottom: 8px; }
  .brand { display: inline-flex; align-items: center; gap: 12px; }
  .glyph {
    width: 40px; height: 40px; border-radius: 11px; display: grid; place-items: center;
    background: linear-gradient(160deg, var(--amber), #d98a2b);
    color: #201400; font-size: 22px; box-shadow: 0 6px 20px rgba(242,180,65,0.28);
  }
  h1.name { font-size: 34px; margin: 0; letter-spacing: -0.02em; font-weight: 700; }
  .tagline { color: var(--page-muted); margin: 14px auto 4px; max-width: 46ch; text-wrap: balance; }
  .kicker { text-transform: uppercase; letter-spacing: 0.18em; font-size: 11px; font-weight: 700; color: var(--amber); }

  .rowlabel {
    text-align: center; text-transform: uppercase; letter-spacing: 0.16em; font-size: 11px;
    font-weight: 700; color: var(--page-muted); margin: 40px 0 2px;
  }
  .rowlabel:first-of-type { margin-top: 30px; }
  .stage { display: flex; gap: 30px; justify-content: center; align-items: flex-start; flex-wrap: wrap; margin-top: 26px; }
  .col { display: flex; flex-direction: column; align-items: center; gap: 13px; width: 300px; }
  .caption { text-align: center; }
  .caption .t { font-weight: 650; font-size: 14px; }
  .caption .d { color: var(--page-muted); font-size: 12.5px; margin-top: 2px; text-wrap: balance; }

  /* ---- iPhone frame -------------------------------------------------------- */
  .phone {
    width: 300px; height: 620px; border-radius: 46px; position: relative;
    background: #05070b; padding: 11px;
    box-shadow: 0 0 0 2px #2b3342, 0 0 0 5px #0c1017, 0 34px 70px rgba(0,0,0,0.5);
  }
  .screen {
    position: relative; width: 100%; height: 100%; border-radius: 36px; overflow: hidden;
    background: var(--s-bg); color: var(--s-fg); display: flex; flex-direction: column;
  }
  .island { position: absolute; top: 9px; left: 50%; transform: translateX(-50%); width: 92px; height: 26px; background: #000; border-radius: 16px; z-index: 40; }
  .statusbar { height: 46px; flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between; padding: 0 22px; font-size: 13px; font-weight: 600; }
  .statusbar .dots { letter-spacing: 1px; opacity: 0.85; }
  .body { flex: 1 1 auto; min-height: 0; position: relative; overflow: hidden; }
  .homebar { height: 22px; flex: 0 0 auto; display: grid; place-items: center; }
  .homebar i { width: 118px; height: 5px; border-radius: 3px; background: color-mix(in srgb, var(--s-fg) 45%, transparent); }
  .tabbar { height: 58px; flex: 0 0 auto; display: flex; border-top: 1px solid var(--s-line); background: var(--s-tab); backdrop-filter: blur(8px); }
  .tab { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 3px; color: var(--s-mut); font-size: 10px; font-weight: 600; }
  .tab .ic { font-size: 17px; line-height: 1; }
  .tab.on { color: var(--amber); }

  .scr { position: absolute; inset: 0; padding: 4px 16px 6px; display: flex; flex-direction: column; }
  .scr h2.title { font-size: 25px; margin: 4px 0 12px; letter-spacing: -0.02em; }

  /* Library */
  .cont { border-radius: 20px; padding: 15px; position: relative; overflow: hidden; background: linear-gradient(150deg, rgba(242,180,65,0.16), rgba(51,214,192,0.10)); border: 1px solid var(--s-line); }
  .cont .lbl { text-transform: uppercase; letter-spacing: 0.14em; font-size: 10px; color: var(--amber); font-weight: 700; }
  .cont .pc { font-size: 19px; font-weight: 650; margin-top: 4px; }
  .cont .sub { color: var(--s-mut); font-size: 12px; margin-top: 2px; }
  .ring { position: absolute; top: 14px; right: 14px; width: 46px; height: 46px; }
  .resume { margin-top: 13px; display: inline-flex; align-items: center; gap: 7px; background: var(--amber); color: #201400; border: 0; border-radius: 11px; padding: 9px 15px; font-weight: 700; font-size: 13px; }
  .list { margin-top: 14px; display: flex; flex-direction: column; gap: 9px; overflow: hidden; }
  .row { display: flex; align-items: center; gap: 12px; padding: 11px 12px; border-radius: 14px; background: var(--s-elev); border: 1px solid var(--s-line); }
  .row .cover { width: 38px; height: 38px; border-radius: 10px; display: grid; place-items: center; font-size: 17px; flex: 0 0 auto; }
  .row .meta { flex: 1; min-width: 0; }
  .row .pn { font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .row .cn { font-size: 11.5px; color: var(--s-mut); }
  .row .pct { font-variant-numeric: tabular-nums; font-size: 12px; color: var(--s-mut); font-weight: 650; }
  .dots3 { display: inline-flex; gap: 3px; vertical-align: middle; margin-left: 6px; }
  .dots3 b { width: 5px; height: 5px; border-radius: 50%; background: color-mix(in srgb, var(--s-fg) 20%, transparent); }
  .dots3 b.on { background: var(--teal); }
  .import { margin-top: 12px; display: flex; align-items: center; justify-content: center; gap: 8px; border: 1.4px dashed var(--s-line); border-radius: 14px; padding: 12px; color: var(--s-mut); font-size: 13px; font-weight: 600; }

  /* Practice / chord shared */
  .pnav { display: flex; align-items: center; gap: 10px; padding: 2px 0 8px; }
  .pnav .chev { font-size: 18px; color: var(--amber); }
  .pnav .pt { font-weight: 650; font-size: 16px; letter-spacing: -0.01em; }
  .pnav .more { margin-left: auto; color: var(--s-mut); font-size: 18px; }
  .chips { display: flex; gap: 7px; margin-bottom: 8px; flex-wrap: wrap; }
  .chip { font-size: 11px; font-weight: 600; padding: 5px 10px; border-radius: 999px; background: var(--s-elev); color: var(--s-fg); border: 1px solid var(--s-line); }
  .chip.mic { color: var(--teal); border-color: rgba(51,214,192,0.4); }
  .chip.m2 { color: var(--violet); border-color: rgba(167,139,250,0.4); }
  .chip .pulse { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: currentColor; margin-right: 5px; animation: pulse 1.4s infinite; }
  @keyframes pulse { 0%,100% { opacity: 1; } 50% { opacity: .35; } }
  canvas.roll { width: 100%; border-radius: 14px; display: block; background: var(--s-roll); border: 1px solid var(--s-line); }
  .feedback { display: flex; align-items: center; gap: 10px; margin-top: 10px; }
  .fb-note { width: 52px; height: 52px; border-radius: 14px; display: grid; place-items: center; font-weight: 750; font-size: 18px; background: rgba(51,214,192,0.16); color: var(--teal); font-variant-numeric: tabular-nums; }
  .fb-meta { flex: 1; }
  .fb-meta .k { font-size: 11px; color: var(--s-mut); text-transform: uppercase; letter-spacing: .08em; }
  .bar { height: 8px; border-radius: 5px; background: var(--s-elev); overflow: hidden; margin-top: 6px; }
  .bar > i { display: block; height: 100%; background: linear-gradient(90deg, var(--teal), var(--amber)); }
  .acc { font-size: 22px; font-weight: 750; font-variant-numeric: tabular-nums; }

  /* Progress */
  .statgrid { display: grid; grid-template-columns: 1.3fr 1fr; gap: 10px; }
  .stat { border-radius: 16px; padding: 13px 14px; background: var(--s-elev); border: 1px solid var(--s-line); }
  .stat .k { font-size: 11px; color: var(--s-mut); text-transform: uppercase; letter-spacing: .08em; }
  .stat .big { font-size: 30px; font-weight: 780; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
  .stat .big small { font-size: 15px; color: var(--s-mut); font-weight: 600; }
  .heat { display: flex; align-items: flex-end; gap: 3px; height: 60px; margin-top: 6px; }
  .heat b { flex: 1; border-radius: 3px 3px 1px 1px; }
  .section-h { font-size: 12px; color: var(--s-mut); text-transform: uppercase; letter-spacing: .1em; margin: 14px 0 8px; font-weight: 700; }
  .focus { display: flex; flex-direction: column; gap: 8px; }
  .frow { display: flex; align-items: center; gap: 10px; background: var(--s-elev); border: 1px solid var(--s-line); border-radius: 12px; padding: 10px 12px; }
  .frow .m { width: 30px; height: 30px; border-radius: 8px; display: grid; place-items: center; font-weight: 750; font-size: 13px; background: rgba(242,180,65,0.18); color: var(--amber); font-variant-numeric: tabular-nums; }
  .frow .why { font-size: 12.5px; color: var(--s-fg); opacity: 0.85; }
  .week { display: flex; align-items: flex-end; gap: 6px; height: 46px; margin-top: 6px; }
  .week b { flex: 1; background: linear-gradient(180deg, var(--amber), rgba(242,180,65,0.25)); border-radius: 3px; }

  /* Onboarding / calibration */
  .ob { text-align: center; padding-top: 12px; display: flex; flex-direction: column; height: 100%; }
  .ob .step { text-transform: uppercase; letter-spacing: .16em; font-size: 10px; color: var(--amber); font-weight: 700; }
  .ob h2 { font-size: 22px; margin: 8px 16px 4px; letter-spacing: -0.01em; }
  .ob p { color: var(--s-mut); font-size: 13px; margin: 0 20px; }
  .keycard { margin: 20px 14px 8px; border-radius: 18px; padding: 16px; background: var(--s-elev); border: 1px solid var(--s-line); }
  .mini-keys { display: flex; height: 84px; align-items: flex-end; }
  .mini-keys .w { flex: 1; margin: 0 1px; background: var(--s-key); border-radius: 4px; height: 100%; }
  .mini-keys .w.hit { background: var(--amber); box-shadow: 0 0 16px rgba(242,180,65,0.6); }
  .meter { margin: 14px 16px 0; }
  .meter .lab { display: flex; justify-content: space-between; font-size: 11px; color: var(--s-mut); }
  .meter .track { height: 8px; border-radius: 5px; background: var(--s-elev); overflow: hidden; margin-top: 5px; }
  .meter .track > i { display: block; height: 100%; }
  .ob .cta { margin: auto 16px 8px; }
  .btn-primary { width: 100%; background: var(--amber); color: #201400; border: 0; border-radius: 13px; padding: 13px; font-weight: 700; font-size: 15px; }
  .ob .skip { color: var(--s-mut); font-size: 12px; margin-top: 10px; }

  /* Scan / import */
  .viewfinder { position: relative; margin: 8px 0 0; border-radius: 16px; overflow: hidden; height: 300px; background: linear-gradient(160deg, #1a2130, #0d121b); border: 1px solid var(--s-line); }
  :root[data-theme="light"] .viewfinder { background: linear-gradient(160deg, #cfd6e4, #eef1f8); }
  .sheet { position: absolute; inset: 26px 20px; background: repeating-linear-gradient(180deg, transparent 0 14px, color-mix(in srgb, var(--s-fg) 28%, transparent) 14px 15px); border-radius: 6px; opacity: 0.5; transform: rotate(-1.2deg); }
  .corners::before, .corners::after, .cn2::before, .cn2::after { content: ""; position: absolute; width: 26px; height: 26px; border: 3px solid var(--amber); }
  .corners::before { top: 14px; left: 14px; border-right: 0; border-bottom: 0; border-radius: 6px 0 0 0; }
  .corners::after { top: 14px; right: 14px; border-left: 0; border-bottom: 0; border-radius: 0 6px 0 0; }
  .cn2::before { bottom: 14px; left: 14px; border-right: 0; border-top: 0; border-radius: 0 0 0 6px; }
  .cn2::after { bottom: 14px; right: 14px; border-left: 0; border-top: 0; border-radius: 0 0 6px 0; }
  .scanline { position: absolute; left: 14px; right: 14px; height: 2px; background: linear-gradient(90deg, transparent, var(--teal), transparent); animation: scan 2.4s ease-in-out infinite; }
  @keyframes scan { 0%,100% { top: 30px; } 50% { top: 270px; } }
  .scanstatus { display: flex; align-items: center; gap: 9px; margin-top: 14px; background: var(--s-elev); border: 1px solid var(--s-line); border-radius: 13px; padding: 12px 14px; }
  .spin { width: 16px; height: 16px; border-radius: 50%; border: 2px solid var(--s-line); border-top-color: var(--teal); animation: spin 0.9s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  .scanstatus .st { font-size: 13px; font-weight: 600; }
  .scanstatus .su { font-size: 11.5px; color: var(--s-mut); }

  footer.note { text-align: center; color: var(--page-muted); font-size: 12.5px; margin-top: 44px; }
  footer.note code { background: color-mix(in srgb, var(--page-muted) 20%, transparent); padding: 1px 6px; border-radius: 5px; }
  .legend { display: inline-flex; gap: 16px; margin-top: 10px; flex-wrap: wrap; justify-content: center; }
  .legend span { color: var(--page-muted); font-size: 12px; }
  .legend i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; vertical-align: -1px; margin-right: 5px; }

  @media (prefers-reduced-motion: reduce) {
    .pulse, .scanline, .spin { animation: none; }
  }
</style>
</head>
<body>
<div class="wrap">
  <button class="themebtn" id="themebtn" aria-label="Toggle theme">☾ / ☀ Theme</button>

  <header class="top">
    <div class="brand"><div class="glyph">♪</div><h1 class="name">Arpeggio</h1></div>
    <p class="tagline">A piano tutor that <b>listens through the microphone</b>. Import any
      score, then play — it follows you note by note and shows what to work on.</p>
    <div class="kicker">iPhone concept · design sketch</div>
  </header>

  <div class="rowlabel">The practice loop</div>
  <div class="stage">
    ${libraryPhone()}
    ${practicePhone()}
    ${progressPhone()}
  </div>

  <div class="rowlabel">Getting started &amp; going deeper</div>
  <div class="stage">
    ${onboardingPhone()}
    ${scanPhone()}
    ${chordPhone()}
  </div>

  <footer class="note">
    Interactive concept — the Practice screen animates the real right-hand line of the OMR'd
    <b>Menuet BWV Anh. 114</b>; Chord mode animates a detected triad. Built on the working stack:
    <code>musicxml-parser</code> → <code>practice-engine</code> (YIN + follow-you + feedback) with a
    real <code>MOTOR 2</code> (Basic Pitch). A native build wraps the same core with
    <code>AVAudioEngine</code> capture and a Core ML MOTOR 2.
    <div class="legend">
      <span><i style="background:#f2b441"></i>Current note</span>
      <span><i style="background:#33d6c0"></i>Hit / right hand</span>
      <span><i style="background:#a78bfa"></i>MOTOR 2 / chords</span>
    </div>
  </footer>
</div>

<script>
const MEL = ${melody};
</script>
<script>
(() => {
  const NAMES = ["C","C#","D","D#","E","F","F#","G","G#","A","A#","B"];
  const nameOf = (m) => NAMES[((m % 12) + 12) % 12] + (Math.floor(m / 12) - 1);
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  // ---- theme toggle -------------------------------------------------------
  const btn = document.getElementById("themebtn");
  btn.addEventListener("click", () => {
    const cur = document.documentElement.getAttribute("data-theme");
    const isDark = cur ? cur === "dark"
      : window.matchMedia("(prefers-color-scheme: dark)").matches;
    document.documentElement.setAttribute("data-theme", isDark ? "light" : "dark");
  });

  // ---- Progress charts ----------------------------------------------------
  const heat = document.getElementById("heat");
  const heatVals = [0.98,0.95,0.99,0.92,0.9,0.97,0.88,0.62,0.94,0.99,0.96,0.9,0.85,0.98,0.93,0.97,
                    0.9,0.88,0.7,0.72,0.95,0.99,0.94,0.9,0.86,0.98,0.74,0.96,0.99,0.93,0.9,0.97];
  if (heat) heatVals.forEach((v) => {
    const b = document.createElement("b");
    b.style.height = (18 + v * 42) + "px";
    b.style.background = v < 0.8
      ? "linear-gradient(180deg,#f2b441,rgba(242,180,65,.3))"
      : "linear-gradient(180deg,#33d6c0,rgba(51,214,192,.28))";
    heat.appendChild(b);
  });
  const week = document.getElementById("week");
  if (week) [12,20,0,35,18,26,22].forEach((v) => {
    const b = document.createElement("b"); b.style.height = (6 + v) + "px"; week.appendChild(b);
  });

  // ---- Falling-notes engine (shared by Practice + Chord) ------------------
  function cssvar(el, name) { return getComputedStyle(el).getPropertyValue(name).trim(); }

  function makeRoll(canvas, notes, opts) {
    const ctx = canvas.getContext("2d");
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    const CW = canvas.width, CH = canvas.height;
    canvas.width = CW * dpr; canvas.height = CH * dpr; ctx.scale(dpr, dpr);
    const screen = canvas.closest(".screen");

    const LO = opts.lo, HI = opts.hi;
    const KEYB_H = 62, HIT_Y = CH - KEYB_H, TOP_Y = 8;
    const isWhite = (m) => [0,2,4,5,7,9,11].includes(((m % 12) + 12) % 12);
    const whites = []; for (let m = LO; m <= HI; m++) if (isWhite(m)) whites.push(m);
    const whiteW = CW / whites.length;
    const xC = {};
    whites.forEach((m, i) => (xC[m] = (i + 0.5) * whiteW));
    for (let m = LO; m <= HI; m++) if (!isWhite(m)) xC[m] = ((xC[m-1] ?? 0) + (xC[m+1] ?? CW)) / 2;

    const LOOK = opts.look, pxPerBeat = (HIT_Y - TOP_Y) / LOOK, BPM = opts.bpm;
    const total = notes.reduce((mx, n) => Math.max(mx, n.t + n.d), 0);
    const lit = {}; let playhead = 0, prev = null, lastActive = -1;

    function roundRect(x, y, w, h, r) {
      r = Math.min(r, w / 2, h / 2);
      ctx.beginPath();
      ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
      ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
    }

    function draw(now) {
      const keyCol = cssvar(screen, "--s-key"), blkCol = cssvar(screen, "--s-blk");
      ctx.clearRect(0, 0, CW, CH);
      for (const n of notes) {
        const yB = HIT_Y - (n.t - playhead) * pxPerBeat;
        const h = Math.max(6, n.d * pxPerBeat - 2), yT = yB - h;
        if (yB < TOP_Y || yT > HIT_Y) continue;
        const x = xC[n.m] ?? CW / 2, w = Math.max(10, whiteW * 0.82);
        const active = n.t <= playhead && playhead < n.t + n.d;
        ctx.fillStyle = active ? (opts.color || "#f2b441") : (opts.noteColor || "rgba(51,214,192,0.85)");
        ctx.shadowColor = active ? "rgba(242,180,65,0.55)" : "transparent";
        ctx.shadowBlur = active ? 15 : 0;
        roundRect(x - w / 2, yT, w, h, 4); ctx.fill(); ctx.shadowBlur = 0;
      }
      ctx.strokeStyle = "rgba(242,180,65,0.5)"; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, HIT_Y); ctx.lineTo(CW, HIT_Y); ctx.stroke();
      for (const m of whites) {
        const x = xC[m] - whiteW / 2, glow = lit[m] && lit[m] > now;
        ctx.fillStyle = glow ? "rgba(51,214,192,0.9)" : keyCol;
        roundRect(x + 1, HIT_Y + 2, whiteW - 2, KEYB_H - 4, 4); ctx.fill();
      }
      const bW = whiteW * 0.62;
      for (let m = LO; m <= HI; m++) if (!isWhite(m)) {
        const x = xC[m] - bW / 2, glow = lit[m] && lit[m] > now;
        ctx.fillStyle = glow ? "rgba(242,180,65,0.95)" : blkCol;
        roundRect(x, HIT_Y + 2, bW, (KEYB_H - 4) * 0.62, 3); ctx.fill();
      }
    }

    function step(now) {
      if (prev == null) prev = now;
      const dt = Math.min(0.05, (now - prev) / 1000); prev = now;
      playhead += dt * (BPM / 60);
      let act = -1;
      for (let i = 0; i < notes.length; i++) if (notes[i].t <= playhead && playhead < notes[i].t + notes[i].d) { act = i; break; }
      if (act !== -1 && act !== lastActive) {
        lastActive = act;
        // light every note sharing this onset (chords)
        const t0 = notes[act].t;
        const group = notes.filter((n) => Math.abs(n.t - t0) < 1e-6);
        for (const n of group) lit[n.m] = now + 240;
        if (opts.onHit) opts.onHit(group, now);
      }
      if (playhead > total + LOOK) { playhead = 0; lastActive = -1; if (opts.onLoop) opts.onLoop(); }
      draw(now);
      if (!reduce) requestAnimationFrame(step);
    }

    if (reduce) { playhead = 2; draw(performance.now()); }
    else requestAnimationFrame(step);
  }

  // ---- Practice screen ----------------------------------------------------
  const roll = document.getElementById("roll");
  if (roll) {
    let hits = 0, correct = 0;
    const fbNote = document.getElementById("fbNote");
    const accNum = document.getElementById("accNum");
    const accBar = document.getElementById("accBar");
    makeRoll(roll, MEL, {
      lo: 60, hi: 84, look: 7, bpm: 72,
      onHit(group) {
        const n = group[0]; hits++;
        const ok = (hits % 17) !== 5; if (ok) correct++;
        if (fbNote) { fbNote.textContent = nameOf(n.m);
          fbNote.style.background = ok ? "rgba(51,214,192,0.16)" : "rgba(255,107,107,0.16)";
          fbNote.style.color = ok ? "#33d6c0" : "#ff6b6b"; }
        const pct = Math.round((correct / hits) * 100);
        if (accNum) accNum.textContent = pct + "%"; if (accBar) accBar.style.width = pct + "%";
      },
      onLoop() { hits = 0; correct = 0; },
    });
  }

  // ---- Chord screen (MOTOR 2) ---------------------------------------------
  const chord = document.getElementById("chordRoll");
  if (chord) {
    // A short left-hand chord progression (triads): C, F, G, C.
    const CH = [
      [48,52,55], [53,57,60], [55,59,62], [48,52,55],
    ];
    const notes = [];
    CH.forEach((tri, i) => tri.forEach((m) => notes.push({ t: i * 2, d: 1.7, m })));
    const eng = document.getElementById("m2engine");
    makeRoll(chord, notes, {
      lo: 45, hi: 69, look: 6, bpm: 60,
      color: "#a78bfa", noteColor: "rgba(167,139,250,0.8)",
      onHit(group) {
        const names = group.slice().sort((a,b)=>a.m-b.m).map((n) => nameOf(n.m).replace(/\\d/, "")).join(" ");
        if (eng) eng.textContent = "poly · " + group.length + " notes [" + names + "]";
      },
    });
  }
})();
</script>
</body>
</html>`;

// ---- screen templates (kept as functions for readability) ------------------
function statusbar() {
  return '<div class="island"></div><div class="statusbar"><span>9:41</span><span class="dots">● ▾ ▮</span></div>';
}
function tabbar(active) {
  const t = (name, ic, key) =>
    '<div class="tab' + (active === key ? " on" : "") + '"><span class="ic">' + ic + "</span>" + name + "</div>";
  return '<div class="tabbar">' + t("Library","▤","lib") + t("Practice","◉","prac") + t("Progress","▨","prog") + "</div>";
}
function phone(inner, active) {
  return '<div class="phone"><div class="screen">' + statusbar() +
    '<div class="body">' + inner + "</div>" + tabbar(active) +
    '<div class="homebar"><i></i></div></div></div>';
}
function col(inner, active, t, d) {
  return '<div class="col">' + phone(inner, active) +
    '<div class="caption"><div class="t">' + t + '</div><div class="d">' + d + "</div></div></div>";
}

function libraryPhone() {
  return col(`<div class="scr">
    <h2 class="title">Library</h2>
    <div class="cont">
      <svg class="ring" viewBox="0 0 46 46"><circle cx="23" cy="23" r="19" fill="none" stroke="rgba(140,150,170,0.3)" stroke-width="5"/><circle cx="23" cy="23" r="19" fill="none" stroke="#f2b441" stroke-width="5" stroke-linecap="round" stroke-dasharray="119" stroke-dashoffset="45" transform="rotate(-90 23 23)"/></svg>
      <div class="lbl">Continue</div><div class="pc serif">Menuet in G</div>
      <div class="sub">Right hand · 72 BPM · 62% mastered</div><button class="resume">▶ Resume</button>
    </div>
    <div class="list">
      <div class="row"><div class="cover" style="background:rgba(167,139,250,0.18);color:#a78bfa">◵</div><div class="meta"><div class="pn serif">Gymnopédie No.1</div><div class="cn">Satie <span class="dots3"><b class="on"></b><b></b><b></b></span></div></div><div class="pct">28%</div></div>
      <div class="row"><div class="cover" style="background:rgba(51,214,192,0.16);color:#33d6c0">♬</div><div class="meta"><div class="pn serif">Prélude in C</div><div class="cn">Bach · BWV 846 <span class="dots3"><b class="on"></b><b class="on"></b><b></b></span></div></div><div class="pct">—</div></div>
      <div class="row"><div class="cover" style="background:rgba(242,180,65,0.18);color:#f2b441">☾</div><div class="meta"><div class="pn serif">Clair de lune</div><div class="cn">Debussy <span class="dots3"><b class="on"></b><b class="on"></b><b class="on"></b></span></div></div><div class="pct">locked</div></div>
    </div>
    <div class="import">＋ &nbsp;Import a score &nbsp;·&nbsp; 📷 photo / PDF</div>
  </div>`, "lib", "Biblioteca",
    "Tus piezas con progreso real. Importa una nueva por foto/PDF → OMR.");
}

function practicePhone() {
  return col(`<div class="scr">
    <div class="pnav"><span class="chev">‹</span><span class="pt serif">Menuet in G</span><span class="more">⋯</span></div>
    <div class="chips"><span class="chip">72 BPM</span><span class="chip">Right hand</span><span class="chip mic"><span class="pulse"></span>Listening</span></div>
    <canvas class="roll" id="roll" width="536" height="440"></canvas>
    <div class="feedback">
      <div class="fb-note" id="fbNote">D5</div>
      <div class="fb-meta"><div class="k">Accuracy · this take</div><div class="bar"><i id="accBar" style="width:96%"></i></div></div>
      <div class="acc" id="accNum">96%</div>
    </div>
  </div>`, "prac", "Práctica (en vivo)",
    "Las notas caen a tempo; tocas y el cursor te sigue. Verde = acierto. Melodía real del Minueto.");
}

function progressPhone() {
  return col(`<div class="scr">
    <h2 class="title">This week</h2>
    <div class="statgrid">
      <div class="stat"><div class="k">Best accuracy</div><div class="big">94<small>%</small></div></div>
      <div class="stat"><div class="k">Streak</div><div class="big">5<small> days</small></div></div>
    </div>
    <div class="stat" style="margin-top:10px"><div class="k">Accuracy by measure</div><div class="heat" id="heat"></div></div>
    <div class="section-h">Focus next</div>
    <div class="focus">
      <div class="frow"><div class="m">8</div><div class="why">Rushed — over the bar length. Loop at 60 BPM.</div></div>
      <div class="frow"><div class="m">19</div><div class="why">Left-hand leap missed 4×.</div></div>
      <div class="frow"><div class="m">27</div><div class="why">Dotted rhythm uneven.</div></div>
    </div>
    <div class="section-h">Practice minutes</div><div class="week" id="week"></div>
  </div>`, "prog", "Progreso",
    "Precisión por compás (heatmap), qué repasar y por qué, y minutos. Alimenta la repetición espaciada.");
}

function onboardingPhone() {
  const keys = Array.from({ length: 10 }, (_, i) =>
    '<div class="w' + (i === 3 ? " hit" : "") + '"></div>').join("");
  return col(`<div class="ob">
    <div style="padding-top:10px"><div class="step">Step 2 of 3 · Tune your room</div>
    <h2 class="serif">Play middle C</h2>
    <p>We measure your room's noise and the mic latency so scoring is fair on your piano.</p></div>
    <div class="keycard"><div class="mini-keys">${keys}</div></div>
    <div class="meter"><div class="lab"><span>Background noise</span><span>low</span></div><div class="track"><i style="width:22%;background:#33d6c0"></i></div></div>
    <div class="meter"><div class="lab"><span>Detected latency</span><span>38 ms</span></div><div class="track"><i style="width:30%;background:#f2b441"></i></div></div>
    <div class="cta"><button class="btn-primary">Heard it ✓ &nbsp; Continue</button><div class="skip">Grant microphone access to calibrate</div></div>
  </div>`, "", "Onboarding · calibración",
    "Al empezar: permiso de micro + calibración de sala (ruido y latencia) para puntuar justo en TU piano.");
}

function scanPhone() {
  return col(`<div class="scr">
    <div class="pnav"><span class="chev">‹</span><span class="pt">Import a score</span></div>
    <div class="viewfinder">
      <div class="sheet"></div>
      <div class="corners"></div><div class="cn2"></div>
      <div class="scanline"></div>
    </div>
    <div class="scanstatus"><div class="spin"></div><div><div class="st">Recognizing notes…</div><div class="su">Audiveris OMR · page 1 of 1</div></div></div>
    <div class="scanstatus" style="margin-top:9px"><div style="color:#33d6c0;font-size:16px">✓</div><div><div class="st">32 measures · 408 notes found</div><div class="su">Tap any note to fix a misread before you play</div></div></div>
  </div>`, "lib", "Escanear y corregir",
    "Foto o PDF → OMR (Audiveris) en el backend → previsualización corregible. Cubre «cualquier partitura».");
}

function chordPhone() {
  return col(`<div class="scr">
    <div class="pnav"><span class="chev">‹</span><span class="pt serif">Prélude in C</span><span class="more">⋯</span></div>
    <div class="chips"><span class="chip">60 BPM</span><span class="chip">Both hands</span><span class="chip m2"><span class="pulse"></span>MOTOR 2</span></div>
    <canvas class="roll" id="chordRoll" width="536" height="440"></canvas>
    <div class="feedback">
      <div class="fb-note" id="m2engine" style="width:auto;padding:0 14px;font-size:13px;background:rgba(167,139,250,0.16);color:#a78bfa">poly · C E G</div>
      <div class="fb-meta"><div class="k">Basic Pitch · polyphonic</div><div class="bar"><i style="width:88%"></i></div></div>
    </div>
  </div>`, "prac", "Modo acordes · MOTOR 2",
    "Para acordes/dos manos entra MOTOR 2 (Basic Pitch, en el dispositivo). Transcribe polifonía que YIN no puede.");
}

writeFileSync(join(here, "iphone.html"), html);
console.log("wrote apps/mockup/iphone.html (" + (html.length / 1024).toFixed(1) + " KiB)");
