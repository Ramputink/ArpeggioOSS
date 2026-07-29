/**
 * App shell for Arpeggio Learn.
 *
 *   library  -> pick a piece
 *   setup    -> how do you want to play it (screen keys / real piano / listen)
 *   play     -> animated staff + keyboard, driven by the Runner
 *   result   -> stars, then repeat / next / back
 *
 * The shell owns the DOM and the screen state machine; everything musical lives
 * in `runner.ts` (judging), `staff.ts` (notation) and `keyboard.ts` (input).
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
import { KeyboardView } from "./keyboard.js";
import { Runner, type PracticeMode, type RunSummary } from "./runner.js";
import { StaffView, noteName, type Clef, type StaffNote } from "./staff.js";
import { loadPrefs, loadProgress, recordRun, savePrefs, starsFor, type Prefs } from "./store.js";
import { Synth } from "./synth.js";

const $ = <T extends HTMLElement = HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el as T;
};

const MODE_HELP: Record<PracticeMode, string> = {
  keys: "Toca las teclas del móvil. No necesitas piano.",
  mic: "Escucha por el micrófono lo que tocas en un piano de verdad.",
  demo: "La app toca la canción para que la escuches y la sigas con la vista.",
};

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let prefs: Prefs = loadPrefs();
let song: Song | null = null;
let runner: Runner | null = null;
let bpm = 90;
/** Pitches the score is currently waiting for (for the status line). */
let expectedNow: number[] = [];

const synth = new Synth();
const staff = new StaffView($<HTMLCanvasElement>("staff"));
const keyboard = new KeyboardView($("keyboard"), {
  onPress: (midi) => runner?.press(midi),
  onRelease: (midi) => runner?.release(midi),
});

// ---------------------------------------------------------------------------
// Theme
// ---------------------------------------------------------------------------
function applyTheme(theme: "dark" | "light"): void {
  document.documentElement.dataset.theme = theme;
  $("themeBtn").textContent = theme === "dark" ? "◐" : "◑";
}
applyTheme(prefs.theme);
$("themeBtn").addEventListener("click", () => {
  prefs = { ...prefs, theme: prefs.theme === "dark" ? "light" : "dark" };
  savePrefs(prefs);
  applyTheme(prefs.theme);
  // The canvas caches the palette, so re-read it after the CSS variables change.
  staff.refreshTheme();
});

// ---------------------------------------------------------------------------
// Library
// ---------------------------------------------------------------------------
function renderLibrary(): void {
  const progress = loadProgress();
  const list = $("songList");
  list.replaceChildren();

  ([1, 2, 3, 4, 5, 6] as Level[]).forEach((level) => {
    const songs = SONGS.filter((s) => s.level === level);
    if (songs.length === 0) return;
    const group = document.createElement("section");
    group.className = "group";
    const h2 = document.createElement("h2");
    h2.textContent = LEVEL_NAMES[level];
    // State what the tier teaches, so the library reads as a path rather than
    // as a pile of songs.
    const goal = document.createElement("p");
    goal.className = "goal";
    goal.textContent = LEVEL_GOALS[level];
    const cards = document.createElement("div");
    cards.className = "cards";

    for (const s of songs) {
      const stars = starsFor(progress[s.id]);
      const card = document.createElement("button");
      card.type = "button";
      card.className = "card" + (stars > 0 ? " done" : "");
      card.innerHTML =
        `<span class="num">${SONGS.indexOf(s) + 1}</span>` +
        `<span class="txt"><b></b><span></span></span>` +
        `<span class="rating">${"★".repeat(stars)}<span class="off">${"★".repeat(3 - stars)}</span></span>`;
      // Titles come from data, so set them as text rather than through innerHTML.
      card.querySelector(".txt b")!.textContent = s.title;
      card.querySelector(".txt span")!.textContent = `${s.composer} · ${s.bpm} ppm`;
      card.addEventListener("click", () => openSetup(s));
      cards.append(card);
    }
    group.append(h2, goal, cards);
    list.append(group);
  });

  renderHero(progress);
}

/** "Continue" card: the last piece played, or a nudge to start the first one. */
function renderHero(progress: Record<string, { lastPlayed: number }>): void {
  const hero = $("hero");
  const lastId = Object.entries(progress).sort((a, b) => b[1].lastPlayed - a[1].lastPlayed)[0]?.[0];
  const last = SONGS.find((s) => s.id === lastId);
  if (!last) {
    hero.classList.add("hidden");
    return;
  }
  hero.classList.remove("hidden");
  hero.innerHTML = `<div class="kicker">Continuar</div><h3></h3><p class="sub"></p>`;
  hero.querySelector("h3")!.textContent = last.title;
  hero.querySelector("p")!.textContent = last.composer;
  hero.addEventListener("click", () => openSetup(last), { once: true });
}

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
  document.querySelectorAll<HTMLButtonElement>("#handSel button").forEach((b) => {
    const disabled = !hasLeft && b.dataset.hand !== "right";
    b.disabled = disabled;
    b.style.opacity = disabled ? "0.35" : "1";
  });
  if (!hasLeft) prefs = { ...prefs, hand: "right" };

  setSegment("modeSel", "mode", prefs.mode);
  setSegment("handSel", "hand", prefs.hand);
  $("modeHelp").textContent = MODE_HELP[prefs.mode];
  $("tempoField").classList.toggle("hidden", prefs.mode !== "demo");
  $("setup").classList.remove("hidden");
}

function setSegment(containerId: string, dataKey: string, value: string): void {
  document.querySelectorAll<HTMLButtonElement>(`#${containerId} button`).forEach((b) => {
    b.classList.toggle("on", b.dataset[dataKey] === value);
  });
}

document.querySelectorAll<HTMLButtonElement>("#modeSel button").forEach((b) =>
  b.addEventListener("click", () => {
    prefs = { ...prefs, mode: b.dataset.mode as PracticeMode };
    savePrefs(prefs);
    setSegment("modeSel", "mode", prefs.mode);
    $("modeHelp").textContent = MODE_HELP[prefs.mode];
    $("tempoField").classList.toggle("hidden", prefs.mode !== "demo");
  }),
);

document.querySelectorAll<HTMLButtonElement>("#handSel button").forEach((b) =>
  b.addEventListener("click", () => {
    if (b.disabled) return;
    prefs = { ...prefs, hand: b.dataset.hand as HandChoice };
    savePrefs(prefs);
    setSegment("handSel", "hand", prefs.hand);
  }),
);

const tempoInput = $<HTMLInputElement>("tempo");
tempoInput.addEventListener("input", () => {
  bpm = Number(tempoInput.value);
  $("bpmOut").textContent = String(bpm);
});

$("cancel").addEventListener("click", () => $("setup").classList.add("hidden"));
$("go").addEventListener("click", () => void startPractice());

// ---------------------------------------------------------------------------
// Play
// ---------------------------------------------------------------------------
async function startPractice(): Promise<void> {
  if (!song) return;
  $("setup").classList.add("hidden");
  $("result").classList.add("hidden");
  stopPractice();

  // Must happen inside the tap handler's task: iOS only unlocks audio from a
  // user gesture, and `await` before this point would lose that privilege.
  // Bounded wait: a browser that has not unlocked audio yet leaves `resume()`
  // pending indefinitely, and the practice screen must open regardless — the
  // context resumes on its own once the gesture is honoured.
  await Promise.race([synth.resume(), delay(400)]);

  const hand = prefs.hand;
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
    `${song.composer} · ${handLabel(hand)}` + (prefs.mode === "demo" ? ` · ${bpm} ppm` : "");
  $("progressBar").style.width = "0%";
  $("library").classList.add("hidden");
  $("play").classList.remove("hidden");
  // The keyboard was built while this screen was still hidden (and therefore
  // zero-width); now that it is on screen, size the keys to the real viewport.
  keyboard.relayout();
  streak = 0;
  showCombo(0);

  try {
    // Count in at the tempo of the piece: the learner feels the pulse before
    // the first note instead of guessing it.
    await countIn(prefs.mode === "demo" ? bpm : song.bpm);
    if (!runner) return; // the learner left during the count-in
    await runner.start();
  } catch (e) {
    // Almost always a denied microphone permission.
    onStatus((e as Error).message || "No se pudo iniciar");
    $("status").className = "status bad";
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

/** Consecutive correct notes, for the streak counter. */
let streak = 0;

/** "3 · 2 · 1", one number per beat at the piece's tempo, with a click. */
async function countIn(bpm: number): Promise<void> {
  const el = $("countdown");
  const digit = el.querySelector("span");
  if (!digit) return;
  const beatMs = Math.min(900, Math.max(320, 60000 / bpm));
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
function showCombo(count: number): void {
  const el = $("combo");
  if (count < 3) {
    el.classList.remove("on");
    el.textContent = "";
    return;
  }
  el.textContent = `${count} seguidas 🔥`;
  el.classList.add("on");
  el.classList.remove("pop");
  void el.offsetWidth;
  el.classList.add("pop");
}

function handLabel(hand: HandChoice): string {
  return hand === "both" ? "las dos manos" : hand === "left" ? "mano izquierda" : "mano derecha";
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
  $("progressBar").style.width = `${p.total ? (p.doneIndex / p.total) * 100 : 0}%`;
  if (prefs.mode !== "demo") setPrompt();
}

/**
 * Wall-clock time until which the "wrong note" message owns the status line.
 *
 * A wrong note produces an event AND a progress update (the cursor stays put),
 * and the progress update would immediately overwrite the correction with the
 * next "Toca RE" — so the message is held for a moment before prompting again.
 */
let promptHeldUntil = 0;

/** Tell the learner, in words, which key to press next. */
function setPrompt(): void {
  if (expectedNow.length === 0) return;
  const remaining = promptHeldUntil - Date.now();
  if (remaining > 0) {
    window.setTimeout(setPrompt, remaining + 20);
    return;
  }
  const names = expectedNow.map((m) => noteName(m, song?.sharps ?? 0));
  const el = $("status");
  el.textContent = names.length > 1 ? `Toca ${names.join(" + ")}` : `Toca ${names[0]}`;
  el.className = "status";
}

function onJudge(event: { kind: string; playedMidi?: number }): void {
  const el = $("status");
  if (event.kind === "correct") {
    if (event.playedMidi !== undefined) keyboard.flash(event.playedMidi, true);
    // Burst on the note that was under the playhead — this fires before the
    // cursor advances, so the sparks land where the learner was looking.
    staff.celebrate();
    showCombo(++streak);
  } else if (event.kind === "wrong") {
    if (event.playedMidi !== undefined) keyboard.flash(event.playedMidi, false);
    staff.flashWrong();
    el.textContent = "Esa no… mira la tecla iluminada";
    el.className = "status bad";
    promptHeldUntil = Date.now() + 1100;
    streak = 0;
    showCombo(0);
  }
}

function onStatus(text: string): void {
  const el = $("status");
  el.textContent = text;
  el.className = "status";
}

function onFinish(summary: RunSummary): void {
  if (!song) return;
  // Listening through the demo is not a performance, so it earns no stars.
  const stars = prefs.mode === "demo" ? 0 : starsFor(recordRun(song.id, summary));
  staff.stop();
  keyboard.setHighlight([]);
  showCombo(0);
  const won = Array.from({ length: stars }, () => `<span class="won">★</span>`).join("");
  $("stars").innerHTML = won + `<span class="off">${"★".repeat(3 - stars)}</span>`;
  $("resultTitle").textContent =
    prefs.mode === "demo" ? "Fin de la escucha" : stars === 3 ? "¡Perfecto!" : "¡Muy bien!";
  $("resultLine").textContent =
    prefs.mode === "demo"
      ? "Ahora inténtalo tú: vuelve y elige «En la pantalla»."
      : `${summary.correct} notas correctas · ${Math.round(summary.accuracy * 100)}% de acierto`;
  $("next").classList.toggle("hidden", nextSong() === null);
  $("result").classList.remove("hidden");
  if (stars === 3) confetti($("result").querySelector<HTMLElement>(".sheet-card")!);
}

function nextSong(): Song | null {
  const i = song ? SONGS.indexOf(song) : -1;
  return i >= 0 && i + 1 < SONGS.length ? SONGS[i + 1] : null;
}

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
  $("result").classList.add("hidden");
  $("play").classList.add("hidden");
  $("library").classList.remove("hidden");
  renderLibrary();
}

$("back").addEventListener("click", toLibrary);
$("toLibrary").addEventListener("click", toLibrary);
$("again").addEventListener("click", () => void startPractice());
$("next").addEventListener("click", () => {
  const n = nextSong();
  if (!n) return;
  $("result").classList.add("hidden");
  stopPractice();
  $("play").classList.add("hidden");
  $("library").classList.remove("hidden");
  openSetup(n);
});

$("namesBtn").addEventListener("click", () => {
  prefs = { ...prefs, showNames: !prefs.showNames };
  savePrefs(prefs);
  $("namesBtn").classList.toggle("on", prefs.showNames);
  staff.setShowNames(prefs.showNames);
  keyboard.setNames(prefs.showNames);
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
$("namesBtn").classList.toggle("on", prefs.showNames);
keyboard.setNames(prefs.showNames);
renderLibrary();

// Offline support + "add to home screen". Registration failures are harmless
// (file:// or a browser without service workers) so they must not break boot.
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker
      .register(new URL("sw.js", document.baseURI).href, { scope: "./" })
      .catch(() => undefined);
  });
}
