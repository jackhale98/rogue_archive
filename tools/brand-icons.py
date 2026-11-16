#!/usr/bin/env python3
"""Regenerates the site's icons (apps/web/public/icons) from docs/brand/emblem.png.

Run by hand after changing the emblem (needs Pillow): python3 tools/brand-icons.py
- icon-32/48/192/512: the round emblem, transparent outside its circle (favicons, manifest "any").
- icon-maskable-192/512: the emblem on a navy square with all of its art inside the
  maskable safe zone (a circle of 40% of the icon's size), centred on the art.
- icon-180: the iOS home screen icon (iOS fills transparency black and rounds the corners itself).
- mark-144: the header's mark (drawn at 44 CSS px; sharp on 3x screens).
Every file is reduced to a 256-colour palette: the art is flat, and the icons are precached.
"""
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
SRC = Image.open(ROOT / 'docs/brand/emblem.png').convert('RGBA')
OUT = ROOT / 'apps/web/public/icons'
NAVY = (2, 12, 28, 255)  # the emblem's own background
# Measured on the emblem (1254 px): the art's centre, its furthest point from that centre, its width.
ART_CX, ART_CY, ART_R, ART_W = 627, 583, 640, 1110
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


for size in (32, 48, 192, 512):
    save(emblem(size), f'icon-{size}.png')
save(emblem(144), 'mark-144.png')
for size in (192, 512):
    save(on_navy(size, int(0.40 * size * S0 / ART_R)), f'icon-maskable-{size}.png')
save(on_navy(180, int(0.84 * 180 * S0 / ART_W)), 'icon-180.png')
