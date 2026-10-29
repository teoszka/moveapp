"""Load and validate content (SPEC §4, §16 S-5) and generate the voice script (SPEC §6)."""

import json
import re
from pathlib import Path

ID_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
YT_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")
MOOD_KEYS = {"theme", "voice", "tones", "mixGainDb", "dimAfter", "tail"}
VOICE_PARAMS = ("exaggeration", "cfg_weight", "temperature", "tempo")


class BuildError(Exception):
    def __init__(self, problems):
        self.problems = problems if isinstance(problems, list) else [problems]
        super().__init__("\n".join(self.problems))


class Content:
    def __init__(self, root, exercises, patterns, moods, voice, routines):
        self.root = Path(root)
        self.exercises = exercises
        self.patterns = patterns
        self.moods = moods
        self.voice = voice
        self.routines = routines  # id -> routine dict


def _read(path, problems):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except FileNotFoundError:
        problems.append(f"{path}: file not found")
    except json.JSONDecodeError as e:
        problems.append(f"{path}: invalid JSON ({e})")
    return None


def _text_ok(value, where, problems):
    if not isinstance(value, str) or not value.strip():
        problems.append(f"{where}: must be a non-empty string")
    elif "<" in value or ">" in value:
        problems.append(f"{where}: must not contain '<' or '>'")


def _num(value, where, problems, positive=True):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or (positive and value <= 0):
        problems.append(f"{where}: must be a positive number")


def load_content(root):
    """Load everything under `root` (the repository root) and validate it. Raises BuildError listing every problem."""
    root = Path(root)
    c = root / "content"
    problems = []
    exercises = _read(c / "exercises.json", problems) or {}
    patterns = _read(c / "breath-patterns.json", problems) or {}
    moods = _read(c / "moods.json", problems) or {}
    voice = _read(c / "voice.json", problems) or {}

    for ex_id, ex in exercises.items():
        w = f"content/exercises.json: {ex_id}"
        if not ID_RE.match(ex_id):
            problems.append(f"{w}: id must match {ID_RE.pattern}")
        if not isinstance(ex, dict):
            problems.append(f"{w}: must be an object")
            continue
        for f in ("name", "cue", "description"):
            _text_ok(ex.get(f), f"{w}.{f}", problems)
        if "spokenName" in ex:
            _text_ok(ex["spokenName"], f"{w}.spokenName", problems)
        if ex.get("level") not in ("floor", "standing"):
            problems.append(f"{w}.level: must be 'floor' or 'standing'")

    for p_id, p in patterns.items():
        w = f"content/breath-patterns.json: {p_id}"
        if not ID_RE.match(p_id):
            problems.append(f"{w}: id must match {ID_RE.pattern}")
        phases = p.get("phases") if isinstance(p, dict) else None
        if not isinstance(phases, list) or not phases:
            problems.append(f"{w}.phases: must be a non-empty list")
            continue
        _text_ok(p.get("label"), f"{w}.label", problems)
        for k, ph in enumerate(phases):
            if ph.get("kind") not in ("in", "hold", "out"):
                problems.append(f"{w}.phases[{k}].kind: must be in, hold or out")
            _num(ph.get("seconds"), f"{w}.phases[{k}].seconds", problems)
            _text_ok(ph.get("prompt"), f"{w}.phases[{k}].prompt", problems)
        if not any(ph.get("kind") == "out" for ph in phases):
            problems.append(f"{w}.phases: a pattern must contain at least one 'out' phase")

    for m_id, m in moods.items():
        w = f"content/moods.json: {m_id}"
        missing = MOOD_KEYS - set(m)
        if missing:
            problems.append(f"{w}: missing {sorted(missing)}")
        if m.get("tones") not in ("bright", "soft"):
            problems.append(f"{w}.tones: must be 'bright' or 'soft'")
        if m.get("voice") not in voice:
            problems.append(f"{w}.voice: no '{m.get('voice')}' entry in content/voice.json")
    for m_id in moods:
        params = voice.get(moods[m_id].get("voice"), {})
        for k in VOICE_PARAMS:
            if not isinstance(params.get(k), (int, float)):
                problems.append(f"content/voice.json: {moods[m_id].get('voice')}.{k} must be a number")
    if not isinstance(voice.get("takes", {}), dict):
        problems.append("content/voice.json.takes: must be an object")

    routines = {}
    for path in sorted((c / "routines").glob("*.json")):
        r = _read(path, problems)
        if r is None:
            continue
        rel = f"content/routines/{path.name}"
        routines[path.stem] = r
        if r.get("id") != path.stem:
            problems.append(f"{rel}.id: must equal the file name '{path.stem}'")
        if not ID_RE.match(path.stem):
            problems.append(f"{rel}: file name must match {ID_RE.pattern}")
        for f in ("title", "summary"):
            _text_ok(r.get(f), f"{rel}.{f}", problems)
        if r.get("mood") not in moods:
            problems.append(f"{rel}.mood: unknown mood '{r.get('mood')}'")
        _num(r.get("order"), f"{rel}.order", problems, positive=False)
        src = r.get("source")
        if not isinstance(src, dict):
            problems.append(f"{rel}.source: required object {{creator, title, youtubeId}}")
        else:
            _text_ok(src.get("creator"), f"{rel}.source.creator", problems)
            _text_ok(src.get("title"), f"{rel}.source.title", problems)
            if not isinstance(src.get("youtubeId"), str) or not YT_RE.match(src["youtubeId"]):
                problems.append(f"{rel}.source.youtubeId: must match {YT_RE.pattern}")
        steps = r.get("steps")
        if not isinstance(steps, list) or not steps:
            problems.append(f"{rel}.steps: must be a non-empty list")
            continue
        for i, s in enumerate(steps):
            w = f"{rel}.steps[{i}]"
            if s.get("exercise") not in exercises:
                problems.append(f"{w}.exercise: unknown exercise '{s.get('exercise')}'")
            _num(s.get("work"), f"{w}.work", problems)
            if s.get("sides", 1) not in (1, 2) or isinstance(s.get("sides", 1), bool):
                problems.append(f"{w}.sides: must be 1 or 2")
            if s.get("breath") is not None and s["breath"] not in patterns:
                problems.append(f"{w}.breath: unknown breath pattern '{s['breath']}'")
            if "settle" in s:
                _num(s["settle"], f"{w}.settle", problems)
            if "cue" in s:
                _text_ok(s["cue"], f"{w}.cue", problems)
            if "voicedCycles" in s:
                _num(s["voicedCycles"], f"{w}.voicedCycles", problems, positive=False)
            if "videoAt" in s and (isinstance(s["videoAt"], bool) or not isinstance(s["videoAt"], int) or s["videoAt"] < 0):
                problems.append(f"{w}.videoAt: must be an integer >= 0")

    if problems:
        raise BuildError(problems)
    return Content(root, exercises, patterns, moods, voice, routines)


# ---------- Voice script (SPEC §6) ----------

_ONES = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
         "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"]
_TENS = {2: "twenty", 3: "thirty", 4: "forty", 5: "fifty", 6: "sixty", 7: "seventy", 8: "eighty", 9: "ninety"}


def words(n):
    n = int(n)
    if n < 20:
        return _ONES[n]
    if n < 100:
        return _TENS[n // 10] + (f"-{_ONES[n % 10]}" if n % 10 else "")
    raise ValueError(n)


def _span(seconds):
    """'thirty seconds', 'two minutes', 'one minute thirty seconds'."""
    m, s = divmod(int(seconds), 60)
    parts = []
    if m:
        parts.append(f"{words(m)} minute" + ("s" if m > 1 else ""))
    if s:
        parts.append(f"{words(s)} second" + ("s" if s != 1 else ""))
    return " ".join(parts)


def announcement(content, routine, index):
    step = routine["steps"][index]
    ex = content.exercises[step["exercise"]]
    last = len(routine["steps"]) - 1
    lead = "First" if index == 0 else "Last one" if index == last else "Next"
    per_side = " per side" if step.get("sides", 1) == 2 else ""
    cue = step.get("cue", ex["cue"])
    return f"{lead}: {ex.get('spokenName', ex['name'])}, {_span(step['work'])}{per_side}. {cue}"


def remaining_text(r):
    """Spoken text for a remaining-time clip, `r` a multiple of 5 seconds."""
    if r < 60:
        return f"{words(r)} seconds left."
    m, s = divmod(r, 60)
    minutes = "One minute" if m == 1 else f"{words(m).capitalize()} minutes"
    return f"{minutes} left." if s == 0 else f"{minutes} {words(s)} seconds left."


def remaining_max(content, mood):
    """Longest nominal work time per side among the mood's routines, rounded down to a multiple of 5."""
    longest = max(s["work"] for r in content.routines.values() if r["mood"] == mood for s in r["steps"])
    return int(longest // 5 * 5)


def clamp_remaining(left, r_max):
    """Time left rounded to the nearest 5 s, clamped to [5, r_max]."""
    return int(min(r_max, max(5, int(left / 5 + 0.5) * 5)))


CLOSING = {
    "energize": "That's it. Have a good day.",
    "wind-down": "That's all. Stay here as long as you like, and sleep well.",
}


def script_lines(content, routine_ids):
    """Every line needed to build `routine_ids`: stable key -> (text, mood)."""
    lines = {}
    for rid in routine_ids:
        r = content.routines[rid]
        mood = r["mood"]
        for i, s in enumerate(r["steps"]):
            ex = content.exercises[s["exercise"]]
            lines[f"{rid}/{i}/announce"] = (announcement(content, r, i), mood)
            lines[f"{rid}/{i}/resume"] = (f"Resuming: {ex.get('spokenName', ex['name'])}.", mood)
            if s.get("sides", 1) == 2:
                lines[f"shared/{mood}/switch"] = ("Switch sides.", mood)
            if s.get("breath"):
                for k, ph in enumerate(content.patterns[s["breath"]]["phases"]):
                    lines[f"shared/{mood}/breath/{s['breath']}/{k}"] = (ph["prompt"], mood)
        lines[f"shared/{mood}/closing"] = (CLOSING[mood], mood)
        for rem in range(5, remaining_max(content, mood) + 1, 5):
            lines[f"shared/{mood}/t{rem:03d}"] = (remaining_text(rem), mood)
    return lines
