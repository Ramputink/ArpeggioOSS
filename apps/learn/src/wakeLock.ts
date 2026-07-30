/**
 * Keep the screen awake while practising.
 *
 * Without this the phone locks itself in the middle of a piece, which at a real
 * piano ends the session — your hands are on the keys, so you cannot tap to wake
 * it, and the practice loop dies with the page.
 *
 * Two details the API demands:
 *
 *  - The lock is released by the browser whenever the page is hidden (switching
 *    apps, an incoming call), and it is NOT restored automatically. It has to be
 *    re-requested on `visibilitychange`.
 *  - `request()` rejects on an insecure context, in a background tab, on low
 *    battery, or simply where the API does not exist (Safari gained it in 16.4).
 *    Every failure here is non-fatal: practice must continue on a phone that
 *    dims, so nothing about this is allowed to throw.
 */

interface WakeLockSentinelLike {
  released: boolean;
  release(): Promise<void>;
  addEventListener(type: "release", listener: () => void): void;
}

interface WakeLockAPI {
  request(type: "screen"): Promise<WakeLockSentinelLike>;
}

function api(): WakeLockAPI | undefined {
  return (navigator as Navigator & { wakeLock?: WakeLockAPI }).wakeLock;
}

export class ScreenAwake {
  private sentinel: WakeLockSentinelLike | null = null;
  /** True between `acquire()` and `release()`, regardless of whether it worked. */
  private wanted = false;
  private listening = false;

  /** Is a lock actually held right now? Surfaced for diagnostics. */
  get held(): boolean {
    return this.sentinel !== null && !this.sentinel.released;
  }

  /** Is the API available at all on this browser? */
  get supported(): boolean {
    return api() !== undefined;
  }

  /** Ask to stay awake. Safe to call repeatedly. */
  async acquire(): Promise<void> {
    this.wanted = true;
    this.listen();
    if (this.held) return;
    try {
      const sentinel = await api()?.request("screen");
      if (!sentinel) return;
      // A lock the browser drops on its own must not be remembered as held.
      sentinel.addEventListener("release", () => {
        if (this.sentinel === sentinel) this.sentinel = null;
      });
      this.sentinel = sentinel;
      // Released while we were awaiting: honour the newer intent.
      if (!this.wanted) void this.release();
    } catch {
      /* unsupported, insecure context, background tab, or battery saver */
    }
  }

  /** Let the screen sleep again. */
  async release(): Promise<void> {
    this.wanted = false;
    const sentinel = this.sentinel;
    this.sentinel = null;
    try {
      await sentinel?.release();
    } catch {
      /* already gone */
    }
  }

  private listen(): void {
    if (this.listening) return;
    this.listening = true;
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "visible" && this.wanted) void this.acquire();
    });
  }
}
