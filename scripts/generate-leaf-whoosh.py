"""Generate PhotoGit's original, portable PCM whoosh and bird-chirp effect."""
import math
import random
import struct
import wave
from pathlib import Path

rate = 44100
duration = 3.2
rng = random.Random(38)
slow = fast = phase = 0.0
samples = []
for index in range(round(rate * duration)):
    t = index / rate
    noise = rng.uniform(-1, 1)
    sweep = math.exp(-((t - 0.65) / 0.48) ** 2)
    fast += (0.06 + 0.4 * sweep) * (noise - fast)
    slow += 0.012 * (noise - slow)
    envelope = min(1, t / 0.12) * math.exp(-max(0, t - 0.7) * 1.8)
    value = (fast - slow) * envelope * 0.65
    for start, pitch in [(1.2, 2000), (1.65, 2300), (2.15, 1900)]:
        age = t - start
        if 0 <= age < 0.22:
            chirp_phase = 2 * math.pi * (pitch * age + 550 * age * age / 0.22)
            value += 0.045 * math.sin(math.pi * age / 0.22) ** 2 * math.sin(chirp_phase)
    value *= min(1, (duration - t) / 0.25)
    samples.append(round(max(-1, min(1, value)) * 32767))
assert samples and max(abs(sample) for sample in samples) < 32767, 'Audio must not clip'
assert any(samples), 'Audio must not be silent'
output = Path(__file__).resolve().parents[1] / 'site/audio/leaf-whoosh.wav'
output.parent.mkdir(parents=True, exist_ok=True)
with wave.open(str(output), 'wb') as audio:
    audio.setparams((1, 2, rate, 0, 'NONE', 'not compressed'))
    audio.writeframes(struct.pack('<' + 'h' * len(samples), *samples))
print(f'Generated {output.name}: {duration}s, 16-bit PCM, {rate} Hz')
