"""Session timeline rules (SPEC §5). Pure functions: durations in, timeline and event list out."""

import math

LEAD_IN = 0.6
GAP = 0.5
COUNT = 3.0
SWITCH_GAP = 3.0
PROMPT_OFFSET = 0.3
CLOSING_DELAY = 1.2
SWITCH_LEAD = 0.2


def ceil1(x):
    """Round up to 0.1 s, ignoring float noise."""
    return round(math.ceil(x * 10 - 1e-6) / 10, 3)


def cycle_length(phases):
    return sum(p["seconds"] for p in phases)


def align_breath(phases, work):
    """§5.4: the end of an `out` phase (cycles repeating) nearest to `work`; a tie goes to the longer value."""
    length = cycle_length(phases)
    ends, acc = [], 0
    for p in phases:
        acc += p["seconds"]
        if p["kind"] == "out":
            ends.append(acc)
    best = ends[0]
    k = 0
    while k * length <= work + length:
        for e in ends:
            c = k * length + e
            d, bd = abs(c - work), abs(best - work)
            if d < bd or (d == bd and c > best):
                best = c
        k += 1
    return best


def settle_for(steps, exercises, i):
    s = steps[i]
    if "settle" in s:
        return s["settle"]
    if i == 0:
        return 10
    return 10 if exercises[steps[i - 1]["exercise"]]["level"] != exercises[s["exercise"]]["level"] else 5


def build_timeline(routine, exercises, patterns, mood, durations):
    """Returns (timeline, events).

    `durations` maps a script line key (see content.script_lines) to the clip length in seconds.
    `timeline` is the chapters/closing/breath part of timeline.json (no audio, resume or build fields).
    `events` is the mix list, sorted by time:
      {"t", "kind": "clip", "key"} | {"t", "kind": "tone", "id", "count": bool} | {"t", "kind": "breath", "step", "end"}
    """
    rid = routine["id"]
    steps = routine["steps"]
    mood_name = routine["mood"]
    events, chapters, breath_marks = [], [], []
    seen_patterns = set()

    def clip(t, key):
        events.append({"t": round(t, 3), "kind": "clip", "key": key})

    def tone(t, tone_id, count=False):
        events.append({"t": round(t, 3), "kind": "tone", "id": tone_id, "count": count})

    def count_in(end, final):
        for k in (3, 2, 1):
            tone(end - k, "tick", count=True)
        tone(end, final)

    t = 0.0
    for i, s in enumerate(steps):
        a = durations[f"{rid}/{i}/announce"]
        settle = settle_for(steps, exercises, i)
        trans = ceil1(max(settle, LEAD_IN + a + GAP + COUNT))
        segments = [{"kind": "transition", "start": round(t, 3), "end": round(t + trans, 3)}]
        chapter_start = t
        clip(t + LEAD_IN, f"{rid}/{i}/announce")
        count_in(t + trans, "go")
        t = round(t + trans, 3)

        pattern = patterns[s["breath"]] if s.get("breath") else None
        work = align_breath(pattern["phases"], s["work"]) if pattern else s["work"]
        sides = s.get("sides", 1)
        voiced = 0
        if pattern:
            voiced = s.get("voicedCycles", 2 if s["breath"] not in seen_patterns else 0)
            seen_patterns.add(s["breath"])

        for side in range(1, sides + 1):
            ws, we = t, round(t + work, 3)
            segments.append({"kind": "work", "start": ws, "end": we, "side": side, "of": sides})
            if pattern:
                events.append({"t": ws, "kind": "breath", "step": i, "end": we})
                length = cycle_length(pattern["phases"])
                acc = 0
                for k, ph in enumerate(pattern["phases"]):
                    c = 0
                    while ws + c * length + acc < we and c < 10_000:
                        start = ws + c * length + acc
                        breath_marks.append({"start": round(start, 3), "end": round(min(start + ph["seconds"], we), 3), "kind": ph["kind"]})
                        if c < voiced:
                            clip(start + PROMPT_OFFSET, f"shared/{mood_name}/breath/{s['breath']}/{k}")
                        c += 1
                    acc += ph["seconds"]
            count_in(we, "done")
            t = we
            if side < sides:
                gap = ceil1(max(SWITCH_GAP, durations[f"shared/{mood_name}/switch"] + 0.7))
                segments.append({"kind": "switch", "start": t, "end": round(t + gap, 3)})
                clip(t + SWITCH_LEAD, f"shared/{mood_name}/switch")
                tone(t + gap, "go")
                t = round(t + gap, 3)
        chapters.append({"step": i, "exercise": s["exercise"], "start": round(chapter_start, 3), "end": t, "segments": segments})

    closing_key = f"shared/{mood_name}/closing"
    closing_at = t + CLOSING_DELAY
    clip(closing_at, closing_key)
    duration = round(closing_at + durations[closing_key] + mood["tail"], 3)
    breath_marks.sort(key=lambda m: m["start"])
    events.sort(key=lambda e: (e["t"], e["kind"]))
    timeline = {
        "chapters": chapters,
        "closing": {"start": t, "end": duration},
        "breath": breath_marks,
        "duration": duration,
    }
    return timeline, events
