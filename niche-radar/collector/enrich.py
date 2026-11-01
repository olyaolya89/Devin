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
import sys
import time
import urllib.error
import urllib.request
from typing import Any

MODEL = os.environ.get("GEMINI_MODEL", "gemini-2.5-flash")
API = "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
EXTRA = ("own_product", "affiliate", "sponsors", "membership", "merch", "none")
DIFFICULTY_RU = {"low": "Низкая", "medium": "Средняя", "high": "Высокая"}
SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "notes_ru": {"type": "STRING"},
        "production_ru": {"type": "STRING"},
        "subniche_ru": {"type": "STRING"},
        "uses_ai": {"type": "STRING", "enum": ["with", "without", "mix"]},
        "difficulty": {"type": "STRING", "enum": ["low", "medium", "high"]},
        "extra_monetization": {"type": "ARRAY", "items": {"type": "STRING", "enum": list(EXTRA)}},
    },
    "required": ["notes_ru", "production_ru", "subniche_ru", "uses_ai", "difficulty", "extra_monetization"],
}
PROMPT = """Ты куратор каталога YouTube-ниш для русскоязычных авторов фейслес-каналов.
Опиши нишу канала по-русски, конкретно, без воды и общих фраз.

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


def call_gemini(body: dict[str, Any], key: str) -> dict[str, Any]:
    request = urllib.request.Request(
        API.format(model=MODEL),
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", "x-goog-api-key": key},
    )
    with urllib.request.urlopen(request, timeout=180) as response:
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
    channel["notes_source"] = "gemini+video" if watched else "gemini"
    channel["enriched_at"] = now.date().isoformat()


def enrich(channel: dict[str, Any], key: str, now: dt.datetime, call=call_gemini) -> bool:
    for watch in (True, False):
        video = top_video(channel) if watch else None
        if watch and not video:
            continue
        try:
            result = call(request_body(channel, watch=watch), key)
        except (urllib.error.URLError, ValueError, KeyError, IndexError) as error:
            print(f"[enrich] {channel.get('id')} watch={watch}: {error}", file=sys.stderr)
            continue
        apply(channel, result, watched=video, now=now)
        return True
    return False


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data", default=os.path.join(os.path.dirname(__file__), "..", "data", "channels.json"))
    parser.add_argument("--limit", type=int, default=40)
    parser.add_argument("--pause", type=float, default=7.0)
    args = parser.parse_args(argv)
    key = os.environ.get("GEMINI_API_KEY", "").strip()
    if not key:
        print("[enrich] GEMINI_API_KEY is not set - skipping", file=sys.stderr)
        return 0
    with open(args.data, encoding="utf-8") as handle:
        data = json.load(handle)
    todo = [c for c in data.get("channels", []) if not c.get("enriched_at") and not c.get("stale")]
    todo.sort(key=lambda c: c.get("score") or 0, reverse=True)
    now = dt.datetime.now(dt.timezone.utc)
    done = 0
    for channel in todo[: args.limit]:
        if enrich(channel, key, now):
            done += 1
            print(f"[enrich] {channel.get('title')}: {channel.get('subniche_ru')}", file=sys.stderr)
        time.sleep(args.pause)
    with open(args.data, "w", encoding="utf-8") as handle:
        json.dump(data, handle, ensure_ascii=False, indent=2)
        handle.write("\n")
    print(f"[enrich] enriched {done}/{min(len(todo), args.limit)} channels", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
