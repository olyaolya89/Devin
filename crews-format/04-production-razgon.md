# Производство: как собрать такое видео (ElevenLabs + Claude Code + плагин Razgon Animation Studio)

## 0. Что нужно один раз
- Claude Code на Windows с установленным плагином **razgon-animation-studio** (при первом запуске он сам ставит ffmpeg, Node, Chromium и faster-whisper, около 1 ГБ).
- Свой стиль-пак **`crews-archive`** (шаг 2). Он делается один раз и потом используется во всех видео канала.

## 1. Сценарий и голос
1. Тема из `03-topics-20.md` → проверка фактов → сценарий по шаблону из `05-script-template.md` и чек-листу из `02-hooks-style-retention.md`.
2. Озвучка в ElevenLabs: спокойный мужской документальный голос, US English → `voice.mp3`.

## 2. Стиль-пак `crews-archive` (один раз)
В Claude Code сказать: `/video-styles`, «создай стиль-пак канала crews-archive по референсам», и приложить 4–6 скриншотов: карточку-документ, разрез с красной рамкой, кадр хроники, карту, титр «NUMBER …». Требования к паку (передать Claude текстом):
- **Фон**: бежевая бумага `#d9d0bf` с лёгкой фактурой; для титров глав тёмный `#1e1c1a`.
- **Грейд**: сепия, зерно 0.25–0.35, виньетка, лёгкое мерцание плёнки, без летербокса.
- **Шрифты**: машинопись (Courier Prime / Special Elite) для документов; узкий гротеск в верхнем регистре (Oswald / Bebas Neue) для плашек и титров.
- **Акцент**: только один цвет, красный `#b3261e` (рамки, номер главы, ключевое слово, полоски-подписи).
- **Типы кадров** (shot mix): разрез с рамкой 30% · архивная хроника 35% · карточка-документ 15% · карта 8% · крупный текст или титр 7% · фото в рамке 5%.
- **Движение**: медленный наезд 3–5% за кадр, рамка рисуется за 0.4 с, текст печатается побуквенно, переходы только склейкой или коротким затемнением.
- **Звук**: музыка в настроениях `mystery`, `tension`, `sad`, `dark`, тихо (-20 dB под голосом). SFX: печатная машинка на карточках, щелчок на рамке, далёкий гул моторов как ambience `hum`.

## 3. Материалы для одного видео (`projects/<slug>/input/`)
- `cutaway.png`: разрез машины, 16:9, 1 шт (промпт ниже). Можно сделать 2–3 крупных плана того же разреза.
- `clips/`: 25–40 архивных клипов по 3–6 секунд. Источники: NARA (catalog.archives.gov), archive.org (коллекции US government films), DVIDS. Брать только государственные материалы США или помеченные Public Domain. В `credits.txt` записать, откуда каждый клип.
- `photos/`: фото людей и техники, только общественное достояние (US Army/USAAF/US Navy official photo, британские Crown Copyright до 1957 года).

## 4. Сборка в плагине
1. «Make an animated video from this voiceover», приложить `voice.mp3` и текст сценария. Выбрать 16:9, 1080p, пак `crews-archive`, «есть готовые картинки и клипы».
2. Claude делает таймкоды Whisper → план кадров. **Проверить план**: у каждой фразы свой кадр по таблице «Визуал под текст» из `02-hooks-style-retention.md`.
3. `/render-video` → контактные листы → превью 30 секунд → исправления.
4. Финальный рендер у себя: плагин даёт zip, распаковать и дважды щёлкнуть `RENDER-Windows.bat`.
5. Субтитры в CapCut, если нужны.

## 5. Промпты (английский)
**Разрез (Google Flow / Higgsfield), один на видео:**
```
Technical cutaway illustration of a WWII [MACHINE] in exact side profile, outer skin removed to show the full interior,
[N] crewmen in [YEAR] uniforms at their stations ([list stations nose to tail]), ammunition, fuel tanks, [bomb bay / ammo racks],
accurate [olive drab / desert / RAF dark green] paint, clean museum-poster illustration style, muted warm colours,
plain light beige background, whole [aircraft/tank] visible with margins, 16:9, no text, no labels, no watermark
```
**Превью:**
```
Photorealistic cinematic cutaway of a WWII [MACHINE] [in flight above bright white clouds / on a Normandy field],
the skin cut away to reveal [the key crewman: age, gear, action] inside, [threat: flak bursts / fighters / fire / sea spray],
dramatic sunlight, ultra detailed, 16:9, no text
```
На превью потом добавить 1–2 слова крупно (например «LAST OUT», «FACING BACKWARDS», «NO PARACHUTE»), желтовато-белые с чёрной обводкой.

## 6. Чего плагин не делает
Озвучку (её делаем в ElevenLabs), превью (Flow или Higgsfield + текст) и поиск архивной хроники (вручную или через LumenCut).
