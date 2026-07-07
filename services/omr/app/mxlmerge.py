"""Merge several single-page MusicXML documents into one continuous score.

Long scores are OMR'd page by page (see pdfutil.split_pages) to bound the JVM
heap on the modest backend machine. Audiveris emits one `score-partwise`
document per page, each restarting its measure numbering at 1. This module
stitches those per-page documents back into a single coherent score.

Strategy (stdlib ElementTree only, no external deps):

  * The FIRST document is the base: its `<part-list>` and its parts' opening
    `<attributes>` (clef/key/time) are kept as-is.
  * For every subsequent page, its `<measure>` elements are APPENDED to the
    matching part of the base (parts are matched by position, since OMR pages
    almost always yield the same single part).
  * All measures of each part are then RENUMBERED sequentially so the numbering
    is continuous across page boundaries.

Known limitations:
  * Parts are matched by index, not by `<score-part>` id. Multi-part scores
    whose parts appear in a different order per page are not handled.
  * If pages disagree on part count, we merge the parts they share by index
    (best effort) and log a warning; extra parts are left untouched.
  * Musical structure that spans a page break — ties, slurs, repeat barlines,
    voltas — is preserved verbatim from each page but not reconciled across the
    seam, so a tie starting on the last measure of page N is not joined to its
    continuation on page N+1.
"""
from __future__ import annotations

import logging
import xml.etree.ElementTree as ET
from typing import List

log = logging.getLogger(__name__)

_XML_DECL = '<?xml version="1.0" encoding="UTF-8"?>'


def _localname(tag: str) -> str:
    """Strip any `{namespace}` prefix from an ElementTree tag."""
    return tag.rsplit("}", 1)[-1]


def _parts(root: ET.Element) -> List[ET.Element]:
    """Return the `<part>` elements of a score-partwise root, in document order.

    Matches by local name so a page carrying a default XML namespace (where
    `findall("part")` would return nothing and the page would be silently
    dropped) is still handled.
    """
    return [c for c in root if _localname(c.tag) == "part"]


def _measures(part: ET.Element) -> List[ET.Element]:
    """Return the `<measure>` elements of a part, in document order."""
    return [c for c in part if _localname(c.tag) == "measure"]


def _renumber(part: ET.Element) -> None:
    """Renumber a part's measures 1..N so numbering is continuous."""
    for i, measure in enumerate(_measures(part), start=1):
        measure.set("number", str(i))


def merge_musicxml(docs: List[str]) -> str:
    """Merge per-page `score-partwise` MusicXML documents into one score.

    Parameters
    ----------
    docs:
        MusicXML documents (as text), one per page, in page order. Each is
        expected to be a `score-partwise` score.

    Returns
    -------
    A single MusicXML document (with XML declaration) whose parts carry the
    concatenated, sequentially renumbered measures of every page.

    Raises
    ------
    ValueError
        If `docs` is empty.
    """
    if not docs:
        raise ValueError("merge_musicxml requires at least one document")
    if len(docs) == 1:
        # Nothing to merge; return the single page unchanged apart from a
        # normalized declaration so callers get consistent output.
        return _serialize(ET.fromstring(docs[0]))

    base_root = ET.fromstring(docs[0])
    base_parts = _parts(base_root)
    if not base_parts:
        # Degenerate base with no parts: return it verbatim, best effort.
        log.warning("merge_musicxml: base document has no <part>; returning it unchanged")
        return _serialize(base_root)

    for page_index, doc in enumerate(docs[1:], start=1):
        page_root = ET.fromstring(doc)
        page_parts = _parts(page_root)
        if not page_parts:
            log.warning("merge_musicxml: page %d has no <part>; skipping", page_index)
            continue

        if len(page_parts) == len(base_parts):
            # Common, well-behaved case: same part layout on every page.
            for base_part, page_part in zip(base_parts, page_parts):
                for measure in _measures(page_part):
                    base_part.append(measure)
        else:
            # Part counts disagree (e.g. Audiveris split a grand staff on one
            # page): append by index for as many parts as both share, rather than
            # dropping all but part 0. Extra parts on either side are left as-is.
            shared = min(len(page_parts), len(base_parts))
            log.warning(
                "merge_musicxml: page %d has %d part(s) but base has %d; "
                "merging the first %d by index",
                page_index, len(page_parts), len(base_parts), shared,
            )
            for bi in range(shared):
                for measure in _measures(page_parts[bi]):
                    base_parts[bi].append(measure)

    # Renumber every base part so measures run 1..N continuously.
    for part in base_parts:
        _renumber(part)

    return _serialize(base_root)


def _serialize(root: ET.Element) -> str:
    """Serialize a score root to text with an XML declaration."""
    body = ET.tostring(root, encoding="unicode")
    return f"{_XML_DECL}\n{body}"
