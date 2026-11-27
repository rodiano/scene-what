# Laver to små demo-loops (egen komposition, fri at bruge) til media/.
# Kør: python3 tools/make-demo-music.py   (kræver ffmpeg for mp3)
import math, random, struct, subprocess, wave, pathlib

SR = 22050
OUT = pathlib.Path(__file__).resolve().parent.parent / 'media'

def note(n):  # MIDI-nummer -> Hz
    return 440 * 2 ** ((n - 69) / 12)

def render(bpm, bars, parts, path):
    beat = 60 / bpm
    total = int(SR * beat * 4 * bars)
    buf = [0.0] * total
    def add(t0, dur, fn, vol):
        i0 = int(t0 * SR)
        for i in range(int(dur * SR)):
            j = i0 + i
            if j >= total: j -= total  # loop rundt, så overgangen er sømløs
            t = i / SR
            env = min(1, t * 80) * math.exp(-t * 3 / dur)
            buf[j] += fn(t) * env * vol
    for p in parts: p(add, beat)
    peak = max(abs(x) for x in buf) or 1
    wav = OUT / (path + '.wav')
    with wave.open(str(wav), 'w') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(SR)
        w.writeframes(b''.join(struct.pack('<h', int(x / peak * 0.85 * 32767)) for x in buf))
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', str(wav), '-b:a', '96k', str(OUT / (path + '.mp3'))], check=True)
    wav.unlink()

sine = lambda f: (lambda t: math.sin(2 * math.pi * f * t))
tri = lambda f: (lambda t: 2 * abs(2 * ((t * f) % 1) - 1) - 1)
saw = lambda f: (lambda t: 2 * ((t * f) % 1) - 1)
random.seed(4)
noise = lambda t: random.uniform(-1, 1)

# --- Baggrund: rolig festivalstemning (96 bpm, 8 takter) ---
chords = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]  # Am F C G
def bg_pad(add, b):
    for bar in range(8):
        for n in chords[bar % 4]:
            add(bar * 4 * b, 4 * b, tri(note(n)), 0.10)
def bg_bass(add, b):
    for bar in range(8):
        root = chords[bar % 4][0] - 12
        for k in (0, 1.5, 2, 3):
            add((bar * 4 + k) * b, 0.4 * b, sine(note(root)), 0.35)
def bg_bell(add, b):
    mel = [76, 72, 74, 76, 77, 76, 72, 71]
    for bar in range(8):
        for k, n in enumerate(mel[(bar * 2) % 8:(bar * 2) % 8 + 2]):
            add((bar * 4 + k * 2 + 0.5) * b, 1.2 * b, sine(note(n)), 0.08)
def bg_shaker(add, b):
    for s in range(8 * 8):
        add(s * b / 2, 0.05, noise, 0.04 if s % 2 else 0.07)
render(96, 8, [bg_pad, bg_bass, bg_bell, bg_shaker], 'demo-baggrund')

# --- Finale: festligt band-nummer (128 bpm, 8 takter) ---
fchords = [[60, 64, 67], [57, 60, 64], [53, 57, 60], [55, 59, 62]]  # C Am F G
def f_kick(add, b):
    for s in range(32): add(s * b, 0.25, lambda t: math.sin(2 * math.pi * (55 + 90 * math.exp(-t * 30)) * t), 0.9)
def f_snare(add, b):
    for s in range(32):
        if s % 2: add(s * b, 0.18, noise, 0.35)
def f_hat(add, b):
    for s in range(64): add(s * b / 2 + b / 4, 0.04, noise, 0.08)
def f_bass(add, b):
    for bar in range(8):
        r = fchords[bar % 4][0] - 24
        for k in range(8): add((bar * 4 + k / 2) * b, 0.3 * b, saw(note(r if k % 4 else r + 12 * (k == 4))), 0.16)
def f_stab(add, b):
    for bar in range(8):
        for k in (0.5, 1.5, 2.5, 3.5):
            for n in fchords[bar % 4]: add((bar * 4 + k) * b, 0.25 * b, saw(note(n)), 0.05)
def f_lead(add, b):
    mel = [72, 74, 76, 79, 76, 74, 72, 69, 72, 74, 76, 74, 72, 71, 72, 74]
    for i, n in enumerate(mel * 2): add(i * b, 0.8 * b, tri(note(n + 12)), 0.10)
render(128, 8, [f_kick, f_snare, f_hat, f_bass, f_stab, f_lead], 'demo-finale')
print('Lavet:', [p.name for p in OUT.glob('demo-*.mp3')])
