"""Pipeline tests that need no GPU: validation (AC-2.1, AC-N.4), shared exercises (AC-3.1), timeline rules (AC-2.2, AC-5.1, AC-6.2).

  python -X utf8 -m unittest discover -s tools/render -p "test_*.py"
"""

import copy
import json
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import timeline as tl  # noqa: E402
from content import BuildError, announcement, clamp_remaining, load_content, remaining_max, remaining_text, script_lines  # noqa: E402

ROOT = Path(__file__).resolve().parents[2]


class Fixture:
    """A throwaway copy of content/ that a test can break."""

    def __enter__(self):
        self.dir = Path(tempfile.mkdtemp())
        shutil.copytree(ROOT / "content", self.dir / "content", ignore=shutil.ignore_patterns("library.json"))
        return self

    def __exit__(self, *a):
        shutil.rmtree(self.dir)

    def edit(self, rel, fn):
        p = self.dir / "content" / rel
        data = json.loads(p.read_text(encoding="utf-8"))
        fn(data)
        p.write_text(json.dumps(data), encoding="utf-8")

    def problems(self):
        try:
            load_content(self.dir)
        except BuildError as e:
            return e.problems
        return []


class Validation(unittest.TestCase):
    def assertRejects(self, edit_rel, fn, *needles):
        with Fixture() as f:
            f.edit(edit_rel, fn)
            msgs = "\n".join(f.problems())
            self.assertTrue(msgs, "expected the build to be rejected")
            for n in needles:
                self.assertIn(n, msgs)

    def test_v1_content_is_valid(self):
        with Fixture() as f:
            self.assertEqual(f.problems(), [])

    def test_unknown_exercise(self):
        self.assertRejects("routines/morning.json", lambda d: d["steps"][0].update(exercise="nope"),
                           "routines/morning.json.steps[0].exercise")

    def test_bad_sides(self):
        self.assertRejects("routines/morning.json", lambda d: d["steps"][4].update(sides=3), "steps[4].sides")

    def test_missing_source(self):
        self.assertRejects("routines/morning.json", lambda d: d.pop("source"), "morning.json.source")

    def test_bad_youtube_id(self):
        self.assertRejects("routines/morning.json", lambda d: d["source"].update(youtubeId="x'><script"), "source.youtubeId")

    def test_bad_video_at(self):
        self.assertRejects("routines/morning.json", lambda d: d["steps"][1].update(videoAt=-1), "steps[1].videoAt")
        self.assertRejects("routines/morning.json", lambda d: d["steps"][1].update(videoAt=1.5), "steps[1].videoAt")

    def test_bad_ids(self):
        def rename(d):
            d["Bad_Id"] = d.pop("cat-cow")
        self.assertRejects("exercises.json", rename, "exercises.json: Bad_Id")

    def test_markup_in_text(self):
        self.assertRejects("exercises.json", lambda d: d["cat-cow"].update(cue="Round <b>up</b>"), "cat-cow.cue")

    def test_pattern_without_out(self):
        def f(d):
            d["box"]["phases"] = [p for p in d["box"]["phases"] if p["kind"] != "out"]
        self.assertRejects("breath-patterns.json", f, "at least one 'out'")

    def test_unknown_breath(self):
        self.assertRejects("routines/evening.json", lambda d: d["steps"][0].update(breath="nope"), "steps[0].breath")


class SharedExercises(unittest.TestCase):
    def test_cue_override_changes_only_that_routine(self):
        with Fixture() as f:
            other = copy.deepcopy(json.loads((f.dir / "content/routines/morning.json").read_text(encoding="utf-8")))
            other["id"], other["order"] = "morning-b", 3
            other["steps"] = [{"exercise": "cat-cow", "work": 45, "cue": "A different cue."}]
            (f.dir / "content/routines/morning-b.json").write_text(json.dumps(other), encoding="utf-8")
            c = load_content(f.dir)
            a = announcement(c, c.routines["morning"], 1)
            b = announcement(c, c.routines["morning-b"], 0)
            self.assertIn("On hands and knees, slowly round and arch your spine.", a)
            self.assertIn("thirty seconds", a)
            self.assertIn("forty-five seconds", b)
            self.assertTrue(b.endswith("A different cue."))
            self.assertNotIn("A different cue.", a)


class Script(unittest.TestCase):
    def test_spec_examples(self):
        c = load_content(ROOT)
        self.assertEqual(announcement(c, c.routines["morning"], 0),
                         "First: Knee hug rock, thirty seconds. Lie on your back, hug your knees, and rock gently side to side.")
        self.assertEqual(announcement(c, c.routines["morning"], 4),
                         "Next: Hip circles, fifteen seconds per side. Lift your knee and draw a big circle. Hold a wall if you need to.")
        self.assertEqual(announcement(c, c.routines["evening"], 3),
                         "Last one: Child's pose, two minutes. Knees wide, reach forward, forehead down. Let your lower back release.")
        self.assertEqual(remaining_text(80), "One minute twenty seconds left.")
        self.assertEqual(remaining_text(120), "Two minutes left.")
        self.assertEqual(remaining_text(25), "twenty-five seconds left.")

    def test_remaining_range_and_clamp(self):
        c = load_content(ROOT)
        self.assertEqual(remaining_max(c, "energize"), 30)
        self.assertEqual(remaining_max(c, "wind-down"), 120)
        self.assertEqual(clamp_remaining(123.5, 120), 120)
        self.assertEqual(clamp_remaining(6.0, 30), 5)
        self.assertEqual(clamp_remaining(100, 30), 30)

    def test_line_keys(self):
        c = load_content(ROOT)
        keys = script_lines(c, ["evening"])
        for k in ("evening/0/announce", "evening/3/resume", "shared/wind-down/closing", "shared/wind-down/breath/box/3",
                  "shared/wind-down/breath/fold/1", "shared/wind-down/t120", "shared/wind-down/t005"):
            self.assertIn(k, keys)
        self.assertNotIn("shared/wind-down/switch", keys)


def fake_durations(c, rid, announce=6.0, switch=0.8, closing=2.5):
    d = {}
    r = c.routines[rid]
    for i in range(len(r["steps"])):
        d[f"{rid}/{i}/announce"] = announce
    d[f"shared/{r['mood']}/switch"] = switch
    d[f"shared/{r['mood']}/closing"] = closing
    return d


class Timeline(unittest.TestCase):
    def build(self, rid, **kw):
        c = load_content(ROOT)
        r = c.routines[rid]
        mood = {**c.moods[r["mood"]]}
        return tl.build_timeline(r, c.exercises, c.patterns, mood, fake_durations(c, rid, **kw)), c

    def test_breath_alignment(self):
        c = load_content(ROOT)
        self.assertEqual(tl.align_breath(c.patterns["box"]["phases"], 120), 124)
        self.assertEqual(tl.align_breath(c.patterns["fold"]["phases"], 120), 120)

    def test_transition_minimums_morning(self):
        (t, _), c = self.build("morning", announce=3.0)  # short announcements: the settle window decides
        settles = [10, 5, 10, 5, 5, 5, 5, 10, 5, 10, 5]
        for ch, s in zip(t["chapters"], settles):
            seg = ch["segments"][0]
            self.assertEqual(seg["kind"], "transition")
            self.assertGreaterEqual(round(seg["end"] - seg["start"], 3), s)

    def test_transition_never_shorter_than_announcement_plus_count(self):
        (t, _), c = self.build("morning", announce=9.0)
        for ch in t["chapters"]:
            seg = ch["segments"][0]
            self.assertGreaterEqual(seg["end"] - seg["start"], 9.0 + 4.1 - 1e-9)

    def test_chapters_contiguous_and_sides(self):
        (t, ev), c = self.build("morning")
        for a, b in zip(t["chapters"], t["chapters"][1:]):
            self.assertEqual(a["end"], b["start"])
        self.assertEqual(t["chapters"][-1]["end"], t["closing"]["start"])
        kinds = [s["kind"] for s in t["chapters"][4]["segments"]]  # hip circles, two sides
        self.assertEqual(kinds, ["transition", "work", "switch", "work"])
        work = [s for s in t["chapters"][4]["segments"] if s["kind"] == "work"]
        self.assertEqual([w["end"] - w["start"] for w in work], [15, 15])
        switch = [s for s in t["chapters"][4]["segments"] if s["kind"] == "switch"][0]
        self.assertEqual(round(switch["end"] - switch["start"], 3), 3.0)
        # no 3-2-1 ticks inside the switch gap
        ticks = [e for e in ev if e["kind"] == "tone" and e["count"]]
        self.assertFalse([e for e in ticks if switch["start"] < e["t"] < switch["end"]])

    def test_evening_breath_alignment_and_prompts(self):
        (t, ev), c = self.build("evening")
        for ch in t["chapters"]:
            work = [s for s in ch["segments"] if s["kind"] == "work"][0]
            self.assertEqual(work["end"] - work["start"], 120 if ch["exercise"] == "butterfly-pulses" else 124)
        prompts = {}
        for e in ev:
            if e["kind"] == "clip" and "/breath/" in e["key"]:
                prompts.setdefault(e["key"].split("/breath/")[1].split("/")[0], []).append(e["t"])
        self.assertEqual(len(prompts["box"]), 8)   # 2 cycles x 4 phases, first box position only
        self.assertEqual(len(prompts["fold"]), 4)  # 2 cycles x 2 phases
        first_box = [s for s in t["chapters"][0]["segments"] if s["kind"] == "work"][0]
        self.assertAlmostEqual(min(prompts["box"]), first_box["start"] + tl.PROMPT_OFFSET, places=3)
        self.assertTrue(all(p < t["chapters"][1]["start"] for p in prompts["box"]))

    def test_breath_marks_match_pattern(self):
        (t, _), c = self.build("evening")
        first = [m for m in t["breath"] if m["start"] < t["chapters"][1]["start"]]
        self.assertEqual([m["kind"] for m in first][:5], ["in", "hold", "out", "hold", "in"])
        self.assertEqual(first[0]["end"] - first[0]["start"], 4)
        self.assertEqual(first[-1]["kind"], "out")
        self.assertEqual(first[-1]["end"], [s for s in t["chapters"][0]["segments"] if s["kind"] == "work"][0]["end"])

    def test_morning_has_no_breath(self):
        (t, ev), c = self.build("morning")
        self.assertEqual(t["breath"], [])
        self.assertFalse([e for e in ev if e["kind"] == "breath"])


if __name__ == "__main__":
    unittest.main()
