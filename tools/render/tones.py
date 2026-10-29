"""Tone vocabulary and breath tone (SPEC §9). Reference: TONES, toneBuf, breathBuf (branch H), addTick in prototype/index.html."""

import math

import numpy as np
from numba import njit

SR = 44100
TAU = 2 * math.pi

TONES = {
    "bright": {
        "tick": {"f": 660, "len": 0.14, "decay": 18, "gain": 0.32},
        "go": {"f": 880, "len": 0.9, "decay": 5.5, "gain": 0.30, "partial": 2.76, "pgain": 0.35, "attack": 0.004},
        "done": {"notes": [660, 440], "step": 0.16, "len": 0.4, "decay": 9, "gain": 0.26},
    },
    "soft": {
        "tick": {"f": 520, "len": 0.16, "decay": 16, "gain": 0.13},
        "go": {"f": 660, "len": 1.1, "decay": 4, "gain": 0.15, "partial": 2.76, "pgain": 0.25, "attack": 0.02},
        "done": {"notes": [520, 390], "step": 0.2, "len": 0.5, "decay": 7, "gain": 0.12},
    },
}

BREATH_SEED = 12345
BREATH_FADE_IN = 0.15
BREATH_FADE_OUT = 0.4


def _time(seconds):
    return np.arange(int(math.ceil(seconds * SR))) / SR


def tone(tone_set, tone_id):
    """One tone as a float32 array at SR. `tone_set` is "bright" or "soft"."""
    p = TONES[tone_set][tone_id]
    if tone_id == "tick":
        t = _time(p["len"])
        out = np.sin(TAU * p["f"] * t) * np.minimum(1, t / 0.004) * np.exp(-t * p["decay"]) * p["gain"]
    elif tone_id == "go":
        t = _time(p["len"])
        body = np.sin(TAU * p["f"] * t) + p["pgain"] * np.sin(TAU * p["f"] * p["partial"] * t) * np.exp(-t * p["decay"] * 1.6)
        out = body * np.minimum(1, t / p["attack"]) * np.exp(-t * p["decay"]) * p["gain"]
    elif tone_id == "done":
        t = _time(p["step"] + p["len"])
        out = np.zeros_like(t)
        for k, f in enumerate(p["notes"]):
            u = t - k * p["step"]
            on = u >= 0
            out[on] += np.sin(TAU * f * u[on]) * np.minimum(1, u[on] / 0.004) * np.exp(-u[on] * p["decay"])
        out *= p["gain"]
    else:
        raise KeyError(tone_id)
    return out.astype(np.float32)


@njit(cache=True)
def _noise_breath(n, sr, kinds, starts, lengths, seed):
    """Variant H: low muffled noise, lowpass sweeps with the phase, amplitude follows a smoothed target.

    kinds: 0 = in, 1 = hold, 2 = out. Phases repeat from sample 0.
    """
    out = np.zeros(n, dtype=np.float32)
    cycle = 0.0
    for L in lengths:
        cycle += L
    al = 1.0 - math.exp(-2.0 * math.pi * 120.0 / sr)
    smooth = 1.0 - math.exp(-1.0 / (0.014 * sr))
    amp = 0.0
    y1 = 0.0
    y2 = 0.0
    z1 = 0.0
    state = seed
    for i in range(n):
        x = (i / sr) % cycle
        idx = len(kinds) - 1
        for k in range(len(kinds)):
            if x < starts[k] + lengths[k]:
                idx = k
                break
        u = (x - starts[idx]) / lengths[idx]
        kind = kinds[idx]
        if kind == 0:
            target = 0.14 + 0.58 * u
            fc = 300.0 + 900.0 * u
        elif kind == 2:
            target = 0.72 - 0.65 * u
            fc = 900.0 - 650.0 * u
        else:
            target = 0.0
            fc = 300.0
        state = (state * 1664525 + 1013904223) & 0xFFFFFFFF
        r = state / 2147483648.0 - 1.0
        a = 1.0 - math.exp(-2.0 * math.pi * fc / sr)
        y1 += a * (r - y1)
        y2 += a * (y1 - y2)
        z1 += al * (y2 - z1)
        amp += (target - amp) * smooth
        out[i] = (y2 - z1) * amp
    return out


def _add_tick(out, at, gain):
    n = int(round(0.06 * SR))
    s0 = int(round(at * SR))
    t = np.arange(n) / SR
    tick = np.sin(TAU * 1250 * t) * np.minimum(1, t / 0.002) * np.exp(-t * 80) * gain
    end = min(len(out), s0 + n)
    out[s0:end] += tick[: end - s0].astype(np.float32)


def breath(phases, seconds):
    """Breath tone for one work interval of `seconds`, phases = [{"kind", "seconds"}, ...] repeating from 0."""
    kinds = np.array([{"in": 0, "hold": 1, "out": 2}[p["kind"]] for p in phases], dtype=np.int64)
    lengths = np.array([float(p["seconds"]) for p in phases])
    starts = np.concatenate([[0.0], np.cumsum(lengths)[:-1]])
    n = int(round(seconds * SR))
    out = _noise_breath(n, SR, kinds, starts, lengths, BREATH_SEED)
    # Hold ticks: one per second, louder on the first of a hold.
    cycle = float(lengths.sum())
    for c in range(int(math.ceil(seconds / cycle))):
        for p, s in zip(phases, starts):
            if p["kind"] != "hold":
                continue
            for k in range(int(round(p["seconds"]))):
                at = c * cycle + s + k
                if at < seconds:
                    _add_tick(out, at, 0.08 if k == 0 else 0.06)
    # Fade in/out at the interval edges, as the prototype did when it started and stopped the loop.
    fi, fo = int(BREATH_FADE_IN * SR), int(BREATH_FADE_OUT * SR)
    out[:fi] *= np.linspace(0, 1, fi, dtype=np.float32)
    out[-fo:] *= np.linspace(1, 0, fo, dtype=np.float32)
    return out
