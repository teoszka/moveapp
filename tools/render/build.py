"""MoveApp render pipeline (SPEC §7).

  python -X utf8 tools/render/build.py [--routine <id>] [--force-voice]

Validates content, renders the voice with Chatterbox (cached), mixes one session.mp3 per routine and writes
timeline.json, resume clips, shared clips and content/library.json.
"""

import argparse
import hashlib
import json
import math
import re
import subprocess
import sys
from pathlib import Path

import numpy as np

sys.path.insert(0, str(Path(__file__).resolve().parent))

import check  # noqa: E402
import timeline as tl  # noqa: E402
import tones  # noqa: E402
from content import BuildError, clamp_remaining, load_content, remaining_max, script_lines  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]
SR = tones.SR
PEAK_CEILING = 10 ** (-1.0 / 20)
BITRATE = "96k"


def encode_mp3(wav, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-f", "f32le", "-ar", str(SR), "-ac", "1", "-i", "pipe:0",
         "-c:a", "libmp3lame", "-b:a", BITRATE, "-ac", "1", "-ar", str(SR),
         "-map_metadata", "-1", "-fflags", "+bitexact", "-flags:a", "+bitexact", str(path)],
        input=wav.astype("<f4").tobytes(), check=True)


def gain_and_limit(wav, db):
    out = wav * (10 ** (db / 20))
    peak = float(np.max(np.abs(out)))
    scale = PEAK_CEILING / peak if peak > PEAK_CEILING else 1.0
    return (out * scale).astype(np.float32), scale


def mix_routine(routine, mood, content, timeline, events, clips):
    n = int(math.ceil(timeline["duration"] * SR)) + 1
    mix = np.zeros(n, dtype=np.float32)
    tone_cache, breath_cache = {}, {}

    def add(wav, t):
        s = int(round(t * SR))
        e = min(n, s + len(wav))
        mix[s:e] += wav[: e - s]

    resolved = []
    for e in events:
        if e["kind"] == "clip":
            add(clips[e["key"]], e["t"])
            resolved.append({**e, "dur": round(len(clips[e["key"]]) / SR, 4)})
        elif e["kind"] == "tone":
            w = tone_cache.setdefault(e["id"], tones.tone(mood["tones"], e["id"]))
            add(w, e["t"])
            resolved.append({**e, "dur": round(len(w) / SR, 4)})
        else:
            pattern = content.patterns[routine["steps"][e["step"]]["breath"]]
            seconds = round(e["end"] - e["t"], 3)
            w = breath_cache.setdefault((id(pattern), seconds), tones.breath(pattern["phases"], seconds))
            add(w, e["t"])
    mixed, scale = gain_and_limit(mix, mood["mixGainDb"])
    return mixed, scale, resolved


def build_hash(parts):
    h = hashlib.sha1()
    for p in parts:
        h.update(p)
    return h.hexdigest()[:12]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--routine", help="build only this routine id")
    ap.add_argument("--force-voice", action="store_true", help="ignore the take cache and re-render every line")
    args = ap.parse_args()

    try:
        content = load_content(ROOT)
        ids = sorted(content.routines, key=lambda r: content.routines[r]["order"])
        if args.routine:
            if args.routine not in content.routines:
                raise BuildError(f"--routine: unknown routine '{args.routine}' (have: {', '.join(ids)})")
            ids = [args.routine]
        lines = script_lines(content, ids)
        from tts import Voice
        voice = Voice(content, ROOT, force=args.force_voice)
    except BuildError as e:
        sys.exit("Build stopped:\n" + e.args[0])

    print(f"{len(lines)} voice lines for {', '.join(ids)}", flush=True)
    clips, durations, flagged = {}, {}, []
    for key, (text, mood) in lines.items():
        try:
            wav, info = voice.clip(key, text, mood)
        except BuildError as e:
            sys.exit("Build stopped:\n" + e.args[0])
        clips[key] = wav
        durations[key] = round(len(wav) / SR, 4)
        if info["flagged"]:
            flagged.append((key, text))

    audio_dir = ROOT / "audio"
    report = []
    for rid in ids:
        routine = content.routines[rid]
        mood_name = routine["mood"]
        mood = content.moods[mood_name]
        patterns = content.patterns
        timeline, events = tl.build_timeline(routine, content.exercises, patterns, {**mood, "name": mood_name}, durations)
        mixed, scale, resolved = mix_routine(routine, mood, content, timeline, events, clips)
        out_dir = audio_dir / rid
        session = out_dir / "session.mp3"
        encode_mp3(mixed, session)

        resume_names = []
        for i in range(len(routine["steps"])):
            w, _ = gain_and_limit(clips[f"{rid}/{i}/resume"], mood["mixGainDb"])
            encode_mp3(w, out_dir / "resume" / f"{i}.mp3")
            resume_names.append(f"resume/{i}.mp3")
        remaining = {}
        for r in range(5, remaining_max(content, mood_name) + 1, 5):
            w, _ = gain_and_limit(clips[f"shared/{mood_name}/t{r:03d}"], mood["mixGainDb"])
            encode_mp3(w, audio_dir / "_shared" / mood_name / f"t{r:03d}.mp3")
            remaining[str(r)] = f"../_shared/{mood_name}/t{r:03d}.mp3"

        doc = {
            "schema": 1,
            "routine": rid,
            "build": "",
            "audio": {"src": "session.mp3", "duration": timeline["duration"], "bytes": session.stat().st_size},
            "chapters": timeline["chapters"],
            "closing": timeline["closing"],
            "breath": timeline["breath"],
            "resume": {"names": resume_names, "remaining": remaining},
        }
        files = [session.read_bytes()] + [(out_dir / n).read_bytes() for n in resume_names]
        doc["build"] = build_hash(files + [json.dumps({k: v for k, v in doc.items() if k != "build"}, sort_keys=True).encode()])
        (out_dir / "timeline.json").write_text(json.dumps(doc, indent=1) + "\n", encoding="utf-8")
        cache_events = {"clips": {k: durations[k] for k in lines}, "events": resolved}
        (ROOT / "tools" / "render" / "cache" / f"{rid}.events.json").write_text(json.dumps(cache_events), encoding="utf-8")

        report.append((rid, routine, timeline, session, scale, doc["build"]))

    write_library(content)

    print("\n== Build report ==")
    for rid, routine, timeline, session, scale, build in report:
        d = timeline["duration"]
        print(f"{rid} ({routine['title']}): {int(d // 60)}:{d % 60:04.1f}  build {build}  {session.stat().st_size / 1e6:.2f} MB"
              + (f"  (peak limited by {20 * math.log10(scale):.1f} dB)" if scale < 1 else ""))
        for ch in timeline["chapters"]:
            trans = ch["segments"][0]
            print(f"   step {ch['step'] + 1:2d} {ch['exercise']:26s} transition {trans['end'] - trans['start']:5.1f} s")
    if flagged:
        print("\nFlagged takes (speaking rate implausible after 4 tries; listen, then pin a seed in voice.json `takes`):")
        for key, text in flagged:
            print(f"   {key}: {text}")
    else:
        print("\nFlagged takes: none")

    print("\n== Check ==")
    problems = []
    for rid in ids:
        problems += check.check_routine(ROOT, rid)
    if problems:
        print("\n".join(problems))
        sys.exit(1)
    print("OK")


def write_library(content):
    entries, missing = [], []
    for rid in sorted(content.routines, key=lambda r: content.routines[r]["order"]):
        r = content.routines[rid]
        path = ROOT / "audio" / rid / "timeline.json"
        if not path.exists():
            missing.append(rid)
            continue
        t = json.loads(path.read_text(encoding="utf-8"))
        entries.append({"id": rid, "title": r["title"], "mood": r["mood"], "summary": r["summary"],
                        "duration": t["audio"]["duration"], "steps": len(r["steps"]), "build": t["build"]})
    (ROOT / "content" / "library.json").write_text(json.dumps(entries, indent=1) + "\n", encoding="utf-8")
    if missing:
        print(f"Warning: not yet built, left out of library.json: {', '.join(missing)}")


if __name__ == "__main__":
    main()
