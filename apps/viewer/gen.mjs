/**
 * Generate a self-contained piano-roll viewer (apps/viewer/index.html) from a
 * parsed score's events JSON. Inlines the data so the HTML opens standalone in
 * any browser (no server, no external assets) — a Phase-2 "render the canonical
 * model + moving cursor + synthesized playback" demo.
 *
 *   node apps/viewer/gen.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const data = readFileSync(join(here, "minueto.events.json"), "utf-8");

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Arpeggio — Piano Roll Viewer</title>
<style>
  :root {
    --bg: #0e1116; --panel: #161b22; --fg: #e6edf3; --muted: #8b949e;
    --grid: #21262d; --rh: #2dd4bf; --lh: #a78bfa; --accent: #f0b429; --border: #30363d;
  }
  @media (prefers-color-scheme: light) {
    :root { --bg:#f6f8fa; --panel:#fff; --fg:#1f2328; --muted:#57606a;
            --grid:#e7ebef; --rh:#0d9488; --lh:#7c3aed; --accent:#bf8700; --border:#d0d7de; }
  }
  * { box-sizing: border-box; }
  body { margin:0; font:14px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
         background:var(--bg); color:var(--fg); }
  header { padding:14px 18px; border-bottom:1px solid var(--border); display:flex;
           align-items:baseline; gap:14px; flex-wrap:wrap; }
  header h1 { font-size:16px; margin:0; font-weight:650; }
  header .meta { color:var(--muted); font-size:12.5px; }
  .controls { display:flex; gap:10px; align-items:center; padding:10px 18px; flex-wrap:wrap;
              border-bottom:1px solid var(--border); background:var(--panel); }
  button { background:var(--panel); color:var(--fg); border:1px solid var(--border);
           border-radius:7px; padding:6px 12px; cursor:pointer; font-size:13px; }
  button:hover { border-color:var(--muted); }
  button.primary { background:var(--rh); color:#03201c; border-color:transparent; font-weight:600; }
  .seg { display:inline-flex; border:1px solid var(--border); border-radius:7px; overflow:hidden; }
  .seg button { border:0; border-radius:0; border-right:1px solid var(--border); }
  .seg button:last-child { border-right:0; }
  .seg button.on { background:var(--accent); color:#231a00; font-weight:600; }
  label.rng { display:flex; align-items:center; gap:8px; color:var(--muted); font-size:12.5px; }
  input[type=range] { accent-color:var(--rh); }
  .legend { margin-left:auto; display:flex; gap:14px; color:var(--muted); font-size:12px; align-items:center; }
  .dot { display:inline-block; width:10px; height:10px; border-radius:3px; margin-right:5px; vertical-align:-1px; }
  .wrap { padding:14px 18px; }
  canvas { width:100%; height:auto; display:block; border:1px solid var(--border);
           border-radius:10px; background:var(--panel); }
  footer { color:var(--muted); font-size:12px; padding:6px 18px 18px; }
  code { background:var(--grid); padding:1px 5px; border-radius:4px; }
</style>
</head>
<body>
<header>
  <h1>🎹 Arpeggio — Piano Roll</h1>
  <span class="meta" id="meta"></span>
</header>
<div class="controls">
  <button class="primary" id="play">▶ Play</button>
  <button id="restart">⭮ Restart</button>
  <div class="seg" id="hands">
    <button data-h="both" class="on">Both</button>
    <button data-h="right">Right</button>
    <button data-h="left">Left</button>
  </div>
  <label class="rng">Tempo <input type="range" id="tempo" min="30" max="180" value="100" />
    <span id="bpm">100</span> BPM</label>
  <label class="rng"><input type="checkbox" id="sound" checked /> Sound</label>
  <div class="legend">
    <span><span class="dot" style="background:var(--rh)"></span>Right hand</span>
    <span><span class="dot" style="background:var(--lh)"></span>Left hand</span>
  </div>
</div>
<div class="wrap"><canvas id="roll"></canvas></div>
<footer>
  Rendered from Arpeggio's canonical model (<code>@arpeggio/musicxml-parser</code>),
  OMR'd by the backend from the Mutopia engraving of Minuet BWV Anh. 114.
  Timing in quarter-note beats; playback is a self-contained WebAudio synth.
</footer>

<script>
const DATA = ${data};
</script>
<script>
(() => {
  const events = DATA.events;
  const beats = DATA.meta.durationQuarters;
  const minMidi = Math.min(...events.map(e => e.midi)) - 2;
  const maxMidi = Math.max(...events.map(e => e.midi)) + 2;
  const rows = maxMidi - minMidi + 1;
  const css = getComputedStyle(document.documentElement);
  const col = n => css.getPropertyValue(n).trim();

  document.getElementById("meta").textContent =
    DATA.meta.notes + " notes · " + DATA.meta.measures + " measures · " +
    beats + " beats · MIDI " + (minMidi+2) + "–" + (maxMidi-2);

  const canvas = document.getElementById("roll");
  const ctx = canvas.getContext("2d");
  const PADL = 34;              // left gutter for pitch labels
  let W = 0, H = 0, pxPerBeat = 0, rowH = 0, dpr = 1;

  function layout() {
    dpr = window.devicePixelRatio || 1;
    const cssW = canvas.parentElement.clientWidth - 0;
    pxPerBeat = Math.max(10, (cssW - PADL) / beats);
    rowH = 9;
    const cssH = rows * rowH + 16;
    W = cssW; H = cssH;
    canvas.style.height = cssH + "px";
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  const yOf = midi => 8 + (maxMidi - midi) * rowH;
  const xOf = beat => PADL + beat * pxPerBeat;

  // ---- transport ----------------------------------------------------------
  let playing = false, posBeat = 0, lastT = 0, bpm = 100, handFilter = "both", sound = true;
  const visible = e => handFilter === "both" || e.hand === handFilter;

  function draw() {
    ctx.clearRect(0, 0, W, H);
    // pitch grid: highlight C rows
    for (let m = minMidi; m <= maxMidi; m++) {
      const y = yOf(m);
      const isC = m % 12 === 0;
      ctx.fillStyle = isC ? col("--grid") : "transparent";
      if (isC) ctx.fillRect(PADL, y - rowH + 2, W - PADL, rowH);
      if (isC) { ctx.fillStyle = col("--muted"); ctx.font = "9px sans-serif";
                 ctx.fillText("C" + (m/12 - 1), 4, y); }
    }
    // bar lines (every ~3 beats for 3/4; derive from time sigs if present)
    const beatsPerBar = (DATA.meta.timeSignatures[0]?.beats ?? 4) *
                        4 / (DATA.meta.timeSignatures[0]?.beatType ?? 4);
    ctx.strokeStyle = col("--grid"); ctx.lineWidth = 1;
    for (let b = 0; b <= beats + 0.001; b += beatsPerBar) {
      ctx.beginPath(); ctx.moveTo(xOf(b), 4); ctx.lineTo(xOf(b), H - 4); ctx.stroke();
    }
    // notes
    for (const e of events) {
      if (!visible(e)) continue;
      const x = xOf(e.on), w = Math.max(2, (e.off - e.on) * pxPerBeat - 1), y = yOf(e.midi);
      const sounding = e.on <= posBeat && posBeat < e.off;
      ctx.fillStyle = e.hand === "left" ? col("--lh") : col("--rh");
      ctx.globalAlpha = sounding ? 1 : 0.72;
      roundRect(x, y - rowH + 2.5, w, rowH - 2, 2.5); ctx.fill();
      if (sounding) { ctx.globalAlpha = 1; ctx.strokeStyle = col("--accent");
                      ctx.lineWidth = 1.5; roundRect(x, y-rowH+2.5, w, rowH-2, 2.5); ctx.stroke(); }
    }
    ctx.globalAlpha = 1;
    // playhead
    const px = xOf(posBeat);
    ctx.strokeStyle = col("--accent"); ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(px, 2); ctx.lineTo(px, H - 2); ctx.stroke();
  }
  function roundRect(x, y, w, h, r) {
    r = Math.min(r, w/2, h/2);
    ctx.beginPath();
    ctx.moveTo(x+r,y); ctx.arcTo(x+w,y,x+w,y+h,r); ctx.arcTo(x+w,y+h,x,y+h,r);
    ctx.arcTo(x,y+h,x,y,r); ctx.arcTo(x,y,x+w,y,r); ctx.closePath();
  }

  // ---- WebAudio synth -----------------------------------------------------
  let ac = null;
  const scheduled = new Set();
  function noteFreq(m) { return 440 * Math.pow(2, (m - 69) / 12); }
  function ping(midi, durSec) {
    if (!ac) return;
    const t = ac.currentTime, f = noteFreq(midi);
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = "triangle"; o.frequency.value = f;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.16, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + Math.max(0.12, durSec));
    o.connect(g).connect(ac.destination); o.start(t); o.stop(t + Math.max(0.13, durSec) + 0.02);
  }

  function tick(now) {
    if (!playing) return;
    const dt = (now - lastT) / 1000; lastT = now;
    const prev = posBeat;
    posBeat += dt * (bpm / 60);            // beats advanced (1 beat = 1 quarter)
    // trigger notes crossed this step
    if (sound && ac) {
      for (const e of events) {
        if (!visible(e)) continue;
        if (e.on >= prev && e.on < posBeat && !scheduled.has(e)) {
          ping(e.midi, (e.off - e.on) * 60 / bpm); scheduled.add(e);
        }
      }
    }
    if (posBeat >= beats) { posBeat = beats; playing = false; setPlayLabel(); }
    draw();
    if (playing) requestAnimationFrame(tick);
  }

  function setPlayLabel() { document.getElementById("play").textContent = playing ? "⏸ Pause" : "▶ Play"; }
  function play() {
    if (posBeat >= beats) posBeat = 0;
    playing = !playing; setPlayLabel();
    if (playing) {
      if (sound && !ac) ac = new (window.AudioContext || window.webkitAudioContext)();
      if (ac && ac.state === "suspended") ac.resume();
      scheduled.clear(); lastT = performance.now(); requestAnimationFrame(tick);
    }
  }

  // ---- controls -----------------------------------------------------------
  document.getElementById("play").onclick = play;
  document.getElementById("restart").onclick = () => { posBeat = 0; scheduled.clear(); draw(); };
  document.getElementById("tempo").oninput = e => { bpm = +e.target.value;
    document.getElementById("bpm").textContent = bpm; };
  document.getElementById("sound").onchange = e => { sound = e.target.checked; };
  document.querySelectorAll("#hands button").forEach(b => b.onclick = () => {
    document.querySelectorAll("#hands button").forEach(x => x.classList.remove("on"));
    b.classList.add("on"); handFilter = b.dataset.h; draw();
  });
  window.addEventListener("resize", () => { layout(); draw(); });

  layout(); draw();
})();
</script>
</body>
</html>`;

writeFileSync(join(here, "index.html"), html);
console.log("wrote apps/viewer/index.html (" + (html.length / 1024).toFixed(1) + " KiB)");
