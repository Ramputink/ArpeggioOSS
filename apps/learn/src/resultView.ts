/**
 * The result sheet.
 *
 * Presentation only: it is told what happened and which buttons to offer, and
 * decides how that looks. Working out *what* you can do next (repeat, loop the
 * weak bars, raise the tempo, go on) depends on the whole app's state and stays
 * where that state lives.
 */
import { plural, reviseAdvice, resultHeadline } from "./copy.js";
import { $, el } from "./dom.js";
import { levelFor, type Stats } from "./gamification.js";
import { icon } from "./icons.js";
import { formatDuration } from "./practiceTime.js";
import type { RunSummary } from "./runner.js";

export interface ResultView {
  summary: RunSummary;
  /** False for a listen-through, where nothing was judged. */
  judged: boolean;
  stars: number;
  /** Longest run of consecutive correct notes in this attempt. */
  bestStreak: number;
  /** Seconds of practice this attempt was worth. */
  seconds: number;
  /** Bar range being drilled, if any. */
  loop: { from: number; to: number } | null;
  /** Measured microphone latency, when practising over a real piano. */
  micLatencyMs: number | null;
  /** True when the microphone run is visibly lagging the learner's hands. */
  latencyIsBad: boolean;
  /** Bars the student model rates weakest. */
  weakMeasures: number[];
  xp: number;
  stats: Stats;
  actions: HTMLElement[];
}

export function renderResult(v: ResultView): void {
  renderStars(v.stars);
  $("resultTitle").textContent = resultHeadline(v.judged, v.stars, v.summary.completed);
  $("resultLine").textContent = v.judged
    ? v.loop
      ? `Bucle de los compases ${v.loop.from}–${v.loop.to}.`
      : "Repite para subir la puntuación, o pasa a la siguiente."
    : "Ahora inténtalo tú: vuelve y elige «En la pantalla».";

  renderStats(v);
  renderXp(v);
  renderAdvice(v);
  $("resultActions").replaceChildren(...v.actions);
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

function renderStats(v: ResultView): void {
  const host = $("resultStats");
  host.replaceChildren();
  if (!v.judged) return;

  const cells: Array<[string, string]> = [
    ["Notas", String(v.summary.correct)],
    ["Acierto", `${Math.round(v.summary.accuracy * 100)}%`],
  ];
  // Timing only means something when a clock was grading; in wait mode the
  // follower deliberately forgives it, so showing a figure would be a lie.
  if (v.summary.meanTimingErrorSec !== null) {
    cells.push(["Desfase", `${Math.round(v.summary.meanTimingErrorSec * 1000)} ms`]);
  } else {
    cells.push(["Racha", String(v.bestStreak)]);
  }
  if (v.seconds >= 30) cells.push(["Tiempo", formatDuration(v.seconds)]);
  if (v.micLatencyMs !== null) cells.push(["Retardo", `${v.micLatencyMs} ms`]);

  for (const [label, value] of cells) {
    const cell = document.createElement("div");
    cell.append(el("dd", "", value), el("dt", "", label));
    host.append(cell);
  }
}

function renderXp(v: ResultView): void {
  const row = $("resultXp");
  const show = v.judged && v.xp > 0;
  row.classList.toggle("hidden", !show);
  if (!show) return;

  const state = levelFor(v.stats.xp);
  $("resultXpText").textContent = `+${v.xp} XP`;
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

function renderAdvice(v: ResultView): void {
  const advice = $("resultAdvice");
  // A microphone run that is visibly behind the hands is a setup problem, not a
  // playing problem, and saying "practise bar 5" would be blaming the learner.
  if (v.latencyIsBad && v.micLatencyMs !== null) {
    advice.classList.remove("hidden");
    advice.textContent =
      `El cursor va ${v.micLatencyMs} ms por detrás de tus manos. Prueba con una sola mano ` +
      "o acerca el móvil al piano: así el sonido llega más limpio y la detección es más rápida.";
    return;
  }
  const text = v.judged && v.summary.accuracy < 0.98 ? reviseAdvice(v.weakMeasures) : null;
  advice.classList.toggle("hidden", text === null);
  if (text) advice.textContent = text;
}

// ---------------------------------------------------------------------------
// Session report
// ---------------------------------------------------------------------------

/** The summary sheet a guided session ends with. */
export function renderSessionReport(headline: string, lines: string[], notes: number): void {
  $("reportHeadline").textContent = headline;
  $("reportNotes").textContent = plural(notes, "nota tocada", "notas tocadas") + " en total.";
  const list = $("reportList");
  list.replaceChildren();
  for (const line of lines) {
    const row = document.createElement("div");
    row.className = "ach done";
    const iconBox = el("span", "ach-icon", "");
    iconBox.innerHTML = icon("check", 18);
    const body = document.createElement("span");
    body.className = "ach-body";
    body.append(el("b", "", line));
    row.append(iconBox, body);
    list.append(row);
  }
}
