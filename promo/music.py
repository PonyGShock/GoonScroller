"""Calm lo-fi soundtrack for the promo, synthesized from scratch (no samples, no licensing).

Pads, Rhodes-like chords, a soft beat and a quiet rain bed, plus gentle sound effects
synced to timeline.json (post snaps, key presses, gallery flips, logo).
    python3 promo/music.py out.wav
"""
import json
import sys
from pathlib import Path

import numpy as np
from scipy.io import wavfile
from scipy.signal import butter, fftconvolve, sosfilt

SR = 44100
HERE = Path(__file__).parent
T = json.loads((HERE / "timeline.json").read_text())
DUR = T["duration"]
N = int(SR * DUR)
BEAT = 60 / T["bpm"]
BAR = 4 * BEAT
rng = np.random.default_rng(7)


def t_axis(sec):
    return np.arange(int(sec * SR)) / SR


def note_hz(name):
    names = {"C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5, "F#": 6, "G": 7, "G#": 8, "A": 9, "A#": 10, "B": 11}
    pitch, octave = name[:-1], int(name[-1])
    return 440 * 2 ** ((names[pitch] + 12 * (octave + 1) - 69) / 12)


def lp(x, hz, order=2):
    return sosfilt(butter(order, hz, "low", fs=SR, output="sos"), x)


def hp(x, hz, order=2):
    return sosfilt(butter(order, hz, "high", fs=SR, output="sos"), x)


def bp(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo, hi], "band", fs=SR, output="sos"), x)


def add(track, sig, at):
    i = int(at * SR)
    if i >= len(track):
        return
    sig = sig[: len(track) - i]
    track[i : i + len(sig)] += sig


# Fmaj7 → Em7 → Dm7 → Cmaj7, one chord per bar.
CHORDS = [
    (["F3", "A3", "C4", "E4"], "F2"),
    (["E3", "G3", "B3", "D4"], "E2"),
    (["D3", "F3", "A3", "C4"], "D2"),
    (["C3", "E3", "G3", "B3"], "C2"),
]
BARS = int(np.ceil(DUR / BAR))
SEC = T.get("music", {"drums": [2, 10], "bass": [2, 10], "keys": [2, BARS]})

pad = np.zeros(N)
keys = np.zeros(N)
bass = np.zeros(N)
drums = np.zeros(N)
sfx = np.zeros(N)
kick_env = np.zeros(N)

# ---------- pad: soft detuned sines, slow swell ----------
for b in range(BARS):
    notes, _ = CHORDS[b % 4]
    length = BAR + 1.6
    t = t_axis(length)
    env = np.minimum(1, t / 0.4) * np.minimum(1, np.maximum(0, (length - t) / 1.4))
    sig = np.zeros_like(t)
    for n in notes:
        f = note_hz(n)
        for det in (-0.12, 0.0, 0.13):
            ph = rng.uniform(0, 2 * np.pi)
            sig += np.sin(2 * np.pi * (f + det) * t + ph) + 0.18 * np.sin(4 * np.pi * (f + det) * t + ph)
    add(pad, lp(sig * env, 1400) * 0.026, b * BAR)

# ---------- keys: Rhodes-ish stabs with tremolo (from bar 2) ----------
def rhodes(f, length=2.4, vel=1.0):
    t = t_axis(length)
    body = np.sin(2 * np.pi * f * t) * np.exp(-t / 1.1)
    bell = 0.25 * np.sin(2 * np.pi * f * 3.01 * t) * np.exp(-t / 0.25)
    trem = 1 + 0.18 * np.sin(2 * np.pi * 4.2 * t)
    return (body + bell) * trem * np.minimum(1, t / 0.005) * vel


for b in range(SEC["keys"][0], min(SEC["keys"][1], BARS)):
    notes, _ = CHORDS[b % 4]
    for beat_pos, vel in ((0, 1.0), (2.5, 0.7)):
        if b >= BARS - 1 and beat_pos > 0:
            continue
        at = b * BAR + beat_pos * BEAT + rng.uniform(0, 0.02)
        for k, n in enumerate(notes):
            # small strum
            add(keys, rhodes(note_hz(n) * 2, vel=vel) * 0.075, at + k * 0.012)

# ---------- bass: round sine, beats 1 and 3 (bars 2-9) ----------
for b in range(*SEC["bass"]):
    _, root = CHORDS[b % 4]
    for beat_pos in (0, 2):
        t = t_axis(BEAT * 1.6)
        f = note_hz(root)
        sig = np.tanh(1.5 * np.sin(2 * np.pi * f * t)) * np.exp(-t / 0.9) * np.minimum(1, t / 0.01)
        add(bass, sig * 0.11, b * BAR + beat_pos * BEAT)

# ---------- drums: soft kick, rim, swung hats (bars 2-9) ----------
def kick():
    t = t_axis(0.45)
    f = 45 + 70 * np.exp(-t / 0.04)
    phase = 2 * np.pi * np.cumsum(f) / SR
    return np.sin(phase) * np.exp(-t / 0.16)


def rim():
    t = t_axis(0.25)
    noise = bp(rng.standard_normal(len(t)), 1200, 4500) * np.exp(-t / 0.05)
    body = np.sin(2 * np.pi * 190 * t) * np.exp(-t / 0.04)
    return noise * 0.6 + body * 0.5


def hat(vel):
    t = t_axis(0.08)
    env = np.minimum(1, t / 0.004) * np.exp(-t / 0.03)
    return bp(rng.standard_normal(len(t)), 4000, 8000, order=4) * env * vel


SWING = 0.58
for b in range(*SEC["drums"]):
    base = b * BAR
    for beat_pos in (0, 2.5):
        add(drums, kick() * 0.32, base + beat_pos * BEAT)
        add(kick_env, np.exp(-t_axis(0.5) / 0.15), base + beat_pos * BEAT)
    for beat_pos in (1, 3):
        add(drums, rim() * 0.09, base + beat_pos * BEAT + 0.01)
    for e in range(8):
        pos = (e // 2) + (SWING if e % 2 else 0)
        add(drums, hat(rng.uniform(0.5, 1.0)) * 0.02, base + pos * BEAT)

# ---------- sound effects ----------
def whoomp():
    t = t_axis(0.5)
    f = 150 + 90 * np.exp(-t / 0.06)
    tone = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.12)
    air = bp(rng.standard_normal(len(t)), 300, 2200) * np.exp(-((t - 0.06) ** 2) / 0.004)
    return tone * 0.5 + air * 0.25


def click():
    t = t_axis(0.05)
    return hp(rng.standard_normal(len(t)), 2500) * np.exp(-t / 0.006) + np.sin(2 * np.pi * 1800 * t) * np.exp(-t / 0.01) * 0.3


def pluck(f):
    t = t_axis(0.9)
    return (np.sin(2 * np.pi * f * t) + 0.3 * np.sin(4 * np.pi * f * t)) * np.exp(-t / 0.22) * np.minimum(1, t / 0.003)


def chime(freqs, length=3.5):
    t = t_axis(length)
    out = np.zeros_like(t)
    for i, f in enumerate(freqs):
        out += np.sin(2 * np.pi * f * t) * np.exp(-t / (1.4 - i * 0.2)) / (i + 1)
    return out * np.minimum(1, t / 0.004)


for s in T["snaps"]:
    add(sfx, whoomp() * 0.26, s - 0.02)
for k in T["keys"]:
    for i in range(3):
        add(sfx, lp(click(), 2500) * 0.035, k - 0.2 + i * 0.03)
for f in T["flips"]:
    add(sfx, pluck(note_hz("E5")) * 0.05, f)
add(sfx, chime([note_hz("C5"), note_hz("G5"), note_hz("E6")]) * 0.06, T["logo"])
add(sfx, chime([note_hz("F4"), note_hz("C5"), note_hz("A5"), note_hz("E6")], 5) * 0.07, T["end"])

# ---------- ambience: a soft, dark rain bed (no vinyl crackle or hiss) ----------
rain = lp(bp(rng.standard_normal(N), 250, 1800, order=4), 1200) * 0.008 * (0.85 + 0.15 * np.sin(2 * np.pi * 0.07 * np.arange(N) / SR))
ambience = rain

# ---------- mix ----------
duck = 1 - 0.3 * np.clip(kick_env, 0, 1)
music = pad * duck + keys + bass * duck + drums
send = pad * 0.5 + keys * 0.7 + drums * 0.15 + sfx * 0.6

# Simple stereo reverb: decaying noise impulse responses.
ir_t = t_axis(2.6)
reverb = []
for side in range(2):
    ir = lp(rng.standard_normal(len(ir_t)), 4000) * np.exp(-ir_t / 0.7)
    ir /= np.sqrt(np.sum(ir**2))
    reverb.append(fftconvolve(send, ir)[:N] * 0.45)

# Slight stereo width: keys a touch left, pad delayed right.
delay = int(0.012 * SR)
left = music + sfx + ambience + reverb[0] + keys * 0.15
right = music + sfx + ambience + reverb[1] + np.concatenate([np.zeros(delay), pad[:-delay]]) * 0.2 - keys * 0.15
mix = np.stack([left, right], axis=1)

# Lo-fi warmth: gentle low-pass and soft saturation.
mix = np.stack([lp(mix[:, c], 7500) for c in range(2)], axis=1)
mix = np.tanh(mix * 1.6) / 1.6

# Fades and normalize.
tt = np.arange(N) / SR
fade = np.minimum(1, tt / 0.3) * np.minimum(1, (DUR - tt) / 1.5)
mix *= fade[:, None]
mix *= 0.6 / np.max(np.abs(mix))

wavfile.write(sys.argv[1] if len(sys.argv) > 1 else "music.wav", SR, (mix * 32767).astype(np.int16))
print("music written")

if "--levels" in sys.argv:
    db = lambda x: 20 * np.log10(np.sqrt(np.mean(x**2)) + 1e-9)
    for name, x in [("pad", pad), ("keys", keys), ("bass", bass), ("drums", drums), ("sfx", sfx), ("ambience", ambience), ("reverb", reverb[0])]:
        print(f"{name:9s} {db(x):6.1f} dB")
