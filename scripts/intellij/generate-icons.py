# Copyright (c) Microsoft Corporation. All rights reserved.
# Licensed under the MIT License. See License.txt in the project root for license information.
# /// script
# requires-python = ">=3.10"
# dependencies = ["cairosvg==2.9.1", "pillow==13.0.0"]
# ///

"""Generate fork branding from resources/intellij/cat.svg (requires CairoSVG and Pillow)."""

import argparse
from io import BytesIO
from pathlib import Path
import xml.etree.ElementTree as ET

import cairosvg
from PIL import Image


ROOT = Path(__file__).resolve().parents[2]
SVG = "http://www.w3.org/2000/svg"
ET.register_namespace("", SVG)
HEADER = "<!-- Copyright (c) Microsoft Corporation. All rights reserved. Licensed under the MIT License. -->\n"


def artwork(tile=False, color=None, opacity=None):
    cat = ET.parse(ROOT / "resources/intellij/cat.svg").getroot()
    if color:
        source_color = cat.find(f"{{{SVG}}}g").get("fill")
        for element in cat.iter():
            for attribute in ("fill", "stroke"):
                if element.get(attribute) == source_color:
                    element.set(attribute, color)
    if opacity:
        cat.set("opacity", opacity)
    if tile:
        cat.set("x", "72")
        cat.set("y", "66")
        cat.set("width", "368")
        cat.set("height", "380")
        outer = ET.Element(f"{{{SVG}}}svg", {
            "width": "512", "height": "512", "viewBox": "0 0 512 512",
            "role": "img", "aria-label": "Blue cat application icon",
        })
        ET.SubElement(outer, f"{{{SVG}}}rect", {
            "x": "48", "y": "48", "width": "416", "height": "416",
            "rx": "106", "fill": "#fff",
        })
        outer.append(cat)
        cat = outer
    return (HEADER + ET.tostring(cat, encoding="unicode") + "\n").encode()


def generate():
    app = artwork(tile=True)
    outputs = {
        "resources/intellij/cat-app.svg": app,
        "src/vs/workbench/browser/media/code-icon.svg": app,
        "src/vs/sessions/browser/media/vscode-icon.svg": app,
    }
    for theme, color, opacity in (
        ("light", "#000000", "0.1"),
        ("dark", "#000000", "0.3"),
        ("hcDark", "#3C3C3C", None),
        ("hcLight", "#D9D9D9", None),
    ):
        outputs[f"src/vs/workbench/browser/parts/editor/media/letterpress-{theme}.svg"] = artwork(color=color, opacity=opacity)

    for filename, size in (
        ("resources/linux/code.png", 512),
        ("resources/server/code-192.png", 192),
        ("resources/server/code-512.png", 512),
    ):
        outputs[filename] = cairosvg.svg2png(bytestring=app, output_width=size, output_height=size)

    master = Image.open(BytesIO(cairosvg.svg2png(bytestring=app, output_width=1024, output_height=1024)))
    for filename, kind, sizes in (
        ("resources/darwin/code.icns", "ICNS", None),
        ("resources/win32/code.ico", "ICO", [(s, s) for s in (16, 24, 32, 48, 64, 128, 256)]),
        ("resources/server/favicon.ico", "ICO", [(s, s) for s in (16, 32, 48)]),
    ):
        buffer = BytesIO()
        master.save(buffer, format=kind, **({"sizes": sizes} if sizes else {}))
        outputs[filename] = buffer.getvalue()
    return outputs


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--check", action="store_true", help="Verify generated assets without writing files")
    args = parser.parse_args()
    stale = []
    for filename, content in generate().items():
        target = ROOT / filename
        if args.check:
            if not target.exists() or target.read_bytes() != content:
                stale.append(filename)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
    if stale:
        parser.exit(1, "Stale icon assets:\n" + "\n".join(stale) + "\n")
    print("Cat branding assets verified." if args.check else "Cat branding assets generated.")


if __name__ == "__main__":
    main()
