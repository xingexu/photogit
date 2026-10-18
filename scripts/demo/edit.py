#!/usr/bin/env python3
"""Cut the PhotoGit demo video from raw screen recordings.

Usage: python3 scripts/demo/edit.py <edl.json> <output.mp4>

The edit decision list (EDL) is a JSON object:

  {
    "music": "music.wav",                    # optional; looped/trimmed to fit
    "segments": [
      {"card": "title", "seconds": 4},       # title | end | chapter
      {"card": "chapter", "seconds": 2.5, "slots": ["ACT 2", "Track and save", "..."]},
      {"src": "raw/take.mov", "start": 12.0, "end": 31.5, "speed": 1.0,
       "crop": [x, y, w, h],                 # source pixels; omitted = full frame
       "captions": [{"at": 0.5, "until": 6, "code": "/scan", "text": "...", "step": "ACT 2"}]}
    ]
  }

Caption times are in output seconds, relative to the start of their segment.
Paths are relative to the EDL file. Requires ffmpeg and Google Chrome.
"""
import json
import os
import shutil
import subprocess
import sys
import tempfile
import urllib.parse
from pathlib import Path

WIDTH, HEIGHT, FPS = 1920, 1080, 30
FADE = 0.45
ROOT = Path(__file__).resolve().parents[2]
CARDS = ROOT / "scripts" / "demo" / "cards.html"
CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"


def run(command):
    subprocess.run(command, check=True, stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)


def render_card(name, slots, destination):
    spec = name if not slots else f"{name}={'|'.join(slots)}"
    url = f"file://{CARDS}#{urllib.parse.quote(spec)}"
    environment = {key: value for key, value in os.environ.items() if key != "ELECTRON_RUN_AS_NODE"}
    subprocess.run([CHROME, "--headless=new", "--disable-gpu", "--hide-scrollbars", "--default-background-color=00000000",
                    f"--window-size={WIDTH},{HEIGHT}", "--virtual-time-budget=4000", f"--screenshot={destination}", url],
                   check=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, env=environment)
    return destination


def encode(arguments, destination):
    run(["ffmpeg", "-y", "-hide_banner", *arguments, "-r", str(FPS), "-c:v", "libx264", "-preset", "medium", "-crf", "17",
         "-pix_fmt", "yuv420p", "-an", str(destination)])


def card_segment(segment, work, index):
    image = render_card(segment["card"], segment.get("slots"), work / f"card-{index}.png")
    seconds = float(segment.get("seconds", 3))
    destination = work / f"segment-{index:03}.mp4"
    encode(["-loop", "1", "-t", str(seconds), "-i", str(image),
            "-vf", f"scale={WIDTH}:{HEIGHT},format=yuv420p"], destination)
    return destination, seconds


def clip_segment(segment, base, work, index):
    source = (base / segment["src"]).resolve()
    start, end = float(segment["start"]), float(segment["end"])
    speed = float(segment.get("speed", 1.0))
    seconds = (end - start) / speed
    filters = []
    if segment.get("crop"):
        x, y, w, h = segment["crop"]
        filters.append(f"crop={w}:{h}:{x}:{y}")
    # Fit inside 1920x1080 on the panel's dark grey, never stretched.
    filters += [f"setpts=(PTS-STARTPTS)/{speed}", f"scale={WIDTH}:{HEIGHT}:force_original_aspect_ratio=decrease:flags=lanczos",
                f"pad={WIDTH}:{HEIGHT}:(ow-iw)/2:(oh-ih)/2:color=0x1e1e1e", f"fps={FPS}", "format=yuva420p"]
    inputs = ["-ss", str(start), "-to", str(end), "-i", str(source)]
    graph = [f"[0:v]{','.join(filters)}[base]"]
    last = "base"
    for number, caption in enumerate(segment.get("captions", [])):
        image = render_card("caption", [caption.get("code", ""), caption["text"], caption.get("step", "")], work / f"caption-{index}-{number}.png")
        at = float(caption.get("at", 0.3))
        until = min(float(caption.get("until", seconds - 0.3)), seconds - 0.05)
        inputs += ["-loop", "1", "-t", str(seconds), "-i", str(image)]
        stream = number + 1
        graph.append(f"[{stream}:v]format=rgba,fade=t=in:st={at}:d=0.3:alpha=1,fade=t=out:st={max(at, until - 0.3)}:d=0.3:alpha=1[c{number}]")
        graph.append(f"[{last}][c{number}]overlay=0:0:enable='between(t,{at},{until})'[v{number}]")
        last = f"v{number}"
    destination = work / f"segment-{index:03}.mp4"
    encode([*inputs, "-filter_complex", ";".join(graph), "-map", f"[{last}]", "-t", str(seconds)], destination)
    return destination, seconds


def assemble(parts, music, base, destination, work):
    # Crossfade every segment into the next.
    inputs, graph = [], []
    for part, _ in parts:
        inputs += ["-i", str(part)]
    offset, last = 0.0, "0:v"
    for index in range(1, len(parts)):
        offset += parts[index - 1][1] - FADE
        label = f"x{index}"
        graph.append(f"[{last}][{index}:v]xfade=transition=fade:duration={FADE}:offset={offset:.3f}[{label}]")
        last = label
    total = sum(seconds for _, seconds in parts) - FADE * (len(parts) - 1)
    graph.append(f"[{last}]format=yuv420p[video]")
    maps = ["-map", "[video]"]
    if music:
        inputs += ["-stream_loop", "-1", "-i", str((base / music).resolve())]
        graph.append(f"[{len(parts)}:a]atrim=0:{total:.3f},afade=t=in:d=1.5,afade=t=out:st={max(0, total - 3):.3f}:d=3,volume=0.85[audio]")
        maps += ["-map", "[audio]", "-c:a", "aac", "-b:a", "160k"]
    run(["ffmpeg", "-y", "-hide_banner", *inputs, "-filter_complex", ";".join(graph), *maps,
         "-c:v", "libx264", "-preset", "slow", "-crf", "20", "-pix_fmt", "yuv420p", "-movflags", "+faststart", str(destination)])
    return total


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    edl_path = Path(sys.argv[1]).resolve()
    edl = json.loads(edl_path.read_text())
    work = Path(tempfile.mkdtemp(prefix="photogit-edit-"))
    try:
        parts = []
        for index, segment in enumerate(edl["segments"]):
            part = card_segment(segment, work, index) if "card" in segment else clip_segment(segment, edl_path.parent, work, index)
            parts.append(part)
            print(f"segment {index + 1}/{len(edl['segments'])}: {part[1]:.1f} s", flush=True)
        total = assemble(parts, edl.get("music"), edl_path.parent, Path(sys.argv[2]).resolve(), work)
        print(f"Wrote {sys.argv[2]} ({total:.1f} s).")
    finally:
        shutil.rmtree(work, ignore_errors=True)


if __name__ == "__main__":
    main()
