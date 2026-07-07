"""Unit tests for mxlmerge.merge_musicxml (stdlib only, runnable as a script).

Run with:  python3 services/omr/tests/test_mxlmerge.py
"""
from __future__ import annotations

import os
import sys
import xml.etree.ElementTree as ET

# Import the module under test without importing the whole `app` package (which
# pulls in fitz/PIL). mxlmerge.py is dependency-free, so we load it directly.
_APP_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "app")
sys.path.insert(0, _APP_DIR)

import mxlmerge  # noqa: E402


def _page(measure_number: int, note: str) -> str:
    """A minimal single-part, single-measure score-partwise document."""
    return (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<score-partwise version="4.0">'
        "  <part-list>"
        '    <score-part id="P1"><part-name>Music</part-name></score-part>'
        "  </part-list>"
        '  <part id="P1">'
        f'    <measure number="{measure_number}">'
        "      <attributes><divisions>1</divisions></attributes>"
        f"      <note><pitch><step>{note}</step><octave>4</octave></pitch>"
        "        <duration>4</duration><type>whole</type></note>"
        "    </measure>"
        "  </part>"
        "</score-partwise>"
    )


def test_two_pages_merge_to_two_measures() -> None:
    page1 = _page(1, "C")
    page2 = _page(1, "D")  # note the page restarts numbering at 1

    merged = mxlmerge.merge_musicxml([page1, page2])

    root = ET.fromstring(merged)
    parts = root.findall("part")
    assert len(parts) == 1, f"expected 1 part, got {len(parts)}"

    measures = parts[0].findall("measure")
    assert len(measures) == 2, f"expected 2 measures, got {len(measures)}"

    numbers = [m.get("number") for m in measures]
    assert numbers == ["1", "2"], f"expected continuous numbering, got {numbers}"

    # The part-list from the base document is preserved.
    assert root.find("part-list") is not None, "part-list missing from merged score"

    # Both pages' notes survive, in order.
    steps = [n.findtext("pitch/step") for n in parts[0].iter("note")]
    assert steps == ["C", "D"], f"expected notes C then D, got {steps}"


def test_single_document_passthrough() -> None:
    merged = mxlmerge.merge_musicxml([_page(1, "C")])
    root = ET.fromstring(merged)
    assert len(root.findall("part/measure")) == 1


def test_mismatched_part_counts_falls_back() -> None:
    # Second page has no <part> at all: it is skipped, base survives intact.
    empty = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<score-partwise version="4.0"><part-list/></score-partwise>'
    )
    merged = mxlmerge.merge_musicxml([_page(1, "C"), empty])
    root = ET.fromstring(merged)
    assert len(root.findall("part/measure")) == 1


def test_namespaced_page_is_not_dropped() -> None:
    # Regression: a page carrying a default XML namespace must still merge — a
    # tag-name findall("part") would return nothing and silently drop the page.
    ns_page = (
        '<?xml version="1.0" encoding="UTF-8"?>'
        '<score-partwise xmlns="http://example.com/musicxml" version="4.0">'
        '  <part-list><score-part id="P1"><part-name>M</part-name></score-part></part-list>'
        '  <part id="P1"><measure number="1">'
        "    <attributes><divisions>1</divisions></attributes>"
        "    <note><pitch><step>E</step><octave>4</octave></pitch>"
        "      <duration>4</duration></note>"
        "  </measure></part>"
        "</score-partwise>"
    )
    merged = mxlmerge.merge_musicxml([_page(1, "C"), ns_page])
    root = ET.fromstring(merged)
    # Base (non-namespaced) part now carries both measures, renumbered 1..2.
    measures = [m for m in root.iter() if m.tag.rsplit("}", 1)[-1] == "measure"]
    assert len(measures) == 2, f"namespaced page was dropped: {len(measures)} measures"


if __name__ == "__main__":
    test_two_pages_merge_to_two_measures()
    test_single_document_passthrough()
    test_mismatched_part_counts_falls_back()
    test_namespaced_page_is_not_dropped()
    print("OK: all mxlmerge tests passed")
