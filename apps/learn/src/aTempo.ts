/**
 * "A tempo" judging — the cursor keeps going and grades you against the clock.
 *
 * The follow-you follower waits for the learner, which is right for a first pass
 * and useless for rhythm: you can hold a note for four seconds and still be told
 * you played it correctly. This judge is the opposite and the one to graduate to.
 * Every expected note has a wall-clock deadline; a note played near its deadline
 * is correct (early/late if outside the tolerance), a note played nowhere near
 * anything expected is wrong, and a deadline that passes unplayed is a miss.
 *
 * Pure on purpose: no audio, no DOM, no timers. Elapsed time is passed in, which
 * is what makes the whole thing unit-testable.
 */
import { classifyError, type ExpectedNote, type PlayerEvent } from "@arpeggio/practice-engine";

export interface ATempoOptions {
  /** Seconds per quarter-note beat, i.e. 60 / bpm. */
  secPerBeat: number;
  /**
   * Half-width of the "on time" window, in seconds. Outside it a matched note
   * reads early or late; default 0.15 s, the same figure the follower uses.
   */
  toleranceSec?: number;
  /**
   * How far from its deadline a note may still be matched at all, in seconds.
   * Wider than the tolerance: a note 400 ms late is still *that* note played
   * badly, not a different note played wrongly. Default 0.7 s.
   */
  matchWindowSec?: number;
}

interface Slot {
  note: ExpectedNote;
  /** Deadline on the elapsed-seconds clock. */
  dueSec: number;
  /** Set once matched or missed, so a slot is judged exactly once. */
  settled: boolean;
}

export class ATempoJudge {
  private readonly slots: Slot[];
  private readonly secPerBeat: number;
  private readonly toleranceSec: number;
  private readonly matchWindowSec: number;
  /** Highest settled slot index + 1 — the progress the UI shows. */
  private settledCount = 0;

  constructor(expected: ExpectedNote[], opts: ATempoOptions) {
    this.secPerBeat = opts.secPerBeat;
    this.toleranceSec = opts.toleranceSec ?? 0.15;
    this.matchWindowSec = opts.matchWindowSec ?? 0.7;
    this.slots = expected.map((note) => ({
      note,
      dueSec: note.onset * this.secPerBeat,
      settled: false,
    }));
  }

  /** Total expected notes. */
  get total(): number {
    return this.slots.length;
  }

  /** Notes judged so far, matched or missed. */
  get judged(): number {
    return this.settledCount;
  }

  /** Where the clock is, in beats. */
  positionBeats(elapsedSec: number): number {
    return Math.max(0, elapsedSec / this.secPerBeat);
  }

  /** True once the clock has passed the end of the piece. */
  isDone(elapsedSec: number): boolean {
    if (this.slots.length === 0) return true;
    const last = this.slots[this.slots.length - 1];
    return elapsedSec > last.dueSec + this.matchWindowSec;
  }

  /** Measure the clock is currently in, for the student model. */
  measureAt(elapsedSec: number): number {
    let measure = this.slots[0]?.note.measure ?? 1;
    for (const slot of this.slots) {
      if (slot.dueSec > elapsedSec) break;
      measure = slot.note.measure;
    }
    return measure;
  }

  /** Pitches due right about now — what the keyboard should light up. */
  dueNotes(elapsedSec: number): number[] {
    const ahead = this.toleranceSec * 2;
    return this.slots
      .filter((s) => !s.settled && s.dueSec >= elapsedSec - ahead && s.dueSec <= elapsedSec + ahead)
      .map((s) => s.note.midi);
  }

  /**
   * Judge one played note. Matches the unsettled slot of the same pitch closest
   * in time — closest rather than first, so a repeated note in a run is credited
   * to the repetition the player actually hit.
   */
  judge(midi: number, elapsedSec: number): PlayerEvent {
    let best: Slot | undefined;
    let bestDistance = Infinity;
    for (const slot of this.slots) {
      if (slot.settled || slot.note.midi !== midi) continue;
      const distance = Math.abs(slot.dueSec - elapsedSec);
      if (distance <= this.matchWindowSec && distance < bestDistance) {
        best = slot;
        bestDistance = distance;
      }
    }

    if (!best) {
      // Nothing expected anywhere near: a wrong note. The nearest unsettled slot
      // supplies the beat so the event still points somewhere in the score.
      const nearest = this.nearestUnsettled(elapsedSec);
      return {
        kind: "wrong",
        expectedMidi: nearest?.note.midi,
        playedMidi: midi,
        atBeat: nearest?.note.onset ?? this.positionBeats(elapsedSec),
        timeSec: elapsedSec,
        ...(nearest ? octaveOffset(nearest.note.midi, midi) : {}),
      };
    }

    best.settled = true;
    this.settledCount++;
    const timingErrorSec = elapsedSec - best.dueSec;
    return {
      kind: classifyError(midi, midi, timingErrorSec, { timingToleranceSec: this.toleranceSec }),
      expectedMidi: midi,
      playedMidi: midi,
      atBeat: best.note.onset,
      timeSec: elapsedSec,
      timingErrorSec,
    };
  }

  /**
   * Settle every slot whose match window has closed without being played, and
   * return one `wrong` per miss. `playedMidi` is absent: nothing was played.
   */
  collectMissed(elapsedSec: number): PlayerEvent[] {
    const events: PlayerEvent[] = [];
    for (const slot of this.slots) {
      if (slot.settled || elapsedSec <= slot.dueSec + this.matchWindowSec) continue;
      slot.settled = true;
      this.settledCount++;
      events.push({
        kind: "wrong",
        expectedMidi: slot.note.midi,
        atBeat: slot.note.onset,
        timeSec: elapsedSec,
      });
    }
    return events;
  }

  private nearestUnsettled(elapsedSec: number): Slot | undefined {
    let best: Slot | undefined;
    let bestDistance = Infinity;
    for (const slot of this.slots) {
      if (slot.settled) continue;
      const distance = Math.abs(slot.dueSec - elapsedSec);
      if (distance < bestDistance) {
        best = slot;
        bestDistance = distance;
      }
    }
    return best;
  }
}

/** `{ octaveOff }` when the pitch class matched, otherwise nothing. */
function octaveOffset(expectedMidi: number, playedMidi: number): { octaveOff?: number } {
  if ((((expectedMidi - playedMidi) % 12) + 12) % 12 !== 0) return {};
  return { octaveOff: (playedMidi - expectedMidi) / 12 };
}
