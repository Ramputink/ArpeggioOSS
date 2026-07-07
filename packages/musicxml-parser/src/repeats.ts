/**
 * Expansion of repeat structure into a linear play order.
 *
 * Given the barline/ending information collected per measure, this produces the
 * sequence of measure indices in the order they are actually performed. Forward
 * and backward repeats and first/second endings (voltas) are supported; da capo
 * / dal segno jumps are best-effort and documented as a limitation.
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

  // Safety bound: repeats can't legitimately expand beyond this many measures.
  const maxSteps = infos.length * 64 + 1000;
  let steps = 0;

  while (i < infos.length) {
    if (steps++ > maxSteps) break; // guard against pathological/broken input
    const m = infos[i];

    if (m.forwardRepeat && i !== repeatStart) {
      // Entering a fresh repeated section.
      repeatStart = i;
      pass = 1;
    }

    // Volta handling: if this measure opens an ending that does not apply on the
    // current pass, skip forward to the ending that does (or stop if none).
    if (m.endingStart && !m.endingStart.includes(pass)) {
      let j = i + 1;
      while (j < infos.length && !infos[j].endingStart?.includes(pass)) j++;
      if (j < infos.length) {
        i = j;
        continue;
      }
      break; // no matching ending remains
    }

    order.push(i);

    if (m.backwardRepeat) {
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

    i++;
  }

  return order;
}
