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

import { BasicPitchDetector } from "@arpeggio/motor2-basicpitch";
import type { DetectedNote } from "@arpeggio/practice-engine";

import { backendBase, health, needsOmr, omrToMusicXML } from "./api.js";
import { PianoRoll } from "./render.js";
import { MicSource, SimSource, ChordSource } from "./audio.js";
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
/** When on, practice keeps chords and transcribes them with MOTOR 2 (Basic Pitch). */
let chordMode = false;

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

/**
 * Build a POLYPHONIC practice line for one hand: keep every note of the hand
 * (chords intact) so the combiner escalates to MOTOR 2 on the scored polyphony.
 */
function polyHand(src: Score, hand: "right" | "left"): Score {
  const events = src.events
    .filter((e) => e.hand === hand)
    .sort((a, b) => a.onset - b.onset || a.pitchMidi - b.pitchMidi);
  return { ...src, events };
}

/** A real MOTOR 2 detector that reports its live activity into the HUD. */
function makePolyDetector(): BasicPitchDetector {
  return new BasicPitchDetector({
    onDetect(notes: DetectedNote[]): void {
      const el = $("hudEngine");
      const pitches = notes.map((n) => n.midi).join(" ");
      el.textContent = `poly · ${notes.length} note${notes.length === 1 ? "" : "s"} [${pitches}]`;
      el.className = "v ok";
    },
  });
}

/** A minimal C–E–G triad score for the self-contained MOTOR 2 test. */
const CHORD_XML = `<?xml version="1.0"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1"><measure number="1">
    <attributes><divisions>1</divisions><time><beats>4</beats><beat-type>4</beat-type></time></attributes>
    <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><staff>1</staff></note>
    <note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><staff>1</staff></note>
    <note><chord/><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><staff>1</staff></note>
  </measure></part>
</score-partwise>`;

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
function setEngine(msg: string): void {
  const el = $("hudEngine");
  el.textContent = msg;
  el.className = "v";
}

let starting = false;

async function startPractice(useMic: boolean): Promise<void> {
  if (!score || starting) return; // re-entrancy guard (e.g. double-click)
  starting = true;
  stopPractice();
  // Project the score for one hand. "Both" defaults to the right-hand line.
  // Chord mode keeps polyphony (MOTOR 2); otherwise collapse to a mono melody.
  const project = chordMode ? polyHand : monoHand;
  let hand: "right" | "left" = selectedHand === "left" ? "left" : "right";
  let practiceScore = project(score, hand);
  if (practiceScore.events.length === 0) {
    hand = hand === "right" ? "left" : "right";
    practiceScore = project(score, hand);
  }
  const poly = chordMode ? makePolyDetector() : undefined;
  practice = new LivePractice(practiceScore, callbacks, poly);
  source = useMic ? new MicSource() : new SimSource(practiceScore, { bpm });
  // Disable Listen/Simulate BEFORE awaiting the (possibly long) mic-permission
  // prompt, so a second click can't spawn an orphaned, never-stopped MicSource.
  transportButtons(true);
  if (chordMode) setEngine("loading Basic Pitch…");
  try {
    setMic((useMic ? "requesting microphone… " : "simulating… ") + `(${hand} hand)`);
    await practice.start(source);
    setMic(`${source.label} · ${hand} hand`);
  } catch (e) {
    setMic((e as Error).message);
    stopPractice(); // release the failed source
  } finally {
    starting = false;
  }
}

/**
 * Self-contained MOTOR 2 check: swap in a C–E–G triad score, drive it with the
 * synthetic {@link ChordSource}, and transcribe with the real Basic Pitch model.
 * Needs no microphone, no piano, and no backend — pure browser verification.
 */
async function startChordTest(): Promise<void> {
  if (starting) return;
  starting = true;
  stopPractice();
  score = parseMusicXML(CHORD_XML);
  $("pieceTitle").textContent = "MOTOR 2 test — C major triad";
  $("pieceMeta").textContent = "3 simultaneous notes (C4·E4·G4)";
  renderer.setScore(score);
  renderer.draw();
  chordMode = true;
  $<HTMLInputElement>("chordMode").checked = true;
  practice = new LivePractice(score, callbacks, makePolyDetector());
  source = new ChordSource([60, 64, 67], { durationSec: 3 });
  transportButtons(true);
  setEngine("loading Basic Pitch…");
  try {
    setMic("MOTOR 2 test: sounding C–E–G…");
    await practice.start(source);
    setMic(source.label);
  } catch (e) {
    setMic((e as Error).message);
    stopPractice();
  } finally {
    starting = false;
  }
}

function stopPractice(): void {
  practice?.stop();
  source?.stop();
  practice = null;
  source = null;
  transportButtons(false);
}

$("listen").addEventListener("click", () => void startPractice(true));
$("simulate").addEventListener("click", () => void startPractice(false));
$("chordTest").addEventListener("click", () => void startChordTest());
$("stop").addEventListener("click", () => { stopPractice(); setMic("stopped"); });

$<HTMLInputElement>("chordMode").addEventListener("change", (e) => {
  chordMode = (e.target as HTMLInputElement).checked;
  if (!chordMode) setEngine("—");
});

document.querySelectorAll<HTMLButtonElement>("#hands button").forEach((b) =>
  b.addEventListener("click", () => {
    document.querySelectorAll("#hands button").forEach((x) => x.classList.remove("on"));
    b.classList.add("on");
    selectedHand = b.dataset.h as "both" | "right" | "left";
    renderer.setHands(selectedHand);
  }));

const tempoInput = $<HTMLInputElement>("tempo");
tempoInput.addEventListener("input", () => { bpm = +tempoInput.value; $("bpm").textContent = String(bpm); });
