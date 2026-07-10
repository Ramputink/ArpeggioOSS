/**
 * Generate the iPhone design mockup (apps/mockup/iphone.html) — a self-contained,
 * interactive "boceto" of the Arpeggio piano-tutor iOS app. Inlines the real
 * right-hand melody of the OMR'd Minuet so the Practice screen animates genuine
 * musical content. Opens standalone in any browser (no server, no assets).
 *
 *   node apps/mockup/gen.mjs
 *
 * Reads the melody produced earlier from the parsed sample:
 *   scratchpad/melody.json  ->  [{ t: beat, d: beats, m: midi }, ...]
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
// The right-hand melody of the OMR'd Minuet, extracted once from the parsed
// sample and checked in here so the mockup regenerates without the OMR backend.
const MEL_PATH = process.env.MELODY_JSON || join(here, "melody.json");
const melody = readFileSync(MEL_PATH, "utf-8");

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Arpeggio — iPhone concept</title>
<style>
  /* ---- Page tokens (theme-aware backdrop; the phone app stays night-dark) --- */
  :root {
    --page-bg: #0a0c10;
    --page-bg2: #10141c;
    --page-fg: #e8ecf3;
    --page-muted: #7f8aa0;
    --page-line: #222a38;
    --amber: #f2b441;
    --teal: #33d6c0;
    --violet: #a78bfa;
  }
  @media (prefers-color-scheme: light) {
    :root {
      --page-bg: #eef1f6; --page-bg2: #e4e9f1; --page-fg: #1c2230;
      --page-muted: #5b6577; --page-line: #d3dae5;
    }
  }
  :root[data-theme="dark"] {
    --page-bg: #0a0c10; --page-bg2: #10141c; --page-fg: #e8ecf3;
    --page-muted: #7f8aa0; --page-line: #222a38;
  }
  :root[data-theme="light"] {
    --page-bg: #eef1f6; --page-bg2: #e4e9f1; --page-fg: #1c2230;
    --page-muted: #5b6577; --page-line: #d3dae5;
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
  /* Serif for musical titles — echoes classical score engraving. */
  .serif { font-family: "SF Pro Display", ui-serif, Georgia, "Times New Roman", serif; }

  .wrap { max-width: 1120px; margin: 0 auto; padding: 40px 20px 64px; }

  header.top { text-align: center; margin-bottom: 8px; }
  .brand { display: inline-flex; align-items: center; gap: 12px; }
  .glyph {
    width: 40px; height: 40px; border-radius: 11px; display: grid; place-items: center;
    background: linear-gradient(160deg, var(--amber), #d98a2b);
    color: #201400; font-size: 22px; box-shadow: 0 6px 20px rgba(242,180,65,0.28);
  }
  h1.name {
    font-size: 34px; margin: 0; letter-spacing: -0.02em; font-weight: 700;
  }
  .tagline { color: var(--page-muted); margin: 14px auto 4px; max-width: 44ch; text-wrap: balance; }
  .kicker {
    text-transform: uppercase; letter-spacing: 0.18em; font-size: 11px; font-weight: 700;
    color: var(--amber); margin-bottom: 18px;
  }

  .stage {
    display: flex; gap: 30px; justify-content: center; align-items: flex-start;
    flex-wrap: wrap; margin-top: 34px;
  }
  .col { display: flex; flex-direction: column; align-items: center; gap: 14px; width: 300px; }
  .caption { text-align: center; }
  .caption .t { font-weight: 650; font-size: 14px; }
  .caption .d { color: var(--page-muted); font-size: 12.5px; margin-top: 2px; text-wrap: balance; }

  /* ---- iPhone frame -------------------------------------------------------- */
  .phone {
    width: 300px; height: 620px; border-radius: 46px; position: relative;
    background: #05070b; padding: 11px;
    box-shadow: 0 0 0 2px #2b3342, 0 0 0 5px #0c1017, 0 34px 70px rgba(0,0,0,0.55);
  }
  .screen {
    position: relative; width: 100%; height: 100%; border-radius: 36px; overflow: hidden;
    background: #0b0e14; color: #eef2f8; display: flex; flex-direction: column;
    /* the app itself commits to a nocturnal theme */
  }
  .island {
    position: absolute; top: 9px; left: 50%; transform: translateX(-50%);
    width: 92px; height: 26px; background: #000; border-radius: 16px; z-index: 40;
  }
  .statusbar {
    height: 46px; flex: 0 0 auto; display: flex; align-items: center; justify-content: space-between;
    padding: 0 22px; font-size: 13px; font-weight: 600; color: #e9eef7;
  }
  .statusbar .dots { letter-spacing: 1px; }
  .body { flex: 1 1 auto; min-height: 0; position: relative; overflow: hidden; }
  .homebar {
    height: 22px; flex: 0 0 auto; display: grid; place-items: center;
  }
  .homebar i { width: 118px; height: 5px; border-radius: 3px; background: rgba(255,255,255,0.5); }

  /* Tab bar */
  .tabbar {
    height: 58px; flex: 0 0 auto; display: flex; border-top: 1px solid rgba(255,255,255,0.07);
    background: rgba(10,13,20,0.9); backdrop-filter: blur(8px);
  }
  .tab { flex: 1; display: flex; flex-direction: column; align-items: center; justify-content: center;
    gap: 3px; color: #67728a; font-size: 10px; font-weight: 600; }
  .tab .ic { font-size: 17px; line-height: 1; }
  .tab.on { color: var(--amber); }

  /* Screen scaffolding */
  .scr { position: absolute; inset: 0; padding: 4px 16px 6px; display: flex; flex-direction: column; }
  .scr h2.title { font-size: 25px; margin: 4px 0 12px; letter-spacing: -0.02em; }

  /* Library */
  .cont {
    border-radius: 20px; padding: 15px; position: relative; overflow: hidden;
    background: linear-gradient(150deg, rgba(242,180,65,0.16), rgba(51,214,192,0.10));
    border: 1px solid rgba(255,255,255,0.09);
  }
  .cont .lbl { text-transform: uppercase; letter-spacing: 0.14em; font-size: 10px; color: var(--amber); font-weight: 700; }
  .cont .pc { font-size: 19px; font-weight: 650; margin-top: 4px; }
  .cont .sub { color: #aab4c6; font-size: 12px; margin-top: 2px; }
  .ring { position: absolute; top: 14px; right: 14px; width: 46px; height: 46px; }
  .resume {
    margin-top: 13px; display: inline-flex; align-items: center; gap: 7px;
    background: var(--amber); color: #201400; border: 0; border-radius: 11px;
    padding: 9px 15px; font-weight: 700; font-size: 13px;
  }
  .list { margin-top: 14px; display: flex; flex-direction: column; gap: 9px; overflow: hidden; }
  .row {
    display: flex; align-items: center; gap: 12px; padding: 11px 12px; border-radius: 14px;
    background: rgba(255,255,255,0.035); border: 1px solid rgba(255,255,255,0.05);
  }
  .row .cover { width: 38px; height: 38px; border-radius: 10px; display: grid; place-items: center;
    font-size: 17px; flex: 0 0 auto; }
  .row .meta { flex: 1; min-width: 0; }
  .row .pn { font-size: 14px; font-weight: 600; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .row .cn { font-size: 11.5px; color: #7b8598; }
  .row .pct { font-variant-numeric: tabular-nums; font-size: 12px; color: #aab4c6; font-weight: 650; }
  .dots3 { display: inline-flex; gap: 3px; vertical-align: middle; margin-left: 6px; }
  .dots3 b { width: 5px; height: 5px; border-radius: 50%; background: rgba(255,255,255,0.18); }
  .dots3 b.on { background: var(--teal); }
  .import {
    margin-top: 12px; display: flex; align-items: center; justify-content: center; gap: 8px;
    border: 1.4px dashed rgba(255,255,255,0.18); border-radius: 14px; padding: 12px;
    color: #aab4c6; font-size: 13px; font-weight: 600;
  }

  /* Practice */
  .pnav { display: flex; align-items: center; gap: 10px; padding: 2px 0 8px; }
  .pnav .chev { font-size: 18px; color: var(--amber); }
  .pnav .pt { font-weight: 650; font-size: 16px; letter-spacing: -0.01em; }
  .pnav .more { margin-left: auto; color: #67728a; font-size: 18px; }
  .chips { display: flex; gap: 7px; margin-bottom: 8px; flex-wrap: wrap; }
  .chip {
    font-size: 11px; font-weight: 600; padding: 5px 10px; border-radius: 999px;
    background: rgba(255,255,255,0.06); color: #c3ccdb; border: 1px solid rgba(255,255,255,0.06);
  }
  .chip.mic { color: var(--teal); border-color: rgba(51,214,192,0.35); }
  .chip.mic .pulse { display: inline-block; width: 7px; height: 7px; border-radius: 50%; background: var(--teal); margin-right: 5px; vertical-align: 0; animation: pulse 1.4s infinite; }
  @keyframes pulse { 0%,100% { opacity: 1; box-shadow: 0 0 0 0 rgba(51,214,192,0.5);} 50% { opacity: .5; box-shadow: 0 0 0 6px rgba(51,214,192,0);} }
  canvas.roll { width: 100%; border-radius: 14px; display: block; background: #070a0f; border: 1px solid rgba(255,255,255,0.06); }
  .feedback { display: flex; align-items: center; gap: 10px; margin-top: 10px; }
  .fb-note {
    width: 52px; height: 52px; border-radius: 14px; display: grid; place-items: center;
    font-weight: 750; font-size: 19px; background: rgba(51,214,192,0.16); color: var(--teal);
    font-variant-numeric: tabular-nums;
  }
  .fb-meta { flex: 1; }
  .fb-meta .k { font-size: 11px; color: #7b8598; text-transform: uppercase; letter-spacing: .08em; }
  .bar { height: 8px; border-radius: 5px; background: rgba(255,255,255,0.08); overflow: hidden; margin-top: 6px; }
  .bar > i { display: block; height: 100%; background: linear-gradient(90deg, var(--teal), var(--amber)); }
  .acc { font-size: 22px; font-weight: 750; font-variant-numeric: tabular-nums; }

  /* Progress */
  .statgrid { display: grid; grid-template-columns: 1.3fr 1fr; gap: 10px; }
  .stat { border-radius: 16px; padding: 13px 14px; background: rgba(255,255,255,0.04); border: 1px solid rgba(255,255,255,0.06); }
  .stat .k { font-size: 11px; color: #7b8598; text-transform: uppercase; letter-spacing: .08em; }
  .stat .big { font-size: 30px; font-weight: 780; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; }
  .stat .big small { font-size: 15px; color: #7b8598; font-weight: 600; }
  .heat { display: flex; align-items: flex-end; gap: 3px; height: 60px; margin-top: 6px; }
  .heat b { flex: 1; border-radius: 3px 3px 1px 1px; background: rgba(51,214,192,0.5); }
  .section-h { font-size: 12px; color: #7b8598; text-transform: uppercase; letter-spacing: .1em; margin: 14px 0 8px; font-weight: 700; }
  .focus { display: flex; flex-direction: column; gap: 8px; }
  .frow { display: flex; align-items: center; gap: 10px; background: rgba(255,255,255,0.035); border: 1px solid rgba(255,255,255,0.05); border-radius: 12px; padding: 10px 12px; }
  .frow .m { width: 30px; height: 30px; border-radius: 8px; display: grid; place-items: center; font-weight: 750; font-size: 13px; background: rgba(242,180,65,0.18); color: var(--amber); font-variant-numeric: tabular-nums; }
  .frow .why { font-size: 12.5px; color: #c3ccdb; }
  .week { display: flex; align-items: flex-end; gap: 6px; height: 46px; margin-top: 6px; }
  .week b { flex: 1; background: linear-gradient(180deg, var(--amber), rgba(242,180,65,0.25)); border-radius: 3px; }

  footer.note { text-align: center; color: var(--page-muted); font-size: 12.5px; margin-top: 40px; }
  footer.note code { background: rgba(127,138,160,0.16); padding: 1px 6px; border-radius: 5px; }
  .legend { display: inline-flex; gap: 16px; margin-top: 10px; flex-wrap: wrap; justify-content: center; }
  .legend span { color: var(--page-muted); font-size: 12px; }
  .legend i { display: inline-block; width: 10px; height: 10px; border-radius: 3px; vertical-align: -1px; margin-right: 5px; }

  @media (max-width: 720px) { .stage { gap: 44px; } }
</style>
</head>
<body>
<div class="wrap">
  <header class="top">
    <div class="brand">
      <div class="glyph">♪</div>
      <h1 class="name">Arpeggio</h1>
    </div>
    <p class="tagline">A piano tutor that <b>listens through the microphone</b>. Import any
      score, then play — it follows you note by note and shows what to work on.</p>
    <div class="kicker">iPhone concept · design sketch</div>
  </header>

  <div class="stage">
    <!-- ============ 1 · LIBRARY ============ -->
    <div class="col">
      <div class="phone"><div class="screen">
        <div class="island"></div>
        <div class="statusbar"><span>9:41</span><span class="dots">● ▾ ▮</span></div>
        <div class="body"><div class="scr">
          <h2 class="title">Library</h2>
          <div class="cont">
            <svg class="ring" viewBox="0 0 46 46"><circle cx="23" cy="23" r="19" fill="none" stroke="rgba(255,255,255,0.15)" stroke-width="5"/><circle cx="23" cy="23" r="19" fill="none" stroke="#f2b441" stroke-width="5" stroke-linecap="round" stroke-dasharray="119" stroke-dashoffset="45" transform="rotate(-90 23 23)"/></svg>
            <div class="lbl">Continue</div>
            <div class="pc serif">Menuet in G</div>
            <div class="sub">Right hand · 72 BPM · 62% mastered</div>
            <button class="resume">▶ Resume</button>
          </div>
          <div class="list">
            <div class="row"><div class="cover" style="background:rgba(167,139,250,0.18);color:#a78bfa">◵</div><div class="meta"><div class="pn serif">Gymnopédie No.1</div><div class="cn">Satie <span class="dots3"><b class="on"></b><b></b><b></b></span></div></div><div class="pct">28%</div></div>
            <div class="row"><div class="cover" style="background:rgba(51,214,192,0.16);color:#33d6c0">♬</div><div class="meta"><div class="pn serif">Prélude in C</div><div class="cn">Bach · BWV 846 <span class="dots3"><b class="on"></b><b class="on"></b><b></b></span></div></div><div class="pct">—</div></div>
            <div class="row"><div class="cover" style="background:rgba(242,180,65,0.18);color:#f2b441">☾</div><div class="meta"><div class="pn serif">Clair de lune</div><div class="cn">Debussy <span class="dots3"><b class="on"></b><b class="on"></b><b class="on"></b></span></div></div><div class="pct">locked</div></div>
          </div>
          <div class="import">＋ &nbsp;Import a score &nbsp;·&nbsp; 📷 photo / PDF</div>
        </div></div>
        <div class="tabbar">
          <div class="tab on"><span class="ic">▤</span>Library</div>
          <div class="tab"><span class="ic">◉</span>Practice</div>
          <div class="tab"><span class="ic">▨</span>Progress</div>
        </div>
        <div class="homebar"><i></i></div>
      </div></div>
      <div class="caption"><div class="t">Biblioteca</div><div class="d">Tus piezas, con progreso real. Importa una nueva por foto/PDF → OMR.</div></div>
    </div>

    <!-- ============ 2 · PRACTICE (live) ============ -->
    <div class="col">
      <div class="phone"><div class="screen">
        <div class="island"></div>
        <div class="statusbar"><span>9:41</span><span class="dots">● ▾ ▮</span></div>
        <div class="body"><div class="scr">
          <div class="pnav"><span class="chev">‹</span><span class="pt serif">Menuet in G</span><span class="more">⋯</span></div>
          <div class="chips">
            <span class="chip">72 BPM</span>
            <span class="chip">Right hand</span>
            <span class="chip mic"><span class="pulse"></span>Listening</span>
          </div>
          <canvas class="roll" id="roll" width="536" height="620"></canvas>
          <div class="feedback">
            <div class="fb-note" id="fbNote">D5</div>
            <div class="fb-meta">
              <div class="k">Accuracy · this take</div>
              <div class="bar"><i id="accBar" style="width:96%"></i></div>
            </div>
            <div class="acc" id="accNum">96%</div>
          </div>
        </div></div>
        <div class="tabbar">
          <div class="tab"><span class="ic">▤</span>Library</div>
          <div class="tab on"><span class="ic">◉</span>Practice</div>
          <div class="tab"><span class="ic">▨</span>Progress</div>
        </div>
        <div class="homebar"><i></i></div>
      </div></div>
      <div class="caption"><div class="t">Práctica (en vivo)</div><div class="d">Las notas caen a tempo; tocas y el cursor te sigue. Verde = acierto. Melodía real del Minueto OMR'd.</div></div>
    </div>

    <!-- ============ 3 · PROGRESS ============ -->
    <div class="col">
      <div class="phone"><div class="screen">
        <div class="island"></div>
        <div class="statusbar"><span>9:41</span><span class="dots">● ▾ ▮</span></div>
        <div class="body"><div class="scr">
          <h2 class="title">This week</h2>
          <div class="statgrid">
            <div class="stat"><div class="k">Best accuracy</div><div class="big">94<small>%</small></div></div>
            <div class="stat"><div class="k">Streak</div><div class="big">5<small> days</small></div></div>
          </div>
          <div class="stat" style="margin-top:10px">
            <div class="k">Accuracy by measure</div>
            <div class="heat" id="heat"></div>
          </div>
          <div class="section-h">Focus next</div>
          <div class="focus">
            <div class="frow"><div class="m">8</div><div class="why">Rushed — over the bar length. Loop at 60 BPM.</div></div>
            <div class="frow"><div class="m">19</div><div class="why">Left-hand leap missed 4×.</div></div>
            <div class="frow"><div class="m">27</div><div class="why">Dotted rhythm uneven.</div></div>
          </div>
          <div class="section-h">Practice minutes</div>
          <div class="week" id="week"></div>
        </div></div>
        <div class="tabbar">
          <div class="tab"><span class="ic">▤</span>Library</div>
          <div class="tab"><span class="ic">◉</span>Practice</div>
          <div class="tab on"><span class="ic">▨</span>Progress</div>
        </div>
        <div class="homebar"><i></i></div>
      </div></div>
      <div class="caption"><div class="t">Progreso</div><div class="d">Precisión por compás (mapa de calor), qué repasar y por qué, y minutos de práctica. Alimenta la repetición espaciada.</div></div>
    </div>
  </div>

  <footer class="note">
    Interactive concept sketch — the Practice screen animates the real right-hand line of the
    OMR'd <b>Menuet BWV Anh. 114</b>. Built on the working stack: <code>musicxml-parser</code> →
    <code>practice-engine</code> (YIN + follow-you + feedback). A native build wraps the same core
    with <code>AVAudioEngine</code> capture and a Core ML MOTOR 2.
    <div class="legend">
      <span><i style="background:#f2b441"></i>Current note</span>
      <span><i style="background:#33d6c0"></i>Hit / right hand</span>
      <span><i style="background:#a78bfa"></i>Left hand</span>
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

  // --- Progress screen static charts ---------------------------------------
  const heat = document.getElementById("heat");
  const heatVals = [0.98,0.95,0.99,0.92,0.9,0.97,0.88,0.62,0.94,0.99,0.96,0.9,0.85,0.98,0.93,0.97,
                    0.9,0.88,0.7,0.72,0.95,0.99,0.94,0.9,0.86,0.98,0.74,0.96,0.99,0.93,0.9,0.97];
  if (heat) heatVals.forEach((v) => {
    const b = document.createElement("b");
    b.style.height = (18 + v * 42) + "px";
    const bad = v < 0.8;
    b.style.background = bad ? "linear-gradient(180deg,#f2b441,rgba(242,180,65,.3))"
                            : "linear-gradient(180deg,#33d6c0,rgba(51,214,192,.28))";
    heat.appendChild(b);
  });
  const week = document.getElementById("week");
  if (week) [12,20,0,35,18,26,22].forEach((v) => {
    const b = document.createElement("b"); b.style.height = (6 + v) + "px"; week.appendChild(b);
  });

  // --- Practice screen: falling-notes animation ----------------------------
  const canvas = document.getElementById("roll");
  if (!canvas) return;
  const ctx = canvas.getContext("2d");
  const dpr = Math.min(3, window.devicePixelRatio || 1);
  const CW = canvas.width, CH = canvas.height;         // internal px (already retina-ish)
  canvas.width = CW * dpr; canvas.height = CH * dpr; ctx.scale(dpr, dpr);
  canvas.style.height = (CH / (536 / 268)) + "px";     // keep the CSS aspect tidy

  // Keyboard range and geometry (C4..C6).
  const LO = 60, HI = 84;
  const KEYB_H = 62, HIT_Y = CH - KEYB_H, TOP_Y = 8;
  const isWhite = (m) => [0,2,4,5,7,9,11].includes(((m % 12) + 12) % 12);
  const whites = []; for (let m = LO; m <= HI; m++) if (isWhite(m)) whites.push(m);
  const whiteW = CW / whites.length;
  const xCenter = {};
  whites.forEach((m, i) => (xCenter[m] = (i + 0.5) * whiteW));
  for (let m = LO; m <= HI; m++) if (!isWhite(m)) xCenter[m] = ((xCenter[m-1] ?? 0) + (xCenter[m+1] ?? CW)) / 2;

  const LOOK = 7;                     // beats visible above the hit line
  const pxPerBeat = (HIT_Y - TOP_Y) / LOOK;
  const BPM = 72;
  const totalBeats = MEL.reduce((mx, n) => Math.max(mx, n.t + n.d), 0);

  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const lit = {};                     // midi -> ms until which the key glows
  let hits = 0, correct = 0, lastActive = -1, playhead = 0, prev = null;

  const fbNote = document.getElementById("fbNote");
  const accNum = document.getElementById("accNum");
  const accBar = document.getElementById("accBar");

  function draw(now) {
    ctx.clearRect(0, 0, CW, CH);

    // Falling notes
    for (let i = 0; i < MEL.length; i++) {
      const n = MEL[i];
      const yBottom = HIT_Y - (n.t - playhead) * pxPerBeat;
      const h = Math.max(6, n.d * pxPerBeat - 2);
      const yTop = yBottom - h;
      if (yBottom < TOP_Y || yTop > HIT_Y) continue;
      const x = xCenter[n.m] ?? CW / 2;
      const w = Math.max(10, whiteW * 0.82);
      const active = n.t <= playhead && playhead < n.t + n.d;
      ctx.fillStyle = active ? "#f2b441" : "rgba(51,214,192,0.85)";
      ctx.shadowColor = active ? "rgba(242,180,65,0.6)" : "transparent";
      ctx.shadowBlur = active ? 16 : 0;
      roundRect(x - w / 2, yTop, w, h, 4); ctx.fill();
      ctx.shadowBlur = 0;
    }

    // Hit line
    ctx.strokeStyle = "rgba(242,180,65,0.55)"; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, HIT_Y); ctx.lineTo(CW, HIT_Y); ctx.stroke();

    // Keyboard
    for (const m of whites) {
      const x = xCenter[m] - whiteW / 2;
      const glow = lit[m] && lit[m] > now;
      ctx.fillStyle = glow ? "rgba(51,214,192,0.9)" : "#e9edf4";
      roundRect(x + 1, HIT_Y + 2, whiteW - 2, KEYB_H - 4, 4); ctx.fill();
    }
    const blackW = whiteW * 0.62;
    for (let m = LO; m <= HI; m++) if (!isWhite(m)) {
      const x = xCenter[m] - blackW / 2;
      const glow = lit[m] && lit[m] > now;
      ctx.fillStyle = glow ? "rgba(242,180,65,0.95)" : "#10151d";
      roundRect(x, HIT_Y + 2, blackW, (KEYB_H - 4) * 0.62, 3); ctx.fill();
    }
  }

  function step(now) {
    if (prev == null) prev = now;
    const dt = Math.min(0.05, (now - prev) / 1000); prev = now;
    playhead += dt * (BPM / 60);

    // Note that just became active -> "played": light its key + score it.
    let act = -1;
    for (let i = 0; i < MEL.length; i++) {
      const n = MEL[i];
      if (n.t <= playhead && playhead < n.t + n.d) { act = i; break; }
    }
    if (act !== -1 && act !== lastActive) {
      lastActive = act;
      const n = MEL[act];
      lit[n.m] = now + 220;
      hits++;
      const ok = (act % 17) !== 5;               // ~94% correct, deterministic
      if (ok) correct++;
      if (fbNote) {
        fbNote.textContent = nameOf(n.m);
        fbNote.style.background = ok ? "rgba(51,214,192,0.16)" : "rgba(255,107,107,0.16)";
        fbNote.style.color = ok ? "#33d6c0" : "#ff6b6b";
      }
      const pct = Math.round((correct / hits) * 100);
      if (accNum) accNum.textContent = pct + "%";
      if (accBar) accBar.style.width = pct + "%";
    }

    if (playhead > totalBeats + LOOK) { playhead = 0; lastActive = -1; hits = 0; correct = 0; }
    draw(now);
    if (!reduce) requestAnimationFrame(step);
  }

  function roundRect(x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
  }

  if (reduce) { playhead = 2; draw(performance.now()); }
  else requestAnimationFrame(step);
})();
</script>
</body>
</html>`;

writeFileSync(join(here, "iphone.html"), html);
console.log("wrote apps/mockup/iphone.html (" + (html.length / 1024).toFixed(1) + " KiB)");
