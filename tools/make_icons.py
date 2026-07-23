from pathlib import Path

from PIL import Image


ROOT = Path(__file__).resolve().parents[1]
ATLAS = ROOT / "public" / "pets" / "dog" / "spritesheet.webp"
ICONS = ROOT / "src-tauri" / "icons"

frame = Image.open(ATLAS).convert("RGBA").crop((0, 0, 192, 208))
bbox = frame.getbbox()
if bbox:
    frame = frame.crop(bbox)


def render(size: int, padding_ratio: float = 0.1) -> Image.Image:
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    available = int(size * (1 - padding_ratio * 2))
    scale = min(available / frame.width, available / frame.height)
    resized = frame.resize(
        (max(1, round(frame.width * scale)), max(1, round(frame.height * scale))),
        Image.Resampling.LANCZOS,
    )
    x = (size - resized.width) // 2
    y = (size - resized.height) // 2
    canvas.alpha_composite(resized, (x, y))
    return canvas


ICONS.mkdir(parents=True, exist_ok=True)
render(32, 0.05).save(ICONS / "32x32.png")
render(128, 0.08).save(ICONS / "128x128.png")
render(256, 0.08).save(ICONS / "128x128@2x.png")
render(512, 0.08).save(ICONS / "icon.png")
render(256, 0.08).save(
    ICONS / "icon.ico",
    format="ICO",
    sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)],
)
render(64, 0.06).save(ROOT / "public" / "favicon.png")
