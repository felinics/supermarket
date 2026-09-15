#!/usr/bin/env python3
"""
Inline CSS from <style> blocks into element style="" attributes.

Required for email templates: most clients (Gmail, Yahoo Mail) strip <style>
blocks from the <head>, so all CSS must be inlined before sending.

@media queries are intentionally preserved in a <style> block because they
cannot be expressed as inline styles and are only needed by clients that
support them (Apple Mail, Outlook app on iOS/Android).

Usage:
  python scripts/inline_css.py input.html output.html

Dependencies:
  pip install premailer
"""

import argparse
import sys
from pathlib import Path


def inline_css(input_path: Path, output_path: Path) -> None:
    try:
        import premailer
    except ImportError:
        sys.stderr.write(
            "Error: premailer is not installed.\n"
            "Run:  pip install premailer\n"
        )
        sys.exit(1)

    html = input_path.read_text(encoding="utf-8")

    result = premailer.transform(
        html,
        remove_classes=False,       # keep class names (used by @media queries)
        keep_style_tags=True,       # preserve @media in a <style> block
        strip_important=False,      # leave !important for @media overrides
        allow_network=False,        # don't fetch external stylesheets
        allow_insecure_ssl=False,
    )

    output_path.write_text(result, encoding="utf-8")

    # Quick stats
    original_size = len(html.encode("utf-8"))
    output_size   = len(result.encode("utf-8"))
    print(f"Input:  {input_path}  ({original_size:,} bytes)")
    print(f"Output: {output_path}  ({output_size:,} bytes)")
    print("Done — CSS inlined successfully.")


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Inline CSS for HTML email templates.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("input",  help="Input HTML file (with <style> blocks)")
    parser.add_argument("output", help="Output HTML file (with inlined CSS)")
    args = parser.parse_args()

    input_path  = Path(args.input)
    output_path = Path(args.output)

    if not input_path.exists():
        sys.stderr.write(f"Error: {input_path} not found\n")
        sys.exit(1)

    inline_css(input_path, output_path)


if __name__ == "__main__":
    main()
