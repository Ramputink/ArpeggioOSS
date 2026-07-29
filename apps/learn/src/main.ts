/**
 * App shell for Arpeggio Learn.
 *
 *   library  -> level, achievements and the curriculum
 *   setup    -> how do you want to play this piece
 *   play     -> animated staff + keyboard, driven by the Runner
 *   result   -> stars, XP, what to work on next
 *
 * The shell owns the DOM and the screen state machine. Everything musical lives
 * in `runner.ts` (judging), `staff.ts` (notation) and `keyboard.ts` (input), and
 * everything countable in `gamification.ts` (pure) plus `store.ts` (persistence).
 */
import {
  LEVEL_GOALS,
  LEVEL_NAMES,
  SONGS,
  beatsPerBar,
  songToScore,
  type HandChoice,
  type Level,
  type Song,
} from "@arpeggio/song-library";

import { confetti } from "./effects.js";
import {
  ACHIEVEMENTS,
  achievementRatio,
  levelFor,
  newlyUnlocked,
  unlockedIds,
  type Achievement,
  type Stats,
} from "./gamification.js";
import { BRAND_MARK, icon } from "./icons.js";
import { KeyboardView } from "./keyboard.js";
import { Runner, type PracticeMode, type RunSummary } from "./runner.js";
import { StaffView, noteName, octaveOf, type Clef, type StaffNote } from "./staff.js";
import {
  applyRun,
  loadPrefs,
  loadProgress,
  loadStats,
  recordRun,
  resetProgress,
  savePrefs,
  starsFor,
  type Prefs,
  type SongProgress,
} from "./store.js";
import { Synth } from "./synth.js";

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el as T;
};

const MODE_HELP: Record<PracticeMode, string> = {
  keys: "Toca las teclas del móvil. No necesitas piano.",
  mic: "Toca en un piano de verdad: la app te escucha por el micrófono.",
  demo: "La app toca la pieza para que la escuches y la sigas con la vista.",
};

const HAND_LABEL: Record<HandChoice, string> = {
  right: "mano derecha",
  left: "mano izquierda",
  both: "las dos manos",
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let prefs: Prefs = loadPrefs();
let song: Song | null = null;
let runner: Runner | null = null;
/** Playback tempo for demo mode; the piece's own tempo otherwise. */
let bpm = 90;
/** Pitches the score is waiting for, for the cue line. */
let expectedNow: number[] = [];
/** Consecutive correct notes, and the best run of them this take. */
let streak = 0;
let bestStreak = 0;
/** Wall-clock time until which a correction owns the cue line. */
let cueHeldUntil = 0;

const synth = new Synth();
const staff = new StaffView($<HTMLCanvasElement>("staff"));
const keyboard = new KeyboardView($("keyboard"), {
  onPress: (midi) => runner?.press(midi),
  onRelease: (midi) => runner?.release(midi),
});

// ---------------------------------------------------------------------------
// Static chrome
// ---------------------------------------------------------------------------
$("brandMark").innerHTML = BRAND_MARK;
$("settingsBtn").innerHTML = icon("settings");
$("back").innerHTML = icon("back", 22);
$("heroCta").innerHTML = icon("play", 22);
$("profileChevron").innerHTML = icon("chevron", 18);
$("streakIcon").innerHTML = icon("bolt", 14);
for (const el of document.querySelectorAll<HTMLElement>("[data-icon]")) {
  el.innerHTML = icon(el.dataset.icon ?? "", el.classList.contains("howto-icon") ? 19 : 17);
}
$("footNote").textContent =
  "Diez y siete piezas de dominio público, de la más fácil a la más difícil. " +
  "Empieza por «María tenía un corderito»: solo usa tres dedos.";

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------
function applyTheme(theme: "dark" | "light"): void {
  document.documentElement.dataset.theme = theme;
  $("themeBtn").innerHTML = icon(theme === "dark" ? "sun" : "moon");
  $("themeBtn").setAttribute("aria-label", theme === "dark" ? "Usar tema claro" : "Usar tema oscuro");
  // Keep the OS chrome (status bar, address bar) in step with the app.
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "dark" ? "#0a0d12" : "#f5f7fb");
}

applyTheme(prefs.theme);
$("themeBtn").addEventListener("click", () => {
  prefs = { ...prefs, theme: prefs.theme === "dark" ? "light" : "dark" };
  savePrefs(prefs);
  applyTheme(prefs.theme);
  // The canvas caches the palette, so re-read it once the variables have changed.
  staff.refreshTheme();
});

// ---------------------------------------------------------------------------
// Sheets
// ---------------------------------------------------------------------------
function openSheet(id: string): void {
  $(id).classList.remove("hidden");
}
function closeSheet(id: string): void {
  $(id).classList.add("hidden");
}

// Tapping the dimmed backdrop closes a sheet, as it would in a native app.
for (const id of ["setup", "settings", "achievements"]) {
  $(id).addEventListener("click", (e) => {
    if (e.target === $(id)) closeSheet(id);
  });
}

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------
function renderLibrary(): void {
  const progress = loadProgress();
  renderProfile();
  renderHero(progress);

  const list = $("songList");
  list.replaceChildren();

  ([1, 2, 3, 4, 5, 6] as Level[]).forEach((level) => {
    const songs = SONGS.filter((s) => s.level === level);
    if (songs.length === 0) return;
    const done = songs.filter((s) => starsFor(progress[s.id]) > 0).length;

    const section = document.createElement("section");
    section.className = "level";

    const head = document.createElement("div");
    head.className = "level-head";
    head.append(
      el("span", "level-chip", `Nivel ${level}`),
      el("h2", "", LEVEL_NAMES[level]),
      el("span", "level-count", `${done}/${songs.length}`),
    );

    const goal = el("p", "level-goal", LEVEL_GOALS[level]);

    const cards = document.createElement("div");
    cards.className = "cards";
    songs.forEach((s, i) => cards.append(songCard(s, i + 1, progress[s.id])));

    section.append(head, goal, cards);
    list.append(section);
  });
}

/** One library row. Built from elements, never from interpolated song text. */
function songCard(s: Song, indexInLevel: number, progress?: SongProgress): HTMLButtonElement {
  const stars = starsFor(progress);
  const card = document.createElement("button");
  card.type = "button";
  card.className = "card" + (stars > 0 ? " done" : "");

  const body = document.createElement("span");
  body.className = "card-body";
  body.append(
    el("span", "card-title", s.title),
    el("span", "card-meta", `${s.composer} · ${s.beats}/${s.beatType} · ${s.bpm} ppm`),
  );

  const rating = document.createElement("span");
  rating.className = "card-stars";
  rating.setAttribute("aria-label", `${stars} de 3 estrellas`);
  for (let i = 0; i < 3; i++) {
    const star = document.createElement("span");
    star.className = i < stars ? "" : "off";
    star.innerHTML = icon("star", 13);
    rating.append(star);
  }

  const chevron = el("span", "card-chevron", "");
  chevron.innerHTML = icon("chevron", 16);

  card.append(el("span", "card-index", String(indexInLevel)), body, rating, chevron);
  card.addEventListener("click", () => openSetup(s));
  return card;
}

/** "1 nota tocada" / "26 notas tocadas" — Spanish copy needs the agreement. */
function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

function el(tag: string, className: string, text: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

/** Level, experience bar and a nudge toward the next achievement. */
function renderProfile(): void {
  const stats = loadStats();
  const state = levelFor(stats.xp);
  $("profileLevel").textContent = String(state.level);
  $("profileTitle").textContent = state.title;
  $("profileXp").textContent = `${state.into} / ${state.need} XP`;
  $<HTMLElement>("profileBar").style.width = `${(state.into / state.need) * 100}%`;

  const unlocked = unlockedIds(stats).length;
  const next = nextAchievement(stats);
  const count = `${unlocked}/${ACHIEVEMENTS.length} logros`;
  $("profileMeta").textContent = next
    ? `${count} · siguiente: ${next.title} (${Math.min(next.progress(stats), next.goal)}/${next.goal})`
    : `${count} · lo has conseguido todo`;
}

/** The closest unfinished achievement, so the hint is always achievable. */
function nextAchievement(stats: Stats): Achievement | undefined {
  return ACHIEVEMENTS.filter((a) => a.progress(stats) < a.goal).sort(
    (a, b) => achievementRatio(b, stats) - achievementRatio(a, stats),
  )[0];
}

/** "Continue" card for the most recently played piece. */
function renderHero(progress: Record<string, SongProgress>): void {
  const hero = $<HTMLButtonElement>("hero");
  const lastId = Object.entries(progress).sort((a, b) => b[1].lastPlayed - a[1].lastPlayed)[0]?.[0];
  const last = SONGS.find((s) => s.id === lastId);
  if (!last) {
    hero.classList.add("hidden");
    return;
  }
  hero.classList.remove("hidden");
  $("heroTitle").textContent = last.title;
  $("heroSub").textContent = `${last.composer} · ${HAND_LABEL[prefs.hand]}`;
  // Assigned, not added: renderLibrary runs on every return to this screen, and
  // addEventListener would stack one handler per visit.
  hero.onclick = () => openSetup(last);
}

// ---------------------------------------------------------------------------
// Achievements sheet
// ---------------------------------------------------------------------------
function renderAchievements(): void {
  const stats = loadStats();
  const unlocked = unlockedIds(stats);
  $("achHeadline").textContent =
    `${unlocked.length} de ${ACHIEVEMENTS.length} conseguidos · ` +
    plural(stats.notes, "nota tocada", "notas tocadas") + " · " +
    plural(stats.songs.length, "pieza terminada", "piezas terminadas");

  const list = $("achList");
  list.replaceChildren();
  const order = [...ACHIEVEMENTS].sort(
    (a, b) => achievementRatio(b, stats) - achievementRatio(a, stats),
  );
  for (const a of order) {
    const value = a.progress(stats);
    const done = value >= a.goal;
    const row = document.createElement("div");
    row.className = "ach" + (done ? " done" : "");

    const iconBox = el("span", "ach-icon", "");
    iconBox.innerHTML = icon(done ? "check" : a.icon, 18);

    const body = document.createElement("span");
    body.className = "ach-body";
    body.append(el("b", "", a.title), el("small", "", a.description));
    if (!done) {
      const track = el("span", "ach-track", "");
      const fill = document.createElement("i");
      fill.style.width = `${achievementRatio(a, stats) * 100}%`;
      track.append(fill);
      body.append(track);
    }

    row.append(iconBox, body, el("span", "ach-count", `${Math.min(value, a.goal)}/${a.goal}`));
    list.append(row);
  }
}

$("profile").addEventListener("click", () => {
  renderAchievements();
  openSheet("achievements");
});
$("achDone").addEventListener("click", () => closeSheet("achievements"));

/** Slide-in notification for a freshly unlocked achievement. */
function toastAchievement(a: Achievement): void {
  const host = $("toasts");
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
  host.append(toast);
  // Belt and braces: if animations are disabled, nothing would fire animationend.
  window.setTimeout(() => toast.remove(), 6000);
}

// ---------------------------------------------------------------------------
// Settings sheet
// ---------------------------------------------------------------------------
const OPTIONS: Array<[string, keyof Prefs]> = [
  ["optNames", "showNames"],
  ["optCountIn", "countIn"],
  ["optHaptics", "haptics"],
];

function syncSettings(): void {
  for (const [id, key] of OPTIONS) $<HTMLInputElement>(id).checked = Boolean(prefs[key]);
  $("aboutLine").textContent =
    "Arpeggio Learn · sin cuenta, sin servidor y sin analítica: tu progreso vive solo en este dispositivo.";
}

for (const [id, key] of OPTIONS) {
  $(id).addEventListener("change", (e) => {
    prefs = { ...prefs, [key]: (e.target as HTMLInputElement).checked };
    savePrefs(prefs);
    if (key === "showNames") {
      staff.setShowNames(prefs.showNames);
      keyboard.setNames(prefs.showNames);
      syncNamesButton();
    }
  });
}

$("settingsBtn").addEventListener("click", () => {
  syncSettings();
  openSheet("settings");
});
$("settingsDone").addEventListener("click", () => closeSheet("settings"));
$("resetProgress").addEventListener("click", () => {
  // Two taps, not a confirm() dialog: a native modal blocks the audio context
  // and cannot be styled, and this is recoverable in one practice session.
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
  renderLibrary();
});

// ---------------------------------------------------------------------------
// First-run explainer
// ---------------------------------------------------------------------------
if (!prefs.introSeen) $("intro").classList.remove("hidden");
$("introDone").addEventListener("click", () => {
  prefs = { ...prefs, introSeen: true };
  savePrefs(prefs);
  $("intro").classList.add("hidden");
});

// ---------------------------------------------------------------------------
// Setup sheet
// ---------------------------------------------------------------------------
function openSetup(s: Song): void {
  song = s;
  bpm = s.bpm;
  $("setupTitle").textContent = s.title;
  $("setupTip").textContent = s.tip;
  $<HTMLInputElement>("tempo").value = String(bpm);
  $("bpmOut").textContent = String(bpm);

  // A piece with no left-hand part can only be practised with the right hand.
  const hasLeft = Boolean(s.left);
  for (const b of document.querySelectorAll<HTMLButtonElement>("#handSel button")) {
    b.disabled = !hasLeft && b.dataset.hand !== "right";
  }
  $("handHint").classList.toggle("hidden", hasLeft);

  setSegment("modeSel", "mode", prefs.mode);
  setSegment("handSel", "hand", effectiveHand());
  $("modeHelp").textContent = MODE_HELP[prefs.mode];
  $("tempoField").classList.toggle("hidden", prefs.mode !== "demo");
  openSheet("setup");
}

/**
 * The hand actually used: the learner's preference, unless the piece has no
 * left-hand part. Kept separate from `prefs.hand` so choosing a melody-only
 * piece does not quietly rewrite the preference for every other piece.
 */
function effectiveHand(): HandChoice {
  return song?.left ? prefs.hand : "right";
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
    prefs = { ...prefs, mode: b.dataset.mode as PracticeMode };
    savePrefs(prefs);
    setSegment("modeSel", "mode", prefs.mode);
    $("modeHelp").textContent = MODE_HELP[prefs.mode];
    $("tempoField").classList.toggle("hidden", prefs.mode !== "demo");
  });
}

for (const b of document.querySelectorAll<HTMLButtonElement>("#handSel button")) {
  b.addEventListener("click", () => {
    if (b.disabled) return;
    prefs = { ...prefs, hand: b.dataset.hand as HandChoice };
    savePrefs(prefs);
    setSegment("handSel", "hand", prefs.hand);
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
async function startPractice(): Promise<void> {
  if (!song) return;
  closeSheet("setup");
  closeSheet("result");
  stopPractice();

  // Must happen inside the tap handler's task: iOS only unlocks audio from a
  // user gesture. Bounded wait, because a browser that has not unlocked audio
  // leaves `resume()` pending indefinitely and the screen must open regardless.
  await Promise.race([synth.resume(), delay(400)]);

  const hand = effectiveHand();
  const score = songToScore(song, hand);
  runner = new Runner(score, {
    mode: prefs.mode,
    synth,
    bpm,
    hooks: { onProgress, onJudge, onStatus, onFinish },
  });

  const notes: StaffNote[] = runner.notes.map((n, i) => ({
    index: i,
    midi: n.midi,
    onset: n.onset,
    offset: n.offset,
    hand: n.staff === 2 ? "left" : "right",
  }));
  const clefs: Clef[] =
    hand === "both" ? ["treble", "bass"] : hand === "left" ? ["bass"] : ["treble"];

  staff.setPiece(notes, {
    sharps: song.sharps,
    beatsPerBar: beatsPerBar(song),
    pickupBeats: song.pickupBeats ?? 0,
    clefs,
    showNames: prefs.showNames,
  });
  staff.start();

  const pitches = notes.map((n) => n.midi);
  keyboard.setRange(Math.min(...pitches), Math.max(...pitches), song.sharps);
  keyboard.setNames(prefs.showNames);
  keyboard.releaseAll();

  $("playTitle").textContent = song.title;
  $("playMeta").textContent =
    `${song.composer} · ${HAND_LABEL[hand]}` + (prefs.mode === "demo" ? ` · ${bpm} ppm` : "");
  setProgressBar(0);
  $("library").classList.add("hidden");
  $("play").classList.remove("hidden");
  // The keyboard was built while this screen was hidden, and therefore measured
  // zero wide; size the keys now that it is really on screen.
  keyboard.relayout();
  streak = 0;
  bestStreak = 0;
  showStreak(0);

  try {
    if (prefs.countIn) await countIn(prefs.mode === "demo" ? bpm : song.bpm);
    if (!runner) return; // the learner left during the count-in
    await runner.start();
  } catch (e) {
    // Almost always a denied microphone permission.
    setCueMessage((e as Error).message || "No se pudo iniciar", true);
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function setProgressBar(fraction: number): void {
  const pct = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
  $<HTMLElement>("progressBar").style.width = `${pct}%`;
  $("track").setAttribute("aria-valuenow", String(pct));
}

/** "3 · 2 · 1", one number per beat at the piece's tempo, with a click. */
async function countIn(tempo: number): Promise<void> {
  const el = $("countdown");
  const digit = el.querySelector("span");
  if (!digit) return;
  const beatMs = Math.min(900, Math.max(320, 60000 / tempo));
  el.classList.remove("hidden");
  for (const n of [3, 2, 1]) {
    digit.textContent = String(n);
    // Restart the pop animation on each number.
    digit.style.animation = "none";
    void digit.offsetWidth;
    digit.style.animation = "";
    synth.click(n === 3);
    await delay(beatMs);
    if ($("play").classList.contains("hidden")) break; // left the screen
  }
  el.classList.add("hidden");
}

/** Show the streak once it is worth celebrating, and pop it on every increment. */
function showStreak(count: number): void {
  const el = $("streak");
  if (count < 3) {
    el.classList.remove("on");
    return;
  }
  $("streakCount").textContent = String(count);
  el.classList.add("on");
  el.classList.remove("pop");
  void el.offsetWidth;
  el.classList.add("pop");
}

/** A short buzz for judged input, where the platform supports it. */
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
  expectedNow = p.expected;
  keyboard.setHighlight(p.expected);
  setProgressBar(p.total ? p.doneIndex / p.total : 0);
  if (prefs.mode !== "demo") renderCue();
}

/**
 * The cue line: which key to press, as note chips with their octave.
 *
 * A wrong note produces both an event and a progress update (the cursor stays
 * put), and the progress update would immediately overwrite the correction — so
 * a correction holds the line for a moment and then the prompt returns.
 */
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
  const sharps = song?.sharps ?? 0;
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

function onJudge(event: { kind: string; playedMidi?: number }): void {
  if (event.kind === "correct") {
    if (event.playedMidi !== undefined) keyboard.flash(event.playedMidi, true);
    // Sparks fire before the cursor advances, so they land on the note head the
    // learner was looking at.
    staff.celebrate();
    streak++;
    bestStreak = Math.max(bestStreak, streak);
    showStreak(streak);
    vibrate(8);
  } else if (event.kind === "wrong") {
    if (event.playedMidi !== undefined) keyboard.flash(event.playedMidi, false);
    staff.flashWrong();
    setCueMessage("Esa no… mira la tecla iluminada", true);
    cueHeldUntil = Date.now() + 1100;
    streak = 0;
    showStreak(0);
    vibrate(28);
  }
}

function onStatus(text: string): void {
  setCueMessage(text);
}

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------
function onFinish(summary: RunSummary): void {
  if (!song) return;
  const judged = prefs.mode !== "demo";
  const stars = judged ? starsFor(recordRun(song.id, summary)) : 0;

  staff.stop();
  keyboard.setHighlight([]);
  showStreak(0);

  const { before, after, xp } = applyRun({
    songId: song.id,
    mode: prefs.mode,
    hand: effectiveHand(),
    correct: summary.correct,
    wrong: summary.wrong,
    stars,
    completed: summary.completed,
    judged,
    streak: bestStreak,
  });

  renderStars(stars);
  $("resultTitle").textContent = judged
    ? stars === 3
      ? "¡Impecable!"
      : summary.completed
        ? "¡Pieza terminada!"
        : "Buen intento"
    : "Fin de la escucha";
  $("resultLine").textContent = judged
    ? "Repite para subir la puntuación, o pasa a la siguiente."
    : "Ahora inténtalo tú: vuelve y elige «En la pantalla».";

  renderResultStats(judged, summary);
  renderXp(judged, xp, after);
  renderAdvice(judged, summary);
  renderResultActions(stars, judged);

  openSheet("result");
  if (stars === 3) confetti($("result").querySelector<HTMLElement>(".sheet-card")!);

  // Achievements are diffed from the two stats snapshots, so a retuned goal is
  // awarded correctly rather than depending on a stored list. Staggered, because
  // one run can unlock several at once and three toasts at the same instant read
  // as one.
  newlyUnlocked(before, after).forEach((a, i) =>
    window.setTimeout(() => toastAchievement(a), 450 + i * 700),
  );
}

function renderStars(stars: number): void {
  const host = $("stars");
  host.replaceChildren();
  for (let i = 0; i < 3; i++) {
    const star = document.createElement("span");
    star.className = i < stars ? "won" : "off";
    star.innerHTML = icon("star", 30);
    host.append(star);
  }
}

function renderResultStats(judged: boolean, summary: RunSummary): void {
  const stats = $("resultStats");
  stats.replaceChildren();
  if (!judged) return;
  const cells: Array<[string, string]> = [
    ["Notas", String(summary.correct)],
    ["Acierto", `${Math.round(summary.accuracy * 100)}%`],
    ["Racha", String(bestStreak)],
  ];
  for (const [label, value] of cells) {
    const cell = document.createElement("div");
    cell.append(el("dd", "", value), el("dt", "", label));
    stats.append(cell);
  }
}

/** XP earned, with the level bar animating from where it was to where it is. */
function renderXp(judged: boolean, xp: number, after: Stats): void {
  const row = $("resultXp");
  row.classList.toggle("hidden", !judged || xp === 0);
  if (!judged || xp === 0) return;
  const state = levelFor(after.xp);
  $("resultXpText").textContent = `+${xp} XP`;
  $("resultLevelText").textContent = `Nivel ${state.level} · ${state.into}/${state.need}`;
  const bar = $<HTMLElement>("resultXpBar");
  bar.style.transition = "none";
  bar.style.width = "0%";
  void bar.offsetWidth;
  bar.style.transition = "";
  window.setTimeout(() => {
    bar.style.width = `${(state.into / state.need) * 100}%`;
  }, 260);
}

/** Concrete next step, from the follower's own view of the weak measures. */
function renderAdvice(judged: boolean, summary: RunSummary): void {
  const advice = $("resultAdvice");
  const measures = runner?.weakestMeasures(3) ?? [];
  if (!judged || summary.accuracy >= 0.98 || measures.length === 0) {
    advice.classList.add("hidden");
    return;
  }
  advice.classList.remove("hidden");
  advice.textContent =
    measures.length === 1
      ? `Repasa el compás ${measures[0]} antes de volver a tocarla entera.`
      : `Repasa los compases ${measures.join(", ")} antes de volver a tocarla entera.`;
}

/**
 * The primary action follows the outcome: after a clean run the obvious next
 * move is the next piece, and after a shaky one it is another attempt.
 */
function renderResultActions(stars: number, judged: boolean): void {
  const host = $("resultActions");
  host.replaceChildren();
  const next = nextSong();
  const advance = judged && stars === 3 && next !== null;

  const again = document.createElement("button");
  again.className = advance ? "btn btn-outline" : "btn btn-primary";
  again.textContent = judged ? "Otra vez" : "Escuchar otra vez";
  again.addEventListener("click", () => void startPractice());

  host.append(advance ? nextButton(next!, "btn btn-primary") : again);
  if (advance) host.append(again);
  else if (next) host.append(nextButton(next, "btn btn-outline"));

  const back = document.createElement("button");
  back.className = "btn btn-quiet";
  back.textContent = "Volver a la biblioteca";
  back.addEventListener("click", toLibrary);
  host.append(back);
}

function nextButton(target: Song, className: string): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = className;
  btn.textContent = "Siguiente pieza";
  btn.addEventListener("click", () => {
    closeSheet("result");
    stopPractice();
    $("play").classList.add("hidden");
    $("library").classList.remove("hidden");
    renderLibrary();
    openSetup(target);
  });
  return btn;
}

function nextSong(): Song | null {
  const i = song ? SONGS.indexOf(song) : -1;
  return i >= 0 && i + 1 < SONGS.length ? SONGS[i + 1] : null;
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
  synth.allOff();
}

function toLibrary(): void {
  stopPractice();
  closeSheet("result");
  $("play").classList.add("hidden");
  $("library").classList.remove("hidden");
  renderLibrary();
}

$("back").addEventListener("click", toLibrary);

function syncNamesButton(): void {
  const btn = $("namesBtn");
  btn.setAttribute("aria-pressed", String(prefs.showNames));
  btn.textContent = "DO";
}

$("namesBtn").addEventListener("click", () => {
  prefs = { ...prefs, showNames: !prefs.showNames };
  savePrefs(prefs);
  syncNamesButton();
  staff.setShowNames(prefs.showNames);
  keyboard.setNames(prefs.showNames);
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
syncNamesButton();
keyboard.setNames(prefs.showNames);
renderLibrary();

// Offline support and "add to home screen". A failure here is harmless (no
// service workers, or an insecure context), so it must not break boot.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker
      .register(new URL("sw.js", document.baseURI).href, { scope: "./" })
      .catch(() => undefined);
  });
}
