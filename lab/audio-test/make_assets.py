"""Build the audio-test track, resume clip and icons.

Usage: python -X utf8 lab/audio-test/make_assets.py <dir with ch1..ch10.wav, resume.wav, end.wav>
The voice clips come from Windows speech (System.Speech, Zira). Voice quality does not matter here;
the test is about background playback and media controls.

Track layout: 10 chapters x 60 s. Each chapter: voice "Chapter N of ten" at 0.4 s, a soft tick every
10 s, a box-breath swell tone from 20 s to 36 s, then 3-2-1 ticks at 57-59 s.
"""

import subprocess
import sys
from pathlib import Path

import numpy as np
import soundfile as sf
from PIL import Image, ImageDraw

SR = 44100
CH = 10
CH_LEN = 60
HERE = Path(__file__).resolve().parent


def load(path: Path) -> np.ndarray:
    data, sr = sf.read(path, dtype="float32")
    if data.ndim > 1:
        data = data.mean(axis=1)
    if sr != SR:
        idx = np.arange(0, len(data), sr / SR)
        data = np.interp(idx, np.arange(len(data)), data).astype(np.float32)
    return data / (np.max(np.abs(data)) + 1e-9) * 0.7


def tone(freq: float, dur: float, gain: float) -> np.ndarray:
    t = np.arange(int(SR * dur)) / SR
    env = np.exp(-t * 18) * np.minimum(1, t * 400)
    return (np.sin(2 * np.pi * freq * t) * env * gain).astype(np.float32)


def breath(dur: float = 16.0) -> np.ndarray:
    t = np.arange(int(SR * dur)) / SR
    phase = t % 16
    level = np.where(phase < 4, phase / 4, np.where(phase < 8, 1, np.where(phase < 12, 1 - (phase - 8) / 4, 0)))
    freq = 180 + 90 * level
    ph = 2 * np.pi * np.cumsum(freq) / SR
    return (np.sin(ph) * (0.05 + 0.15 * level)).astype(np.float32)


def put(buf: np.ndarray, clip: np.ndarray, at: float) -> None:
    i = int(at * SR)
    buf[i:i + len(clip)] += clip[: len(buf) - i]


def encode(wav: np.ndarray, out: Path) -> None:
    tmp = out.with_suffix(".wav")
    sf.write(tmp, wav, SR)
    subprocess.run(["ffmpeg", "-y", "-loglevel", "error", "-i", str(tmp), "-ac", "1", "-c:a", "libmp3lame",
                    "-b:a", "64k", "-abr", "0", str(out)], check=True)
    tmp.unlink()


def icon(size: int) -> None:
    img = Image.new("RGB", (size, size), "#1B2A4A")
    d = ImageDraw.Draw(img)
    r = size * 0.28
    c = size / 2
    d.ellipse([c - r, c - r, c + r, c + r], outline="#93c5fd", width=max(4, size // 24))
    img.save(HERE / f"icon-{size}.png")


def main(src: Path) -> None:
    track = np.zeros(SR * CH * CH_LEN, dtype=np.float32)
    tick = tone(660, 0.12, 0.35)
    go = tone(990, 0.35, 0.45)
    soft = tone(440, 0.08, 0.12)
    for n in range(CH):
        base = n * CH_LEN
        if n > 0:
            put(track, go, base)
        put(track, load(src / f"ch{n + 1}.wav"), base + 0.4)
        for s in range(10, 60, 10):
            put(track, soft, base + s)
        put(track, breath(), base + 20)
        if n < CH - 1:
            for s in (57, 58, 59):
                put(track, tick, base + s)
    put(track, load(src / "end.wav"), CH * CH_LEN - 4)
    encode(np.clip(track, -1, 1), HERE / "track.mp3")
    encode(load(src / "resume.wav"), HERE / "resume.mp3")
    icon(192)
    icon(512)
    print("ok")


if __name__ == "__main__":
    main(Path(sys.argv[1]))
