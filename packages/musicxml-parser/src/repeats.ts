/**
 * Expansion of repeat structure into a linear play order.
 *
 * Given the barline/ending information collected per measure, this produces the
 * sequence of measure indices in the order they are actually performed. Forward
 * and backward repeats and first/second endings (voltas) are supported, as well
 * as da capo / dal segno navigation with coda and fine markers.
 */

/** Repeat-related flags extracted from a measure's barlines. */
export interface MeasureRepeatInfo {
  /** This measure begins a repeated section (`<repeat direction="forward"/>`). */
  forwardRepeat: boolean;
  /** This measure ends a repeated section (`<repeat direction="backward"/>`). */
  backwardRepeat: boolean;
  /** `times` on the backward repeat (how many total plays); default 2. */
  repeatTimes: number;
  /** Ending (volta) numbers that start at this measure, e.g. [1] or [2]. */
  endingStart: number[] | null;
  /** This measure is a segno point (the target of a dal-segno jump). */
  segno: boolean;
  /** This measure is a coda point (the target of a to-coda jump). */
  coda: boolean;
  /** At the end of this measure, jump back to the beginning (da capo). */
  dacapo: boolean;
  /** At the end of this measure, jump back to the segno (dal segno). */
  dalsegno: boolean;
  /** On the D.C./D.S. return pass, jump from here to the coda point. */
  toCoda: boolean;
  /** On the D.C./D.S. return pass, stop after playing this measure (fine). */
  fine: boolean;
}

/**
 * Compute the linear play order of measure indices.
 *
 * @param infos One entry per measure, in source order.
 * @returns Array of 0-based measure indices in performance order.
 */
export function computePlayOrder(infos: MeasureRepeatInfo[]): number[] {
  const order: number[] = [];
  const jumpsDone: Record<number, number> = {};
  let i = 0;
  let repeatStart = 0;
  let pass = 1; // which pass through the current repeated section we are on

  // Navigation (D.C./D.S./coda/fine) state. Each jump fires at most once, and
  // the fine/to-coda markers only take effect on the "return" pass a D.C. or
  // D.S. jump triggers (they are ignored on the way there).
  const segnoIndex = infos.findIndex((m) => m.segno);
  const codaIndex = infos.findIndex((m) => m.coda);
  const navDone = new Set<number>(); // indices of D.C./D.S. jumps already taken
  let navReturn = false; // true once a D.C./D.S. jump has been taken
  let codaJumpDone = false;

  // Safety bound: repeats/navigation can't legitimately expand beyond this.
  const maxSteps = infos.length * 64 + 1000;
  let steps = 0;

  while (i < infos.length) {
    if (steps++ > maxSteps) break; // guard against pathological/broken input
    const m = infos[i];

    // On a D.C./D.S. return pass the source is replayed straight through, so
    // section repeats and voltas are not re-evaluated.
    if (!navReturn && m.forwardRepeat && i !== repeatStart) {
      // Entering a fresh repeated section.
      repeatStart = i;
      pass = 1;
    }

    // Volta handling: if this measure opens an ending that does not apply on the
    // current pass, skip forward to the ending that does (or stop if none).
    if (!navReturn && m.endingStart && !m.endingStart.includes(pass)) {
      let j = i + 1;
      while (j < infos.length && !infos[j].endingStart?.includes(pass)) j++;
      if (j < infos.length) {
        i = j;
        continue;
      }
      break; // no matching ending remains
    }

    order.push(i);

    // Fine: on the return pass, stop after playing this measure.
    if (navReturn && m.fine) break;

    // To coda: on the return pass, jump from here to the coda point.
    if (navReturn && m.toCoda && codaIndex >= 0 && !codaJumpDone) {
      codaJumpDone = true;
      i = codaIndex;
      continue;
    }

    if (!navReturn && m.backwardRepeat) {
      const done = jumpsDone[i] ?? 0;
      if (done < m.repeatTimes - 1) {
        jumpsDone[i] = done + 1;
        pass += 1;
        i = repeatStart;
        continue;
      }
      // Repeat exhausted; fall through to the next measure and reset section.
      repeatStart = i + 1 < infos.length && infos[i + 1].forwardRepeat ? i + 1 : i + 1;
      pass = 1;
    }

    // Da capo / dal segno: take the jump once, then honor fine/to-coda markers
    // on the way back.
    if (m.dacapo && !navDone.has(i)) {
      navDone.add(i);
      navReturn = true;
      i = 0;
      continue;
    }
    if (m.dalsegno && !navDone.has(i)) {
      navDone.add(i);
      navReturn = true;
      i = segnoIndex >= 0 ? segnoIndex : 0;
      continue;
    }

    i++;
  }

  return order;
}
