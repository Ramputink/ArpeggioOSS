/**
 * App shell: wires import (OMR/MusicXML) -> render -> live practice.
 *
 * Flow:
 *   load a score  -> parseMusicXML -> Score
 *   render it     -> PianoRoll
 *   practice      -> MicSource | SimSource --frames--> LivePractice(PracticeSession)
 *                    -> cursor + HUD update from follower/feedback state
 */
import { parseMusicXML, qualityReport, type Score, type NoteEvent } from "@arpeggio/musicxml-parser";

import { backendBase, health, needsOmr, omrToMusicXML } from "./api.js";
import { PianoRoll } from "./render.js";
import { MicSource, SimSource } from "./audio.js";
import { LivePractice } from "./practice.js";
import type { FrameSource, PlayerEvent } from "./contracts.js";

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el as T;
};

// ---- elements --------------------------------------------------------------
const importPanel = $("import");
const stage = $("stage");
const statusEl = $("importStatus");
const fileInput = $<HTMLInputElement>("file");
const drop = $("drop");
const roll = $<HTMLCanvasElement>("roll");

const renderer = new PianoRoll(roll);
let score: Score | null = null;
let practice: LivePractice | null = null;
let source: FrameSource | null = null;
let raf = 0;

// ---- backend badge ---------------------------------------------------------
(async () => {
  const badge = $("backend");
  const h = await health();
  const base = backendBase() || location.origin;
  badge.textContent = h.ok ? `backend: OK (${h.version ?? "?"})` : "backend: offline";
  badge.classList.toggle("ok", h.ok);
  badge.classList.toggle("bad", !h.ok);
  badge.title = base;
})();

// ---- import ----------------------------------------------------------------
function setStatus(msg: string, kind: "" | "ok" | "err" = ""): void {
  statusEl.textContent = msg;
  statusEl.className = "status" + (kind ? " " + kind : "");
}

async function loadFromText(xml: string, title: string): Promise<void> {
  score = parseMusicXML(xml);
  const rep = qualityReport(score);
  $("pieceTitle").textContent = title;
  $("pieceMeta").textContent =
    `${rep.parts} part · ${rep.staves} staves · ${rep.measures} measures · ${rep.notes} notes` +
    (rep.warnings.length ? ` · ${rep.warnings.length} warning(s)` : "");
  renderer.setScore(score);
  renderer.draw();
  importPanel.classList.add("hidden");
  stage.classList.remove("hidden");
  renderer.setScore(score); // re-layout now that the canvas is visible
  renderer.draw();
}

async function handleFile(file: File): Promise<void> {
  try {
    if (needsOmr(file.name)) {
      setStatus(`OMR: recognizing “${file.name}” on the backend… (this can take ~20 s)`);
      const xml = await omrToMusicXML(file);
      await loadFromText(xml, file.name.replace(/\.[^.]+$/, ""));
    } else {
      setStatus(`Parsing “${file.name}”…`);
      const xml = await file.text();
      await loadFromText(xml, file.name.replace(/\.[^.]+$/, ""));
    }
    setStatus("");
  } catch (e) {
    setStatus((e as Error).message, "err");
  }
}

fileInput.addEventListener("change", () => {
  const f = fileInput.files?.[0];
  if (f) void handleFile(f);
});
["dragover", "dragenter"].forEach((ev) =>
  drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("hot"); }));
["dragleave", "drop"].forEach((ev) =>
  drop.addEventListener(ev, () => drop.classList.remove("hot")));
drop.addEventListener("drop", (e) => {
  e.preventDefault();
  const f = (e as DragEvent).dataTransfer?.files?.[0];
  if (f) void handleFile(f);
});

$("sample").addEventListener("click", async () => {
  try {
    setStatus("Loading sample…");
    const res = await fetch("./sample.musicxml");
    if (!res.ok) throw new Error("sample not found");
    await loadFromText(await res.text(), "Minuet in G — BWV Anh. 114");
    setStatus("");
  } catch (e) {
    setStatus((e as Error).message, "err");
  }
});

$("back").addEventListener("click", () => {
  stopPractice();
  stage.classList.add("hidden");
  importPanel.classList.remove("hidden");
});

// ---- practice --------------------------------------------------------------
let bpm = 90;
let selectedHand: "both" | "right" | "left" = "both";

/**
 * Build a monophonic practice line for one hand: keep only that hand's notes and,
 * where several sound at once, the top one. Detection here is monophonic (YIN),
 * so practice targets a single melodic line — the roadmap's minimal mic path.
 */
function monoHand(src: Score, hand: "right" | "left"): Score {
  const byOnset = new Map<number, NoteEvent>();
  for (const e of src.events) {
    if (e.hand !== hand) continue;
    const cur = byOnset.get(e.onset);
    if (!cur || e.pitchMidi > cur.pitchMidi) byOnset.set(e.onset, e);
  }
  const events = [...byOnset.values()].sort((a, b) => a.onset - b.onset);
  return { ...src, events };
}

const callbacks = {
  onEvents(events: PlayerEvent[]): void {
    const last = events[events.length - 1];
    if (!last) return;
    const el = $("hudLast");
    el.textContent = last.kind + (last.playedMidi ? ` (${last.playedMidi})` : "");
    el.className = "v " + (last.kind === "correct" ? "ok" : last.kind === "wrong" ? "bad" : "");
  },
  onProgress(p: { index: number; total: number; measure: number; done: boolean; positionBeats: number }): void {
    // Drive the cursor by beat position; the renderer highlights whatever notes
    // are sounding there (the follower's index is into the filtered mono line,
    // not the full rendered score, so we don't map it to a rendered note).
    renderer.setCursorBeat(p.positionBeats);
    renderer.draw();
    $("hudProgress").textContent = `${p.index} / ${p.total}`;
    $("hudMeasure").textContent = String(p.measure);
    if (practice) {
      const acc = practice.accuracy;
      $("hudAcc").textContent = Number.isFinite(acc) ? `${Math.round(acc * 100)}%` : "—";
      const rec = practice.recommend;
      $("hudNext").textContent = rec.length ? "measures " + rec.join(", ") : "—";
    }
    if (p.done) {
      setMic("done 🎉");
      transportButtons(false);
    }
  },
};

function transportButtons(running: boolean): void {
  $<HTMLButtonElement>("listen").disabled = running;
  $<HTMLButtonElement>("simulate").disabled = running;
  $<HTMLButtonElement>("stop").disabled = !running;
}
function setMic(msg: string): void { $("micState").textContent = msg; }

async function startPractice(useMic: boolean): Promise<void> {
  if (!score) return;
  stopPractice();
  // Practice one hand (monophonic). "Both" defaults to the right-hand melody.
  let hand: "right" | "left" = selectedHand === "left" ? "left" : "right";
  let practiceScore = monoHand(score, hand);
  if (practiceScore.events.length === 0) {
    hand = hand === "right" ? "left" : "right";
    practiceScore = monoHand(score, hand);
  }
  practice = new LivePractice(practiceScore, callbacks);
  source = useMic ? new MicSource() : new SimSource(practiceScore, { bpm });
  try {
    setMic((useMic ? "requesting microphone… " : "simulating… ") + `(${hand} hand)`);
    await practice.start(source);
    setMic(`${source.label} · ${hand} hand`);
    transportButtons(true);
  } catch (e) {
    setMic((e as Error).message);
    transportButtons(false);
  }
}

function stopPractice(): void {
  if (raf) cancelAnimationFrame(raf);
  practice?.stop();
  source?.stop();
  practice = null;
  source = null;
  transportButtons(false);
}

$("listen").addEventListener("click", () => void startPractice(true));
$("simulate").addEventListener("click", () => void startPractice(false));
$("stop").addEventListener("click", () => { stopPractice(); setMic("stopped"); });

document.querySelectorAll<HTMLButtonElement>("#hands button").forEach((b) =>
  b.addEventListener("click", () => {
    document.querySelectorAll("#hands button").forEach((x) => x.classList.remove("on"));
    b.classList.add("on");
    selectedHand = b.dataset.h as "both" | "right" | "left";
    renderer.setHands(selectedHand);
  }));

const tempoInput = $<HTMLInputElement>("tempo");
tempoInput.addEventListener("input", () => { bpm = +tempoInput.value; $("bpm").textContent = String(bpm); });
