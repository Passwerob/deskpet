from __future__ import annotations

import argparse
import json
import subprocess
import tempfile
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


FRAME_WIDTH = 192
FRAME_HEIGHT = 208

ANIMATIONS = {
    "idle": {"row": 0, "frames": 7, "frame_ms": 300, "loop": True, "factor": 32},
    "walkRight": {"row": 1, "frames": 8, "frame_ms": 134, "loop": True, "factor": 8},
    "walkLeft": {"row": 2, "frames": 8, "frame_ms": 134, "loop": True, "factor": 8},
    "wave": {"row": 3, "frames": 4, "frame_ms": 205, "loop": False, "factor": 16},
    "jump": {"row": 4, "frames": 5, "frame_ms": 165, "loop": False, "factor": 16},
    "rollOver": {"row": 5, "frames": 8, "frame_ms": 475, "loop": False, "factor": 8},
    "waiting": {"row": 6, "frames": 6, "frame_ms": 267, "loop": True, "factor": 16},
    "thinking": {"row": 7, "frames": 6, "frame_ms": 275, "loop": True, "factor": 32},
    "focus": {"row": 8, "frames": 6, "frame_ms": 267, "loop": True, "factor": 16},
}


def extract_frames(atlas: Image.Image, row: int, count: int) -> list[Image.Image]:
    top = row * FRAME_HEIGHT
    return [
        atlas.crop(
            (
                index * FRAME_WIDTH,
                top,
                (index + 1) * FRAME_WIDTH,
                top + FRAME_HEIGHT,
            )
        ).convert("RGBA")
        for index in range(count)
    ]


def write_rife_inputs(frames: list[Image.Image], black_dir: Path, white_dir: Path) -> None:
    black_dir.mkdir(parents=True, exist_ok=True)
    white_dir.mkdir(parents=True, exist_ok=True)
    for index, image in enumerate(frames):
        rgba = np.asarray(image, dtype=np.float32) / 255.0
        alpha = rgba[..., 3:4]
        black_matte = rgba[..., :3] * alpha
        white_matte = black_matte + (1.0 - alpha)
        Image.fromarray(np.clip(black_matte * 255 + 0.5, 0, 255).astype(np.uint8), "RGB").save(
            black_dir / f"{index:08d}.png"
        )
        Image.fromarray(np.clip(white_matte * 255 + 0.5, 0, 255).astype(np.uint8), "RGB").save(
            white_dir / f"{index:08d}.png"
        )


def run_rife(
    executable: Path,
    model: Path,
    input_dir: Path,
    output_dir: Path,
    target_frames: int,
    tta: bool,
) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    command = [
            str(executable),
            "-i",
            str(input_dir),
            "-o",
            str(output_dir),
            "-n",
            str(target_frames),
            "-m",
            str(model),
            "-f",
            "%08d.png",
        ]
    if tta:
        command.extend(["-x", "-z"])
    subprocess.run(
        command,
        cwd=executable.parent,
        check=True,
    )


def run_rife_dyadic(
    executable: Path,
    model: Path,
    input_dir: Path,
    output_dir: Path,
    factor: int,
    tta: bool,
) -> None:
    """Recursively double a sequence, dropping RIFE's one padded tail frame per pass."""
    if factor < 1 or factor & (factor - 1):
        raise ValueError(f"RIFE factor must be a power of two, got {factor}")

    current_input = input_dir
    stages = factor.bit_length() - 1
    if stages == 0:
        output_dir.mkdir(parents=True, exist_ok=True)
        for source in sorted(input_dir.glob("*.png")):
            (output_dir / source.name).write_bytes(source.read_bytes())
        return

    for stage in range(stages):
        stage_output = output_dir if stage == stages - 1 else output_dir.parent / f"{output_dir.name}-stage-{stage + 1}"
        input_count = len(list(current_input.glob("*.png")))
        run_rife(executable, model, current_input, stage_output, input_count * 2, tta)
        outputs = sorted(stage_output.glob("*.png"))
        if len(outputs) != input_count * 2:
            raise RuntimeError(
                f"RIFE doubling mismatch: expected {input_count * 2}, got {len(outputs)}"
            )
        # Directory mode emits the final key pose twice because it has no next
        # frame to interpolate. Removing that one padded image gives the exact
        # dyadic sequence: (N - 1) * 2 + 1.
        outputs[-1].unlink()
        current_input = stage_output


def combine_rife_outputs(black_dir: Path, white_dir: Path) -> list[Image.Image]:
    black_paths = sorted(black_dir.glob("*.png"))
    white_paths = sorted(white_dir.glob("*.png"))
    if len(black_paths) != len(white_paths) or not black_paths:
        raise RuntimeError(
            f"RIFE output mismatch: black={len(black_paths)} white={len(white_paths)}"
        )

    frames: list[Image.Image] = []
    for black_path, white_path in zip(black_paths, white_paths):
        black = np.asarray(Image.open(black_path).convert("RGB"), dtype=np.float32) / 255.0
        white = np.asarray(Image.open(white_path).convert("RGB"), dtype=np.float32) / 255.0
        matte_difference = np.clip(white - black, 0.0, 1.0)
        alpha = 1.0 - np.mean(matte_difference, axis=2, keepdims=True)
        alpha = np.clip(alpha, 0.0, 1.0)
        rgb = np.divide(
            black,
            np.maximum(alpha, 2 / 255),
            out=np.zeros_like(black),
            where=alpha > 2 / 255,
        )
        rgba = np.concatenate([np.clip(rgb, 0, 1), np.clip(alpha, 0, 1)], axis=2)
        rgba[rgba[..., 3] < 2 / 255] = 0
        frames.append(Image.fromarray(np.clip(rgba * 255 + 0.5, 0, 255).astype(np.uint8), "RGBA"))
    return frames


def remove_small_detached_components(image: Image.Image, min_pixels: int = 96) -> Image.Image:
    """Remove tiny alpha islands produced by interpolation without touching the pet body."""
    rgba = np.asarray(image.convert("RGBA")).copy()
    rgba[rgba[..., 3] <= 32] = 0
    visible = rgba[..., 3] > 32
    height, width = visible.shape
    visited = np.zeros_like(visible, dtype=bool)
    components: list[list[tuple[int, int]]] = []

    for y in range(height):
        for x in range(width):
            if not visible[y, x] or visited[y, x]:
                continue
            stack = [(y, x)]
            visited[y, x] = True
            component: list[tuple[int, int]] = []
            while stack:
                current_y, current_x = stack.pop()
                component.append((current_y, current_x))
                for offset_y in (-1, 0, 1):
                    for offset_x in (-1, 0, 1):
                        if offset_x == 0 and offset_y == 0:
                            continue
                        next_y = current_y + offset_y
                        next_x = current_x + offset_x
                        if not (0 <= next_y < height and 0 <= next_x < width):
                            continue
                        if visible[next_y, next_x] and not visited[next_y, next_x]:
                            visited[next_y, next_x] = True
                            stack.append((next_y, next_x))
            components.append(component)

    if not components:
        return Image.fromarray(rgba, "RGBA")

    largest = max(len(component) for component in components)
    threshold = max(min_pixels, int(largest * 0.0125))
    for component in components:
        if len(component) >= threshold:
            continue
        ys, xs = zip(*component)
        top = max(0, min(ys) - 2)
        bottom = min(height, max(ys) + 3)
        left = max(0, min(xs) - 2)
        right = min(width, max(xs) + 3)
        rgba[top:bottom, left:right] = 0
    return Image.fromarray(rgba, "RGBA")


def premultiplied_array(image: Image.Image) -> np.ndarray:
    rgba = np.asarray(image.convert("RGBA"), dtype=np.float32) / 255.0
    return np.concatenate([rgba[..., :3] * rgba[..., 3:4], rgba[..., 3:4]], axis=2)


def continuity(frames: list[Image.Image]) -> dict[str, float]:
    diffs = [
        float(np.mean(np.abs(premultiplied_array(left) - premultiplied_array(right))))
        for left, right in zip(frames, frames[1:])
    ]
    return {
        "mean": round(float(np.mean(diffs)), 6),
        "max": round(float(np.max(diffs)), 6),
    }


def resample_frames(
    frames: list[Image.Image],
    target_count: int,
    loop: bool,
) -> list[Image.Image]:
    """Select an even 60 Hz timeline from a denser dyadic RIFE sequence."""
    if target_count < 2:
        raise ValueError(f"target_count must be at least two, got {target_count}")
    if target_count > len(frames):
        raise ValueError(
            f"Cannot resample {len(frames)} frames up to {target_count}; increase RIFE factor"
        )
    if target_count == len(frames):
        return frames

    if loop:
        indices = [int(index * len(frames) / target_count) for index in range(target_count)]
    else:
        last = len(frames) - 1
        indices = [round(index * last / (target_count - 1)) for index in range(target_count)]
    if len(set(indices)) != target_count:
        raise RuntimeError(f"Resampling produced duplicate source indices: {indices}")
    return [frames[index] for index in indices]


def save_strip(frames: list[Image.Image], path: Path, columns: int = 16) -> None:
    rows = (len(frames) + columns - 1) // columns
    strip = Image.new("RGBA", (FRAME_WIDTH * columns, FRAME_HEIGHT * rows), (0, 0, 0, 0))
    for index, frame in enumerate(frames):
        left = (index % columns) * FRAME_WIDTH
        top = (index // columns) * FRAME_HEIGHT
        strip.alpha_composite(frame, (left, top))
    path.parent.mkdir(parents=True, exist_ok=True)
    strip.save(path, "WEBP", lossless=True, method=6)


def checkerboard() -> Image.Image:
    image = Image.new("RGB", (FRAME_WIDTH, FRAME_HEIGHT), "#eef1f6")
    draw = ImageDraw.Draw(image)
    size = 16
    for y in range(0, FRAME_HEIGHT, size):
        for x in range(0, FRAME_WIDTH, size):
            if (x // size + y // size) % 2:
                draw.rectangle((x, y, x + size - 1, y + size - 1), fill="#dfe4ec")
    return image


def composite_frame(frame: Image.Image) -> Image.Image:
    background = checkerboard()
    background.paste(frame, (0, 0), frame)
    return background


def save_preview(frames: list[Image.Image], frame_ms: float, path: Path) -> None:
    previews = [composite_frame(frame) for frame in frames]
    path.parent.mkdir(parents=True, exist_ok=True)
    previews[0].save(
        path,
        save_all=True,
        append_images=previews[1:],
        duration=max(20, round(frame_ms)),
        loop=0,
        optimize=False,
    )


def save_contact_sheet(frames: list[Image.Image], path: Path) -> None:
    columns = 8
    label_height = 18
    rows = (len(frames) + columns - 1) // columns
    sheet = Image.new(
        "RGB",
        (columns * FRAME_WIDTH, rows * (FRAME_HEIGHT + label_height)),
        "#dfe4ec",
    )
    draw = ImageDraw.Draw(sheet)
    for index, frame in enumerate(frames):
        column = index % columns
        row = index // columns
        x = column * FRAME_WIDTH
        y = row * (FRAME_HEIGHT + label_height)
        sheet.paste(composite_frame(frame), (x, y))
        draw.rectangle(
            (x, y + FRAME_HEIGHT, x + FRAME_WIDTH, y + FRAME_HEIGHT + label_height),
            fill="#20242c",
        )
        draw.text((x + 6, y + FRAME_HEIGHT + 2), f"frame {index:02d}", fill="#ffffff")
    path.parent.mkdir(parents=True, exist_ok=True)
    sheet.save(path, "PNG", optimize=True)


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate RIFE in-between frames for Zhuochong")
    parser.add_argument("atlas", type=Path)
    parser.add_argument("--rife-bin", type=Path, required=True)
    parser.add_argument("--model", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--qa-dir", type=Path, required=True)
    parser.add_argument("--action", action="append", choices=sorted(ANIMATIONS))
    parser.add_argument("--tta", action="store_true")
    parser.add_argument("--target-fps", type=float, default=60.0)
    parser.add_argument(
        "--standard-v2",
        action="store_true",
        help="Use the Codex v2 standard six-frame idle row and keep its 2.1s loop duration",
    )
    args = parser.parse_args()

    atlas = Image.open(args.atlas).convert("RGBA")
    animation_specs = {name: dict(spec) for name, spec in ANIMATIONS.items()}
    if args.standard_v2:
        animation_specs["idle"]["frames"] = 6
        animation_specs["idle"]["frame_ms"] = 350
        animation_specs["idle"]["factor"] = 32
    manifest = {
        "method": "rife-v4.6-ncnn-vulkan-dual-matte-alpha",
        "source": "https://github.com/nihui/rife-ncnn-vulkan",
        "animations": {},
    }
    manifest_path = args.output_dir / "manifest.json"
    if args.action and manifest_path.is_file():
        existing_manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        if isinstance(existing_manifest.get("animations"), dict):
            manifest = existing_manifest

    with tempfile.TemporaryDirectory(prefix="zhuochong-rife-") as temporary:
        work_root = Path(temporary)
        selected_actions = args.action or list(animation_specs)
        for action in selected_actions:
            spec = animation_specs[action]
            if spec["factor"] < 1 or spec["factor"] & (spec["factor"] - 1):
                raise RuntimeError(
                    f"{action}: RIFE factor must be a power of two, got {spec['factor']}"
                )
            use_tta = args.tta or action == "rollOver"
            original = extract_frames(atlas, spec["row"], spec["frames"])
            rife_inputs = original + ([original[0]] if spec["loop"] else [])
            target_frames = (
                spec["frames"] * spec["factor"] + 1
                if spec["loop"]
                else (spec["frames"] - 1) * spec["factor"] + 1
            )
            action_root = work_root / action
            black_input = action_root / "black-input"
            white_input = action_root / "white-input"
            black_output = action_root / "black-output"
            white_output = action_root / "white-output"
            write_rife_inputs(rife_inputs, black_input, white_input)
            run_rife_dyadic(
                args.rife_bin, args.model, black_input, black_output, spec["factor"], use_tta
            )
            run_rife_dyadic(
                args.rife_bin, args.model, white_input, white_output, spec["factor"], use_tta
            )
            smoothed = combine_rife_outputs(black_output, white_output)

            if action in {"jump", "rollOver"}:
                smoothed = [remove_small_detached_components(frame) for frame in smoothed]
            if len(smoothed) != target_frames:
                raise RuntimeError(
                    f"{action}: expected {target_frames} RIFE frames, got {len(smoothed)}"
                )
            if spec["loop"]:
                smoothed = smoothed[:-1]

            source_duration_ms = spec["frames"] * spec["frame_ms"]
            interpolated_frames = len(smoothed)
            delivery_frames = round(source_duration_ms * args.target_fps / 1000)
            smoothed = resample_frames(smoothed, delivery_frames, spec["loop"])
            derived_frame_ms = source_duration_ms / len(smoothed)
            columns = 16
            save_strip(smoothed, args.output_dir / f"{action}.webp", columns)
            save_preview(smoothed, derived_frame_ms, args.qa_dir / f"{action}.gif")
            save_contact_sheet(smoothed, args.qa_dir / f"{action}-contact.png")
            manifest["animations"][action] = {
                "source_frames": spec["frames"],
                "frames": len(smoothed),
                "columns": columns,
                "factor": spec["factor"],
                "interpolated_frames": interpolated_frames,
                "target_fps": args.target_fps,
                "tta": use_tta,
                "frame_ms": round(derived_frame_ms, 4),
                "loop": spec["loop"],
                "duration_ms": round(len(smoothed) * derived_frame_ms, 2),
                "source_continuity": continuity(original),
                "smooth_continuity": continuity(smoothed),
                "asset": f"{action}.webp",
            }
            print(f"{action}: {spec['frames']} -> {len(smoothed)} frames")

    args.output_dir.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


if __name__ == "__main__":
    main()
