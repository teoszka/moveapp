"""Draw the PWA icons and the mood icons used as Media Session artwork.

  python -X utf8 tools/make_icons.py      (needs Pillow)

Output: icons/icon-192.png, icon-512.png, icon-maskable-512.png, mood-energize-{192,512}.png, mood-wind-down-{192,512}.png
"""

import math
from pathlib import Path

from PIL import Image, ImageDraw

OUT = Path(__file__).resolve().parents[1] / "icons"
SS = 4  # supersampling


def canvas(size, bg):
    return Image.new("RGB", (size * SS, size * SS), bg)


def finish(img, size, name):
    OUT.mkdir(exist_ok=True)
    img.resize((size, size), Image.LANCZOS).save(OUT / name)


def sun(d, c, r, color, width):
    d.ellipse([c - r, c - r, c + r, c + r], outline=color, width=width)
    for k in range(8):
        a = k * math.pi / 4
        x1, y1 = c + math.cos(a) * r * 1.5, c + math.sin(a) * r * 1.5
        x2, y2 = c + math.cos(a) * r * 2.0, c + math.sin(a) * r * 2.0
        d.line([x1, y1, x2, y2], fill=color, width=width)


def moon(d, c, r, color, bg):
    d.ellipse([c - r, c - r, c + r, c + r], fill=color)
    off = r * 0.55
    d.ellipse([c - r + off, c - r - off * 0.4, c + r + off, c + r - off * 0.4], fill=bg)


def mood_icon(size, kind):
    bg, fg = ("#fdecdc", "#ef8a3c") if kind == "energize" else ("#0a1222", "#93c5fd")
    img = canvas(size, bg)
    d = ImageDraw.Draw(img)
    c = size * SS / 2
    if kind == "energize":
        sun(d, c, size * SS * 0.14, fg, max(2, size * SS // 40))
    else:
        moon(d, c, size * SS * 0.26, fg, bg)
    return img


def app_icon(size, safe=1.0):
    img = canvas(size, "#1B2A4A")
    d = ImageDraw.Draw(img)
    c = size * SS / 2
    r = size * SS * 0.26 * safe
    d.ellipse([c - r, c - r, c + r, c + r], outline="#93c5fd", width=max(3, int(size * SS / 22 * safe)))
    dot = r * 0.32
    d.ellipse([c - dot, c - dot, c + dot, c + dot], fill="#ef8a3c")
    return img


for s in (192, 512):
    finish(app_icon(s), s, f"icon-{s}.png")
    for kind in ("energize", "wind-down"):
        finish(mood_icon(s, kind), s, f"mood-{kind}-{s}.png")
finish(app_icon(512, safe=0.75), 512, "icon-maskable-512.png")
