"""Chatterbox TTS with a take cache, take check and levelling (SPEC §7.2 steps 3-5).

The model is loaded lazily: a fully cached build needs neither torch nor the GPU.
"""

import hashlib
import json
import os
import subprocess
import zlib
from pathlib import Path

import numpy as np
import soundfile as sf

from content import BuildError

TARGET_LUFS = -18.0
PEAK_LIMIT = 10 ** (-0.5 / 20)
MAX_TRIES = 4
MODEL_REVISION = "5bb1f6ee58e50c3b8d408bc82a6d3740c2db6e18"
OUT_SR = 44100


def _sha1(*parts):
    h = hashlib.sha1()
    for p in parts:
        h.update(p if isinstance(p, bytes) else str(p).encode("utf-8"))
        h.update(b"\0")
    return h.hexdigest()


def speaking_rate_ok(text, seconds):
    letters = sum(c.isalnum() for c in text)
    return 7.0 <= letters / max(seconds, 0.05) <= 20.0


def trim(wav, sr):
    import librosa
    trimmed, _ = librosa.effects.trim(wav, top_db=38)
    pad = np.zeros(int(sr * 0.04), dtype=np.float32)
    return np.concatenate([pad, trimmed, pad])


def level(wav, sr):
    import pyloudnorm
    try:
        loud = pyloudnorm.Meter(sr, block_size=0.2).integrated_loudness(wav)
        if not np.isfinite(loud):
            raise ValueError("silent")
        out = pyloudnorm.normalize.loudness(wav, loud, TARGET_LUFS)
    except Exception:
        rms = np.sqrt(np.mean(wav ** 2)) + 1e-9
        out = wav * (10 ** (TARGET_LUFS / 20) / rms)
    peak = np.max(np.abs(out))
    return (out * (PEAK_LIMIT / peak) if peak > PEAK_LIMIT else out).astype(np.float32)


def to_output(wav, sr, tempo):
    """Resample to 44.1 kHz and apply `tempo` (pitch preserved) with ffmpeg; returns a float32 array."""
    filters = [f"atempo={tempo}"] if tempo != 1.0 else []
    filters.append(f"aresample={OUT_SR}")
    proc = subprocess.run(
        ["ffmpeg", "-loglevel", "error", "-f", "f32le", "-ar", str(sr), "-ac", "1", "-i", "pipe:0",
         "-af", ",".join(filters), "-f", "f32le", "-ar", str(OUT_SR), "-ac", "1", "pipe:1"],
        input=wav.astype("<f4").tobytes(), capture_output=True, check=True,
    )
    return np.frombuffer(proc.stdout, dtype="<f4").astype(np.float32)


class Voice:
    def __init__(self, content, root, force=False):
        self.params = {m: content.voice[content.moods[m]["voice"]] for m in content.moods}
        self.takes = content.voice.get("takes", {})
        self.cache = Path(root) / "tools" / "render" / "cache"
        self.cache.mkdir(parents=True, exist_ok=True)
        self.force = force
        self.reference_path = self._reference(content.voice.get("reference"), Path(root))
        self.reference_hash = _sha1(self.reference_path.read_bytes()) if self.reference_path else "builtin"
        self.model = None
        self.sr = 24000

    @staticmethod
    def _reference(ref, root):
        if ref is None:
            return None
        if not ref.startswith("local:"):
            raise BuildError(f"content/voice.json.reference: must be null or 'local:<name>', got '{ref}'")
        name = ref[len("local:"):]
        local = root / "tools" / "render" / "local.json"
        if not local.exists():
            raise BuildError(
                f"{local} not found. Create it (it is gitignored) with the path to your reference WAV:\n"
                f'  {{"voices": {{"{name}": "<absolute path to reference.wav>"}}}}')
        path = json.loads(local.read_text(encoding="utf-8")).get("voices", {}).get(name)
        if not path or not Path(path).is_file():
            raise BuildError(f"tools/render/local.json: voices.{name} must point to an existing WAV file (got {path!r})")
        return Path(path)

    def _load_model(self):
        if self.model is not None:
            return
        os.environ["HF_HUB_OFFLINE"] = "1"
        import perth
        if getattr(perth, "PerthImplicitWatermarker", None) is None:
            raise BuildError("perth.PerthImplicitWatermarker is missing: refusing to build without the AI watermark (SPEC §7.1)")
        import torch
        from huggingface_hub.constants import HF_HUB_CACHE
        from chatterbox.tts import ChatterboxTTS
        snapshot = Path(HF_HUB_CACHE) / "models--ResembleAI--chatterbox" / "snapshots" / MODEL_REVISION
        if not snapshot.is_dir():
            raise BuildError(f"Model snapshot {MODEL_REVISION} not found at {snapshot}; builds never download weights (SPEC S-7)")
        device = "cuda" if torch.cuda.is_available() else "cpu"
        print(f"Loading Chatterbox on {device} (revision {MODEL_REVISION[:8]})", flush=True)
        self.model = ChatterboxTTS.from_local(snapshot, device)
        if not isinstance(self.model.watermarker, perth.PerthImplicitWatermarker):
            raise BuildError("Chatterbox is not using PerthImplicitWatermarker: refusing to build (SPEC §7.1)")
        self.sr = self.model.sr
        if self.reference_path:
            self.model.prepare_conditionals(str(self.reference_path), exaggeration=next(iter(self.params.values()))["exaggeration"])

    def take(self, key, text, mood):
        """Final take at the model rate: (wav, info). Cached under sha1(text | reference | params | seed)."""
        p = self.params[mood]
        gen = {k: p[k] for k in ("exaggeration", "cfg_weight", "temperature")}  # tempo is applied later, so it is not part of the key
        seed = self.takes.get(key, zlib.crc32(key.encode()) % 100000)
        name = _sha1(text, self.reference_hash, json.dumps(gen, sort_keys=True), seed)
        wav_path, info_path = self.cache / f"{name}.wav", self.cache / f"{name}.json"
        if not self.force and wav_path.exists() and info_path.exists():
            return sf.read(wav_path, dtype="float32")[0], json.loads(info_path.read_text(encoding="utf-8"))
        import torch
        self._load_model()
        wav, flagged, used = None, True, seed
        for attempt in range(MAX_TRIES):
            used = seed + attempt
            torch.manual_seed(used)
            out = self.model.generate(text, **gen)
            cand = trim(out.squeeze(0).cpu().numpy().astype(np.float32), self.sr)
            wav = cand
            if speaking_rate_ok(text, len(cand) / self.sr):
                flagged = False
                break
            print(f"   re-roll {key} ({len(cand) / self.sr:.1f} s looks off)", flush=True)
        wav = level(wav, self.sr)
        info = {"key": key, "seed": used, "flagged": flagged}
        sf.write(wav_path, wav, self.sr, subtype="FLOAT")
        info_path.write_text(json.dumps(info), encoding="utf-8")
        return wav, info

    def clip(self, key, text, mood):
        """Take, tempo-adjusted and resampled to 44.1 kHz: (wav, info)."""
        wav, info = self.take(key, text, mood)
        return to_output(wav, self.sr, self.params[mood]["tempo"]), info
