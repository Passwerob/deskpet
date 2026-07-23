from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw


FRAME_WIDTH = 192
FRAME_HEIGHT = 208
ACTIONS = [
    "idle",
    "walkRight",
    "walkLeft",
    "wave",
    "jump",
    "rollOver",
    "waiting",
    "thinking",
    "focus",
]
SKINS = ["dog", "cream-dog", "corgi-tuantuan"]


def read_specs(root: Path, skin: str) -> dict[str, dict]:
    smooth = root / skin / "smooth"
    manifest = json.loads((smooth / "manifest.json").read_text(encoding="utf-8"))
    specs = dict(manifest["animations"])
    specs["rollOver"] = json.loads(
        (smooth / "roll-v3-manifest.json").read_text(encoding="utf-8")
    )
    return specs


def extract_cells(
    asset: Path,
    frames: int,
    columns: int,
) -> tuple[list[Image.Image], int, tuple[int, int], tuple[int, int]]:
    atlas = Image.open(asset).convert("RGBA")
    rows = (frames + columns - 1) // columns
    expected_size = (columns * FRAME_WIDTH, rows * FRAME_HEIGHT)
    cells = []
    for index in range(frames):
        left = (index % columns) * FRAME_WIDTH
        top = (index // columns) * FRAME_HEIGHT
        cells.append(atlas.crop((left, top, left + FRAME_WIDTH, top + FRAME_HEIGHT)))
    unused_visible = 0
    for index in range(frames, rows * columns):
        left = (index % columns) * FRAME_WIDTH
        top = (index // columns) * FRAME_HEIGHT
        alpha = np.asarray(atlas.crop((left, top, left + FRAME_WIDTH, top + FRAME_HEIGHT)))[..., 3]
        unused_visible += int(np.count_nonzero(alpha))
    return cells, unused_visible, (atlas.width, atlas.height), expected_size


def premultiplied(image: Image.Image) -> np.ndarray:
    rgba = np.asarray(image, dtype=np.float32) / 255.0
    return np.concatenate((rgba[..., :3] * rgba[..., 3:4], rgba[..., 3:4]), axis=2)


def continuity(cells: list[Image.Image]) -> dict[str, float]:
    values = [
        float(np.mean(np.abs(premultiplied(left) - premultiplied(right))))
        for left, right in zip(cells, cells[1:])
    ]
    max_index = int(np.argmax(values))
    return {
        "mean": round(float(np.mean(values)), 6),
        "max": round(float(np.max(values)), 6),
        "max_transition": [max_index, max_index + 1],
    }


def checkerboard() -> Image.Image:
    image = Image.new("RGB", (FRAME_WIDTH, FRAME_HEIGHT), "#eef1f6")
    draw = ImageDraw.Draw(image)
    for y in range(0, FRAME_HEIGHT, 16):
        for x in range(0, FRAME_WIDTH, 16):
            if (x // 16 + y // 16) % 2:
                draw.rectangle((x, y, x + 15, y + 15), fill="#dfe4ec")
    return image


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--generated-root", type=Path, required=True)
    parser.add_argument("--installed-root", type=Path, required=True)
    parser.add_argument("--json-out", type=Path, required=True)
    parser.add_argument("--sheet-out", type=Path, required=True)
    args = parser.parse_args()

    thumb = (48, 52)
    samples_per_action = 8
    block_width = samples_per_action * thumb[0]
    row_height = thumb[1] + 18
    header_height = 24
    sheet = Image.new(
        "RGB",
        (block_width * len(SKINS), header_height + row_height * len(ACTIONS)),
        "#dfe4ec",
    )
    draw = ImageDraw.Draw(sheet)
    report: dict[str, object] = {"ok": True, "skins": {}}

    for skin_index, skin in enumerate(SKINS):
        generated_specs = read_specs(args.generated_root, skin)
        installed_specs = read_specs(args.installed_root, skin)
        skin_report: dict[str, object] = {}
        sheet_x = skin_index * block_width
        draw.rectangle((sheet_x, 0, sheet_x + block_width, header_height), fill="#20242c")
        draw.text((sheet_x + 7, 6), skin, fill="#ffffff")

        for action_index, action in enumerate(ACTIONS):
            spec = generated_specs[action]
            frames = int(spec["frames"])
            columns = int(spec.get("columns", frames))
            asset = args.generated_root / skin / "smooth" / str(spec["asset"])
            cells, unused_visible, actual_size, expected_size = extract_cells(asset, frames, columns)
            hashes = [hashlib.sha256(cell.tobytes()).hexdigest() for cell in cells]
            adjacent_duplicates = sum(left == right for left, right in zip(hashes, hashes[1:]))
            visible_frames = sum(int(np.count_nonzero(np.asarray(cell)[..., 3]) > 0) for cell in cells)
            measured = continuity(cells)
            old_frames = int(installed_specs[action]["frames"])
            unique_ratio = len(set(hashes)) / frames
            action_ok = (
                actual_size == expected_size
                and visible_frames == frames
                and unique_ratio >= 0.97
                and adjacent_duplicates == 0
                and unused_visible == 0
            )
            report["ok"] = bool(report["ok"]) and action_ok
            skin_report[action] = {
                "ok": action_ok,
                "old_frames": old_frames,
                "frames": frames,
                "increase": round(frames / old_frames, 3),
                "columns": columns,
                "frame_ms": spec["frame_ms"],
                "duration_ms": spec["duration_ms"],
                "actual_size": actual_size,
                "expected_size": expected_size,
                "visible_frames": visible_frames,
                "unique_frames": len(set(hashes)),
                "unique_ratio": round(unique_ratio, 4),
                "adjacent_duplicates": adjacent_duplicates,
                "unused_visible_pixels": unused_visible,
                "continuity": measured,
            }

            indices = np.linspace(0, frames - 1, samples_per_action, dtype=int)
            label_y = header_height + action_index * row_height
            draw.rectangle((sheet_x, label_y, sheet_x + block_width, label_y + 18), fill="#303642")
            draw.text((sheet_x + 5, label_y + 3), f"{action} {frames}f", fill="#ffffff")
            for sample_index, frame_index in enumerate(indices):
                background = checkerboard()
                background.paste(cells[int(frame_index)], (0, 0), cells[int(frame_index)])
                thumbnail = background.resize(thumb, Image.Resampling.LANCZOS)
                sheet.paste(thumbnail, (sheet_x + sample_index * thumb[0], label_y + 18))

        report["skins"][skin] = skin_report

    args.json_out.parent.mkdir(parents=True, exist_ok=True)
    args.sheet_out.parent.mkdir(parents=True, exist_ok=True)
    args.json_out.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    sheet.save(args.sheet_out, "PNG", optimize=True)
    print(json.dumps({"ok": report["ok"], "json": str(args.json_out), "sheet": str(args.sheet_out)}, ensure_ascii=False))


if __name__ == "__main__":
    main()
