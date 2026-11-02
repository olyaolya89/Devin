"""Add Russian niche notes to Niche Radar channels with Gemini.

For each channel without notes, Gemini watches the first 2 minutes of the top
video (when the API accepts the YouTube URL) and reads the channel metadata,
then returns a Russian niche description like a human curator would write.
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from typing import Any

MODEL = os.environ.get("GEMINI_MODEL", "gemini-3.8-flash")
BASE = os.environ.get("GEMINI_API_BASE", "https://generativelanguage.googleapis.com/v1beta")
API = BASE + "/models/{model}:generateContent"
TIMEOUT = float(os.environ.get("GEMINI_TIMEOUT", "180"))
RETRY_WAITS = tuple(float(x) for x in os.environ.get("GEMINI_RETRY_WAITS", "15,45").split(","))
RETRY_CODES = (429, 500, 503, 504)
FALLBACKS: list[str] = []
RETIRED: set[str] = set()
SKIP_MODELS = ("lite", "image", "tts", "live", "audio", "embedding", "robotics", "computer")
EXTRA = ("own_product", "affiliate", "sponsors", "membership", "merch", "none")
STYLES = (
    "stock_footage", "maps_graphics", "ai_images", "2d_animation", "3d_animation", "ai_video", "highlights",
    "illustrations", "photos_stock", "ai_illustrations", "talking_head", "screencast_slides", "stickman", "code_generated",
)
DIFFICULTY_RU = {"low": "Низкая", "medium": "Средняя", "high": "Высокая"}
SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "fits": {"type": "BOOLEAN"},
        "reject_reason": {"type": "STRING"},
        "niche_ru": {"type": "STRING"},
        "notes_ru": {"type": "STRING"},
        "production_ru": {"type": "STRING"},
        "subniche_ru": {"type": "STRING"},
        "uses_ai": {"type": "STRING", "enum": ["with", "without", "mix"]},
        "difficulty": {"type": "STRING", "enum": ["low", "medium", "high"]},
        "extra_monetization": {"type": "ARRAY", "items": {"type": "STRING", "enum": list(EXTRA)}},
        "has_ai_avatar": {"type": "BOOLEAN"},
        "production_styles": {"type": "ARRAY", "items": {"type": "STRING", "enum": list(STYLES)}},
        "categories": {"type": "ARRAY", "items": {"type": "STRING"}},
    },
    "required": ["fits", "niche_ru", "notes_ru", "production_ru", "subniche_ru", "uses_ai", "difficulty", "extra_monetization"],
}
PROMPT = """Ты куратор каталога YouTube-ниш для русскоязычных авторов фейслес-каналов.
Опиши нишу канала по-русски, конкретно, без воды и общих фраз.

Сначала проверь канал. fits: true, только если это канал с оригинальным контентом в понятной нише,
формат которого можно повторить (фейслес или с ведущим). fits: false — музыка, перезаливы и нарезки чужих
передач, детский контент, стримы и игры без ниши, личные влоги, новости-агрегаторы, спам, канал не на заявленную тему.
reject_reason — одно короткое предложение, почему не подходит (пусто, если подходит).
niche_ru — ниша 1–3 слова: «История», «Военное дело», «Финансы», «Ювелирка», «Животные», «Психология» и т. п.
Подниша и ниша должны соответствовать тому, что реально в роликах, а не случайным словам из названий.

notes_ru — 2–4 предложения: о чём ролики (с конкретными примерами тем из названий),
1–2 шаблона заголовков в виде «[Событие]: [интригующий вопрос]», язык, длина роликов в минутах,
есть ли лицо в кадре, частота выхода, дополнительная монетизация из описания (книги, курсы,
партнёрки, спонсоры) — если есть.
production_ru — 1–2 предложения: метод производства с примерными долями
(например: «анимированные карты (~50%), архивная хроника (~40%), фото (~10%), закадровый голос, без ИИ»)
и сложность. Если видео приложено — опирайся на то, что видишь в кадре.
subniche_ru — узкая подниша 2–6 слов, например «Военная история и снаряжение»,
«Пенсия и переезд в Техас», «Дешёвая земля и фермы».
uses_ai: with — ИИ-картинки/видео/голос заметны, mix — частично, without — нет.
difficulty: насколько трудно повторить формат одному автору.
extra_monetization: только то, что явно видно в описании; иначе ["none"].
has_ai_avatar: true, если в кадре ИИ-аватар/цифровой ведущий.
production_styles: 1–3 основных стиля видеоряда, от главного к второстепенному. code_generated — видео собрано программно
(код/Remotion/Manim/скрипты генерируют графику, текст, диаграммы и анимацию по данным).
categories: 2–4 коротких английских категории, например ["history", "Documentary", "Military"].

Данные канала:
{data}"""


def _fmt_minutes(seconds: int) -> str:
    return f"{round(seconds / 60)} мин" if seconds else "?"


def channel_data(channel: dict[str, Any]) -> str:
    videos = sorted(channel.get("videos") or [], key=lambda v: v.get("views") or 0, reverse=True)[:15]
    lines = [
        f"Название: {channel.get('title', '')}",
        f"Язык: {channel.get('language', '')}; страна: {channel.get('country') or '—'}",
        f"Подписчики: {channel.get('subs', 0)}; просмотры: {channel.get('total_views', 0)}; видео: {channel.get('videos_count', 0)}",
        f"Описание: {(channel.get('description') or '')[:1500]}",
        "Ролики (просмотры, длина, дата, название):",
    ]
    lines += [
        f"- {v.get('views', 0)} | {_fmt_minutes(v.get('duration_sec') or 0)} | {(v.get('published_at') or '')[:10]} | {v.get('title', '')}"
        for v in videos
    ]
    return "\n".join(lines)


def top_video(channel: dict[str, Any]) -> dict[str, Any] | None:
    videos = [v for v in channel.get("videos") or [] if v.get("id")]
    return max(videos, key=lambda v: v.get("views") or 0) if videos else None


def request_body(channel: dict[str, Any], *, watch: bool) -> dict[str, Any]:
    parts: list[dict[str, Any]] = []
    video = top_video(channel) if watch else None
    if video:
        parts.append({
            "fileData": {"fileUri": f"https://www.youtube.com/watch?v={video['id']}"},
            "videoMetadata": {"startOffset": "0s", "endOffset": "120s"},
        })
    parts.append({"text": PROMPT.format(data=channel_data(channel))})
    config: dict[str, Any] = {"responseMimeType": "application/json", "responseSchema": SCHEMA, "temperature": 0.4}
    if video:
        config["mediaResolution"] = "MEDIA_RESOLUTION_LOW"
    return {"contents": [{"parts": parts}], "generationConfig": config}


def pick_model(names: list[str], preferred: str = MODEL) -> str | None:
    """Pick the preferred model if available, else the newest stable Gemini flash model."""
    short = [n.split("/")[-1] for n in names]
    if preferred in short:
        return preferred
    flash = [n for n in short if "gemini" in n and "flash" in n and not any(s in n for s in SKIP_MODELS)]
    if not flash:
        return None
    version = lambda n: float((re.search(r"gemini-(\d+(?:\.\d+)?)", n) or [0, 0])[1])
    stable = [n for n in flash if "preview" not in n and "exp" not in n] or flash
    return sorted(stable, key=lambda n: (version(n), "latest" not in n, -len(n)), reverse=True)[0]


def flash_candidates(names: list[str]) -> list[str]:
    """All usable flash models, newest first, for fallback when one is overloaded."""
    left, out = list(names), []
    while True:
        best = pick_model(left, "")
        if not best:
            return out
        out.append(best)
        left = [n for n in left if n.split("/")[-1] != best]


def switch_model(error_body: str) -> bool:
    """Follow the API's 'no longer available ... use models/X' hint once per model."""
    global MODEL
    hint = re.search(r"use models/([\w.-]+)", error_body)
    if "no longer available" not in error_body or not hint or hint.group(1) == MODEL:
        return False
    print(f"[enrich] model {MODEL} retired, switching to {hint.group(1)}", file=sys.stderr)
    RETIRED.add(MODEL)
    MODEL = hint.group(1)
    return True


def list_models(key: str) -> list[str]:
    request = urllib.request.Request(BASE + "/models?pageSize=1000", headers={"x-goog-api-key": key})
    with urllib.request.urlopen(request, timeout=60) as response:
        payload = json.load(response)
    return [
        m.get("name", "") for m in payload.get("models", [])
        if "generateContent" in (m.get("supportedGenerationMethods") or [])
    ]


def call_gemini(body: dict[str, Any], key: str) -> dict[str, Any]:
    request = urllib.request.Request(
        API.format(model=MODEL),
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "x-goog-api-key": key},
    )
    with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
        payload = json.load(response)
    text = "".join(
        part.get("text", "")
        for part in payload.get("candidates", [{}])[0].get("content", {}).get("parts", [])
    )
    return json.loads(text)


def apply(channel: dict[str, Any], result: dict[str, Any], *, watched: dict[str, Any] | None, now: dt.datetime) -> None:
    extra = [x for x in result.get("extra_monetization") or [] if x in EXTRA and x != "none"]
    stamp = f"{now:%d.%m}"
    source = (
        f"Классифицировано {stamp} (Gemini): просмотр 2 мин ролика «{watched.get('title', '')}»."
        if watched else f"Классифицировано {stamp} (Gemini) по названиям и описанию канала."
    )
    channel["notes_ru"] = "\n\n".join(
        x.strip() for x in (result.get("notes_ru"), result.get("production_ru"), source) if x and x.strip()
    )
    channel["production_methods_ru"] = (result.get("production_ru") or "").strip()
    channel["subniche_ru"] = (result.get("subniche_ru") or "").strip() or channel.get("subniche_ru")
    mode = result.get("uses_ai")
    if mode in ("with", "without", "mix"):
        channel["uses_ai_mode"] = mode
        channel["uses_ai"] = mode != "without"
    if result.get("difficulty") in DIFFICULTY_RU:
        channel["difficulty"] = result["difficulty"]
        channel["difficulty_ru"] = DIFFICULTY_RU[result["difficulty"]]
    channel["extra_monetization"] = extra
    styles = [x for x in result.get("production_styles") or [] if x in STYLES]
    if styles:
        channel["production_styles"] = styles
        channel["production_style"] = styles[0]
    categories = [str(x).strip() for x in result.get("categories") or [] if str(x).strip()][:4]
    if categories:
        channel["categories"] = categories
    if isinstance(result.get("has_ai_avatar"), bool):
        channel["has_ai_avatar"] = result["has_ai_avatar"]
    channel["notes_source"] = "gemini+video" if watched else "gemini"
    channel["verified"] = bool(result.get("fits"))
    channel["reject_reason"] = "" if channel["verified"] else (result.get("reject_reason") or "").strip()
    if (result.get("niche_ru") or "").strip():
        channel["niche_ai_ru"] = result["niche_ru"].strip()
    channel["enriched_at"] = now.date().isoformat()


class GeminiError(Exception):
    def __init__(self, code: int, body: str):
        super().__init__(f"HTTP {code}: {body[:300]}")
        self.code, self.body = code, body


def attempt(call, body: dict[str, Any], key: str) -> dict[str, Any]:
    """Call Gemini, retrying overload (429/5xx) and timeouts with backoff."""
    for wait in RETRY_WAITS + (None,):
        try:
            return call(body, key)
        except urllib.error.HTTPError as error:
            text = error.read().decode("utf-8", "replace")
            if error.code in RETRY_CODES and wait is not None:
                time.sleep(wait)
                continue
            raise GeminiError(error.code, text) from None
        except OSError as error:
            if wait is not None:
                time.sleep(wait)
                continue
            raise GeminiError(0, str(error)) from None
    raise GeminiError(0, "no attempts")


def next_model() -> bool:
    global MODEL
    while FALLBACKS:
        candidate = FALLBACKS.pop(0)
        if candidate != MODEL and candidate not in RETIRED:
            print(f"[enrich] model {MODEL} unavailable, switching to {candidate}", file=sys.stderr)
            MODEL = candidate
            return True
    return False


def enrich(channel: dict[str, Any], key: str, now: dt.datetime, call=call_gemini) -> bool:
    for watch in (True, False):
        video = top_video(channel) if watch else None
        if watch and not video:
            continue
        try:
            result = attempt(call, request_body(channel, watch=watch), key)
        except GeminiError as error:
            if switch_model(error.body) or (error.code in RETRY_CODES and next_model()):
                return enrich(channel, key, now, call)
            print(f"[enrich] {channel.get('id')} watch={watch}: {error}", file=sys.stderr)
            continue
        except (ValueError, KeyError, IndexError, TypeError) as error:
            print(f"[enrich] {channel.get('id')} watch={watch}: bad response {error}", file=sys.stderr)
            continue
        apply(channel, result, watched=video, now=now)
        return True
    return False


def save(path: str, data: dict[str, Any]) -> None:
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    os.replace(tmp, path)


MAX_COMPETITORS = 20
MAX_VIDEOS = 60


def competitor_counts(channels: list[dict[str, Any]]) -> dict[str, int]:
    """Competitors = other channels with the same niche and primary language (matches the site)."""
    groups: dict[tuple[str, str], int] = {}
    key = lambda c: (c.get("niche") or "", (c.get("language") or "en").split("-")[0])
    for channel in channels:
        groups[key(channel)] = groups.get(key(channel), 0) + 1
    return {c.get("id"): groups[key(c)] - 1 for c in channels}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", default=os.path.join(os.path.dirname(__file__), "..", "data", "channels.json"))
    parser.add_argument("--limit", type=int, default=100)
    parser.add_argument("--pause", type=float, default=7.0)
    args = parser.parse_args(argv)
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not key:
        print("[enrich] GEMINI_API_KEY is not set - skipping", file=sys.stderr)
        return 0
    with open(args.data, encoding="utf-8") as handle:
        data = json.load(handle)
    global MODEL
    try:
        names = list_models(key)
        MODEL = pick_model(names) or MODEL
        FALLBACKS[:] = [n for n in flash_candidates(names) if n != MODEL]
    except (urllib.error.URLError, ValueError) as error:
        print(f"[enrich] could not list models: {error}", file=sys.stderr)
    print(f"[enrich] model: {MODEL}", file=sys.stderr)
    todo = [
        c for c in data.get("channels", [])
        if "verified" not in c and not c.get("graduated") and (c.get("videos_count") or 0) <= MAX_VIDEOS
    ]
    counts = competitor_counts(data.get("channels", []))
    crowded = [c for c in todo if counts.get(c.get("id"), 0) > MAX_COMPETITORS]
    todo = [c for c in todo if counts.get(c.get("id"), 0) <= MAX_COMPETITORS]
    print(f"[enrich] skipping {len(crowded)} channels with more than {MAX_COMPETITORS} competitors", file=sys.stderr)
    todo.sort(key=lambda c: (counts.get(c.get("id"), 0), -(c.get("score") or 0)))
    now = dt.datetime.now(dt.timezone.utc)
    done = failed = 0
    batch = todo[: args.limit]
    try:
        for channel in batch:
            if enrich(channel, key, now):
                done += 1
                failed = 0
                print(f"[enrich] {channel.get('title')}: {channel.get('subniche_ru')}", file=sys.stderr)
                save(args.data, data)
            else:
                failed += 1
                if failed >= 8:
                    print("[enrich] 8 channels in a row failed - Gemini unavailable, stopping", file=sys.stderr)
                    break
            time.sleep(args.pause)
    finally:
        save(args.data, data)
    print(f"[enrich] enriched {done}/{len(batch)} channels with {MODEL}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
