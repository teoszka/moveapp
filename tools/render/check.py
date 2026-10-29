"""Checks on a built routine (SPEC §7.2 step 9).

  python -X utf8 tools/render/check.py [routine ...]

Needs audio/<id>/timeline.json and tools/render/cache/<id>.events.json, both written by build.py.
"""

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
EPS = 1e-3
DURATION_TOLERANCE = 0.05


def probe_duration(path):
    out = subprocess.run(["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
                         capture_output=True, text=True, check=True)
    return float(out.stdout.strip())


def check_routine(root, rid):
    root = Path(root)
    base = root / "audio" / rid
    problems = []
    tl = json.loads((base / "timeline.json").read_text(encoding="utf-8"))
    cache = json.loads((root / "tools" / "render" / "cache" / f"{rid}.events.json").read_text(encoding="utf-8"))
    p = lambda msg: problems.append(f"{rid}: {msg}")

    # Chapters contiguous, closing follows the last one.
    chapters = tl["chapters"]
    if abs(chapters[0]["start"]) > EPS:
        p(f"first chapter starts at {chapters[0]['start']}, not 0")
    for a, b in zip(chapters, chapters[1:]):
        if abs(a["end"] - b["start"]) > EPS:
            p(f"chapters {a['step']} and {b['step']} are not contiguous ({a['end']} vs {b['start']})")
    if abs(chapters[-1]["end"] - tl["closing"]["start"]) > EPS:
        p("last chapter does not end where closing starts")
    for c in chapters:
        segs = c["segments"]
        if abs(segs[0]["start"] - c["start"]) > EPS or abs(segs[-1]["end"] - c["end"]) > EPS:
            p(f"step {c['step']}: segments do not span the chapter")
        for a, b in zip(segs, segs[1:]):
            if abs(a["end"] - b["start"]) > EPS:
                p(f"step {c['step']}: segments not contiguous at {a['end']}")

    # No voice clip overlaps another voice clip or a 3-2-1 count tick.
    voice = sorted(((e["t"], e["t"] + e["dur"], e["key"]) for e in cache["events"] if e["kind"] == "clip"))
    ticks = [(e["t"], e["t"] + e["dur"]) for e in cache["events"] if e["kind"] == "tone" and e["count"]]
    for (s1, e1, k1), (s2, e2, k2) in zip(voice, voice[1:]):
        if s2 < e1 - EPS:
            p(f"voice clips overlap: {k1} ({s1:.2f}-{e1:.2f}) and {k2} ({s2:.2f})")
    for s, e, k in voice:
        for ts, te in ticks:
            if s < te - EPS and ts < e - EPS:
                p(f"voice clip {k} ({s:.2f}-{e:.2f}) overlaps a count tick at {ts:.2f}")

    # Encoded duration matches the timeline.
    got = probe_duration(base / "session.mp3")
    if abs(got - tl["audio"]["duration"]) > DURATION_TOLERANCE:
        p(f"session.mp3 is {got:.3f} s, timeline says {tl['audio']['duration']:.3f} s")
    if (base / "session.mp3").stat().st_size != tl["audio"]["bytes"]:
        p("timeline audio.bytes does not match session.mp3")

    # Every resume path exists.
    for rel in tl["resume"]["names"] + list(tl["resume"]["remaining"].values()):
        if not (base / rel).resolve().is_file():
            p(f"missing resume file {rel}")
    return problems


if __name__ == "__main__":
    ids = sys.argv[1:] or sorted(d.name for d in (ROOT / "audio").iterdir() if (d / "timeline.json").exists())
    found = []
    for rid in ids:
        found += check_routine(ROOT, rid)
    print("\n".join(found) if found else "OK")
    sys.exit(1 if found else 0)
