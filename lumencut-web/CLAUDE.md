# LumenCut Studio — handoff for an AI assistant (Claude, Devin, etc.)

Live site: https://olyaolya89.github.io/Devin/lumencut-web/
Repo: https://github.com/olyaolya89/Devin — folder `lumencut-web/`
Deploy: GitHub Pages serves the repo's default branch `devin/1787123082-irmaa-waitlist-page` (yes, odd name — it IS the default branch). Merging a PR into it redeploys the site in ~1–2 min. No build step.

## What it is
A static, browser-only (Chrome/Edge) tool for faceless YouTube videos for a US audience, in the style of app.kutly.io:
paste English script + upload voiceover (MP3/WAV) → one click "🎬 Сделать готовое видео" → 1080p MP4 with
meaning-matched, non-repeating stock footage (≤5 s per cut), Kutly-like overlays, word-highlight subtitles, SFX, music,
plus `subtitles.srt` and `credits.txt`. No server, no ffmpeg, no paid credits. UI language is Russian (owner is Russian-speaking).

## Pipeline (js/app.js → makeStoryboard() then doRender())
```
style = loadStyle()                     styles.js – 'doc' (reference documentary, default), 'classic', or 'ref' from analyzeReference() (reference.js)
splitShots(script)                      plan.js   – 2–5 s scenes
transcribe(to16kMono(voice))            ai.js     – Whisper Xenova/whisper-base.en via @huggingface/transformers@3.8.1 (jsDelivr)
alignTiming(shots, words)               plan.js   – fallback estimateTiming() at voice speed
mergeShort(shots, style.cut.min)        plan.js   – doc look: joins short lines so a picture holds 3–8 s
geminiPlan() | heuristicPlan()          plan.js   – meaning → concrete visual + English stock queries, overlay, sfx, mood
gatherCandidates()                      match.js  – sources.js searchAll()
pickMedia()                             match.js  – CLIP Xenova/clip-vit-base-patch32 text↔thumbnail; global no-repeat
planCuts()                              match.js  – MAX_CUT = 5 s
refillShort()                           match.js  – wider search (visual/meaning/topic) for scenes short of clips
thinGraphics(shots, mode, style)        plan.js   – render-time overlay/SFX density (UI "Графика": as style/none/all)
buildOverlays()/drawDoc()               gfx.js    – doc look: 12 graphic types timed to spoken words (ovWindow)
mixAudio()                              audio.js  – levelVoice() + compressor, 35 SFX (sfx/), 11 music beds (music/), ducking, ~-14 LUFS
renderVideo()                           render.js – canvas + WebCodecs + vendor mp4-muxer
```

## Reference style (Oct 2026)
The owner wants videos that look like a competitor reference (youtube.com/@MaraWardwell, file in the project folder).
`styles.js` STYLES.doc holds what was measured by hand; `reference.js` measures an uploaded video in the browser (cuts and dissolves from
64×36 frame diffs + colour histograms, music level from pause loudness, graphics via Gemini on frames every ~4 s) and builds a profile on top of doc.
The doc look has no subtitles by default, soft synthesised SFX tied to graphics (audio.js softCues/synth), and cuts up to style.cut.max (8 s).
Classic keeps rule 3 (≤ 5 s). Test graphics by rendering frames in headless Chromium (jsDelivr may be blocked in the cloud container: route it to local npm copies).

## Hard rules (owner requirements — keep them)
1. Footage chosen by MEANING, not literal words. Gemini prompt in plan.js; CLIP re-ranks.
2. No repeated frames: same id/url never reused; cosine > 0.93 globally / > 0.88 vs neighbours is rejected; UI blocks manual reuse.
3. ≤ 5 s per cut in the classic look (doc look: style.cut.max, 8 s, as in the reference); long scenes get several different picks.
4. Copyright-safe only (monetised YouTube). Sources: Pexels, Pixabay (user keys), Wikimedia (non-free filtered),
   NASA (copyright/courtesy filtered), Internet Archive ONLY collections prelinger/FedFlix/usgovfilms/nasa
   (uploader licence tags are untrustworthy), Library of Congress ONLY "No known restrictions".
   Rejected on purpose: Coverr (API forbids commercial use), Freepik/Free To Use (paid), Mixkit/Dareful/YT Audio Library (no API),
   National Archives (key by application), Freesound (mixed licences). Every pick must keep author/licence/page for credits.txt.
5. US audience: months/dates are time references, not visuals (no snow for "February" unless the line is about weather).
6. Keys live only in the browser (localStorage `lumencut.settings`). Never commit keys.
7. Owner is non-technical, on Windows. Explain changes to her in Russian, step by step.

## Known limits / ideas to check
- Free Pexels key = 200 requests/hour: photos only for the main query, identical queries cached, 429 pauses Pexels 15 min and logs it. Pixabay gated at 100/min.
- Subtitles highlight words by Whisper timings (shot.wt); without voice they are spread evenly.
- Clips shorter than their cut play slower (≥0.5×) instead of freezing.
- Without Pexels/Pixabay keys only Wikimedia/NASA/IA/LoC are searched → weak matches for modern everyday topics.
- Pitch jumps in TTS voice are not corrected (only loudness levelling).
- Render is ~real time; tab must stay in foreground.
- Audio track is Opus in MP4 (YouTube accepts it).
- WebGPU used only if `navigator.gpu.requestAdapter()` returns an adapter, else WASM.

## How to test locally
`python -m http.server 8000` in the repo root → open http://localhost:8000/lumencut-web/ in Chrome.
There are no unit tests; check JS syntax with `node --check lumencut-web/js/*.js`.
Workflow for changes: new branch → PR into the default branch → owner merges → site updates.
