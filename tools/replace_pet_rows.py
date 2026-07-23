from __future__ import annotations

import argparse
from pathlib import Path

from PIL import Image


FRAME_WIDTH = 192
FRAME_HEIGHT = 208
ATLAS_WIDTH = FRAME_WIDTH * 8
ATLAS_HEIGHT = FRAME_HEIGHT * 11


def parse_row(value: str) -> tuple[int, Path, int]:
    try:
        row_text, frames_text, directory_text = value.split(":", 2)
        row = int(row_text)
        frames = int(frames_text)
    except ValueError as exc:
        raise argparse.ArgumentTypeError(
            "row must be ROW:FRAME_COUNT:FRAME_DIRECTORY"
        ) from exc
    if not 0 <= row < 11:
        raise argparse.ArgumentTypeError("row must be between 0 and 10")
    if not 1 <= frames <= 8:
        raise argparse.ArgumentTypeError("frame count must be between 1 and 8")
    return row, Path(directory_text), frames


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Replace selected rows in an existing 8x11 Codex pet atlas."
    )
    parser.add_argument("--base-atlas", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument(
        "--row",
        action="append",
        required=True,
        type=parse_row,
        help="ROW:FRAME_COUNT:FRAME_DIRECTORY (repeatable)",
    )
    args = parser.parse_args()

    atlas = Image.open(args.base_atlas).convert("RGBA")
    if atlas.size != (ATLAS_WIDTH, ATLAS_HEIGHT):
        raise SystemExit(
            f"unexpected atlas size {atlas.size}; expected {(ATLAS_WIDTH, ATLAS_HEIGHT)}"
        )

    for row, frame_dir, frame_count in args.row:
        top = row * FRAME_HEIGHT
        atlas.paste(
            Image.new("RGBA", (ATLAS_WIDTH, FRAME_HEIGHT), (0, 0, 0, 0)),
            (0, top),
        )
        for index in range(frame_count):
            frame_path = frame_dir / f"{index:02d}.png"
            if not frame_path.is_file():
                raise SystemExit(f"missing frame: {frame_path}")
            frame = Image.open(frame_path).convert("RGBA")
            if frame.size != (FRAME_WIDTH, FRAME_HEIGHT):
                raise SystemExit(
                    f"unexpected frame size {frame.size} for {frame_path}; "
                    f"expected {(FRAME_WIDTH, FRAME_HEIGHT)}"
                )
            atlas.alpha_composite(frame, (index * FRAME_WIDTH, top))

    args.output.parent.mkdir(parents=True, exist_ok=True)
    if args.output.suffix.lower() == ".webp":
        atlas.save(args.output, format="WEBP", lossless=True, method=6)
    else:
        atlas.save(args.output, format="PNG", optimize=True)
    print(args.output)


if __name__ == "__main__":
    main()
