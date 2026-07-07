/**
 * OMR backend client. In production the app is served BY the backend, so the
 * default base URL is same-origin (""); override with ?backend=... for dev.
 */

/** Resolve the backend base URL: ?backend= query param, else same-origin. */
export function backendBase(): string {
  const q = new URLSearchParams(location.search).get("backend");
  if (q) return q.replace(/\/$/, "");
  // Same-origin when served by the backend; empty string keeps fetch relative.
  return "";
}

export async function health(base = backendBase()): Promise<{ ok: boolean; version?: string }> {
  try {
    const res = await fetch(`${base}/health`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { ok: false };
    const j = await res.json();
    return { ok: j.status === "ok", version: j.audiveris_version };
  } catch {
    return { ok: false };
  }
}

/** Send an image/PDF to the OMR backend and return the MusicXML text. */
export async function omrToMusicXML(file: File, base = backendBase()): Promise<string> {
  const form = new FormData();
  form.append("file", file, file.name);
  const res = await fetch(`${base}/omr`, { method: "POST", body: form });
  if (!res.ok) {
    let detail = `HTTP ${res.status}`;
    try {
      const j = await res.json();
      if (j?.detail) detail = j.detail;
    } catch {
      /* non-JSON error body */
    }
    throw new Error(`OMR failed: ${detail}`);
  }
  return res.text();
}

/** Extensions we can OMR (vs. parse directly). */
export function needsOmr(name: string): boolean {
  return /\.(pdf|png|jpe?g|tif?f|bmp)$/i.test(name);
}
