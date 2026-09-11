---
name: media-processing
description: Inspect, trim, transcode and extract audio or video with FFmpeg.
---

# Media Processing

## Inspect before converting
Run `ffprobe -v error -show_format -show_streams -of json <input>` to identify codecs, duration, streams and dimensions. Keep the source file intact and write to a separate output path.

## Common operations
Use `ffmpeg -i <input> -vn <audio-output>` to extract audio; `ffmpeg -i <input> -vf fps=1 <frame-pattern>` for frame sampling. For trimming, choose stream copy when keyframe-aligned cuts are acceptable, or re-encode for precise cuts. Select codecs and container based on the requested target rather than only changing the extension.

## Verify
Probe the output again and compare duration, stream count, resolution and requested format. Play or inspect representative samples when possible. Quote paths and avoid `-y` unless overwriting that output was explicitly intended.

References: https://ffmpeg.org/ffmpeg.html ; https://ffmpeg.org/ffprobe.html
