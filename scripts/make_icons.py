#!/usr/bin/env python3
"""Generate the PNG icon set for the WaaS Portal Helper Chrome extension.

Pillow is not installed in this environment, so this writes PNGs directly using
only the standard library (zlib + struct). Output is a rounded blue square with
a white shield, rendered with 4x supersampling so the 16px icon stays legible.

Usage (from the repo root):
    python -I scripts/make_icons.py
"""

from __future__ import annotations

import struct
import sys
import zlib
from pathlib import Path

# Output sizes required by Chrome's manifest `icons` key.
SIZES = (16, 48, 128)

OUT_DIR = Path(__file__).resolve().parent.parent / "chrome-extensions" / "waas-portal-helper" / "icons"

BLUE = (11, 95, 165)       # background
WHITE = (255, 255, 255)    # shield
SS = 4                     # supersampling factor per axis


# --------------------------------------------------------------------------
# PNG writing
# --------------------------------------------------------------------------

def _chunk(tag: bytes, data: bytes) -> bytes:
    body = tag + data
    return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)


def write_png(path: Path, size: int, pixels: list[list[tuple[int, int, int, int]]]) -> None:
    """Write 8-bit RGBA (color type 6) PNG data to `path`."""
    raw = b"".join(
        b"\x00" + bytes(channel for px in row for channel in px)
        for row in pixels
    )
    data = (
        b"\x89PNG\r\n\x1a\n"
        + _chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
        + _chunk(b"IDAT", zlib.compress(raw, 9))
        + _chunk(b"IEND", b"")
    )
    path.write_bytes(data)


# --------------------------------------------------------------------------
# Shape tests (operate on sub-pixel sample coordinates)
# --------------------------------------------------------------------------

def in_rounded_square(x: float, y: float, size: float, radius: float) -> bool:
    if x < 0 or y < 0 or x > size or y > size:
        return False
    # Clamp the point into the inner rectangle; distance to that clamped point
    # is the distance to the rounded-rect edge.
    cx = min(max(x, radius), size - radius)
    cy = min(max(y, radius), size - radius)
    dx, dy = x - cx, y - cy
    return dx * dx + dy * dy <= radius * radius


def in_shield(x: float, y: float, size: float) -> bool:
    """Shield outline in normalized [-1, 1] coordinates."""
    u = (x / size) * 2.0 - 1.0
    v = (y / size) * 2.0 - 1.0

    half_width = 0.46
    top, shoulder, tip = -0.50, 0.08, 0.60

    if v < top or v > tip:
        return False
    if v <= shoulder:
        return abs(u) <= half_width
    # Below the shoulder the sides taper linearly to a point at `tip`.
    return abs(u) <= half_width * (tip - v) / (tip - shoulder)


# --------------------------------------------------------------------------
# Rendering
# --------------------------------------------------------------------------

def render(size: int) -> list[list[tuple[int, int, int, int]]]:
    radius = size * 0.22
    samples = SS * SS
    rows = []

    for py in range(size):
        row = []
        for px in range(size):
            bg_hits = 0
            fg_hits = 0
            for sy in range(SS):
                for sx in range(SS):
                    x = px + (sx + 0.5) / SS
                    y = py + (sy + 0.5) / SS
                    if in_rounded_square(x, y, size, radius):
                        bg_hits += 1
                        if in_shield(x, y, size):
                            fg_hits += 1

            if bg_hits == 0:
                row.append((0, 0, 0, 0))
                continue

            alpha = bg_hits / samples
            t = min(fg_hits / bg_hits, 1.0)  # how much of the covered area is shield
            rgb = tuple(round(b + (w - b) * t) for b, w in zip(BLUE, WHITE))
            row.append((*rgb, round(alpha * 255)))
        rows.append(row)

    return rows


def main() -> int:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    for size in SIZES:
        path = OUT_DIR / f"icon{size}.png"
        write_png(path, size, render(size))
        print(f"wrote {path.relative_to(OUT_DIR.parents[2])} ({path.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
