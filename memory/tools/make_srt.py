#!/usr/bin/env python3
"""Build a CapCut-ready SRT from a plain voice-over script.

Usage: python3 make_srt.py script.txt out.srt [--wps 2.6]

Reads only the text after the line "=== СЦЕНАРИЙ ===" if present.
Splits into sentences, then into cues of at most two lines of <= 42 chars,
breaking at clause punctuation first and word boundaries second. Timing is
estimated from words per second; realign in CapCut once real audio exists.
"""
import re
import sys

MAX_LINE = 42
MAX_LINES = 2


def load_script(path):
    text = open(path, encoding="utf-8").read()
    marker = "=== СЦЕНАРИЙ ==="
    if marker in text:
        text = text.split(marker, 1)[1]
    return " ".join(text.split())


def sentences(text):
    parts = re.split(r"(?<=[.!?])\s+", text)
    return [p.strip() for p in parts if p.strip()]


def wrap(words):
    """Greedy wrap of a word list into lines <= MAX_LINE."""
    lines, cur = [], ""
    for w in words:
        cand = (cur + " " + w).strip()
        if len(cand) <= MAX_LINE:
            cur = cand
        else:
            if cur:
                lines.append(cur)
            cur = w
    if cur:
        lines.append(cur)
    return lines


def fits(text):
    return len(wrap(text.split())) <= MAX_LINES


def pack(units):
    """Greedily join units (clauses or words) while the cue still fits."""
    out, cur = [], ""
    for u in units:
        cand = (cur + " " + u).strip()
        if fits(cand):
            cur = cand
        else:
            if cur:
                out.append(cur)
            cur = u
    if cur:
        out.append(cur)
    return out


def split_cue(sentence):
    """Split one sentence into chunks that each fit MAX_LINES lines."""
    if fits(sentence):
        return [sentence]
    words = sentence.split()
    k = len(pack(words))
    while True:
        size = -(-len(words) // k)
        parts = [" ".join(words[i:i + size]) for i in range(0, len(words), size)]
        if all(fits(p) for p in parts):
            return [p for p in parts if p]
        k += 1


def fmt(t):
    h = int(t // 3600)
    m = int(t % 3600 // 60)
    s = int(t % 60)
    ms = int(round((t - int(t)) * 1000))
    if ms == 1000:
        s, ms = s + 1, 0
    return f"{h:02d}:{m:02d}:{s:02d},{ms:03d}"


def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    wps = 2.6
    if "--wps" in sys.argv:
        wps = float(sys.argv[sys.argv.index("--wps") + 1])
    src, dst = args[0], args[1]
    text = load_script(src)
    cues = []
    for s in sentences(text):
        cues.extend(split_cue(s))
    t = 0.0
    out = []
    for i, cue in enumerate(cues, 1):
        dur = max(1.0, len(cue.split()) / wps)
        out.append(f"{i}\n{fmt(t)} --> {fmt(t + dur)}\n" + "\n".join(wrap(cue.split())) + "\n")
        t += dur
    open(dst, "w", encoding="utf-8").write("\n".join(out))
    print(f"{len(cues)} cues, total {fmt(t)}")


if __name__ == "__main__":
    main()
