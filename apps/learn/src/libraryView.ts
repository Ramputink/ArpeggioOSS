/**
 * The library screen: who you are, what to play next, and everything playable.
 *
 *   profile   level, XP, the achievement you are closest to
 *   hero      "continue" — the last thing you touched
 *   levels    the curriculum, in order
 *   técnica   generated warm-ups, deliberately outside the curriculum
 *   tuyas     imported MusicXML, with an explicit edit mode
 *
 * Pure rendering: it is handed the stored state and a set of callbacks, and it
 * owns no state of its own except which section is in edit mode.
 */
import {
  EXERCISES,
  LEVEL_GOALS,
  LEVEL_NAMES,
  SONGS,
  type Level,
  type Song,
} from "@arpeggio/song-library";

import { HAND_LABEL, plural } from "./copy.js";
import { $, el } from "./dom.js";
import {
  ACHIEVEMENTS,
  achievementRatio,
  levelFor,
  unlockedIds,
  type Achievement,
  type Stats,
} from "./gamification.js";
import { icon } from "./icons.js";
import { loadImported, pieceFromMusicXML, pieceFromSong, type Piece } from "./pieces.js";
import { formatDuration } from "./practiceTime.js";
import { starsFor, type Prefs, type SongProgress } from "./store.js";

export interface LibraryHandlers {
  /** Open the setup sheet for a piece. */
  onOpen(piece: Piece): void;
  /** Delete an imported score and re-render. */
  onDeleteImported(id: string): void;
  /** Redraw the whole screen — the edit toggle needs it. */
  onRefresh(): void;
}

/** Whether the "Mis partituras" section is showing its delete buttons. */
let editingImported = false;

export function renderLibrary(
  progress: Record<string, SongProgress>,
  stats: Stats,
  prefs: Prefs,
  handlers: LibraryHandlers,
): void {
  renderProfile(stats);
  renderNextUp(progress, prefs, handlers);

  const list = $("songList");
  list.replaceChildren();

  // Only the tier being worked on is open. Nineteen pieces, ten exercises and
  // eight headings expanded at once is a wall, and what a beginner needs first
  // is not a catalogue — it is to know which one to press.
  const current = currentLevel(progress);

  ([1, 2, 3, 4, 5, 6] as Level[]).forEach((level) => {
    const songs = SONGS.filter((s) => s.level === level);
    if (songs.length === 0) return;
    const done = songs.filter((s) => starsFor(progress[s.id]) > 0).length;
    list.append(
      collapsible({
        chip: `Nivel ${level}`,
        title: LEVEL_NAMES[level],
        count: `${done}/${songs.length}`,
        blurb: LEVEL_GOALS[level],
        open: level === current,
        body: cardRow(
          songs.map((s, i) => pieceCard(pieceFromSong(s), String(i + 1), progress[s.id], handlers)),
        ),
      }),
    );
  });

  renderExercises(progress, list, handlers);
  renderImported(progress, list, handlers);
}

/** The lowest tier with something still unfinished — where the learner is. */
function currentLevel(progress: Record<string, SongProgress>): Level {
  for (const level of [1, 2, 3, 4, 5, 6] as Level[]) {
    if (SONGS.some((s) => s.level === level && starsFor(progress[s.id]) === 0)) return level;
  }
  return 6;
}

interface Section {
  chip: string;
  title: string;
  count: string;
  blurb: string;
  open: boolean;
  body: HTMLElement;
  /** An extra control inside the section (the imported-scores edit toggle). */
  action?: HTMLElement;
}

/**
 * A section that is a single row until it is opened.
 *
 * `<details>` rather than a click handler and a boolean: it is a disclosure, the
 * browser already knows what one of those is, and it keeps working for a
 * keyboard and a screen reader without any of that being written here.
 */
function collapsible(section: Section): HTMLElement {
  const box = document.createElement("details");
  box.className = "level";
  box.open = section.open;

  const head = document.createElement("summary");
  head.className = "level-head";
  head.append(
    el("span", "level-chip", section.chip),
    el("h2", "", section.title),
    el("span", "level-count", section.count),
  );
  const chevron = el("span", "level-chevron", "");
  chevron.innerHTML = icon("chevron", 16);
  head.append(chevron);

  box.append(head, el("p", "level-goal", section.blurb));
  if (section.action) box.append(section.action);
  box.append(section.body);
  return box;
}

function cardRow(cards: HTMLElement[]): HTMLElement {
  const row = document.createElement("div");
  row.className = "cards";
  row.append(...cards);
  return row;
}

/**
 * Technique warm-ups.
 *
 * Below the curriculum and closed by default: a beginner opening the app should
 * see "Estrellita", not a scale. They are here, and in the guided session, which
 * is where they actually get played.
 */
function renderExercises(
  progress: Record<string, SongProgress>,
  list: HTMLElement,
  handlers: LibraryHandlers,
): void {
  const done = EXERCISES.filter((s) => starsFor(progress[s.id]) > 0).length;
  list.append(
    collapsible({
      chip: "Técnica",
      title: "Calentamiento",
      count: `${done}/${EXERCISES.length}`,
      blurb:
        "Patrones cortos que enseñan la mano, no la pieza. Un par de minutos antes de tocar cambia el día entero.",
      open: false,
      body: cardRow(
        EXERCISES.map((s) => pieceCard(pieceFromSong(s), "•", progress[s.id], handlers)),
      ),
    }),
  );
}

/** "Mis partituras": whatever the learner brought in as MusicXML. */
function renderImported(
  progress: Record<string, SongProgress>,
  list: HTMLElement,
  handlers: LibraryHandlers,
): void {
  const records = loadImported();
  if (records.length === 0) {
    editingImported = false;
    return;
  }

  // An explicit edit toggle, not a long press. The previous version wired
  // deletion to `contextmenu` and told the learner to "hold with the right
  // button" — there is no right button on a phone, and a long press opens iOS's
  // own callout, so an imported score could not be removed at all on the only
  // device this app is built for.
  const edit = document.createElement("button");
  edit.type = "button";
  edit.className = "linkbtn" + (editingImported ? " on" : "");
  edit.textContent = editingImported ? "Listo" : "Editar";
  edit.setAttribute("aria-pressed", String(editingImported));
  edit.addEventListener("click", () => {
    editingImported = !editingImported;
    handlers.onRefresh();
  });

  const cards: HTMLElement[] = [];
  for (const record of records) {
    let imported: Piece;
    try {
      imported = pieceFromMusicXML(record.id, record.name, record.xml);
    } catch {
      // A stored file that no longer parses must not take the library down.
      continue;
    }
    cards.push(
      editingImported
        ? removableCard(imported, record.id, progress[record.id], handlers)
        : pieceCard(imported, "★", progress[record.id], handlers),
    );
  }

  list.append(
    collapsible({
      chip: "Tuyas",
      title: "Mis partituras",
      count: String(records.length),
      blurb: editingImported
        ? "Pulsa la papelera para quitar una partitura."
        : "Partituras que has importado tú, en MusicXML (.musicxml o .mxl).",
      open: editingImported,
      action: edit,
      body: cardRow(cards),
    }),
  );
}

/** An imported card with its delete button beside it. */
function removableCard(
  piece: Piece,
  id: string,
  progress: SongProgress | undefined,
  handlers: LibraryHandlers,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "card-row";
  const remove = document.createElement("button");
  remove.type = "button";
  remove.className = "iconbtn danger";
  remove.innerHTML = icon("trash", 19);
  remove.setAttribute("aria-label", `Quitar «${piece.title}»`);
  remove.addEventListener("click", () => handlers.onDeleteImported(id));
  row.append(pieceCard(piece, "★", progress, handlers), remove);
  return row;
}

function pieceCard(
  p: Piece,
  badge: string,
  progress: SongProgress | undefined,
  handlers: LibraryHandlers,
): HTMLButtonElement {
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
  card.addEventListener("click", () => handlers.onOpen(p));
  return card;
}

// ---------------------------------------------------------------------------
// Profile and hero
// ---------------------------------------------------------------------------

function renderProfile(stats: Stats): void {
  const state = levelFor(stats.xp);
  $("profileLevel").textContent = String(state.level);
  $("profileTitle").textContent = state.title;
  $("profileXp").textContent = `${state.into} / ${state.need} XP`;
  $<HTMLElement>("profileBar").style.width = `${(state.into / state.need) * 100}%`;

  const unlocked = unlockedIds(stats).length;
  const next = nextAchievement(stats);
  // Practice time leads, because it is the number that actually predicts
  // getting better — and until now the app counted it nowhere.
  const time = stats.seconds > 0 ? `${formatDuration(stats.seconds)} de práctica · ` : "";
  const count = `${unlocked}/${ACHIEVEMENTS.length} logros`;
  $("profileMeta").textContent = next
    ? `${time}${count} · siguiente: ${next.title} (${Math.min(next.progress(stats), next.goal)}/${next.goal})`
    : `${time}${count} · lo has conseguido todo`;
}

export function nextAchievement(stats: Stats): Achievement | undefined {
  return ACHIEVEMENTS.filter((a) => a.progress(stats) < a.goal).sort(
    (a, b) => achievementRatio(b, stats) - achievementRatio(a, stats),
  )[0];
}

/**
 * The one thing to press.
 *
 * The library used to open on a profile card, two buttons and twenty-nine
 * pieces, and answered the only question a beginner actually has — "where do I
 * start?" — nowhere. This answers it, in one sentence, always:
 *
 *   nothing played yet  -> the easiest piece in the library, by name
 *   something in progress -> that piece
 *   that piece finished -> the next one in the curriculum
 *
 * It also states, in words, how you are about to play (screen, piano, listen),
 * because choosing "Mi piano" is invisible otherwise — and a learner pressing
 * the keys of a real piano while the app is waiting for taps on the screen sees
 * an app that is simply broken.
 */
function renderNextUp(
  progress: Record<string, SongProgress>,
  prefs: Prefs,
  handlers: LibraryHandlers,
): void {
  const target = nextUp(progress);
  const fresh = Object.keys(progress).length === 0;

  $("heroEyebrow").textContent = fresh ? "Empieza aquí" : "Continuar";
  $("heroTitle").textContent = target.title;
  $("heroSub").textContent = `${MODE_LABEL[prefs.mode]} · ${HAND_LABEL[prefs.hand]}`;
  // Assigned, not added: this runs on every return to the library screen, and
  // `addEventListener` would fire the handler once per visit ever made.
  $<HTMLButtonElement>("hero").onclick = () => handlers.onOpen(pieceFromSong(target));
}

/** How the learner is about to play, in words rather than a hidden setting. */
const MODE_LABEL: Record<string, string> = {
  keys: "En la pantalla",
  mic: "Con tu piano",
  demo: "Escuchando",
};

/** The piece to offer: what is in progress, or the next one never finished. */
function nextUp(progress: Record<string, SongProgress>): Song {
  const lastId = Object.entries(progress).sort((a, b) => b[1].lastPlayed - a[1].lastPlayed)[0]?.[0];
  const last = [...SONGS, ...EXERCISES].find((s) => s.id === lastId);
  // Still working on it: three stars means done, anything less means come back.
  if (last && starsFor(progress[last.id]) < 3) return last;
  return SONGS.find((s) => starsFor(progress[s.id]) === 0) ?? last ?? SONGS[0];
}

// ---------------------------------------------------------------------------
// Achievements sheet
// ---------------------------------------------------------------------------

export function renderAchievements(stats: Stats): void {
  const unlocked = unlockedIds(stats);
  $("achHeadline").textContent =
    `${unlocked.length} de ${ACHIEVEMENTS.length} conseguidos · ` +
    `${formatDuration(stats.seconds)} de práctica · ` +
    plural(stats.notes, "nota tocada", "notas tocadas");

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
