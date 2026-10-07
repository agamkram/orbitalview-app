#!/usr/bin/env python3
"""Generate OrbitalView home-screen icons."""

from __future__ import annotations

import math
import random
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parents[1]
EARTH_TEXTURE = ROOT / "public" / "earth.jpg"
OUT_PUBLIC = ROOT / "public"
OUT_APP = ROOT / "src" / "app"

BG = (2, 4, 10)
LON_OFFSET = 0.22


def draw_stars(draw: ImageDraw.ImageDraw, size: int, count: int, seed: int) -> None:
    rng = random.Random(seed)
    for _ in range(count):
        x = rng.randint(4, size - 5)
        y = rng.randint(4, size - 5)
        brightness = rng.randint(120, 255)
        radius = rng.choice([0, 0, 1, 1, 2])
        color = (brightness, brightness, min(255, brightness + 20))
        draw.ellipse((x - radius, y - radius, x + radius, y + radius), fill=color)


def render_earth(texture: Image.Image, diameter: int, lon_offset: float) -> Image.Image:
    radius = diameter // 2
    sphere = Image.new("RGBA", (diameter, diameter), (0, 0, 0, 0))
    pixels = sphere.load()
    tex_w, tex_h = texture.size

    for py in range(diameter):
        dy = py - radius
        for px in range(diameter):
            dx = px - radius
            dist_sq = dx * dx + dy * dy
            if dist_sq > radius * radius:
                continue

            z = math.sqrt(radius * radius - dist_sq)
            nx = dx / radius
            ny = dy / radius
            nz = z / radius
            lon = math.atan2(nx, nz) + lon_offset
            lat = math.asin(max(-1.0, min(1.0, ny)))
            u = (lon / (2 * math.pi)) % 1.0
            v = 0.5 - lat / math.pi
            tx = min(tex_w - 1, max(0, int(u * tex_w)))
            ty = min(tex_h - 1, max(0, int(v * tex_h)))
            r, g, b = texture.getpixel((tx, ty))[:3]

            shade = 0.72 + 0.28 * max(0.0, nz)
            pixels[px, py] = (
                int(r * shade),
                int(g * shade),
                int(b * shade),
                255,
            )

    return sphere


def draw_satellites(
    draw: ImageDraw.ImageDraw,
    center: tuple[int, int],
    earth_radius: int,
    seed: int,
) -> None:
    rng = random.Random(seed)
    colors = [
        (255, 107, 107),
        (255, 107, 107),
        (255, 107, 107),
        (77, 171, 247),
        (81, 207, 102),
        (255, 255, 255),
        (116, 143, 252),
    ]

    for _ in range(170):
        theta = rng.uniform(0, 2 * math.pi)
        phi = rng.uniform(-0.85, 0.85)
        orbit = earth_radius * rng.uniform(1.12, 1.58)
        x = center[0] + orbit * math.cos(theta) * math.cos(phi)
        y = center[1] + orbit * math.sin(phi) * 0.72 + orbit * 0.08 * math.sin(theta)
        color = rng.choice(colors)
        dot = rng.choice([2, 2, 3, 3, 4])
        draw.ellipse((x - dot, y - dot, x + dot, y + dot), fill=color)


def build_icon(size: int) -> Image.Image:
    texture = Image.open(EARTH_TEXTURE).convert("RGB")
    canvas = Image.new("RGBA", (size, size), BG + (255,))
    draw = ImageDraw.Draw(canvas)
    draw_stars(draw, size, max(50, size // 6), seed=11)

    earth_diameter = int(size * 0.56)
    earth = render_earth(texture, earth_diameter, LON_OFFSET)
    earth = earth.filter(ImageFilter.GaussianBlur(radius=0.4))
    center = (size // 2, size // 2)
    earth_radius = earth_diameter // 2
    top_left = (center[0] - earth_radius, center[1] - earth_radius)

    glow = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    glow_draw = ImageDraw.Draw(glow)
    glow_draw.ellipse(
        (
            top_left[0] - 8,
            top_left[1] - 8,
            top_left[0] + earth_diameter + 8,
            top_left[1] + earth_diameter + 8,
        ),
        fill=(40, 120, 220, 42),
    )
    glow = glow.filter(ImageFilter.GaussianBlur(radius=max(4, size // 64)))
    canvas = Image.alpha_composite(canvas, glow)

    draw = ImageDraw.Draw(canvas)
    draw_satellites(draw, center, earth_radius, seed=29)
    canvas.alpha_composite(earth, top_left)
    draw = ImageDraw.Draw(canvas)
    draw.ellipse(
        (
            top_left[0] - 2,
            top_left[1] - 2,
            top_left[0] + earth_diameter + 2,
            top_left[1] + earth_diameter + 2,
        ),
        outline=(90, 150, 255, 70),
        width=max(1, size // 180),
    )

    return canvas.convert("RGB")


def save_icons() -> None:
    OUT_PUBLIC.mkdir(parents=True, exist_ok=True)
    OUT_APP.mkdir(parents=True, exist_ok=True)

    icon_512 = build_icon(512)
    icon_512.save(OUT_PUBLIC / "icon-512.png", "PNG")

    icon_180 = icon_512.resize((180, 180), Image.Resampling.LANCZOS)
    icon_180.save(OUT_PUBLIC / "apple-touch-icon.png", "PNG")

    icon_32 = icon_512.resize((32, 32), Image.Resampling.LANCZOS)
    icon_32.save(OUT_APP / "icon.png", "PNG")
    icon_180.save(OUT_APP / "apple-icon.png", "PNG")

    print(f"Wrote {OUT_PUBLIC / 'icon-512.png'}")
    print(f"Wrote {OUT_PUBLIC / 'apple-touch-icon.png'}")
    print(f"Wrote {OUT_APP / 'icon.png'}")
    print(f"Wrote {OUT_APP / 'apple-icon.png'}")


if __name__ == "__main__":
    save_icons()