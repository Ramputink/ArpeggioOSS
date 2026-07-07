/**
 * Parse-quality report.
 *
 * OMR is never perfect, so after parsing we surface simple, human-readable
 * signals that hint whether Audiveris got confused: measure/note counts plus a
 * list of warnings about suspicious content (empty voices, out-of-range
 * pitches, measures whose duration disagrees with the time signature, etc.).
 */
import type { NoteEvent, Score } from "./model.js";

/** Severity of a warning. `warn` = likely fine, `error` = probably wrong. */
export type WarningLevel = "info" | "warn" | "error";

export interface QualityWarning {
  level: WarningLevel;
  code: string;
  message: string;
  /** Measure number the warning refers to, when applicable. */
  measure?: number;
}

export interface QualityReport {
  measures: number;
  notes: number;
  parts: number;
  staves: number;
  voices: number;
  /** Tuple [lowestMidi, highestMidi], or null when there are no notes. */
  pitchRange: [number, number] | null;
  /** Total sounding duration span in quarter-note beats. */
  durationQuarters: number;
  repeatsFlattened: boolean;
  warnings: QualityWarning[];
}

// Piano keyboard range: A0 (21) .. C8 (108). Notes outside are suspicious.
const PIANO_MIN = 21;
const PIANO_MAX = 108;

function countDistinct<T>(items: Iterable<T>): number {
  return new Set(items).size;
}

/** Build a {@link QualityReport} from a parsed {@link Score}. */
export function qualityReport(score: Score): QualityReport {
  const { events } = score;
  const warnings: QualityWarning[] = [];

  const measures = countDistinct(events.map((e) => e.measure));
  const staves = countDistinct(events.map((e) => e.staff));
  const voices = countDistinct(events.map((e) => e.voice));

  let pitchRange: [number, number] | null = null;
  if (events.length > 0) {
    let lo = Infinity;
    let hi = -Infinity;
    for (const e of events) {
      if (e.pitchMidi < lo) lo = e.pitchMidi;
      if (e.pitchMidi > hi) hi = e.pitchMidi;
    }
    pitchRange = [lo, hi];
  }

  const durationQuarters = events.reduce((max, e) => Math.max(max, e.offset), 0);

  // --- warnings -------------------------------------------------------------
  if (events.length === 0) {
    warnings.push({
      level: "error",
      code: "no-notes",
      message: "No notes were parsed — OMR likely failed to recognize the score.",
    });
  }

  // Out-of-range pitches (octave errors are a classic OMR mistake).
  const outOfRange = events.filter(
    (e) => e.pitchMidi < PIANO_MIN || e.pitchMidi > PIANO_MAX,
  );
  if (outOfRange.length > 0) {
    warnings.push({
      level: "warn",
      code: "pitch-out-of-range",
      message:
        `${outOfRange.length} note(s) fall outside the piano range (A0–C8); ` +
        `possible octave misreads.`,
    });
  }

  // Non-positive durations (a note that starts and ends at the same time).
  const zeroDur = events.filter((e) => e.offset <= e.onset);
  if (zeroDur.length > 0) {
    warnings.push({
      level: "warn",
      code: "zero-duration",
      message: `${zeroDur.length} note(s) have zero or negative duration.`,
    });
  }

  // Unresolved ties: a note flagged tied whose value looks unusually long.
  const longTied = events.filter((e) => e.tied && e.offset - e.onset > 16);
  if (longTied.length > 0) {
    warnings.push({
      level: "info",
      code: "long-tied-note",
      message:
        `${longTied.length} tied note(s) span > 4 bars of 4/4; ` +
        `check for an unresolved tie.`,
    });
  }

  // Overlaps within the same voice (a monophonic voice should not stack notes).
  const overlaps = countVoiceOverlaps(events);
  if (overlaps > 0) {
    warnings.push({
      level: "warn",
      code: "voice-overlap",
      message: `${overlaps} overlapping note pair(s) within a single voice.`,
    });
  }

  // Measures whose total content disagrees with the active time signature.
  if (score.timeSignatures.length > 0) {
    checkMeasureDurations(score, warnings);
  }

  return {
    measures,
    notes: events.length,
    parts: score.parts.length,
    staves,
    voices,
    pitchRange,
    durationQuarters,
    repeatsFlattened: score.repeatsFlattened,
    warnings,
  };
}

/** Count overlapping note pairs that share the same (voice, staff). */
function countVoiceOverlaps(events: NoteEvent[]): number {
  const byVoice = new Map<string, NoteEvent[]>();
  for (const e of events) {
    const key = `${e.staff}|${e.voice}`;
    (byVoice.get(key) ?? byVoice.set(key, []).get(key)!).push(e);
  }
  let overlaps = 0;
  for (const list of byVoice.values()) {
    list.sort((a, b) => a.onset - b.onset);
    for (let i = 1; i < list.length; i++) {
      // A small epsilon avoids flagging legato/rounding touch points.
      if (list[i].onset < list[i - 1].offset - 1e-6) overlaps++;
    }
  }
  return overlaps;
}

/** Flag measures whose sounded length differs from the time signature. */
function checkMeasureDurations(score: Score, warnings: QualityWarning[]): void {
  // Resolve the active time signature (beats in quarter notes) per measure.
  const sigs = [...score.timeSignatures].sort((a, b) => a.measure - b.measure);
  const activeSigFor = (measure: number) => {
    let active = sigs[0];
    for (const s of sigs) if (s.measure <= measure) active = s;
    return active;
  };

  // Estimate each measure's content length from note positions *within* the
  // measure (position + duration), not global onsets. This is repeat-safe: the
  // same source measure recurs at several global onsets once repeats are
  // flattened, so grouping by global time would conflate the passes.
  const lengthByMeasure = new Map<number, number>();
  for (const e of score.events) {
    const localEnd = e.position + (e.offset - e.onset);
    lengthByMeasure.set(e.measure, Math.max(lengthByMeasure.get(e.measure) ?? 0, localEnd));
  }

  let flagged = 0;
  for (const [measure, actual] of lengthByMeasure) {
    const sig = activeSigFor(measure);
    if (!sig) continue;
    const expected = (sig.beats * 4) / sig.beatType; // measure length in quarters
    // Allow pickup/partial measures and rounding; flag only clear mismatches.
    if (actual > expected + 1e-3 && actual - expected > 0.5) {
      flagged++;
      if (flagged <= 5) {
        warnings.push({
          level: "warn",
          code: "measure-overfull",
          measure,
          message:
            `Measure ${measure} spans ${actual.toFixed(2)} beats but the time ` +
            `signature allows ${expected.toFixed(2)}.`,
        });
      }
    }
  }
  if (flagged > 5) {
    warnings.push({
      level: "warn",
      code: "measure-overfull",
      message: `…and ${flagged - 5} more measure-length mismatches.`,
    });
  }
}

/** Render a report as a compact, human-readable multi-line string. */
export function formatReport(r: QualityReport): string {
  const lines: string[] = [];
  lines.push("Parse quality report");
  lines.push("─────────────────────");
  lines.push(`  Parts:      ${r.parts}`);
  lines.push(`  Staves:     ${r.staves}`);
  lines.push(`  Voices:     ${r.voices}`);
  lines.push(`  Measures:   ${r.measures}`);
  lines.push(`  Notes:      ${r.notes}`);
  if (r.pitchRange) {
    lines.push(`  Pitch range: MIDI ${r.pitchRange[0]}–${r.pitchRange[1]}`);
  }
  lines.push(`  Duration:   ${r.durationQuarters.toFixed(1)} quarter-beats`);
  lines.push(`  Repeats flattened: ${r.repeatsFlattened ? "yes" : "no"}`);

  if (r.warnings.length === 0) {
    lines.push("  Warnings:   none 🎉");
  } else {
    lines.push(`  Warnings (${r.warnings.length}):`);
    for (const w of r.warnings) {
      const badge = w.level === "error" ? "✗" : w.level === "warn" ? "!" : "·";
      lines.push(`    ${badge} [${w.code}] ${w.message}`);
    }
  }
  return lines.join("\n");
}
