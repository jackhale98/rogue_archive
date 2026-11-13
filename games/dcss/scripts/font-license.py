#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-2.0-or-later
"""Prints the copyright and license embedded in a TrueType font's name table.

DCSS ships the DejaVu fonts for its WebTiles client without a separate
license file; the license travels inside the fonts (name IDs 0, 13 and 14).
Usage: font-license.py <font.ttf>
"""
import struct
import sys


def names(path):
    data = open(path, 'rb').read()
    count = struct.unpack('>H', data[4:6])[0]
    for i in range(count):
        tag, _, offset, _ = struct.unpack('>4sIII', data[12 + 16 * i:28 + 16 * i])
        if tag != b'name':
            continue
        _, records, strings = struct.unpack('>HHH', data[offset:offset + 6])
        found = {}
        for j in range(records):
            platform, _, _, name_id, length, at = struct.unpack(
                '>HHHHHH', data[offset + 6 + 12 * j:offset + 18 + 12 * j])
            raw = data[offset + strings + at:offset + strings + at + length]
            if platform == 3:
                found.setdefault(name_id, raw.decode('utf-16-be'))
            elif platform == 1:
                found.setdefault(name_id, raw.decode('latin-1'))
        return found
    raise SystemExit(f'{path}: no name table')


font = names(sys.argv[1])
print(f'{font.get(4, sys.argv[1])} ({font.get(5, "")})\n')
print(font.get(0, '') + '\n')
print(font.get(13, '') + '\n')
print(font.get(14, ''))
