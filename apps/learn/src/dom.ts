/**
 * The handful of DOM helpers every screen needs.
 *
 * Extracted so that the screen modules read as layout and copy rather than as
 * `document.createElement` five times a function — and so that `main.ts` stops
 * being the file where everything happens to live.
 */

/** Look up a required element. Throws loudly rather than failing at first use. */
export function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} missing`);
  return el as T;
}

/** A styled element with text. `className` and `text` may both be empty. */
export function el(tag: string, className: string, text: string): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text) node.textContent = text;
  return node;
}

/** A button that does one thing. */
export function button(className: string, label: string, onClick: () => void): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = className;
  btn.textContent = label;
  btn.addEventListener("click", onClick);
  return btn;
}

export function openSheet(id: string): void {
  $(id).classList.remove("hidden");
}

export function closeSheet(id: string): void {
  $(id).classList.add("hidden");
}

export function show(id: string, visible: boolean): void {
  $(id).classList.toggle("hidden", !visible);
}
