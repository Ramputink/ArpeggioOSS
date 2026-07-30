/**
 * Reading `.mxl` — compressed MusicXML.
 *
 * `.mxl` is a zip archive holding the score plus a `META-INF/container.xml` that
 * names which entry inside it is the score. It matters because it is what
 * MuseScore, Sibelius and Finale export **by default**, so "export it
 * uncompressed instead" was an instruction every single user would have hit
 * before they ever saw a note.
 *
 * No zip library is shipped for it. A zip is a handful of fixed-layout records,
 * and the only genuinely hard part — DEFLATE — is already in every browser and
 * in Node as `DecompressionStream("deflate-raw")`. That is ~150 lines here
 * against ~40 kB of dependency in a bundle that has to work offline on a phone.
 *
 * Only what a score archive actually uses is supported: stored (method 0) and
 * deflated (method 8) entries. Encryption, spanning and zip64 are rejected with
 * a message that says what to do instead, rather than producing nonsense.
 */

/** Local file header, central directory and end-of-central-directory magic. */
const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;

/** The EOCD sits at the end, after a comment of at most 0xffff bytes. */
const MAX_EOCD_SEARCH = 0xffff + 22;

interface ZipEntry {
  name: string;
  method: number;
  compressedSize: number;
  uncompressedSize: number;
  localOffset: number;
  /** Bit 0 of the general-purpose flags: the entry is encrypted. */
  encrypted: boolean;
}

/** Read the central directory. Throws with a user-facing message on anything odd. */
function readDirectory(view: DataView): ZipEntry[] {
  let eocd = -1;
  const from = Math.max(0, view.byteLength - MAX_EOCD_SEARCH);
  for (let i = view.byteLength - 22; i >= from; i--) {
    if (view.getUint32(i, true) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("El archivo .mxl está dañado");

  const count = view.getUint16(eocd + 10, true);
  let offset = view.getUint32(eocd + 16, true);
  if (offset === 0xffffffff) throw new Error("El archivo .mxl es demasiado grande (zip64)");

  const entries: ZipEntry[] = [];
  for (let i = 0; i < count; i++) {
    if (offset + 46 > view.byteLength || view.getUint32(offset, true) !== SIG_CENTRAL) break;
    const flags = view.getUint16(offset + 8, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    entries.push({
      name: decodeUtf8(new Uint8Array(view.buffer, view.byteOffset + offset + 46, nameLength)),
      method: view.getUint16(offset + 10, true),
      compressedSize: view.getUint32(offset + 20, true),
      uncompressedSize: view.getUint32(offset + 24, true),
      localOffset: view.getUint32(offset + 42, true),
      encrypted: (flags & 1) !== 0,
    });
    offset += 46 + nameLength + extraLength + commentLength;
  }
  if (entries.length === 0) throw new Error("El archivo .mxl está vacío");
  return entries;
}

/** Bytes of one entry, inflating it when it is deflated. */
async function readEntry(view: DataView, entry: ZipEntry): Promise<Uint8Array> {
  if (entry.encrypted) throw new Error("La partitura está protegida con contraseña");
  const at = entry.localOffset;
  if (at + 30 > view.byteLength || view.getUint32(at, true) !== SIG_LOCAL) {
    throw new Error("El archivo .mxl está dañado");
  }
  // The local header repeats the name and extra fields with its *own* lengths;
  // trusting the central directory's here is the classic way to read garbage.
  const nameLength = view.getUint16(at + 26, true);
  const extraLength = view.getUint16(at + 28, true);
  const start = at + 30 + nameLength + extraLength;
  const raw = new Uint8Array(view.buffer, view.byteOffset + start, entry.compressedSize);

  if (entry.method === 0) return raw;
  if (entry.method !== 8) throw new Error("El .mxl usa una compresión que no entiendo");

  // `raw` is a view onto the whole archive; copy it so the Blob owns a plain
  // ArrayBuffer of exactly this entry.
  const copy = raw.slice();
  const stream = new Blob([copy.buffer as ArrayBuffer])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function decodeUtf8(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes);
}

/**
 * Which entry holds the score.
 *
 * `META-INF/container.xml` is the authority and is present in every conforming
 * archive; the fallback exists because OMR tools and older exporters sometimes
 * ship the score alone.
 */
function scoreEntryName(container: string | null, entries: ZipEntry[]): string {
  const declared = container?.match(/full-path\s*=\s*"([^"]+)"/)?.[1];
  if (declared && entries.some((e) => e.name === declared)) return declared;

  const candidate = entries.find(
    (e) =>
      !e.name.startsWith("META-INF/") && !e.name.endsWith("/") && /\.(musicxml|xml)$/i.test(e.name),
  );
  if (!candidate) throw new Error("El .mxl no contiene ninguna partitura");
  return candidate.name;
}

/**
 * Extract the MusicXML document from a `.mxl` archive.
 *
 * @param buffer The raw file, as read by `File.arrayBuffer()`.
 * @returns The uncompressed MusicXML text, ready for `parseMusicXML`.
 */
export async function readMxl(buffer: ArrayBuffer): Promise<string> {
  const view = new DataView(buffer);
  const entries = readDirectory(view);

  const containerEntry = entries.find((e) => e.name === "META-INF/container.xml");
  const container = containerEntry ? decodeUtf8(await readEntry(view, containerEntry)) : null;

  const name = scoreEntryName(container, entries);
  const entry = entries.find((e) => e.name === name)!;
  const text = decodeUtf8(await readEntry(view, entry));
  // Exporters routinely emit a UTF-8 BOM, and an XML parser fed one fails on
  // the very first character with an error that explains nothing.
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** True for the file extensions the importer should route through {@link readMxl}. */
export function isCompressedMusicXML(fileName: string): boolean {
  return /\.mxl$/i.test(fileName);
}
