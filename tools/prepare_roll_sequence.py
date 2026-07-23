from __future__ import annotations

import argparse
import importlib.util
import json
from pathlib import Path

from PIL import Image, ImageDraw


FRAME_WIDTH = 192
FRAME_HEIGHT = 208
FRAME_COUNT_PER_PHASE = 8


def load_extractor(path: Path):
    spec = importlib.util.spec_from_file_location("hatch_extract_strip_frames", path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load extractor: {path}")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def extract_raw_frames(path: Path, extractor, threshold: float) -> list[Image.Image]:
    with Image.open(path) as opened:
        transparent = extractor.remove_chroma_background(
            opened, (0, 255, 0), threshold
        )
    groups = extractor.component_frame_groups(transparent, FRAME_COUNT_PER_PHASE)
    if groups is None or len(groups) != FRAME_COUNT_PER_PHASE:
        raise RuntimeError(f"Expected 8 sprite groups in {path}")
    return [extractor.component_group_image(transparent, group, padding=4) for group in groups]


def normalize_frames(frames: list[Image.Image]) -> tuple[list[Image.Image], float]:
    max_width = max(frame.width for frame in frames)
    max_height = max(frame.height for frame in frames)
    scale = min((FRAME_WIDTH - 10) / max_width, (FRAME_HEIGHT - 10) / max_height, 1.0)
    normalized: list[Image.Image] = []
    for frame in frames:
        width = max(1, round(frame.width * scale))
        height = max(1, round(frame.height * scale))
        sprite = frame.resize((width, height), Image.Resampling.LANCZOS)
        cell = Image.new("RGBA", (FRAME_WIDTH, FRAME_HEIGHT), (0, 0, 0, 0))
        left = (FRAME_WIDTH - width) // 2
        top = FRAME_HEIGHT - height - 5
        cell.alpha_composite(sprite, (left, top))
        normalized.append(cell)
    return normalized, scale


def save_contact_sheet(frames: list[Image.Image], path: Path) -> None:
    columns = 8
    label_height = 18
    rows = (len(frames) + columns - 1) // columns
    sheet = Image.new("RGB", (columns * FRAME_WIDTH, rows * (FRAME_HEIGHT + label_height)), "#dfe4ec")
    draw = ImageDraw.Draw(sheet)
    for index, frame in enumerate(frames):
        checker = Image.new("RGB", (FRAME_WIDTH, FRAME_HEIGHT), "#eef1f6")
        checker_draw = ImageDraw.Draw(checker)
        for y in range(0, FRAME_HEIGHT, 16):
            for x in range(0, FRAME_WIDTH, 16):
                if (x // 16 + y // 16) % 2:
                    checker_draw.rectangle((x, y, x + 15, y + 15), fill="#dfe4ec")
        checker.paste(frame, (0, 0), frame)
        column = index % columns
        row = index // columns
        x = column * FRAME_WIDTH
        y = row * (FRAME_HEIGHT + label_height)
        sheet.paste(checker, (x, y))
        draw.rectangle((x, y + FRAME_HEIGHT, x + FRAME_WIDTH, y + FRAME_HEIGHT + label_height), fill="#20242c")
        draw.text((x + 6, y + FRAME_HEIGHT + 2), f"key {index + 1:02d}", fill="#ffffff")
    path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(path, "PNG", optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Extract and normalize a 24-pose roll sequence")
    parser.add_argument("--phase", action="append", type=Path, required=True)
    parser.add_argument("--extractor", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--qa", type=Path, required=True)
    parser.add_argument("--key-threshold", type=float, default=96.0)
    args = parser.parse_args()
    if len(args.phase) != 3:
        raise SystemExit("Exactly three --phase inputs are required")

    extractor = load_extractor(args.extractor.resolve())
    raw_frames: list[Image.Image] = []
    for phase in args.phase:
        raw_frames.extend(extract_raw_frames(phase.resolve(), extractor, args.key_threshold))
    if len(raw_frames) != 24:
        raise RuntimeError(f"Expected 24 raw frames, got {len(raw_frames)}")

    frames, scale = normalize_frames(raw_frames)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    for index, frame in enumerate(frames):
        frame.save(args.output_dir / f"{index:02d}.png", "PNG", optimize=True)
    save_contact_sheet(frames, args.qa)
    manifest = {
        "ok": True,
        "source_frames": len(frames),
        "frame_size": [FRAME_WIDTH, FRAME_HEIGHT],
        "shared_scale": round(scale, 6),
        "alignment": "bottom-center",
        "sources": [str(path.resolve()) for path in args.phase],
    }
    (args.output_dir / "manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
