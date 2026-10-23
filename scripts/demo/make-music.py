#!/usr/bin/env python3
"""Generate the original ambient music bed for the PhotoGit demo video.

Usage: python3 scripts/demo/make-music.py <seconds> <output.wav>

Soft electric-piano chords over a warm pad and a gentle pulse, in a slow
I-vi-IV-V loop. Everything is synthesized here, so the track carries no
third-party rights.
"""
import sys
import wave

import numpy as np
from scipy.signal import butter, lfilter

RATE = 44100
BPM = 84
BEAT = 60 / BPM

# Cmaj9, Am9, Fmaj9, G6/9: MIDI notes, two bars each.
PROGRESSION = [
    [48, 55, 59, 62, 64],
    [45, 52, 55, 59, 60],
    [41, 48, 52, 55, 57],
    [43, 50, 55, 57, 59],
]
MELODY = [76, 74, 71, 72, 74, 71, 69, 67]  # sparse bell motif, one note per bar


def hz(note):
    return 440.0 * 2 ** ((note - 69) / 12)


def envelope(length, attack, release):
    env = np.ones(length)
    a = min(length, int(attack * RATE))
    r = min(length - a, int(release * RATE))
    env[:a] = np.linspace(0, 1, a) ** 2
    if r:
        env[-r:] = np.linspace(1, 0, r) ** 2
    return env


def tone(freq, seconds, partials, detune=0.0, vibrato=0.0):
    t = np.arange(int(seconds * RATE)) / RATE
    out = np.zeros_like(t)
    for multiple, gain in partials:
        wobble = vibrato * np.sin(2 * np.pi * 0.21 * t)
        out += gain * np.sin(2 * np.pi * freq * multiple * (1 + detune) * t + wobble)
    return out


def lowpass(signal, cutoff):
    b, a = butter(2, cutoff / (RATE / 2))
    return lfilter(b, a, signal)


def reverb(signal, mix=0.35):
    out = signal.copy()
    for delay_ms, gain in [(89, 0.42), (131, 0.35), (197, 0.28), (283, 0.22), (409, 0.16), (601, 0.1)]:
        shift = int(delay_ms / 1000 * RATE)
        delayed = np.zeros_like(signal)
        delayed[shift:] = signal[:-shift]
        out += gain * mix * delayed
    return out


def add(buffer, offset, signal):
    end = min(len(buffer), offset + len(signal))
    if offset < end:
        buffer[offset:end] += signal[:end - offset]


def render(total_seconds):
    length = int(total_seconds * RATE)
    left = np.zeros(length + RATE * 4)
    right = np.zeros_like(left)
    bar = BEAT * 4
    t = 0.0
    index = 0
    while t < total_seconds:
        chord = PROGRESSION[(index // 2) % len(PROGRESSION)]
        start = int(t * RATE)
        if index % 2 == 0:
            # Pad: held for two bars, slow swell.
            for note in chord:
                pad = tone(hz(note), bar * 2 + 1.5, [(1, 1), (2, 0.25), (3, 0.08)], detune=0.0015, vibrato=0.002)
                pad *= envelope(len(pad), 1.6, 1.8) * 0.045
                add(left, start, pad)
                add(right, start, np.roll(pad, 220))
        # Electric piano: chord on beats 1 and 3, slightly spread.
        for beat in (0, 2):
            hit = int((t + beat * BEAT) * RATE)
            for spread, note in enumerate(chord[1:]):
                key = tone(hz(note + 12), 2.4, [(1, 1), (2, 0.35), (4, 0.06)])
                key *= np.exp(-np.arange(len(key)) / RATE * 2.2) * envelope(len(key), 0.008, 0.6) * 0.05
                offset = hit + spread * 330
                pan = 0.35 + 0.1 * spread
                add(left, offset, key * (1 - pan))
                add(right, offset, key * pan)
        # Bell motif on the second beat of every other bar.
        if index % 2 == 1:
            note = MELODY[(index // 2) % len(MELODY)]
            bell = tone(hz(note), 3.0, [(1, 1), (2.76, 0.3), (5.4, 0.08)])
            bell *= np.exp(-np.arange(len(bell)) / RATE * 1.4) * envelope(len(bell), 0.004, 1.0) * 0.032
            hit = int((t + BEAT) * RATE)
            add(left, hit, bell * 0.6)
            add(right, hit, bell * 0.4)
        # Soft sub pulse on each beat.
        for beat in range(4):
            hit = int((t + beat * BEAT) * RATE)
            kick = tone(hz(chord[0] - 12), 0.5, [(1, 1)])
            kick *= np.exp(-np.arange(len(kick)) / RATE * 9) * 0.05
            add(left, hit, kick)
            add(right, hit, kick)
        t += bar
        index += 1

    stereo = []
    for channel in (left, right):
        channel = reverb(lowpass(channel, 5200))[:length]
        stereo.append(channel)
    mix = np.stack(stereo, axis=1)
    # Two-second fade in, four-second fade out, then normalize to -14 dB peak.
    fade_in = min(length, 2 * RATE)
    fade_out = min(length, 4 * RATE)
    mix[:fade_in] *= np.linspace(0, 1, fade_in)[:, None]
    mix[-fade_out:] *= np.linspace(1, 0, fade_out)[:, None]
    mix /= np.max(np.abs(mix)) + 1e-9
    mix *= 10 ** (-14 / 20)
    return mix


def main():
    if len(sys.argv) != 3:
        sys.exit(__doc__)
    seconds = float(sys.argv[1])
    data = (render(seconds) * 32767).astype("<i2")
    with wave.open(sys.argv[2], "wb") as output:
        output.setnchannels(2)
        output.setsampwidth(2)
        output.setframerate(RATE)
        output.writeframes(data.tobytes())
    print(f"Wrote {sys.argv[2]} ({seconds:.1f} s).")


if __name__ == "__main__":
    main()
