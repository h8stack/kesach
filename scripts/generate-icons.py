#!/usr/bin/env python3
"""Generate the KeSach app and file-association icons from vector sources.

Requires rsvg-convert (librsvg) and ImageMagick's `convert`. The generated
PNG/ICO/ICNS files are committed so packaging does not need these tools.

Usage: python3 scripts/generate-icons.py
"""

import os
import struct
import subprocess
import tempfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
ICON_DIR = os.path.join(ROOT, "assets", "icons")
APPX_DIR = os.path.join(ROOT, "assets", "appx")
PUBLIC_ICON = os.path.join(ROOT, "public", "assets", "icon.png")

APP_ICON_SVG = """<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#14B8A6"/>
      <stop offset="0.55" stop-color="#0F766E"/>
      <stop offset="1" stop-color="#0B3B4A"/>
    </linearGradient>
    <linearGradient id="page" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FFFDF7"/>
      <stop offset="1" stop-color="#E9DFC9"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" rx="224" fill="url(#bg)"/>
  <circle cx="512" cy="430" r="330" fill="#5EEAD4" opacity="0.12"/>
  <ellipse cx="512" cy="790" rx="300" ry="40" fill="#041F26" opacity="0.28"/>
  <path d="M238 330 C 340 296, 456 322, 512 372 L 512 770 C 456 720, 340 694, 238 728 Z" fill="url(#page)"/>
  <path d="M786 330 C 684 296, 568 322, 512 372 L 512 770 C 568 720, 684 694, 786 728 Z" fill="url(#page)"/>
  <path d="M238 728 C 340 694, 456 720, 512 770 C 568 720, 684 694, 786 728 L 786 748 C 684 714, 568 740, 512 790 C 456 740, 340 714, 238 748 Z" fill="#CBBFA6" opacity="0.55"/>
  <path d="M512 372 L 512 770" stroke="#C9BCA2" stroke-width="12" opacity="0.55"/>
  <g stroke="#C9BCA2" stroke-width="13" stroke-linecap="round" opacity="0.65" fill="none">
    <path d="M304 430 C 370 408, 438 418, 470 440"/>
    <path d="M304 490 C 370 468, 438 478, 470 500"/>
    <path d="M304 550 C 370 528, 438 538, 470 560"/>
    <path d="M304 610 C 370 588, 438 598, 470 620"/>
    <path d="M554 440 C 586 418, 654 408, 720 430"/>
    <path d="M554 500 C 586 478, 654 468, 720 490"/>
    <path d="M554 560 C 586 538, 654 528, 720 550"/>
    <path d="M554 620 C 586 598, 654 588, 720 610"/>
  </g>
  <path d="M642 300 H 742 V 486 L 692 444 L 642 486 Z" fill="#F97066"/>
  <path d="M642 300 H 742 V 322 H 642 Z" fill="#FF8A80" opacity="0.6"/>
</svg>
"""

FORMAT_ICONS = {
    "epub": {
        "label": "EPUB",
        "font_size": 140,
        "c1": "#0F766E",
        "c2": "#0B3B4A",
        "accent": "#5EEAD4",
        "dark": "#0B3B4A",
    },
    "pdf": {
        "label": "PDF",
        "font_size": 180,
        "c1": "#DC2626",
        "c2": "#7F1D1D",
        "accent": "#FCA5A5",
        "dark": "#7F1D1D",
    },
    "mobi": {
        "label": "MOBI",
        "font_size": 140,
        "c1": "#2563EB",
        "c2": "#1E3A8A",
        "accent": "#93C5FD",
        "dark": "#1E3A8A",
    },
    "azw3": {
        "label": "AZW3",
        "font_size": 140,
        "c1": "#EA580C",
        "c2": "#7C2D12",
        "accent": "#FDBA74",
        "dark": "#7C2D12",
    },
    "comic": {
        "label": "COMIC",
        "font_size": 112,
        "c1": "#7C3AED",
        "c2": "#4C1D95",
        "accent": "#C4B5FD",
        "dark": "#4C1D95",
    },
    "fb2": {
        "label": "FB2",
        "font_size": 180,
        "c1": "#16A34A",
        "c2": "#14532D",
        "accent": "#86EFAC",
        "dark": "#14532D",
    },
}


def format_icon_svg(spec):
    return f"""<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="{spec['c1']}"/>
      <stop offset="1" stop-color="{spec['c2']}"/>
    </linearGradient>
  </defs>
  <rect width="1024" height="1024" rx="224" fill="url(#bg)"/>
  <circle cx="512" cy="450" r="310" fill="#FFFFFF" opacity="0.08"/>
  <path d="M282 238 H 620 L 742 360 V 786 H 282 Z" fill="#FFFDF7"/>
  <path d="M620 238 L 742 360 H 620 Z" fill="#E6DCC8"/>
  <text x="512" y="610" text-anchor="middle"
        font-family="DejaVu Sans, Arial, Helvetica, sans-serif"
        font-size="{spec['font_size']}" font-weight="700" fill="{spec['dark']}">{spec['label']}</text>
  <rect x="382" y="660" width="260" height="18" rx="9" fill="{spec['accent']}" opacity="0.9"/>
</svg>
"""

ICNS_TYPES = [
    (16, "icp4"),
    (32, "icp5"),
    (64, "icp6"),
    (128, "ic07"),
    (256, "ic08"),
    (512, "ic09"),
    (1024, "ic10"),
]

SIZES = [16, 32, 48, 64, 128, 256, 512, 1024]
ICO_SIZES = [256, 128, 64, 48, 32, 16]
CONVERT = "convert"


def run(cmd):
    subprocess.run(cmd, check=True, stdout=subprocess.DEVNULL)


def render(svg_path, size, out_path):
    run(["rsvg-convert", "-w", str(size), "-h", str(size), "-o", out_path, svg_path])


def write_icns(png_by_size, out_path):
    chunks = []
    for size, ostype in ICNS_TYPES:
        data = open(png_by_size[size], "rb").read()
        chunks.append(ostype.encode("ascii") + struct.pack(">I", 8 + len(data)) + data)
    body = b"".join(chunks)
    with open(out_path, "wb") as f:
        f.write(b"icns" + struct.pack(">I", 8 + len(body)) + body)


def write_ico(png_by_size, out_path):
    run([CONVERT] + [png_by_size[size] for size in ICO_SIZES] + [out_path])


def emit_icon_set(svg_text, name):
    with tempfile.TemporaryDirectory() as tmp:
        svg_path = os.path.join(tmp, name + ".svg")
        with open(svg_path, "w", encoding="utf-8") as f:
            f.write(svg_text)
        png_by_size = {}
        for size in SIZES:
            png_path = os.path.join(tmp, f"{name}-{size}.png")
            render(svg_path, size, png_path)
            png_by_size[size] = png_path
        write_ico(png_by_size, os.path.join(ICON_DIR, name + ".ico"))
        write_icns(png_by_size, os.path.join(ICON_DIR, name + ".icns"))
        return {
            size: open(png_by_size[size], "rb").read() for size in SIZES
        }


def main():
    os.makedirs(ICON_DIR, exist_ok=True)
    os.makedirs(APPX_DIR, exist_ok=True)

    with open(os.path.join(ICON_DIR, "icon.svg"), "w", encoding="utf-8") as f:
        f.write(APP_ICON_SVG)

    app_pngs = emit_icon_set(APP_ICON_SVG, "icon")
    # electron-builder's Linux icon directory expects {size}x{size}.png.
    for size in (16, 32, 48, 64, 128, 256, 512):
        with open(os.path.join(ICON_DIR, f"{size}x{size}.png"), "wb") as dst:
            dst.write(app_pngs[size])

    # Appx / Microsoft Store tile assets.
    appx_specs = [
        ("StoreLogo.png", 100),
        ("Square44x44Logo.png", 88),
        ("Square44x44Logo.targetsize-256_altform-unplated.png", 88),
        ("Square44x44Logo.targetsize-44_altform-unplated.png", 88),
        ("Square150x150Logo.png", 300),
    ]
    for filename, size in appx_specs:
        render(os.path.join(ICON_DIR, "icon.svg"), size, os.path.join(APPX_DIR, filename))
    with open(os.path.join(APPX_DIR, "icon.ico"), "wb") as dst, open(
        os.path.join(ICON_DIR, "icon.ico"), "rb"
    ) as src:
        dst.write(src.read())

    # Wide tile: centered 171px logo on a transparent 620x300 canvas.
    wide_tmp = os.path.join(APPX_DIR, ".wide-icon.png")
    render(os.path.join(ICON_DIR, "icon.svg"), 171, wide_tmp)
    run([
        CONVERT,
        "-size",
        "620x300",
        "xc:none",
        wide_tmp,
        "-gravity",
        "center",
        "-composite",
        os.path.join(APPX_DIR, "Wide310x150Logo.png"),
    ])
    os.remove(wide_tmp)

    # Tray icon (used by main.js in both dev and packaged builds).
    os.makedirs(os.path.dirname(PUBLIC_ICON), exist_ok=True)
    with open(PUBLIC_ICON, "wb") as dst:
        dst.write(app_pngs[256])
    build_tray = os.path.join(ROOT, "build", "assets", "icon.png")
    if os.path.isdir(os.path.dirname(build_tray)):
        with open(build_tray, "wb") as dst:
            dst.write(app_pngs[256])

    for name, spec in FORMAT_ICONS.items():
        emit_icon_set(format_icon_svg(spec), name)

    print("Generated KeSach icons in assets/icons, assets/appx and public/assets")


if __name__ == "__main__":
    main()
