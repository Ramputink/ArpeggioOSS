/**
 * "Comprobar el micrófono" — the diagnostic that makes a real-piano session
 * debuggable instead of mysterious.
 *
 * Three questions, in the order they matter: can I hear you at all, how loud is
 * the room, and how far behind your hands is the cursor. Without it, every
 * failure mode over a microphone — phone too far, room too noisy, pipeline too
 * slow — looks identical to the learner: "it isn't working".
 *
 * Self-contained: the only thing it needs from the rest of the app is the
 * latency the last microphone run measured, passed in as a getter so this module
 * never has to know that a `Runner` exists.
 */
import { MIC_VERDICT } from "./copy.js";
import { $, closeSheet, openSheet, show } from "./dom.js";
import type { LatencyStats } from "./latency.js";
import { MicCheck, levelVerdict } from "./micCheck.js";
import { noteName, octaveOf } from "./staff.js";

/** Pitch class the verification asks for: DO, the note every beginner can find. */
const CHECK_PITCH_CLASS = 0;

/** Seconds of silence used to measure the room's noise floor. */
const FLOOR_SAMPLE_MS = 2000;

/** Above this RMS the room is noisy enough to hurt detection. */
const NOISY_ROOM_RMS = 0.02;

const micCheck = new MicCheck();
let heardTarget = false;

/** Wire the sheet up once, at boot. */
export function wireMicCheck(latency: () => LatencyStats | null): void {
  $("micCheckBtn").addEventListener("click", () => {
    closeSheet("settings");
    open(latency());
  });

  $("micStart").addEventListener("click", () => void listen());
  $("micFloorBtn").addEventListener("click", () => void measureFloor());
  $("micDone").addEventListener("click", () => {
    micCheck.stop();
    closeSheet("miccheck");
  });
}

function open(stats: LatencyStats | null): void {
  heardTarget = false;
  $("micVerdict").textContent = "Pulsa «Escuchar» y toca cualquier tecla.";
  $("micPitch").textContent = "—";
  $("micFloor").textContent = "—";
  show("micTask", false);
  $("micLatency").textContent = stats && stats.samples > 0 ? `${stats.p50} ms` : "—";
  openSheet("miccheck");
}

async function listen(): Promise<void> {
  try {
    show("micTask", true);
    $("micTask").textContent = "Toca un DO para confirmar que te oigo bien.";
    await micCheck.start((reading) => {
      const bar = $<HTMLElement>("micLevel");
      bar.style.width = `${Math.min(100, Math.round(reading.rms * 260))}%`;
      const verdict = levelVerdict(reading.rms);
      bar.classList.toggle("hot", verdict === "clipping" || verdict === "loud");
      bar.classList.toggle("low", verdict === "quiet");
      $("micVerdict").textContent = MIC_VERDICT[verdict];

      if (reading.midi === null || reading.confidence <= 0.6) return;
      $("micPitch").textContent = `${noteName(reading.midi, 0)}${octaveOf(reading.midi)}`;
      // Asking for a specific note, not just "some sound", is what separates
      // "the microphone works" from "the microphone hears your piano".
      if (!heardTarget && reading.midi % 12 === CHECK_PITCH_CLASS) {
        heardTarget = true;
        $("micTask").textContent = "Perfecto: te oigo bien. Ya puedes practicar con el piano.";
        $("micTask").classList.remove("warn");
      }
    });
  } catch (err) {
    $("micVerdict").textContent = (err as Error).message || "No se pudo abrir el micrófono";
  }
}

async function measureFloor(): Promise<void> {
  show("micTask", true);
  $("micTask").textContent = "No toques nada durante dos segundos…";
  micCheck.resetPeak();
  await new Promise((resolve) => window.setTimeout(resolve, FLOOR_SAMPLE_MS));
  const floor = micCheck.meanRms;
  $("micFloor").textContent = floor.toFixed(3);
  $("micTask").textContent =
    floor > NOISY_ROOM_RMS
      ? "La sala es ruidosa: acerca el móvil al piano o busca un sitio más silencioso."
      : "Sala silenciosa. Perfecto para practicar.";
}
