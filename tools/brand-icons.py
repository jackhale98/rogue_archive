#!/usr/bin/env python3
"""Regenerates the site's icons (apps/web/public/icons) from docs/brand/emblem.png.

Run by hand after changing the emblem (needs Pillow): python3 tools/brand-icons.py
- icon-32/48/192/512: the round emblem, transparent outside its circle (favicons, manifest "any").
- icon-maskable-192/512: the emblem on a navy square with all of its art inside the
  maskable safe zone (a circle of 40% of the icon's size), centred on the art.
- icon-180: the iOS home screen icon (iOS fills transparency black and rounds the corners itself).
- mark-144: the header's mark in the dark theme (drawn at 44 CSS px; sharp on 3x screens).
- mark-light-144: the header's mark in the light theme: no navy disc (transparent), the
  cream parts (arch, hero, stars, steps) in the site's ink, teal and amber kept; cropped
  to the art, 144 px high.
Every file is reduced to a 256-colour palette: the art is flat, and the icons are precached.
"""
import colorsys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = Image.open(ROOT / 'docs/brand/emblem.png').convert('RGBA')
OUT = ROOT / 'apps/web/public/icons'
NAVY = (2, 12, 28, 255)  # the emblem's own background
INK = (0x23, 0x1D, 0x14)  # the light theme's --text
INK_SOFT = (0x6A, 0x5D, 0x45)  # the light theme's --text-muted: the stones' shadow side
# Measured on the emblem (1254 px): the art's centre, its furthest point from that centre, its width.
ART_CX, ART_CY, ART_R, ART_W = 627, 583, 640, 1110
ART_BOX = (72, 200, 1182, 966)
S0 = SRC.width


def save(image: Image.Image, name: str) -> None:
    palette = image.convert('RGBA').quantize(256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE)
    palette.save(OUT / name, optimize=True)


def emblem(size: int) -> Image.Image:
    return SRC.resize((size, size), Image.LANCZOS)


def on_navy(size: int, emblem_size: int) -> Image.Image:
    square = Image.new('RGBA', (size, size), NAVY)
    k = emblem_size / S0
    square.alpha_composite(emblem(emblem_size), (round(size / 2 - ART_CX * k), round(size / 2 - ART_CY * k)))
    return square


def for_light_theme(image: Image.Image) -> Image.Image:
    """The navy made transparent (softly, by its distance from the navy), neutral tones redrawn in ink."""
    out = Image.new('RGBA', image.size)
    source, target = image.load(), out.load()
    for y in range(image.height):
        for x in range(image.width):
            r, g, b, a = source[x, y]
            distance = ((r - NAVY[0]) ** 2 + (g - NAVY[1]) ** 2 + (b - NAVY[2]) ** 2) ** 0.5
            keep = min(1.0, max(0.0, (distance - 40) / 70))
            if a == 0 or keep == 0:
                continue
            _, lightness, saturation = colorsys.rgb_to_hls(r / 255, g / 255, b / 255)
            if saturation > 0.35 and lightness < 0.85 and max(r, g, b) - min(r, g, b) > 60:
                colour = (r, g, b)  # teal and amber
            else:
                t = min(1.0, max(0.0, (0.92 - lightness) / 0.2))  # cream -> ink, tan -> soft ink
                colour = tuple(round(INK[i] + (INK_SOFT[i] - INK[i]) * t) for i in range(3))
            target[x, y] = (*colour, round(a * keep))
    return out


for size in (32, 48, 192, 512):
    save(emblem(size), f'icon-{size}.png')
save(emblem(144), 'mark-144.png')
for size in (192, 512):
    save(on_navy(size, int(0.40 * size * S0 / ART_R)), f'icon-maskable-{size}.png')
save(on_navy(180, int(0.84 * 180 * S0 / ART_W)), 'icon-180.png')
art = SRC.crop((ART_BOX[0] - 8, ART_BOX[1] - 8, ART_BOX[2] + 8, ART_BOX[3] + 8))
art = for_light_theme(art)
save(art.resize((round(art.width * 144 / art.height), 144), Image.LANCZOS), 'mark-light-144.png')
