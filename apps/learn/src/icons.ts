/**
 * The icon set, as inline SVG.
 *
 * Deliberately not emoji. Emoji render differently on every platform, cannot be
 * recoloured with the theme, sit on their own baseline, and read as a placeholder
 * rather than as a product. These are 24×24 stroke icons on a single grid, so
 * they inherit `currentColor` and line up with the type.
 *
 * Kept as strings rather than DOM builders because every use site is either
 * static markup or a template — and `innerHTML` with a fixed constant is safe.
 */

const OPEN =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" ' +
  'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">';

const PATHS: Record<string, string> = {
  back: '<path d="M15 5l-7 7 7 7"/>',
  chevron: '<path d="M9 5l7 7-7 7"/>',
  play: '<path d="M8 5.5v13l11-6.5z" fill="currentColor" stroke="none"/>',
  moon: '<path d="M20.5 13.2A8.5 8.5 0 0 1 10.8 3.5a7 7 0 1 0 9.7 9.7z"/>',
  sun:
    '<circle cx="12" cy="12" r="4"/>' +
    '<path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.2 5.2l1.4 1.4M17.4 17.4l1.4 1.4M18.8 5.2l-1.4 1.4M6.6 17.4l-1.4 1.4"/>',
  settings:
    '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/>' +
    '<circle cx="16" cy="7" r="2.2"/><circle cx="8" cy="17" r="2.2"/>',
  keys:
    '<rect x="3" y="5.5" width="18" height="13" rx="2"/>' +
    '<path d="M8 5.5v7.5M12 5.5v7.5M16 5.5v7.5"/>',
  mic:
    '<rect x="9" y="3" width="6" height="10" rx="3"/>' +
    '<path d="M6 11a6 6 0 0 0 12 0M12 17v4M9.5 21h5"/>',
  ear: '<path d="M8 9a4 4 0 1 1 8 0c0 2-1.6 2.8-2.4 4-.6.9-.6 2.3-2.1 2.3-1.2 0-1.6-.9-1.6-1.8M12 20.5a5 5 0 0 1-5-5"/>',
  bolt: '<path d="M13 2.5 5.5 13.5H11l-1 8 8.5-11.5H13z" fill="currentColor" stroke="none"/>',
  star: '<path d="m12 3.6 2.6 5.4 5.9.8-4.3 4.1 1 5.9-5.2-2.8-5.2 2.8 1-5.9-4.3-4.1 5.9-.8z" fill="currentColor" stroke="none"/>',
  check: '<path d="M20 6.5 9.5 17 4 11.5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  note: '<path d="M9 18V6.5l9-2V16"/><circle cx="6.5" cy="18" r="2.6"/><circle cx="15.5" cy="16" r="2.6"/>',
  hand: '<path d="M8 12V5.5a1.6 1.6 0 0 1 3.2 0V11m0-1.5a1.6 1.6 0 0 1 3.2 0V12m0-1a1.6 1.6 0 0 1 3.2 0v4.5A5.5 5.5 0 0 1 12.2 21H11a6 6 0 0 1-6-6v-2.4a1.6 1.6 0 0 1 3.2 0"/>',
  stand: '<path d="M12 3v13M5 21l7-5 7 5M4 8h16"/>',
  loop: '<path d="M4 9V7a2 2 0 0 1 2-2h12l-3-3m3 11v2a2 2 0 0 1-2 2H4l3 3"/>',
  metro: '<path d="M12 4 6 20h12L12 4z"/><path d="M8.6 13h6.8M12 13l6-7"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>',
  upload:
    '<path d="M12 16V4m0 0L7.5 8.5M12 4l4.5 4.5M4 16v2.5A1.5 1.5 0 0 0 5.5 20h13a1.5 1.5 0 0 0 1.5-1.5V16"/>',
  page: '<rect x="4" y="3.5" width="16" height="17" rx="2"/><path d="M8 9h8M8 13h8M8 17h5"/>',
  pause: '<path d="M9 5v14M15 5v14"/>',
  trash: '<path d="M4 7h16M10 7V5h4v2M6 7l1 13h10l1-13M10.5 11v5M13.5 11v5"/>',
  dumbbell: '<path d="M3 10v4M6 7.5v9M18 7.5v9M21 10v4M6 12h12"/>',
};

/** One icon as an inline `<svg>` string. Unknown names render nothing. */
export function icon(name: keyof typeof PATHS | string, size = 20): string {
  const body = PATHS[name];
  if (!body) return "";
  return OPEN.replace("<svg", `<svg width="${size}" height="${size}"`) + body + "</svg>";
}

/**
 * The brand mark: the same piano glyph as the app icon, at UI scale.
 * Not an icon from the set above — it is filled, coloured and self-contained.
 */
export const BRAND_MARK =
  '<svg viewBox="0 0 40 40" width="38" height="38" aria-hidden="true" focusable="false">' +
  '<defs><linearGradient id="bm" x1="0" y1="0" x2="0.4" y2="1">' +
  '<stop offset="0" stop-color="#f7c65c"/><stop offset="1" stop-color="#d0821f"/>' +
  "</linearGradient></defs>" +
  '<rect width="40" height="40" rx="11" fill="url(#bm)"/>' +
  '<rect x="7" y="12" width="26" height="16" rx="2" fill="#fdfbf6"/>' +
  '<g stroke="#c9a978" stroke-width="0.9"><path d="M13.4 13v14M19.8 13v14M26.2 13v14"/></g>' +
  '<g fill="#241803"><rect x="10.4" y="12" width="3.2" height="9.5" rx="0.8"/>' +
  '<rect x="16.6" y="12" width="3.2" height="9.5" rx="0.8"/>' +
  '<rect x="25.4" y="12" width="3.2" height="9.5" rx="0.8"/></g>' +
  "</svg>";
