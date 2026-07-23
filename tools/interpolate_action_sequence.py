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
    save_strip,
    write_rife_inputs,
)


def main() -> None:
    parser = argparse.ArgumentParser(description="Interpolate a custom action key-pose sequence")
    parser.add_argument("--frames-dir", type=Path, required=True)
    parser.add_argument("--rife-bin", type=Path, required=True)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--qa-dir", type=Path, required=True)
    parser.add_argument("--asset", default="thinking")
    parser.add_argument("--factor", type=int, default=32)
    parser.add_argument("--duration-ms", type=float, default=2400.0)
    parser.add_argument("--target-fps", type=float, default=60.0)
    parser.add_argument("--loop", action="store_true")
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
    if len(paths) < 2:
        raise SystemExit(f"Expected at least two source frames in {args.frames_dir}")
    original = [Image.open(path).convert("RGBA") for path in paths]
    rife_inputs = original + ([original[0]] if args.loop else [])
    target_frames = (
        len(original) * args.factor + 1
        if args.loop
        else (len(original) - 1) * args.factor + 1
    )

    with tempfile.TemporaryDirectory(prefix=f"zhuochong-{args.asset}-rife-") as temporary:
        root = Path(temporary)
        black_input = root / "black-input"
        white_input = root / "white-input"
        black_output = root / "black-output"
        white_output = root / "white-output"
        write_rife_inputs(rife_inputs, black_input, white_input)
        run_rife_dyadic(
            args.rife_bin, args.model, black_input, black_output, args.factor, args.tta
        )
        run_rife_dyadic(
            args.rife_bin, args.model, white_input, white_output, args.factor, args.tta
        )
        smoothed = [
            remove_small_detached_components(frame)
            for frame in combine_rife_outputs(black_output, white_output)
        ]

    if len(smoothed) != target_frames:
        raise RuntimeError(f"Expected {target_frames} frames, got {len(smoothed)}")
    if args.loop:
        smoothed = smoothed[:-1]
    interpolated_frames = len(smoothed)
    delivery_frames = round(args.duration_ms * args.target_fps / 1000)
    smoothed = resample_frames(smoothed, delivery_frames, args.loop)
    frame_ms = args.duration_ms / len(smoothed)
    columns = 16
    save_strip(smoothed, args.output_dir / f"{args.asset}.webp", columns)
    save_preview(smoothed, frame_ms, args.qa_dir / f"{args.asset}.gif")
    save_contact_sheet(smoothed, args.qa_dir / f"{args.asset}-contact.png")

    manifest_path = args.output_dir / "manifest.json"
    if manifest_path.is_file():
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    else:
        manifest = {
            "method": "rife-v4.6-ncnn-vulkan-dual-matte-alpha",
            "source": "https://github.com/nihui/rife-ncnn-vulkan",
            "animations": {},
        }
    manifest.setdefault("animations", {})[args.asset] = {
        "source_frames": len(original),
        "frames": len(smoothed),
        "columns": columns,
        "factor": args.factor,
        "interpolated_frames": interpolated_frames,
        "target_fps": args.target_fps,
        "tta": args.tta,
        "frame_ms": round(frame_ms, 4),
        "loop": args.loop,
        "duration_ms": args.duration_ms,
        "source_continuity": continuity(original),
        "smooth_continuity": continuity(smoothed),
        "asset": f"{args.asset}.webp",
    }
    args.output_dir.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
    )
    print(json.dumps(manifest["animations"][args.asset], ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
