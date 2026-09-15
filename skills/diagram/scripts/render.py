#!/usr/bin/env python3
"""
Render a diagram source file to PNG or SVG.

Supported input formats:
  .mmd / .mermaid        → Mermaid  (requires: npx @mermaid-js/mermaid-cli)
  .puml / .plantuml / .pu → PlantUML (requires: java + plantuml.jar OR uses online API)
  .dot / .gv             → Graphviz (requires: graphviz — brew/apt install graphviz)

Usage:
  python scripts/render.py input.mmd output.png
  python scripts/render.py input.mmd output.svg [-w 2400]
  python scripts/render.py input.puml output.png
  python scripts/render.py input.dot output.png
  python scripts/render.py input.dot output.png -K neato
"""

import argparse
import subprocess
import sys
import urllib.request
import base64
import zlib
from pathlib import Path


# ---------------------------------------------------------------------------
# Mermaid
# ---------------------------------------------------------------------------

def render_mermaid(input_path: Path, output_path: Path, width: int = 1600) -> None:
    cmd = [
        "npx", "-y", "@mermaid-js/mermaid-cli",
        "-i", str(input_path),
        "-o", str(output_path),
        "-w", str(width),
    ]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        sys.stderr.write(result.stderr)
        sys.exit(result.returncode)


# ---------------------------------------------------------------------------
# PlantUML
# ---------------------------------------------------------------------------

_PLANTUML_B64_TABLE = str.maketrans(
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/",
    "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_",
)


def _plantuml_encode(source: str) -> str:
    """Encode PlantUML source for the online API URL."""
    compressed = zlib.compress(source.encode("utf-8"))[2:-4]
    return base64.b64encode(compressed).decode().translate(_PLANTUML_B64_TABLE)


def render_plantuml(input_path: Path, output_path: Path) -> None:
    ext = output_path.suffix.lstrip(".")

    # Try local plantuml.jar first (place it at scripts/plantuml.jar)
    jar_path = Path(__file__).parent / "plantuml.jar"
    if jar_path.exists():
        cmd = ["java", "-jar", str(jar_path), f"-t{ext}", str(input_path)]
        result = subprocess.run(cmd, capture_output=True, text=True)
        if result.returncode != 0:
            sys.stderr.write(result.stderr)
            sys.exit(result.returncode)
        # PlantUML writes output next to input; move if needed
        generated = input_path.with_suffix(f".{ext}")
        if generated != output_path:
            generated.rename(output_path)
        return

    # Fall back to online API
    encoded = _plantuml_encode(input_path.read_text(encoding="utf-8"))
    url = f"https://www.plantuml.com/plantuml/{ext}/{encoded}"
    print(f"No plantuml.jar found — using online API: {url}")
    urllib.request.urlretrieve(url, output_path)


# ---------------------------------------------------------------------------
# Graphviz
# ---------------------------------------------------------------------------

def render_graphviz(input_path: Path, output_path: Path, engine: str = "dot") -> None:
    ext = output_path.suffix.lstrip(".")
    cmd = [engine, f"-T{ext}", str(input_path), "-o", str(output_path)]
    result = subprocess.run(cmd, capture_output=True, text=True)
    if result.returncode != 0:
        sys.stderr.write(result.stderr)
        sys.exit(result.returncode)


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def main() -> None:
    parser = argparse.ArgumentParser(
        description="Render a diagram file (Mermaid / PlantUML / Graphviz) to PNG or SVG.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("input",  help="Input diagram file")
    parser.add_argument("output", help="Output file (.png or .svg)")
    parser.add_argument(
        "-K", "--engine", default="dot", metavar="ENGINE",
        help="Graphviz layout engine: dot (default), neato, fdp, sfdp, twopi, circo",
    )
    parser.add_argument(
        "-w", "--width", type=int, default=1600, metavar="PX",
        help="Mermaid output width in pixels (default: 1600)",
    )
    args = parser.parse_args()

    input_path  = Path(args.input)
    output_path = Path(args.output)

    if not input_path.exists():
        sys.stderr.write(f"Error: {input_path} not found\n")
        sys.exit(1)

    suffix = input_path.suffix.lower()

    if suffix in (".mmd", ".mermaid"):
        render_mermaid(input_path, output_path, width=args.width)
    elif suffix in (".puml", ".plantuml", ".pu"):
        render_plantuml(input_path, output_path)
    elif suffix in (".dot", ".gv"):
        render_graphviz(input_path, output_path, engine=args.engine)
    else:
        sys.stderr.write(
            f"Error: unrecognised extension '{suffix}'.\n"
            "Expected .mmd/.mermaid, .puml/.plantuml/.pu, or .dot/.gv\n"
        )
        sys.exit(1)

    print(f"Rendered: {output_path}")


if __name__ == "__main__":
    main()
