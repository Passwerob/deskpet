from __future__ import annotations

import argparse
import json
import tempfile
from pathlib import Path

from PIL import Image

from interpolate_pet import (
    combine_rife_outputs,
    continuity,
    remove_small_detached_components,
    resample_frames,
    run_rife_dyadic,
    save_contact_sheet,
    save_preview,
    write_rife_inputs,
)


def save_grid(frames: list[Image.Image], path: Path, columns: int = 16) -> None:
    frame_width, frame_height = frames[0].size
    rows = (len(frames) + columns - 1) // columns
    grid = Image.new("RGBA", (frame_width * columns, frame_height * rows), (0, 0, 0, 0))
    for index, frame in enumerate(frames):
        left = (index % columns) * frame_width
        top = (index // columns) * frame_height
        grid.alpha_composite(frame, (left, top))
    path.parent.mkdir(parents=True, exist_ok=True)
    grid.save(path, "WEBP", lossless=True, method=6)


def main() -> None:
    parser = argparse.ArgumentParser(description="Interpolate a 24-pose roll into a smooth app animation")
    parser.add_argument("--frames-dir", type=Path, required=True)
    parser.add_argument("--rife-bin", type=Path, required=True)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--qa-dir", type=Path, required=True)
    parser.add_argument("--factor", type=int, default=6)
    parser.add_argument("--duration-ms", type=float, default=4800.0)
    parser.add_argument("--target-fps", type=float, default=60.0)
    parser.add_argument("--tta", action="store_true")
    args = parser.parse_args()

    args.frames_dir = args.frames_dir.resolve()
    args.rife_bin = args.rife_bin.resolve()
    args.model = args.model.resolve()
    args.output_dir = args.output_dir.resolve()
    args.qa_dir = args.qa_dir.resolve()
    if args.factor < 1 or args.factor & (args.factor - 1):
        raise SystemExit(f"RIFE factor must be a power of two, got {args.factor}")

    paths = sorted(args.frames_dir.glob("[0-9][0-9].png"))
    if len(paths) != 24:
        raise SystemExit(f"Expected 24 source frames in {args.frames_dir}, got {len(paths)}")
    original = [Image.open(path).convert("RGBA") for path in paths]
    target_frames = (len(original) - 1) * args.factor + 1

    with tempfile.TemporaryDirectory(prefix="zhuochong-roll-rife-") as temporary:
        root = Path(temporary)
        black_input = root / "black-input"
        white_input = root / "white-input"
        black_output = root / "black-output"
        white_output = root / "white-output"
        write_rife_inputs(original, black_input, white_input)
        run_rife_dyadic(
            args.rife_bin, args.model, black_input, black_output, args.factor, args.tta
        )
        run_rife_dyadic(
            args.rife_bin, args.model, white_input, white_output, args.factor, args.tta
        )
        smoothed = [remove_small_detached_components(frame) for frame in combine_rife_outputs(black_output, white_output)]

    if len(smoothed) != target_frames:
        raise RuntimeError(f"Expected {target_frames} frames, got {len(smoothed)}")
    interpolated_frames = len(smoothed)
    delivery_frames = round(args.duration_ms * args.target_fps / 1000)
    smoothed = resample_frames(smoothed, delivery_frames, loop=False)
    frame_ms = args.duration_ms / len(smoothed)
    columns = 16
    save_grid(smoothed, args.output_dir / "rollOver.webp", columns)
    save_preview(smoothed, frame_ms, args.qa_dir / "rollOver.gif")
    save_contact_sheet(smoothed, args.qa_dir / "rollOver-contact.png")
    manifest = {
        "method": "24-authored-poses+rife-v4.6-dual-matte-alpha",
        "source_frames": len(original),
        "frames": len(smoothed),
        "columns": columns,
        "factor": args.factor,
        "interpolated_frames": interpolated_frames,
        "target_fps": args.target_fps,
        "tta": args.tta,
        "frame_ms": round(frame_ms, 4),
        "duration_ms": args.duration_ms,
        "source_continuity": continuity(original),
        "smooth_continuity": continuity(smoothed),
        "asset": "rollOver.webp",
    }
    args.output_dir.mkdir(parents=True, exist_ok=True)
    (args.output_dir / "roll-v3-manifest.json").write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(manifest, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
