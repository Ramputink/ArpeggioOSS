/**
 * Reading compressed MusicXML.
 *
 * The archives are built here rather than checked in as binary fixtures, so the
 * test says exactly which zip layout it is exercising — stored vs deflated,
 * container vs no container — instead of hiding it in a blob.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { deflateRawSync } from "node:zlib";

import { isCompressedMusicXML, readMxl } from "../src/mxl.js";

const SCORE = `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="4.0">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1"><measure number="1">
    <attributes><divisions>1</divisions><key><fifths>1</fifths></key>
      <time><beats>4</beats><beat-type>4</beat-type></time></attributes>
    <note><pitch><step>G</step><octave>4</octave></pitch><duration>4</duration><voice>1</voice><staff>1</staff></note>
  </measure></part>
</score-partwise>`;

const CONTAINER = `<?xml version="1.0" encoding="UTF-8"?>
<container><rootfiles>
  <rootfile full-path="score.xml" media-type="application/vnd.recordare.musicxml+xml"/>
</rootfiles></container>`;

interface Member {
  name: string;
  body: string | Uint8Array;
  /** 0 = stored, 8 = deflated. */
  method?: 0 | 8;
}

/** Build a minimal but conforming zip archive. */
function zip(members: Member[]): ArrayBuffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;

  for (const member of members) {
    const method = member.method ?? 8;
    const raw =
      typeof member.body === "string" ? Buffer.from(member.body, "utf8") : Buffer.from(member.body);
    const data = method === 8 ? deflateRawSync(raw) : raw;
    const name = Buffer.from(member.name, "utf8");

    const local = Buffer.alloc(30 + name.length);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(method, 8);
    // CRC is left at zero: nothing in the reader verifies it, and a fixture that
    // pretended to would be testing node:zlib rather than the reader.
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26);
    name.copy(local, 30);

    const central = Buffer.alloc(46 + name.length);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt32LE(offset, 42);
    name.copy(central, 46);

    locals.push(local, data);
    centrals.push(central);
    offset += local.length + data.length;
  }

  const directory = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(members.length, 8);
  eocd.writeUInt16LE(members.length, 10);
  eocd.writeUInt32LE(directory.length, 12);
  eocd.writeUInt32LE(offset, 16);

  const out = Buffer.concat([...locals, directory, eocd]);
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
}

test("reads the score a container.xml points at", async () => {
  // The realistic case: two entries, and the score is not the first one.
  const archive = zip([
    { name: "META-INF/container.xml", body: CONTAINER },
    { name: "decoy.xml", body: "<not-a-score/>" },
    { name: "score.xml", body: SCORE },
  ]);
  const xml = await readMxl(archive);
  assert.match(xml, /score-partwise/);
  assert.match(xml, /<fifths>1<\/fifths>/);
});

test("falls back to the only score when there is no container", async () => {
  const archive = zip([{ name: "MyPiece.musicxml", body: SCORE }]);
  assert.match(await readMxl(archive), /score-partwise/);
});

test("reads a stored (uncompressed) entry", async () => {
  // Exporters commonly store container.xml and deflate only the score.
  const archive = zip([
    { name: "META-INF/container.xml", body: CONTAINER, method: 0 },
    { name: "score.xml", body: SCORE, method: 0 },
  ]);
  assert.match(await readMxl(archive), /score-partwise/);
});

test("strips a UTF-8 BOM", async () => {
  // A BOM makes an XML parser fail on character 1 with an error about nothing.
  const archive = zip([{ name: "score.xml", body: "﻿" + SCORE }]);
  const xml = await readMxl(archive);
  assert.equal(xml.charCodeAt(0), "<".charCodeAt(0));
});

test("rejects a file that is not a zip, with something a learner can act on", async () => {
  const junk = Buffer.from("this is not a zip file at all, not even close");
  await assert.rejects(
    () =>
      readMxl(junk.buffer.slice(junk.byteOffset, junk.byteOffset + junk.byteLength) as ArrayBuffer),
    /dañado/,
  );
});

test("rejects an archive with no score inside", async () => {
  const archive = zip([{ name: "readme.txt", body: "nothing to see" }]);
  await assert.rejects(() => readMxl(archive), /no contiene ninguna partitura/);
});

test("recognises the extension it should route", () => {
  assert.equal(isCompressedMusicXML("Nocturne.mxl"), true);
  assert.equal(isCompressedMusicXML("Nocturne.MXL"), true);
  assert.equal(isCompressedMusicXML("Nocturne.musicxml"), false);
  assert.equal(isCompressedMusicXML("Nocturne.xml"), false);
});
