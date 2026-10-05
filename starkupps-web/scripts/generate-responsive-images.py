#!/usr/bin/env python3
"""
Generate responsive image derivatives for the storefront's bundled photography.

Why this is a script and not a build plugin
-------------------------------------------
The storefront is image-heavy (hero, gallery, about) and ships full-resolution
JPEGs to every device: measured 5.4x-8.5x oversized on a phone. A build plugin
(`vite-imagetools`) is the textbook answer, but this project builds with Vite 8
on Rolldown, where such plugins are not reliably supported. Adding one would put
a new dependency between the code and a build that currently works, so
derivatives are generated once, ahead of time, with no build-time dependency at
all.

Output
------
Writes `src/assets/responsive/<stem>-<width>.jpg` for each bundled photo in
`src/assets/`. `src/lib/responsive-images.ts` discovers those files via
`import.meta.glob`, so there is no generated manifest to drift out of sync.

Re-run after adding or replacing a source photograph:

    python3 scripts/generate-responsive-images.py

`<ResponsiveImage>` degrades gracefully: a photo with no derivatives simply
renders with a plain `src`, so a newly added image is never broken by
forgetting to regenerate.
"""

from __future__ import annotations

import pathlib
import re

from PIL import Image

ROOT = pathlib.Path(__file__).resolve().parent.parent
SRC = ROOT / "src" / "assets"
OUT = SRC / "responsive"

# Ladder in CSS pixels. A consumer picks with `sizes`; the browser chooses by
# device width x DPR. 1600 is the widest any bundled asset is displayed at, so
# nothing above that is generated.
WIDTHS = (320, 480, 640, 960, 1280, 1600)

# Smaller renditions can be compressed harder: they get upscaled less often.
QUALITY = {320: 72, 480: 75, 640: 78, 960: 80, 1280: 82, 1600: 84}

EXTENSIONS = (".jpg", ".jpeg", ".png", ".webp", ".avif")


def slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")


def kb(path: pathlib.Path) -> int:
    return path.stat().st_size // 1024


def main() -> None:
    if OUT.exists():
        for stale in OUT.iterdir():
            if stale.is_file():
                stale.unlink()
    OUT.mkdir(parents=True, exist_ok=True)

    sources = sorted(p for p in SRC.iterdir() if p.is_file() and p.suffix.lower() in EXTENSIONS)
    grand_original = grand_derived = 0

    for src in sources:
        with Image.open(src) as probe:
            src_w, src_h = probe.size

        stem = slugify(src.stem)
        made: list[int] = []

        for w in WIDTHS:
            if w >= src_w:
                # Never upscale. The original is already at or below this width,
                # so the source file itself is the right answer for this step.
                break
            target = OUT / f"{stem}-{w}.jpg"
            with Image.open(src) as im:
                ratio = w / src_w
                resized = im.resize((w, max(1, round(src_h * ratio))), Image.LANCZOS)
                if resized.mode != "RGB":
                    resized = resized.convert("RGB")
                # progressive + no metadata: every EXIF byte is dead weight here.
                resized.save(target, "JPEG", quality=QUALITY[w], optimize=True, progressive=True)
            made.append(w)

        derived_kb = sum(kb(OUT / f"{stem}-{w}.jpg") for w in made)
        grand_original += kb(src)
        grand_derived += derived_kb
        print(
            f"{src.stem:16} {src_w}x{src_h}  {kb(src):>4} KB  ->  "
            f"{len(made)} variants, {derived_kb:>4} KB"
        )

    print(f"\noriginals {grand_original} KB  +  derivatives {grand_derived} KB")
    print(f"wrote {OUT.relative_to(ROOT)} ({len(list(OUT.glob('*')))} files)")


if __name__ == "__main__":
    main()