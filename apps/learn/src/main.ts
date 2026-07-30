/**
 * App shell for Arpeggio Learn.
 *
 *   library  -> level, achievements, the curriculum, imported scores
 *   setup    -> input, judging, hands, tempo
 *   play     -> animated notation (scrolling or paged) + keyboard or music stand
 *   result   -> stars, XP, timing, what to work on next
 *
 * The shell owns the DOM and the screen state machine. Everything musical lives
 * in `runner.ts` (judging), `staff.ts` (notation) and `keyboard.ts` (input);
 * everything countable in `gamification.ts`; and the two things that have to be
 * right for a real piano — staying awake and hearing the instrument — in
 * `wakeLock.ts` and `micCheck.ts`.
 */
import { LEVEL_GOALS, LEVEL_NAMES, SONGS, type HandChoice, type Level } from "@arpeggio/song-library";
import type { Score } from "@arpeggio/musicxml-parser";

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
import { latencyVerdict } from "./latency.js";
import { KeyboardView, MIN_KEY_WIDTH, whiteKeysNeeded } from "./keyboard.js";
import { MicCheck, levelVerdict } from "./micCheck.js";
import {
  addImported,
  loadImported,
  pieceFromMusicXML,
  pieceFromSong,
  removeImported,
  type Piece,
} from "./pieces.js";
import { Runner, type PracticeMode, type RunSummary } from "./runner.js";
import { planSession, type SessionStep } from "./session.js";
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
import { ScreenAwake } from "./wakeLock.js";

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

const JUDGE_HELP = {
  wait: "El cursor te espera en cada nota. Perdona el ritmo: ideal para leer la pieza por primera vez.",
  tempo: "El cursor sigue al tempo y corrige si llegas tarde o pronto. Es el modo honesto con el ritmo.",
};

const HAND_LABEL: Record<HandChoice, string> = {
  right: "mano derecha",
  left: "mano izquierda",
  both: "las dos manos",
};

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

const synth = new Synth();
const awake = new ScreenAwake();
const micCheck = new MicCheck();
const staff = new StaffView($<HTMLCanvasElement>("staff"));
const keyboard = new KeyboardView($("keyboard"), {
  onPress: (midi) => runner?.press(midi),
  onRelease: (midi) => runner?.release(midi),
});

/** Absolute URLs so the app also works from a GitHub Pages sub-path. */
const MODEL_URL = new URL("models/basic-pitch/model.json", document.baseURI).href;
const WORKER_URL = new URL("polyWorker.js", document.baseURI).href;

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
for (const el of document.querySelectorAll<HTMLElement>("[data-icon]")) {
  const size = el.classList.contains("howto-icon") ? 19 : el.closest(".standbtn") ? 21 : 17;
  el.innerHTML = icon(el.dataset.icon ?? "", size);
}
$("footNote").textContent =
  "Diecisiete piezas de dominio público, de la más fácil a la más difícil. " +
  "Empieza por «María tenía un corderito»: solo usa tres dedos, y lleva la digitación escrita.";

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------
function applyTheme(theme: "dark" | "light"): void {
  document.documentElement.dataset.theme = theme;
  $("themeBtn").innerHTML = icon(theme === "dark" ? "sun" : "moon");
  $("themeBtn").setAttribute("aria-label", theme === "dark" ? "Usar tema claro" : "Usar tema oscuro");
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", theme === "dark" ? "#0a0d12" : "#f5f7fb");
}

applyTheme(prefs.theme);
$("themeBtn").addEventListener("click", () => {
  prefs = { ...prefs, theme: prefs.theme === "dark" ? "light" : "dark" };
  savePrefs(prefs);
  applyTheme(prefs.theme);
  staff.refreshTheme();
});

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
  $("standBar").classList.toggle("hidden", !prefs.stand);
  staff.setMaxSpace(prefs.stand ? STAND_STAFF_SPACE : HAND_STAFF_SPACE);
  updateRotateHint();
}

function updateRotateHint(): void {
  const playing = !$("play").classList.contains("hidden");
  const show = playing && prefs.stand && window.matchMedia("(orientation: portrait)").matches;
  $("rotateHint").classList.toggle("hidden", !show);
}
window.addEventListener("orientationchange", updateRotateHint);
window.addEventListener("resize", updateRotateHint);

$("standBtn").addEventListener("click", () => {
  prefs = { ...prefs, stand: !prefs.stand };
  savePrefs(prefs);
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
  $("keyboard").classList.toggle("hidden", hide);
  if (!hide) keyboard.relayout();
}

// ---------------------------------------------------------------------------
// Sheets
// ---------------------------------------------------------------------------
function openSheet(id: string): void {
  $(id).classList.remove("hidden");
}
function closeSheet(id: string): void {
  $(id).classList.add("hidden");
}
for (const id of ["setup", "settings", "achievements", "miccheck", "session"]) {
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
    const cards = document.createElement("div");
    cards.className = "cards";
    songs.forEach((s, i) =>
      cards.append(pieceCard(pieceFromSong(s), String(i + 1), progress[s.id])),
    );
    section.append(head, el("p", "level-goal", LEVEL_GOALS[level]), cards);
    list.append(section);
  });

  renderImported(progress, list);
}

/** "Mis partituras": whatever the learner brought in as MusicXML. */
function renderImported(progress: Record<string, SongProgress>, list: HTMLElement): void {
  const records = loadImported();
  if (records.length === 0) return;
  const section = document.createElement("section");
  section.className = "level";
  const head = document.createElement("div");
  head.className = "level-head";
  head.append(
    el("span", "level-chip", "Tuyas"),
    el("h2", "", "Mis partituras"),
    el("span", "level-count", String(records.length)),
  );
  const cards = document.createElement("div");
  cards.className = "cards";
  for (const record of records) {
    let imported: Piece;
    try {
      imported = pieceFromMusicXML(record.id, record.name, record.xml);
    } catch {
      // A stored file that no longer parses must not take the library down.
      continue;
    }
    const card = pieceCard(imported, "★", progress[record.id]);
    card.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      removeImported(record.id);
      renderLibrary();
    });
    cards.append(card);
  }
  section.append(head, el("p", "level-goal", "Mantén pulsado con el botón derecho para quitar una."), cards);
  list.append(section);
}

function pieceCard(p: Piece, badge: string, progress?: SongProgress): HTMLButtonElement {
  const stars = starsFor(progress);
  const card = document.createElement("button");
  card.type = "button";
  card.className = "card" + (stars > 0 ? " done" : "");

  const body = document.createElement("span");
  body.className = "card-body";
  body.append(
    el("span", "card-title", p.title),
    el("span", "card-meta", `${p.composer} · ${p.bpm} ppm`),
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

  card.append(el("span", "card-index", badge), body, rating, chevron);
  card.addEventListener("click", () => openSetup(p));
  return card;
}

function el(tag: string, className: string, text: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

/** "1 nota tocada" / "26 notas tocadas" — Spanish copy needs the agreement. */
function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

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

function nextAchievement(stats: Stats): Achievement | undefined {
  return ACHIEVEMENTS.filter((a) => a.progress(stats) < a.goal).sort(
    (a, b) => achievementRatio(b, stats) - achievementRatio(a, stats),
  )[0];
}

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
  // Assigned, not added: renderLibrary runs on every return to this screen.
  hero.onclick = () => openSetup(pieceFromSong(last));
}

// ---------------------------------------------------------------------------
// Achievements
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

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
const OPTIONS: Array<[string, keyof Prefs]> = [
  ["optNames", "showNames"],
  ["optCountIn", "countIn"],
  ["optHaptics", "haptics"],
  ["optMetronome", "metronome"],
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
    prefs = { ...prefs, [key]: (e.target as HTMLInputElement).checked };
    savePrefs(prefs);
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
  renderLibrary();
});

// ---------------------------------------------------------------------------
// First run
// ---------------------------------------------------------------------------
if (!prefs.introSeen) $("intro").classList.remove("hidden");
$("introDone").addEventListener("click", () => {
  prefs = { ...prefs, introSeen: true };
  savePrefs(prefs);
  $("intro").classList.add("hidden");
});

// ---------------------------------------------------------------------------
// Microphone check
// ---------------------------------------------------------------------------
/** Pitch class the verification asks for: DO, the note every beginner can find. */
const CHECK_PITCH_CLASS = 0;
let micHeardTarget = false;

function openMicCheck(): void {
  micHeardTarget = false;
  $("micVerdict").textContent = "Pulsa «Escuchar» y toca cualquier tecla.";
  $("micPitch").textContent = "—";
  $("micFloor").textContent = "—";
  $("micTask").classList.add("hidden");
  const stats = runner?.latency;
  $("micLatency").textContent =
    stats && stats.samples > 0 ? `${stats.p50} ms` : "—";
  openSheet("miccheck");
}

$("micCheckBtn").addEventListener("click", () => {
  closeSheet("settings");
  openMicCheck();
});

$("micStart").addEventListener("click", () => {
  void (async () => {
    try {
      $("micTask").classList.remove("hidden");
      $("micTask").textContent = "Toca un DO para confirmar que te oigo bien.";
      await micCheck.start((reading) => {
        const pct = Math.min(100, Math.round(reading.rms * 260));
        const bar = $<HTMLElement>("micLevel");
        bar.style.width = `${pct}%`;
        const verdict = levelVerdict(reading.rms);
        bar.classList.toggle("hot", verdict === "clipping" || verdict === "loud");
        bar.classList.toggle("low", verdict === "quiet");
        $("micVerdict").textContent = MIC_VERDICT[verdict];
        if (reading.midi !== null && reading.confidence > 0.6) {
          $("micPitch").textContent = `${noteName(reading.midi, 0)}${octaveOf(reading.midi)}`;
          if (!micHeardTarget && reading.midi % 12 === CHECK_PITCH_CLASS) {
            micHeardTarget = true;
            $("micTask").textContent = "Perfecto: te oigo bien. Ya puedes practicar con el piano.";
            $("micTask").classList.remove("warn");
          }
        }
      });
    } catch (err) {
      $("micVerdict").textContent = (err as Error).message || "No se pudo abrir el micrófono";
    }
  })();
});

const MIC_VERDICT: Record<ReturnType<typeof levelVerdict>, string> = {
  silence: "No oigo nada. ¿Está el micrófono tapado?",
  quiet: "Te oigo muy bajito: acerca el móvil al piano.",
  good: "Nivel perfecto.",
  loud: "Un poco fuerte: aleja el móvil un palmo.",
  clipping: "Demasiado fuerte, se satura. Aleja el móvil.",
};

$("micFloorBtn").addEventListener("click", () => {
  void (async () => {
    $("micTask").classList.remove("hidden");
    $("micTask").textContent = "No toques nada durante dos segundos…";
    micCheck.resetPeak();
    await delay(2000);
    const floor = micCheck.meanRms;
    $("micFloor").textContent = floor.toFixed(3);
    $("micTask").textContent =
      floor > 0.02
        ? "La sala es ruidosa: acerca el móvil al piano o busca un sitio más silencioso."
        : "Sala silenciosa. Perfecto para practicar.";
  })();
});

$("micDone").addEventListener("click", () => {
  micCheck.stop();
  closeSheet("miccheck");
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
  $<HTMLInputElement>("tempo").value = String(bpm);
  $("bpmOut").textContent = String(bpm);

  for (const b of document.querySelectorAll<HTMLButtonElement>("#handSel button")) {
    b.disabled = !p.hasLeft && b.dataset.hand !== "right";
  }
  $("handHint").classList.toggle("hidden", p.hasLeft);

  setSegment("modeSel", "mode", prefs.mode);
  setSegment("judgeSel", "judge", prefs.aTempo ? "tempo" : "wait");
  setSegment("handSel", "hand", effectiveHand());
  $("modeHelp").textContent = MODE_HELP[prefs.mode];
  $("judgeHelp").textContent = prefs.aTempo ? JUDGE_HELP.tempo : JUDGE_HELP.wait;
  // The tempo matters whenever a clock is involved: demo playback, the
  // metronome, or a-tempo grading.
  $("tempoField").classList.toggle(
    "hidden",
    !(prefs.mode === "demo" || prefs.aTempo || prefs.metronome),
  );
  updateFitHint();
  openSheet("setup");
}

function effectiveHand(): HandChoice {
  return piece?.hasLeft ? prefs.hand : "right";
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
    prefs = { ...prefs, mode: b.dataset.mode as PracticeMode };
    savePrefs(prefs);
    setSegment("modeSel", "mode", prefs.mode);
    $("modeHelp").textContent = MODE_HELP[prefs.mode];
    $("tempoField").classList.toggle(
      "hidden",
      !(prefs.mode === "demo" || prefs.aTempo || prefs.metronome),
    );
    updateFitHint();
  });
}

for (const b of document.querySelectorAll<HTMLButtonElement>("#judgeSel button")) {
  b.addEventListener("click", () => {
    prefs = { ...prefs, aTempo: b.dataset.judge === "tempo" };
    savePrefs(prefs);
    setSegment("judgeSel", "judge", prefs.aTempo ? "tempo" : "wait");
    $("judgeHelp").textContent = prefs.aTempo ? JUDGE_HELP.tempo : JUDGE_HELP.wait;
    $("tempoField").classList.toggle(
      "hidden",
      !(prefs.mode === "demo" || prefs.aTempo || prefs.metronome),
    );
  });
}

for (const b of document.querySelectorAll<HTMLButtonElement>("#handSel button")) {
  b.addEventListener("click", () => {
    if (b.disabled) return;
    prefs = { ...prefs, hand: b.dataset.hand as HandChoice };
    savePrefs(prefs);
    setSegment("handSel", "hand", prefs.hand);
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

async function startPractice(): Promise<void> {
  if (!piece) return;
  closeSheet("setup");
  closeSheet("result");
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
    modelUrl: MODEL_URL,
    workerUrl: WORKER_URL,
    hooks: { onProgress, onJudge, onStatus, onFinish },
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
  $("playMeta").textContent =
    `${piece.composer} · ${HAND_LABEL[hand]}` +
    (prefs.aTempo || prefs.mode === "demo" ? ` · ${bpm} ppm` : "") +
    (loopBars ? ` · bucle ${loopBars.from}–${loopBars.to}` : "");
  setProgressBar(0);
  $("library").classList.add("hidden");
  $("play").classList.remove("hidden");
  applyStand();
  syncKeyboardVisibility();
  keyboard.relayout();
  $("standLoop").setAttribute("aria-pressed", String(loopBars !== null));
  // Hands on the keys means nothing will tap the screen for twenty minutes.
  void awake.acquire();
  streak = 0;
  bestStreak = 0;
  showStreak(0);

  try {
    if (prefs.countIn) await countIn(bpm);
    if (!runner) return; // the learner left during the count-in
    await runner.start();
  } catch (e) {
    setCueMessage((e as Error).message || "No se pudo iniciar", true);
  }
}

/** Fingering for a note, looked up on the score that produced it. */
function fingerAt(score: Score, onset: number, midi: number): number | undefined {
  return score.events.find(
    (e) => e.pitchMidi === midi && Math.abs(e.onset - onset) < 1e-6,
  )?.finger;
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
  const el = $("countdown");
  const digit = el.querySelector("span");
  if (!digit) return;
  const beatMs = Math.min(900, Math.max(320, 60000 / tempo));
  el.classList.remove("hidden");
  for (const n of [3, 2, 1]) {
    digit.textContent = String(n);
    digit.style.animation = "none";
    void digit.offsetWidth;
    digit.style.animation = "";
    synth.click(n === 3);
    await delay(beatMs);
    if ($("play").classList.contains("hidden")) break;
  }
  el.classList.add("hidden");
}

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
  currentMeasure = p.measure;
  expectedNow = p.expected;
  keyboard.setHighlight(p.expected);
  setProgressBar(p.total ? p.doneIndex / p.total : 0);
  if (prefs.mode !== "demo") renderCue();
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
  setCueMessage(wrongNoteMessage(event), true);
  cueHeldUntil = Date.now() + 1200;
  streak = 0;
  showStreak(0);
  vibrate(28);
}

/**
 * What to say about a wrong note. Three genuinely different situations, and one
 * message for all of them would be wrong in two of them:
 *
 *  - nothing was played and the deadline passed (a-tempo miss);
 *  - the right note in the wrong octave, which is a misplaced hand;
 *  - a wrong note — and only then is "look at the lit key" useful, and only when
 *    there is a keyboard on screen to look at.
 */
function wrongNoteMessage(event: { playedMidi?: number; octaveOff?: number }): string {
  if (event.playedMidi === undefined) return "Se te ha pasado esa nota";
  if (event.octaveOff !== undefined) {
    const octaves = Math.abs(event.octaveOff);
    const where = event.octaveOff < 0 ? "más abajo" : "más arriba";
    return `Nota correcta, pero ${plural(octaves, "una octava", "octavas")} ${where}`;
  }
  const hasKeyboard = !$("keyboard").classList.contains("hidden");
  return hasKeyboard ? "Esa no… mira la tecla iluminada" : "Esa no era";
}

function onStatus(text: string): void {
  setCueMessage(text);
}

// --- loop ------------------------------------------------------------------
/**
 * Toggle a drill on the bars the student model rates weakest. A loop is run as a
 * piece in its own right — the score is restricted to those bars — which keeps the
 * follower, the staff and the progress bar honest with no special cases.
 */
$("standLoop").addEventListener("click", () => {
  if (loopBars) {
    loopBars = null;
  } else {
    const weak = runner?.weakestMeasures(3) ?? [];
    const measure = weak.length > 0 ? weak : [currentMeasure];
    loopBars = { from: Math.min(...measure), to: Math.max(...measure) };
  }
  $("standLoop").setAttribute("aria-pressed", String(loopBars !== null));
  void startPractice();
});

// ---------------------------------------------------------------------------
// Result
// ---------------------------------------------------------------------------
function onFinish(summary: RunSummary): void {
  if (!piece) return;
  const judged = prefs.mode !== "demo";
  const stars = judged ? starsFor(recordRun(piece.id, summary)) : 0;

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
    ? loopBars
      ? `Bucle de los compases ${loopBars.from}–${loopBars.to}.`
      : "Repite para subir la puntuación, o pasa a la siguiente."
    : "Ahora inténtalo tú: vuelve y elige «En la pantalla».";

  renderResultStats(judged, summary);
  renderXp(judged, xp, after);
  renderAdvice(judged, summary);
  renderResultActions(stars, judged, summary);

  openSheet("result");
  if (stars === 3) confetti($("result").querySelector<HTMLElement>(".sheet-card")!);

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
  ];
  // Timing only means something when a clock was grading; in wait mode the
  // follower deliberately forgives it, so showing a figure would be a lie.
  if (summary.meanTimingErrorSec !== null) {
    cells.push(["Desfase", `${Math.round(summary.meanTimingErrorSec * 1000)} ms`]);
  } else {
    cells.push(["Racha", String(bestStreak)]);
  }
  const latency = runner?.latency;
  if (prefs.mode === "mic" && latency && latency.samples > 0) {
    cells.push(["Retardo", `${latency.p50} ms`]);
  }
  for (const [label, value] of cells) {
    const cell = document.createElement("div");
    cell.append(el("dd", "", value), el("dt", "", label));
    stats.append(cell);
  }
}

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

function renderAdvice(judged: boolean, summary: RunSummary): void {
  const advice = $("resultAdvice");
  const measures = runner?.weakestMeasures(3) ?? [];
  const latency = runner?.latency;
  // A microphone run that is visibly behind the hands is a setup problem, not a
  // playing problem, and saying "practise bar 5" would be blaming the learner.
  if (prefs.mode === "mic" && latency && latency.samples > 5 && latencyVerdict(latency.p50) === "bad") {
    advice.classList.remove("hidden");
    advice.textContent =
      `El cursor va ${latency.p50} ms por detrás de tus manos. Prueba con una sola mano ` +
      "o acerca el móvil al piano: así el sonido llega más limpio y la detección es más rápida.";
    return;
  }
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

function renderResultActions(stars: number, judged: boolean, summary: RunSummary): void {
  const host = $("resultActions");
  host.replaceChildren();

  // A guided session drives the order: its next step is the primary action.
  if (sessionStep >= 0 && sessionStep + 1 < sessionPlan.length) {
    host.append(button("btn btn-primary", "Siguiente paso de la sesión", () => runSessionStep(sessionStep + 1)));
  }

  const clean = judged && summary.completed && summary.accuracy >= 0.95;
  // Tempo ramp: the mechanic that actually builds speed. Offered only after a
  // clean run, and only where a clock is involved — otherwise the number has no
  // effect on anything.
  if (clean && (prefs.aTempo || prefs.metronome || prefs.mode === "demo")) {
    const faster = Math.round(bpm * 1.1);
    host.append(
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
    host.append(
      button("btn btn-outline", `Practicar los compases ${from}–${to}`, () => {
        loopBars = { from, to };
        void startPractice();
      }),
    );
  }
  if (loopBars) {
    host.append(
      button("btn btn-outline", "Tocarla entera", () => {
        loopBars = null;
        void startPractice();
      }),
    );
  }

  const next = nextPiece();
  const advance = judged && stars === 3 && next !== null && sessionStep < 0;
  const again = button(
    advance || host.children.length > 0 ? "btn btn-outline" : "btn btn-primary",
    judged ? "Otra vez" : "Escuchar otra vez",
    () => void startPractice(),
  );
  if (advance) {
    host.prepend(button("btn btn-primary", "Siguiente pieza", () => openNext(next!)));
    host.append(again);
  } else {
    host.append(again);
    if (next) host.append(button("btn btn-outline", "Siguiente pieza", () => openNext(next)));
  }
  host.append(button("btn btn-quiet", "Volver a la biblioteca", toLibrary));
}

function button(className: string, label: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.className = className;
  btn.textContent = label;
  btn.addEventListener("click", onClick);
  return btn;
}

function openNext(target: Piece): void {
  closeSheet("result");
  stopPractice();
  $("play").classList.add("hidden");
  $("library").classList.remove("hidden");
  renderLibrary();
  openSetup(target);
}

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

  const list = $("sessionList");
  list.replaceChildren();
  sessionPlan.forEach((step, i) => {
    const row = document.createElement("div");
    row.className = "ach";
    row.append(
      el("span", "card-index", String(i + 1)),
      (() => {
        const body = document.createElement("span");
        body.className = "ach-body";
        body.append(el("b", "", step.title), el("small", "", step.detail));
        return body;
      })(),
    );
    list.append(row);
  });
  openSheet("session");
});

$("sessionStart").addEventListener("click", () => runSessionStep(0));
$("sessionCancel").addEventListener("click", () => {
  sessionPlan = [];
  sessionStep = -1;
  closeSheet("session");
});

function runSessionStep(index: number): void {
  closeSheet("session");
  closeSheet("result");
  const step = sessionPlan[index];
  if (!step) {
    sessionStep = -1;
    toLibrary();
    return;
  }
  sessionStep = index;
  openSetup(pieceFromSong(step.song), step.loop);
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
      if (/\.mxl$/i.test(file.name)) {
        // .mxl is a zip; unzipping it would mean shipping an archive library for
        // a case the learner can avoid by exporting uncompressed MusicXML.
        throw new Error("Exporta la partitura como .musicxml sin comprimir");
      }
      const xml = await file.text();
      addImported(file.name.replace(/\.[^.]+$/, ""), xml);
      renderLibrary();
      $("importBtn").querySelector("span")!.textContent = "Importada";
      window.setTimeout(() => {
        $("importBtn").querySelector("span")!.textContent = "Importar partitura";
      }, 2500);
    } catch (err) {
      $("importBtn").querySelector("span")!.textContent =
        (err as Error).message || "No se pudo leer";
      window.setTimeout(() => {
        $("importBtn").querySelector("span")!.textContent = "Importar partitura";
      }, 3500);
    }
  })();
});

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
  void awake.release();
  updateRotateHint();
  renderLibrary();
}

$("back").addEventListener("click", toLibrary);
$("standRestart").addEventListener("click", () => void startPractice());
$("standStop").addEventListener("click", toLibrary);

function syncNamesButton(): void {
  $("namesBtn").setAttribute("aria-pressed", String(prefs.showNames));
  $("namesBtn").textContent = "DO";
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
applyStand();
keyboard.setNames(prefs.showNames);
renderLibrary();

if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker
      .register(new URL("sw.js", document.baseURI).href, { scope: "./" })
      .catch(() => undefined);
  });
}
