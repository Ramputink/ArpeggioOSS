/**
 * App shell for Arpeggio Learn.
 *
 *   library  -> level, achievements, the curriculum, warm-ups, imported scores
 *   setup    -> input, judging, hands, tempo, where to put the hands
 *   play     -> animated notation (scrolling or paged) + keyboard or music stand
 *   result   -> stars, XP, timing, what to work on next
 *
 * The shell owns the screen state machine and the wiring between the parts.
 * Everything else has its own home: judging in `runner.ts`, notation in
 * `staff.ts`, input in `keyboard.ts`, rewards in `gamification.ts`, minutes in
 * `practiceTime.ts`, the two screens with the most markup in `libraryView.ts`
 * and `resultView.ts`, and every sentence the app composes in `copy.ts`.
 */
import { SONGS, type HandChoice } from "@arpeggio/song-library";
import type { Score } from "@arpeggio/musicxml-parser";

import {
  HAND_LABEL,
  JUDGE_HELP,
  MODE_HELP,
  fiveFingerSpan,
  handPositionText,
  pitchLabel,
  plural,
  wrongNoteMessage,
} from "./copy.js";
import { $, button, closeSheet, el, openSheet, show } from "./dom.js";
import { confetti } from "./effects.js";
import { newlyUnlocked, type Achievement, type Stats } from "./gamification.js";
import { BRAND_MARK, icon } from "./icons.js";
import { KeyboardView, MIN_KEY_WIDTH, whiteKeysNeeded } from "./keyboard.js";
import { latencyVerdict } from "./latency.js";
import { renderAchievements, renderLibrary, type LibraryHandlers } from "./libraryView.js";
import { openMicCheck, wireMicCheck } from "./micCheckView.js";
import { isCompressedMusicXML, readMxl } from "./mxl.js";
import { addImported, pieceFromSong, removeImported, type Piece } from "./pieces.js";
import { PracticeClock } from "./practiceTime.js";
import { renderResult, renderSessionReport } from "./resultView.js";
import { Runner, type PracticeMode, type RunSummary } from "./runner.js";
import {
  planSession,
  summariseSession,
  type SessionReport,
  type SessionStep,
  type StepResult,
} from "./session.js";
import { StaffView, noteName, octaveOf, type Clef, type StaffNote } from "./staff.js";
import {
  applyRun,
  bankPracticeSeconds,
  loadPrefs,
  loadProgress,
  loadStats,
  recordRun,
  resetProgress,
  savePrefs,
  starsFor,
  type Prefs,
} from "./store.js";
import { Synth } from "./synth.js";
import { ScreenAwake } from "./wakeLock.js";

/** Largest staff line-gap in each layout, in pixels. */
const HAND_STAFF_SPACE = 22;
const STAND_STAFF_SPACE = 34;

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let prefs: Prefs = loadPrefs();
let piece: Piece | null = null;
let runner: Runner | null = null;
/** Tempo actually used: the piece's own, unless a ramp raised it. */
let bpm = 90;
/** Inclusive bar range to drill on repeat, or null for the whole piece. */
let loopBars: { from: number; to: number } | null = null;
let expectedNow: number[] = [];
let streak = 0;
let bestStreak = 0;
let cueHeldUntil = 0;
/** Measure the cursor is in, so a loop can be started from where you are. */
let currentMeasure = 1;
/** The guided session, when one is running. */
let sessionPlan: SessionStep[] = [];
let sessionStep = -1;
let sessionResults: StepResult[] = [];
/** Practice seconds accumulated across the steps of the current session. */
let sessionSeconds = 0;

const synth = new Synth();
const awake = new ScreenAwake();
const clock = new PracticeClock();
const staff = new StaffView($<HTMLCanvasElement>("staff"));
const keyboard = new KeyboardView($("keyboard"), {
  onPress: (midi) => runner?.press(midi),
  onRelease: (midi) => runner?.release(midi),
});

/** Absolute URLs so the app also works from a GitHub Pages sub-path. */
const MODEL_URL = new URL("models/basic-pitch/model.json", document.baseURI).href;
const WORKER_URL = new URL("polyWorker.js", document.baseURI).href;

const now = (): number => performance.now() / 1000;

// ---------------------------------------------------------------------------
// Static chrome
// ---------------------------------------------------------------------------
$("brandMark").innerHTML = BRAND_MARK;
$("settingsBtn").innerHTML = icon("settings");
$("standBtn").innerHTML = icon("stand", 20);
$("back").innerHTML = icon("back", 22);
$("heroCta").innerHTML = icon("play", 22);
$("profileChevron").innerHTML = icon("chevron", 18);
$("streakIcon").innerHTML = icon("bolt", 14);
for (const node of document.querySelectorAll<HTMLElement>("[data-icon]")) {
  const size = node.classList.contains("howto-icon") ? 19 : node.closest(".ctrl") ? 20 : 17;
  node.innerHTML = icon(node.dataset.icon ?? "", size);
}
$("footNote").textContent =
  "Diecinueve piezas de dominio público, de la más fácil a la más difícil, " +
  "más los ejercicios de técnica.";

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------
function applyTheme(theme: "dark" | "light"): void {
  document.documentElement.dataset.theme = theme;
  $("themeBtn").innerHTML = icon(theme === "dark" ? "sun" : "moon");
  $("themeBtn").setAttribute(
    "aria-label",
    theme === "dark" ? "Usar tema claro" : "Usar tema oscuro",
  );
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "dark" ? "#0a0d12" : "#f5f7fb");
}

applyTheme(prefs.theme);
$("themeBtn").addEventListener("click", () => {
  setPrefs({ theme: prefs.theme === "dark" ? "light" : "dark" });
  applyTheme(prefs.theme);
  staff.refreshTheme();
});

function setPrefs(patch: Partial<Prefs>): void {
  prefs = { ...prefs, ...patch };
  savePrefs(prefs);
}

// ---------------------------------------------------------------------------
// Music-stand mode
// ---------------------------------------------------------------------------
/**
 * Driven by a `data-` attribute on `<body>` rather than by rebuilding the screen,
 * so it can be toggled mid-piece: the staff simply re-lays out on its next frame.
 */
function applyStand(): void {
  document.body.dataset.stand = prefs.stand ? "1" : "";
  $("standBtn").setAttribute("aria-pressed", String(prefs.stand));
  // "Parar" only earns its space on the stand; in the hand, the back arrow in
  // the title bar is right there.
  show("ctrlStop", prefs.stand);
  staff.setMaxSpace(prefs.stand ? STAND_STAFF_SPACE : HAND_STAFF_SPACE);
  updateRotateHint();
}

function updateRotateHint(): void {
  const playing = !$("play").classList.contains("hidden");
  const showHint = playing && prefs.stand && window.matchMedia("(orientation: portrait)").matches;
  show("rotateHint", showHint);
}
window.addEventListener("orientationchange", updateRotateHint);
window.addEventListener("resize", updateRotateHint);

$("standBtn").addEventListener("click", () => {
  setPrefs({ stand: !prefs.stand });
  applyStand();
  syncKeyboardVisibility();
});

/**
 * The on-screen keyboard is hidden whenever it is not the instrument: in stand
 * mode, and in microphone mode where it is both dead weight and a path from the
 * speaker back into the microphone.
 */
function syncKeyboardVisibility(): void {
  const hide = prefs.stand || prefs.mode === "mic";
  show("keyboard", !hide);
  if (!hide) keyboard.relayout();
}

// ---------------------------------------------------------------------------
// Sheets
// ---------------------------------------------------------------------------
for (const id of ["setup", "settings", "achievements", "miccheck", "session", "report"]) {
  $(id).addEventListener("click", (e) => {
    if (e.target === $(id)) closeSheet(id);
  });
}

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------
const libraryHandlers: LibraryHandlers = {
  onOpen: (p) => openSetup(p),
  onDeleteImported: (id) => {
    removeImported(id);
    refreshLibrary();
  },
  onRefresh: () => refreshLibrary(),
};

function refreshLibrary(): void {
  renderLibrary(loadProgress(), loadStats(), prefs, libraryHandlers);
}

$("profile").addEventListener("click", () => {
  renderAchievements(loadStats());
  openSheet("achievements");
});
$("achDone").addEventListener("click", () => closeSheet("achievements"));

function toastAchievement(a: Achievement): void {
  const toast = document.createElement("div");
  toast.className = "toast";
  const iconBox = el("span", "toast-icon", "");
  iconBox.innerHTML = icon(a.icon, 18);
  const body = document.createElement("span");
  body.className = "toast-body";
  body.append(el("span", "eyebrow", "Logro conseguido"), el("b", "", a.title));
  toast.append(iconBox, body);
  toast.addEventListener("animationend", (e) => {
    if ((e as AnimationEvent).animationName === "toastout") toast.remove();
  });
  $("toasts").append(toast);
  window.setTimeout(() => toast.remove(), 6000);
}

function announce(before: Stats, after: Stats): void {
  newlyUnlocked(before, after).forEach((a, i) =>
    window.setTimeout(() => toastAchievement(a), 450 + i * 700),
  );
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
const OPTIONS: Array<[string, keyof Prefs]> = [
  ["optNames", "showNames"],
  ["optCountIn", "countIn"],
  ["optHaptics", "haptics"],
  ["optMetronome", "metronome"],
  ["optAccompany", "accompany"],
  ["optPageView", "pageView"],
  ["optStand", "stand"],
];

function syncSettings(): void {
  for (const [id, key] of OPTIONS) $<HTMLInputElement>(id).checked = Boolean(prefs[key]);
  $("aboutLine").textContent =
    "Arpeggio Learn · sin cuenta, sin servidor y sin analítica: tu progreso vive solo en este dispositivo.";
}

for (const [id, key] of OPTIONS) {
  $(id).addEventListener("change", (e) => {
    setPrefs({ [key]: (e.target as HTMLInputElement).checked } as Partial<Prefs>);
    if (key === "showNames") {
      staff.setShowNames(prefs.showNames);
      keyboard.setNames(prefs.showNames);
      syncNamesButton();
    }
    if (key === "stand") {
      applyStand();
      syncKeyboardVisibility();
    }
  });
}

$("settingsBtn").addEventListener("click", () => {
  syncSettings();
  openSheet("settings");
});
$("settingsDone").addEventListener("click", () => closeSheet("settings"));
$("resetProgress").addEventListener("click", () => {
  // Two taps rather than a confirm() dialog: a native modal blocks the audio
  // context and cannot be styled, and this is recoverable in one session.
  const btn = $<HTMLButtonElement>("resetProgress");
  if (btn.dataset.armed !== "1") {
    btn.dataset.armed = "1";
    btn.textContent = "Pulsa otra vez para confirmar";
    window.setTimeout(() => {
      btn.dataset.armed = "";
      btn.textContent = "Borrar mi progreso";
    }, 4000);
    return;
  }
  resetProgress();
  btn.dataset.armed = "";
  btn.textContent = "Progreso borrado";
  refreshLibrary();
});

// ---------------------------------------------------------------------------
// Microphone check
// ---------------------------------------------------------------------------
// Its own module: a self-contained diagnostic whose only tie to the rest of the
// app is the latency the last microphone run measured.
wireMicCheck(() => runner?.latency ?? null);

// ---------------------------------------------------------------------------
// First run
// ---------------------------------------------------------------------------
/**
 * One question: is there a piano in front of you?
 *
 * It is the only setting that decides whether the app works at all for this
 * person, and getting it wrong does not look like a wrong setting — it looks
 * like a broken app. You press the keys of your piano and nothing on screen
 * moves, because the app is patiently waiting for a tap.
 *
 * The old first run was three bullet points explaining the app and then left
 * the learner on the library screen with twenty-nine pieces and no idea which
 * one to press.
 */
if (!prefs.introSeen) show("intro", true);

function chooseMode(mode: PracticeMode): void {
  setPrefs({ mode, introSeen: true });
  show("intro", false);
  syncKeyboardVisibility();
  refreshLibrary();
}

$("introScreen").addEventListener("click", () => chooseMode("keys"));
$("introPiano").addEventListener("click", () => {
  chooseMode("mic");
  // Straight into the microphone check, because "can it hear my piano?" is the
  // question that has to be answered before anything else is worth trying — and
  // it is the failure that is impossible to diagnose from the practice screen.
  openMicCheck();
});

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------
function openSetup(p: Piece, loop?: { from: number; to: number }): void {
  piece = p;
  bpm = p.bpm;
  loopBars = loop ?? null;
  $("setupTitle").textContent = p.title;
  $("setupMeta").textContent =
    `${p.composer} · ${p.beats}/${p.beatType} · ${p.bpm} ppm · ` +
    plural(p.bars, "compás", "compases") +
    (p.hasLeft ? " · dos manos" : " · solo melodía") +
    (loopBars ? ` · bucle ${loopBars.from}–${loopBars.to}` : "");
  $("setupTip").textContent = p.tip;

  for (const b of document.querySelectorAll<HTMLButtonElement>("#handSel button")) {
    b.disabled = !p.hasLeft && b.dataset.hand !== "right";
  }
  show("handHint", !p.hasLeft);

  setSegment("modeSel", "mode", prefs.mode);
  setSegment("judgeSel", "judge", prefs.aTempo ? "tempo" : "wait");
  setSegment("handSel", "hand", effectiveHand());
  $("modeHelp").textContent = MODE_HELP[prefs.mode];
  $("judgeHelp").textContent = prefs.aTempo ? JUDGE_HELP.tempo : JUDGE_HELP.wait;
  $<HTMLInputElement>("tempo").value = String(bpm);
  $("bpmOut").textContent = String(bpm);
  syncTempoField();
  updateHandPosition();
  updateFitHint();
  openSheet("setup");
}

function effectiveHand(): HandChoice {
  return piece?.hasLeft ? prefs.hand : "right";
}

/** The tempo only matters where a clock is involved. */
function syncTempoField(): void {
  show("tempoField", prefs.mode === "demo" || prefs.aTempo || prefs.metronome);
}

function updateHandPosition(): void {
  const text = piece ? handPositionText(piece.startPosition, piece.sharps, effectiveHand()) : null;
  show("setupHands", text !== null);
  if (text) $("setupHands").textContent = text;
}

function updateFitHint(): void {
  const hint = $("fitHint");
  if (!piece || prefs.mode !== "keys" || prefs.stand) {
    hint.classList.add("hidden");
    return;
  }
  const pitches = piece.score(effectiveHand()).events.map((e) => e.pitchMidi);
  if (pitches.length === 0) {
    hint.classList.add("hidden");
    return;
  }
  const needed = whiteKeysNeeded(Math.min(...pitches), Math.max(...pitches)) * MIN_KEY_WIDTH;
  const fits = needed <= document.documentElement.clientWidth;
  hint.classList.toggle("hidden", fits);
  if (!fits) {
    hint.textContent =
      effectiveHand() === "both"
        ? "Con las dos manos no caben todas las teclas en la pantalla. Practica una mano cada vez, o elige «Mi piano»."
        : "Esta pieza es más ancha que la pantalla: el teclado se desplazará solo hasta la tecla que toca.";
  }
}

function setSegment(containerId: string, dataKey: string, value: string): void {
  for (const b of document.querySelectorAll<HTMLButtonElement>(`#${containerId} button`)) {
    const on = b.dataset[dataKey] === value;
    b.classList.toggle("on", on);
    b.setAttribute("aria-pressed", String(on));
  }
}

for (const b of document.querySelectorAll<HTMLButtonElement>("#modeSel button")) {
  b.addEventListener("click", () => {
    setPrefs({ mode: b.dataset.mode as PracticeMode });
    setSegment("modeSel", "mode", prefs.mode);
    $("modeHelp").textContent = MODE_HELP[prefs.mode];
    syncTempoField();
    updateFitHint();
  });
}

for (const b of document.querySelectorAll<HTMLButtonElement>("#judgeSel button")) {
  b.addEventListener("click", () => {
    setPrefs({ aTempo: b.dataset.judge === "tempo" });
    setSegment("judgeSel", "judge", prefs.aTempo ? "tempo" : "wait");
    $("judgeHelp").textContent = prefs.aTempo ? JUDGE_HELP.tempo : JUDGE_HELP.wait;
    syncTempoField();
  });
}

for (const b of document.querySelectorAll<HTMLButtonElement>("#handSel button")) {
  b.addEventListener("click", () => {
    if (b.disabled) return;
    setPrefs({ hand: b.dataset.hand as HandChoice });
    setSegment("handSel", "hand", prefs.hand);
    updateHandPosition();
    updateFitHint();
  });
}

const tempoInput = $<HTMLInputElement>("tempo");
tempoInput.addEventListener("input", () => {
  bpm = Number(tempoInput.value);
  $("bpmOut").textContent = String(bpm);
});

$("cancel").addEventListener("click", () => closeSheet("setup"));
$("go").addEventListener("click", () => void startPractice());

// ---------------------------------------------------------------------------
// Play
// ---------------------------------------------------------------------------
/** Keep only the bars of a loop range, so a drill is a piece in its own right. */
function restrictToLoop(score: Score, loop: { from: number; to: number } | null): Score {
  if (!loop) return score;
  const events = score.events.filter((e) => e.measure >= loop.from && e.measure <= loop.to);
  return events.length > 0 ? { ...score, events } : score;
}

/** The hand the learner is *not* playing, for the app to sound. */
function otherHandNotes(hand: HandChoice): Array<{ midi: number; onset: number; offset: number }> {
  if (!piece || !prefs.accompany || hand === "both" || !piece.hasLeft) return [];
  const other: HandChoice = hand === "right" ? "left" : "right";
  return restrictToLoop(piece.score(other), loopBars).events.map((e) => ({
    midi: e.pitchMidi,
    onset: e.onset,
    offset: e.offset,
  }));
}

async function startPractice(): Promise<void> {
  if (!piece) return;
  closeSheet("setup");
  closeSheet("result");
  closeSheet("report");
  stopPractice();

  // Inside the tap handler's task: iOS only unlocks audio from a user gesture.
  // Bounded, because a browser that has not unlocked audio leaves `resume()`
  // pending for ever and the screen must open regardless.
  await Promise.race([synth.resume(), delay(400)]);

  const hand = effectiveHand();
  const score = restrictToLoop(piece.score(hand), loopBars);
  runner = new Runner(score, {
    mode: prefs.mode,
    synth,
    bpm,
    aTempo: prefs.aTempo,
    metronome: prefs.metronome,
    beatsPerBar: (piece.beats * 4) / piece.beatType,
    accompany: otherHandNotes(hand),
    modelUrl: MODEL_URL,
    workerUrl: WORKER_URL,
    hooks: { onProgress, onJudge, onStatus, onFinish, onHeard },
  });

  const notes: StaffNote[] = runner.notes.map((n, i) => ({
    index: i,
    midi: n.midi,
    onset: n.onset,
    offset: n.offset,
    hand: n.staff === 2 ? "left" : "right",
    finger: fingerAt(score, n.onset, n.midi),
  }));
  const clefs: Clef[] =
    hand === "both" ? ["treble", "bass"] : hand === "left" ? ["bass"] : ["treble"];

  staff.setPiece(notes, {
    sharps: piece.sharps,
    beatsPerBar: (piece.beats * 4) / piece.beatType,
    pickupBeats: piece.pickupBeats,
    clefs,
    showNames: prefs.showNames,
    maxSpace: prefs.stand ? STAND_STAFF_SPACE : HAND_STAFF_SPACE,
    layout: prefs.pageView ? "page" : "scroll",
  });
  staff.start();

  const pitches = notes.map((n) => n.midi);
  if (pitches.length > 0) {
    keyboard.setRange(Math.min(...pitches), Math.max(...pitches), piece.sharps);
  }
  keyboard.setNames(prefs.showNames);
  keyboard.releaseAll();

  $("playTitle").textContent = piece.title;
  $("playMeta").textContent = playMetaText(hand);
  $("staff").setAttribute("aria-label", `${piece.title}, ${HAND_LABEL[hand]}`);
  setProgressBar(0);
  show("library", false);
  show("play", true);
  applyStand();
  syncKeyboardVisibility();
  keyboard.relayout();
  syncPauseButton();
  show("heard", prefs.mode === "mic");
  if (prefs.mode === "mic") $("heard").textContent = "Escuchando…";
  $("ctrlLoop").setAttribute("aria-pressed", String(loopBars !== null));
  // Hands on the keys means nothing will tap the screen for twenty minutes.
  void awake.acquire();
  streak = 0;
  bestStreak = 0;
  showStreak(0);
  showHandPositionCue(hand);

  try {
    if (prefs.countIn) await countIn(bpm);
    if (!runner) return; // the learner left during the count-in
    clock.start(now());
    await runner.start();
  } catch (e) {
    setCueMessage((e as Error).message || "No se pudo iniciar", true);
  }
}

function playMetaText(hand: HandChoice): string {
  const step = sessionStep >= 0 ? `Paso ${sessionStep + 1}/${sessionPlan.length} · ` : "";
  return (
    step +
    `${piece?.composer} · ${HAND_LABEL[hand]}` +
    // Say it when the app is sounding the other hand: otherwise the first
    // unexplained note that is not yours is confusing rather than helpful.
    (runner?.accompanying ? " + la app" : "") +
    (prefs.aTempo || prefs.mode === "demo" ? ` · ${bpm} ppm` : "") +
    (loopBars ? ` · bucle ${loopBars.from}–${loopBars.to}` : "")
  );
}

/**
 * Light the five keys the hand starts on, and say so, before the first note.
 *
 * Only where there is a keyboard to light: at a real piano the sentence is the
 * whole message, and it is already on the setup sheet the learner just left.
 */
function showHandPositionCue(hand: HandChoice): void {
  const text = piece ? handPositionText(piece.startPosition, piece.sharps, hand) : null;
  if (!text) return;
  setCueMessage(text);
  cueHeldUntil = Date.now() + 2500;
  const anchor = hand === "left" ? piece?.startPosition?.left : piece?.startPosition?.right;
  if (anchor !== undefined && !prefs.stand && prefs.mode === "keys") {
    keyboard.setGuide(fiveFingerSpan(anchor));
    window.setTimeout(() => keyboard.setGuide([]), 3000);
  }
}

/** Fingering for a note, looked up on the score that produced it. */
function fingerAt(score: Score, onset: number, midi: number): number | undefined {
  return score.events.find((e) => e.pitchMidi === midi && Math.abs(e.onset - onset) < 1e-6)?.finger;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function setProgressBar(fraction: number): void {
  const pct = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
  $<HTMLElement>("progressBar").style.width = `${pct}%`;
  $("track").setAttribute("aria-valuenow", String(pct));
}

async function countIn(tempo: number): Promise<void> {
  const box = $("countdown");
  const digit = box.querySelector("span");
  if (!digit) return;
  const beatMs = Math.min(900, Math.max(320, 60000 / tempo));
  box.classList.remove("hidden");
  for (const n of [3, 2, 1]) {
    digit.textContent = String(n);
    digit.style.animation = "none";
    void digit.offsetWidth;
    digit.style.animation = "";
    synth.click(n === 3);
    await delay(beatMs);
    if ($("play").classList.contains("hidden")) break;
  }
  box.classList.add("hidden");
}

function showStreak(count: number): void {
  const box = $("streak");
  if (count < 3) {
    box.classList.remove("on");
    return;
  }
  $("streakCount").textContent = String(count);
  box.classList.add("on");
  box.classList.remove("pop");
  void box.offsetWidth;
  box.classList.add("pop");
}

function vibrate(ms: number): void {
  if (!prefs.haptics) return;
  navigator.vibrate?.(ms);
}

function onProgress(p: {
  doneIndex: number;
  total: number;
  positionBeats: number;
  measure: number;
  expected: number[];
}): void {
  staff.setProgress(p.doneIndex, p.positionBeats);
  if (p.measure !== currentMeasure) describeStaff(p.measure);
  currentMeasure = p.measure;
  expectedNow = p.expected;
  keyboard.setHighlight(p.expected);
  setProgressBar(p.total ? p.doneIndex / p.total : 0);
  if (prefs.mode !== "demo") renderCue();
}

/**
 * Keep the canvas's text alternative current.
 *
 * A canvas is a blank rectangle to a screen reader. Between this and the live
 * cue line, a blind learner has the two things the sighted one has: where they
 * are in the piece, and which note is next.
 */
function describeStaff(measure: number): void {
  if (!piece) return;
  $("staff").setAttribute("aria-label", `${piece.title}. Compás ${measure} de ${piece.bars}.`);
}

function renderCue(): void {
  if (expectedNow.length === 0) return;
  const remaining = cueHeldUntil - Date.now();
  if (remaining > 0) {
    window.setTimeout(renderCue, remaining + 20);
    return;
  }
  const cue = $("cue");
  cue.className = "cue";
  cue.replaceChildren(el("span", "cue-lead", "Toca"));
  const sharps = piece?.sharps ?? 0;
  for (const midi of expectedNow) {
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.append(document.createTextNode(noteName(midi, sharps)));
    chip.append(el("sub", "", String(octaveOf(midi))));
    cue.append(chip);
  }
}

function setCueMessage(text: string, bad = false): void {
  const cue = $("cue");
  cue.className = "cue" + (bad ? " bad" : "");
  cue.replaceChildren(el("span", "cue-text", text));
}

function onJudge(event: { kind: string; playedMidi?: number; octaveOff?: number }): void {
  if (event.kind === "correct" || event.kind === "early" || event.kind === "late") {
    if (event.playedMidi !== undefined) keyboard.flash(event.playedMidi, true);
    staff.celebrate();
    streak++;
    bestStreak = Math.max(bestStreak, streak);
    showStreak(streak);
    vibrate(8);
    // In a-tempo mode timing is the point, so say which way you were off.
    if (event.kind !== "correct") {
      setCueMessage(event.kind === "early" ? "Un poco pronto" : "Un poco tarde");
      cueHeldUntil = Date.now() + 700;
    }
    return;
  }
  if (event.kind !== "wrong") return;

  if (event.playedMidi !== undefined) keyboard.flash(event.playedMidi, false);
  staff.flashWrong();
  setCueMessage(wrongNoteMessage(event, !$("keyboard").classList.contains("hidden")), true);
  cueHeldUntil = Date.now() + 1200;
  streak = 0;
  showStreak(0);
  vibrate(28);
}

/**
 * A transient hint on the cue line.
 *
 * Dropped while a held message is showing. Status lines are ephemeral by design
 * — the first cursor position replaces them a moment later — so the one thing
 * they must not do is stamp on something the learner is still reading, which is
 * exactly what "Toca las teclas marcadas" did to the hand-placement message it
 * arrived one tick after.
 */
/**
 * Show what the microphone is hearing, whether or not it was accepted.
 *
 * This is a diagnostic, and it exists because the app was silently failing in a
 * way the learner could not possibly diagnose: it asks for a DO4, they play a
 * DO4, and nothing happens. Now they can see whether it heard a DO5, heard
 * nothing at all, or heard exactly the right note and rejected it — three
 * different bugs that used to look like one.
 */
let heardUntil = 0;
function onHeard(midis: number[]): void {
  if (prefs.mode !== "mic") return;
  const box = $("heard");
  heardUntil = Date.now() + 1400;
  box.classList.remove("hidden", "deaf");
  const sharps = piece?.sharps ?? 0;
  box.textContent =
    midis.length === 0
      ? "Te oigo, pero no distingo la nota"
      : `Te oigo: ${midis.map((m) => pitchLabel(m, sharps)).join(" · ")}`;
  window.setTimeout(() => {
    if (Date.now() >= heardUntil) fadeHeard();
  }, 1500);
}

/** Nothing has been heard for a while: say so, because silence is a symptom. */
function fadeHeard(): void {
  const box = $("heard");
  if ($("play").classList.contains("hidden") || prefs.mode !== "mic") {
    box.classList.add("hidden");
    return;
  }
  box.classList.add("deaf");
  box.textContent = "No oigo el piano…";
}

function onStatus(text: string): void {
  if (cueHeldUntil > Date.now()) return;
  setCueMessage(text);
}

// --- transport --------------------------------------------------------------

function syncPauseButton(): void {
  const paused = runner?.isPaused ?? false;
  $("ctrlPause").setAttribute("aria-pressed", String(paused));
  $("ctrlPauseLabel").textContent = paused ? "Seguir" : "Pausa";
  $("ctrlPause").querySelector("i")!.innerHTML = icon(paused ? "play" : "pause", 20);
}

$("ctrlPause").addEventListener("click", () => {
  if (!runner) return;
  if (runner.isPaused) {
    clock.start(now());
    runner.resume();
  } else {
    clock.pause(now());
    runner.pause();
  }
  syncPauseButton();
  show("heard", prefs.mode === "mic");
  if (prefs.mode === "mic") $("heard").textContent = "Escuchando…";
});

/**
 * Toggle a drill on the bars the student model rates weakest. A loop is run as a
 * piece in its own right — the score is restricted to those bars — which keeps the
 * follower, the staff and the progress bar honest with no special cases.
 */
$("ctrlLoop").addEventListener("click", () => {
  if (loopBars) {
    loopBars = null;
  } else {
    const weak = runner?.weakestMeasures(3) ?? [];
    const measures = weak.length > 0 ? weak : [currentMeasure];
    loopBars = { from: Math.min(...measures), to: Math.max(...measures) };
  }
  $("ctrlLoop").setAttribute("aria-pressed", String(loopBars !== null));
  void startPractice();
});

$("ctrlRestart").addEventListener("click", () => void startPractice());
$("ctrlStop").addEventListener("click", toLibrary);

/**
 * A backgrounded tab is not practice.
 *
 * Without this the minute counter would bank whatever happened while the phone
 * was in a pocket, and the one number that is supposed to mean effort would mean
 * nothing at all.
 */
document.addEventListener("visibilitychange", () => {
  if (document.hidden) {
    clock.pause(now());
  } else if (!$("play").classList.contains("hidden") && !(runner?.isPaused ?? true)) {
    clock.start(now());
  }
});

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------
function onFinish(summary: RunSummary): void {
  if (!piece) return;
  const judged = prefs.mode !== "demo";
  const stars = judged ? starsFor(recordRun(piece.id, summary)) : 0;
  const seconds = clock.take(now());
  clock.pause(now());
  // A session step ends here and goes straight to the next one, never through
  // the library, so this is where the session's own clock has to be fed.
  if (sessionStep >= 0) sessionSeconds += seconds;

  staff.stop();
  keyboard.setHighlight([]);
  showStreak(0);

  const { before, after, xp } = applyRun({
    songId: piece.id,
    mode: prefs.mode,
    hand: effectiveHand(),
    correct: summary.correct,
    wrong: summary.wrong,
    stars,
    completed: summary.completed,
    judged,
    streak: bestStreak,
    seconds,
  });

  const latency = runner?.latency;
  const micLatencyMs = prefs.mode === "mic" && latency && latency.samples > 0 ? latency.p50 : null;

  renderResult({
    summary,
    judged,
    stars,
    bestStreak,
    seconds,
    loop: loopBars,
    micLatencyMs,
    latencyIsBad:
      prefs.mode === "mic" &&
      latency !== undefined &&
      latency.samples > 5 &&
      latencyVerdict(latency.p50) === "bad",
    weakMeasures: runner?.weakestMeasures(3) ?? [],
    xp,
    stats: after,
    actions: resultActions(stars, judged, summary),
  });

  recordSessionStep(stars, summary);
  openSheet("result");
  if (stars === 3) confetti($("result").querySelector<HTMLElement>(".sheet-card")!);
  announce(before, after);
}

function resultActions(stars: number, judged: boolean, summary: RunSummary): HTMLElement[] {
  const actions: HTMLElement[] = [];

  // A guided session drives the order: its next step is the primary action.
  const moreSteps = sessionStep >= 0 && sessionStep + 1 < sessionPlan.length;
  if (moreSteps) {
    actions.push(
      button("btn btn-primary", "Siguiente paso de la sesión", () =>
        runSessionStep(sessionStep + 1),
      ),
    );
  } else if (sessionStep >= 0) {
    actions.push(button("btn btn-primary", "Ver el resumen de la sesión", finishSession));
  }

  const clean = judged && summary.completed && summary.accuracy >= 0.95;
  // Tempo ramp: the mechanic that actually builds speed. Offered only after a
  // clean run, and only where a clock is involved — otherwise the number has no
  // effect on anything.
  if (clean && (prefs.aTempo || prefs.metronome || prefs.mode === "demo")) {
    const faster = Math.round(bpm * 1.1);
    actions.push(
      button("btn btn-outline", `Súbelo a ${faster} ppm`, () => {
        bpm = faster;
        void startPractice();
      }),
    );
  }

  const weak = runner?.weakestMeasures(3) ?? [];
  if (judged && !loopBars && weak.length > 0 && summary.accuracy < 0.95) {
    const from = Math.min(...weak);
    const to = Math.max(...weak);
    actions.push(
      button("btn btn-outline", `Practicar los compases ${from}–${to}`, () => {
        loopBars = { from, to };
        void startPractice();
      }),
    );
  }
  if (loopBars) {
    actions.push(
      button("btn btn-outline", "Tocarla entera", () => {
        loopBars = null;
        void startPractice();
      }),
    );
  }

  const next = nextPiece();
  const advance = judged && stars === 3 && next !== null && sessionStep < 0;
  const again = button(
    advance || actions.length > 0 ? "btn btn-outline" : "btn btn-primary",
    judged ? "Otra vez" : "Escuchar otra vez",
    () => void startPractice(),
  );
  if (advance) {
    actions.unshift(button("btn btn-primary", "Siguiente pieza", () => openNext(next!)));
    actions.push(again);
  } else {
    actions.push(again);
    if (next && sessionStep < 0) {
      actions.push(button("btn btn-outline", "Siguiente pieza", () => openNext(next)));
    }
  }
  actions.push(button("btn btn-quiet", "Volver a la biblioteca", toLibrary));
  return actions;
}

function openNext(target: Piece): void {
  closeSheet("result");
  stopPractice();
  show("play", false);
  show("library", true);
  refreshLibrary();
  openSetup(target);
}

/**
 * The next piece in the curriculum.
 *
 * Looked up in `SONGS` rather than in everything playable, so finishing a warm-up
 * or an imported score never offers "the next one" out of a list it is not in.
 */
function nextPiece(): Piece | null {
  if (!piece || piece.imported) return null;
  const i = SONGS.findIndex((s) => s.id === piece?.id);
  return i >= 0 && i + 1 < SONGS.length ? pieceFromSong(SONGS[i + 1]) : null;
}

// ---------------------------------------------------------------------------
// Guided session
// ---------------------------------------------------------------------------
$("sessionBtn").addEventListener("click", () => {
  const progress = loadProgress();
  const stars: Record<string, number> = {};
  const lastPlayed: Record<string, number> = {};
  for (const [id, entry] of Object.entries(progress)) {
    stars[id] = starsFor(entry);
    lastPlayed[id] = entry.lastPlayed;
  }
  sessionPlan = planSession({ stars, lastPlayed, weakBars: runner?.weakestMeasures(3) ?? [] });
  sessionStep = -1;
  sessionResults = [];

  const list = $("sessionList");
  list.replaceChildren();
  sessionPlan.forEach((step, i) => {
    const row = document.createElement("div");
    row.className = "ach";
    const body = document.createElement("span");
    body.className = "ach-body";
    body.append(el("b", "", step.title), el("small", "", step.detail));
    row.append(el("span", "card-index", String(i + 1)), body);
    list.append(row);
  });
  openSheet("session");
});

$("sessionStart").addEventListener("click", () => runSessionStep(0));
$("sessionCancel").addEventListener("click", () => {
  sessionPlan = [];
  sessionStep = -1;
  sessionResults = [];
  closeSheet("session");
});
// Nothing else to do here: the library is already behind the sheet.
$("reportDone").addEventListener("click", () => closeSheet("report"));

function runSessionStep(index: number): void {
  closeSheet("session");
  closeSheet("result");
  const step = sessionPlan[index];
  if (!step) {
    finishSession();
    return;
  }
  sessionStep = index;
  openSetup(pieceFromSong(step.song), step.loop);
}

/** Remember how a session step went, so the summary can be honest about it. */
function recordSessionStep(stars: number, summary: RunSummary): void {
  const step = sessionPlan[sessionStep];
  if (!step) return;
  sessionResults[sessionStep] = {
    title: step.title,
    songTitle: step.song.title,
    stars,
    correct: summary.correct,
    completed: summary.completed,
  };
}

/**
 * End the session and say what happened.
 *
 * The plan is announced up front, so it has to be accounted for at the end —
 * otherwise the app asks for ten minutes of trust and never reports back. There
 * is one way out, `toLibrary`, so that walking away mid-session ends it too: the
 * previous version left `sessionStep` pointing at a plan nobody was following,
 * and the next piece finished from the library was filed as a step of it.
 */
function finishSession(): void {
  closeSheet("result");
  toLibrary();
}

/** Clear the session and return its report, if it got far enough to have one. */
function takeSessionReport(): SessionReport | null {
  const results = sessionResults.filter(Boolean);
  const seconds = sessionSeconds;
  const planned = sessionPlan.length;
  sessionPlan = [];
  sessionStep = -1;
  sessionResults = [];
  sessionSeconds = 0;
  return results.length > 0 ? summariseSession(results, seconds, planned) : null;
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------
$("importBtn").addEventListener("click", () => $<HTMLInputElement>("importFile").click());
$("importFile").addEventListener("change", () => {
  const input = $<HTMLInputElement>("importFile");
  const file = input.files?.[0];
  input.value = "";
  if (!file) return;
  void (async () => {
    try {
      // `.mxl` is what MuseScore, Sibelius and Finale export by default, so it
      // is the first thing a real user brings; see `mxl.ts`.
      const xml = isCompressedMusicXML(file.name)
        ? await readMxl(await file.arrayBuffer())
        : await file.text();
      addImported(file.name.replace(/\.[^.]+$/, ""), xml);
      refreshLibrary();
      flashImportLabel("Importada", 2500);
    } catch (err) {
      flashImportLabel((err as Error).message || "No se pudo leer", 3500);
    }
  })();
});

function flashImportLabel(text: string, ms: number): void {
  const label = $("importBtn").querySelector("span")!;
  label.textContent = text;
  window.setTimeout(() => {
    label.textContent = "Importar partitura";
  }, ms);
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------
function stopPractice(): void {
  runner?.stop();
  runner = null;
  staff.stop();
  keyboard.releaseAll();
  keyboard.setHighlight([]);
  keyboard.setGuide([]);
  synth.allOff();
}

function toLibrary(): void {
  // Bank whatever was practised before walking away: most practice ends this
  // way, not with a finished piece, and only counting completions would
  // undercount exactly the sessions spent grinding four bars.
  const seconds = clock.take(now());
  clock.pause(now());
  if (seconds >= 1) {
    sessionSeconds += seconds;
    const { before, after } = bankPracticeSeconds(seconds);
    announce(before, after);
  }

  const report = takeSessionReport();

  stopPractice();
  closeSheet("result");
  show("play", false);
  show("library", true);
  void awake.release();
  updateRotateHint();
  refreshLibrary();

  if (report) {
    renderSessionReport(report.headline, report.lines, report.notes);
    openSheet("report");
  }
}

$("back").addEventListener("click", toLibrary);

function syncNamesButton(): void {
  $("namesBtn").setAttribute("aria-pressed", String(prefs.showNames));
  $("namesBtn").textContent = "DO";
}

$("namesBtn").addEventListener("click", () => {
  setPrefs({ showNames: !prefs.showNames });
  syncNamesButton();
  staff.setShowNames(prefs.showNames);
  keyboard.setNames(prefs.showNames);
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
syncNamesButton();
applyStand();
keyboard.setNames(prefs.showNames);
refreshLibrary();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker
      .register(new URL("sw.js", document.baseURI).href, { scope: "./" })
      .catch(() => undefined);
  });
}
