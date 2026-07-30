/**
 * A small Web Audio piano voice.
 *
 * The point is not realism, it is that a learner with no instrument can press
 * keys on the phone and hear pitch — so the app is usable on the bus. Each note
 * is three detuned partials through a low-pass with a plucked envelope, which
 * costs nothing and reads clearly as "piano-ish" on a phone speaker.
 */

/** Concert-pitch frequency of a MIDI note. */
export function midiToHz(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

interface Voice {
  osc: OscillatorNode[];
  gain: GainNode;
}

export class Synth {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly voices = new Map<number, Voice>();

  /**
   * Create/resume the audio context. Must be called from a user gesture —
   * iOS Safari starts every context suspended.
   */
  async resume(): Promise<void> {
    if (!this.ctx) {
      const Ctor: typeof AudioContext =
        window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.9;
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === "suspended") await this.ctx.resume();
  }

  /** Seconds on the audio clock; 0 before the context exists. */
  get now(): number {
    return this.ctx?.currentTime ?? 0;
  }

  noteOn(midi: number, velocity = 0.85, at?: number): void {
    if (!this.ctx || !this.master) return;
    this.noteOff(midi, at, 0.01);

    const t = at ?? this.ctx.currentTime;
    const hz = midiToHz(midi);
    const gain = this.ctx.createGain();
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    // Track the fundamental so low notes stay warm and high notes stay clear.
    filter.frequency.value = Math.min(9000, hz * 8 + 700);
    filter.Q.value = 0.4;

    // Partials: fundamental (triangle, body) + octave + twelfth (sine, sparkle).
    const spec: Array<[OscillatorType, number, number]> = [
      ["triangle", 1, 0.6],
      ["sine", 2, 0.22],
      ["sine", 3, 0.1],
    ];
    const osc = spec.map(([type, mult, level]) => {
      const o = this.ctx!.createOscillator();
      o.type = type;
      o.frequency.value = hz * mult;
      const g = this.ctx!.createGain();
      g.gain.value = level;
      o.connect(g).connect(filter);
      o.start(t);
      return o;
    });
    filter.connect(gain).connect(this.master);

    // Percussive attack, long-ish decay to a quiet sustain: piano, roughly.
    const peak = 0.28 * velocity;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(peak, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(peak * 0.35, t + 0.55);
    gain.gain.exponentialRampToValueAtTime(peak * 0.16, t + 2.2);

    this.voices.set(midi, { osc, gain });
  }

  noteOff(midi: number, at?: number, release = 0.22): void {
    const voice = this.voices.get(midi);
    if (!voice || !this.ctx) return;
    const t = at ?? this.ctx.currentTime;
    voice.gain.gain.cancelScheduledValues(t);
    voice.gain.gain.setValueAtTime(Math.max(voice.gain.gain.value, 0.0001), t);
    voice.gain.gain.exponentialRampToValueAtTime(0.0001, t + release);
    for (const o of voice.osc) o.stop(t + release + 0.05);
    this.voices.delete(midi);
  }

  /** Schedule a complete note; used by the "listen to it" demo playback. */
  playAt(midi: number, startSec: number, durationSec: number, velocity = 0.85): void {
    if (!this.ctx) return;
    this.noteOn(midi, velocity, startSec);
    // Hold slightly short of the written duration so repeated notes re-attack.
    const held = Math.max(0.08, durationSec - 0.03);
    const voice = this.voices.get(midi);
    if (!voice) return;
    this.voices.delete(midi); // scheduled notes are not "held" by a finger
    const end = startSec + held;
    // Drop the decay events at/after `end` and ramp down from wherever the
    // envelope has got to. No setValueAtTime anchor here: reading `.value` now
    // would sample the envelope at *scheduling* time, not at `end`, and pin the
    // release to a wrong (usually near-zero) level.
    voice.gain.gain.cancelScheduledValues(end);
    voice.gain.gain.exponentialRampToValueAtTime(0.0001, end + 0.25);
    for (const o of voice.osc) o.stop(end + 0.3);
  }

  /**
   * A short metronome blip for the count-in. Deliberately a different timbre
   * from the piano voice (a filtered square, very short) so a count-in beat is
   * never mistaken for a note of the piece.
   */
  click(accent = false): void {
    this.clickAt(this.now, accent);
  }

  /**
   * Schedule a click on the audio clock.
   *
   * Pitched at 2637 Hz (E7), deliberately **above YIN's 1500 Hz search range**:
   * with a real piano the click leaves the speaker and comes back through the
   * microphone, and a click inside the detector's range would be transcribed as a
   * note the learner never played.
   */
  clickAt(at: number, accent = false): void {
    if (!this.ctx || !this.master) return;
    const t = at;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = "square";
    osc.frequency.value = accent ? 2637 : 1976;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(accent ? 0.075 : 0.05, t + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.12);
  }

  /** Silence everything immediately (leaving practice, pressing stop). */
  allOff(): void {
    for (const midi of [...this.voices.keys()]) this.noteOff(midi, undefined, 0.05);
  }
}
