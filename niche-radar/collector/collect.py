#!/usr/bin/env python3
"""Collect young YouTube channels for the Niche Radar static site."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import math
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from statistics import median
from typing import Any


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
QUERIES_PATH = os.path.join(BASE_DIR, "queries.json")
RPM_PATH = os.path.join(BASE_DIR, "rpm_baseline.json")
CACHE_PATH = os.path.join(BASE_DIR, "nexlev_cache.json")
API_URL = "https://www.googleapis.com/youtube/v3"
SEARCH_LIMIT = 7500
ENRICHMENT_LIMIT = 1500

STYLE_KEYWORDS = {
    "stickman": ("stickman", "stick figure", "stick-figure", "stickly", "палочный"),
    "2d_animation": ("animated", "animation", "cartoon", "анимация", "мультфильм"),
    "ai_illustrations": (
        "illustrated",
        "ai art",
        "midjourney",
        "drawn",
        "ilustrado",
        "dibujado",
        "иллюстрации",
    ),
    "ai_video": ("ai generated", "ai video", "sora", "veo", "kling", "нейросеть"),
    "maps_graphics": ("map", "maps", "geography", "карта", "состояние", "state", "border"),
    "screencast_slides": ("tutorial", "how to", "screen", "excel", "code"),
    "talking_head": ("vlog", "my", "i tried", "я попробовал", "reaction"),
}
STYLE_RU = {
    "stickman": "Стикманы",
    "2d_animation": "2D-анимация",
    "ai_illustrations": "ИИ-иллюстрации",
    "ai_video": "ИИ-видео",
    "stock_footage": "Стоковый футаж",
    "maps_graphics": "Карты и графика",
    "screencast_slides": "Скринкаст/слайды",
    "talking_head": "С лицом",
    "mixed": "Смешанный",
}
DIFFICULTY = {
    "stock_footage": "low",
    "screencast_slides": "low",
    "ai_illustrations": "low",
    "maps_graphics": "medium",
    "stickman": "medium",
    "ai_video": "medium",
    "2d_animation": "high",
    "talking_head": "high",
}
DIFFICULTY_RU = {"low": "Низкая", "medium": "Средняя", "high": "Высокая"}


class QuotaExhausted(RuntimeError):
    """Raised when all configured API keys have exhausted their quota."""


def _log(message: str) -> None:
    print(message, file=sys.stderr)


def _load_json(path: str, default: Any) -> Any:
    try:
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)
    except FileNotFoundError:
        return default


def _load_cache() -> dict[str, Any]:
    if not os.path.exists(CACHE_PATH):
        with open(CACHE_PATH, "w", encoding="utf-8") as handle:
            json.dump({}, handle)
        return {}
    return _load_json(CACHE_PATH, {})


def _utc_now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def _iso_date(value: dt.datetime | None = None) -> str:
    return (value or _utc_now()).date().isoformat()


def _parse_time(value: str | None) -> dt.datetime | None:
    if not value:
        return None
    try:
        parsed = dt.datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed.replace(tzinfo=dt.timezone.utc) if parsed.tzinfo is None else parsed
    except ValueError:
        return None


def _duration_seconds(value: str | None) -> int:
    if not value:
        return 0
    match = re.fullmatch(r"PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?", value)
    if not match:
        return 0
    hours, minutes, seconds = (int(part or 0) for part in match.groups())
    return hours * 3600 + minutes * 60 + seconds


def _clamp(value: float, low: float, high: float) -> float:
    return max(low, min(high, value))


def _number(value: Any, default: int = 0) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def rotate_queries(queries: list[dict[str, Any]], now: dt.datetime) -> list[dict[str, Any]]:
    """Rotate the daily query start so the search budget covers all seeds."""
    if not queries:
        return []
    offset = (now.timetuple().tm_yday * 25) % len(queries)
    return queries[offset:] + queries[:offset]


def _api_item_video(item: dict[str, Any]) -> dict[str, Any]:
    snippet = item.get("snippet", {})
    statistics = item.get("statistics", {})
    details = item.get("contentDetails", {})
    return {
        "id": item.get("id") if isinstance(item.get("id"), str) else item.get("id", {}).get("videoId"),
        "title": snippet.get("title", ""),
        "description": snippet.get("description", ""),
        "tags": snippet.get("tags", []),
        "thumbnail": snippet.get("thumbnails", {}).get("medium", {}).get(
            "url", snippet.get("thumbnails", {}).get("default", {}).get("url", "")
        ),
        "published_at": snippet.get("publishedAt"),
        "views": _number(statistics.get("viewCount")),
        "duration_sec": _duration_seconds(details.get("duration")),
        "default_language": snippet.get("defaultLanguage") or snippet.get("defaultAudioLanguage"),
    }


def _new_state(keys: list[str] | None = None) -> dict[str, Any]:
    configured = keys if keys is not None else os.environ.get("YOUTUBE_API_KEY", "").split(",")
    configured = [key.strip() for key in configured if key.strip()]
    return {
        "keys": configured,
        "key_index": 0,
        "quota_units_used": 0,
        "search_units": 0,
        "enrichment_units": 0,
        "exhausted": False,
    }


def yt_get(
    resource: str,
    params: dict[str, Any],
    state: dict[str, Any],
    *,
    cost: int = 1,
    is_search: bool = False,
) -> dict[str, Any]:
    """GET a YouTube API resource, rotating keys after quota errors."""
    budget = SEARCH_LIMIT if is_search else ENRICHMENT_LIMIT
    used = state["search_units"] if is_search else state["enrichment_units"]
    if used + cost > budget:
        state["exhausted"] = True
        raise QuotaExhausted("quota budget exhausted")
    keys = state.get("keys", [])
    if not keys:
        raise RuntimeError("YOUTUBE_API_KEY is not configured")
    remaining_keys = len(keys)
    while remaining_keys:
        key_index = state["key_index"] % len(keys)
        key = keys[key_index]
        query = dict(params)
        query["key"] = key
        url = f"{API_URL}/{resource}?{urllib.parse.urlencode(query)}"
        try:
            with urllib.request.urlopen(url, timeout=30) as response:
                result = json.load(response)
            state["quota_units_used"] += cost
            if is_search:
                state["search_units"] += cost
            else:
                state["enrichment_units"] += cost
            return result
        except urllib.error.HTTPError as error:
            body = error.read().decode("utf-8", errors="replace")
            try:
                reason = json.loads(body)["error"]["errors"][0].get("reason")
            except (KeyError, IndexError, TypeError, json.JSONDecodeError):
                reason = None
            if error.code == 403 and reason == "quotaExceeded":
                remaining_keys -= 1
                state["key_index"] = (key_index + 1) % len(keys)
                _log("YouTube API key quota exceeded; rotating key")
                continue
            raise
    state["exhausted"] = True
    raise QuotaExhausted("all YouTube API keys have exhausted quota")


def search(
    query: dict[str, Any],
    query_index: int,
    state: dict[str, Any],
    modifiers: list[str],
    *,
    now: dt.datetime | None = None,
) -> list[dict[str, Any]]:
    """Run the prescribed search passes and return raw search result items."""
    now = now or _utc_now()
    if not modifiers:
        modifiers = [""]
    published_after = (now - dt.timedelta(days=45)).isoformat().replace("+00:00", "Z")
    texts = [query["text"], f'{query["text"]} {modifiers[query_index % len(modifiers)]}']
    passes = [(text, "viewCount") for text in texts]
    if query.get("lang") == "en":
        passes.append((query["text"], "date"))
    results = []
    for text, order in passes:
        params = {
            "part": "snippet",
            "type": "video",
            "videoDuration": "medium",
            "order": order,
            "publishedAfter": published_after,
            "maxResults": 25,
            "relevanceLanguage": query.get("lang", "en"),
            "q": text,
        }
        try:
            payload = yt_get("search", params, state, cost=100, is_search=True)
        except QuotaExhausted:
            raise
        results.extend(payload.get("items", []))
    return results


def fetch_channels(channel_ids: list[str], state: dict[str, Any]) -> dict[str, dict[str, Any]]:
    channels: dict[str, dict[str, Any]] = {}
    for start in range(0, len(channel_ids), 50):
        payload = yt_get(
            "channels",
            {"part": "snippet,statistics,contentDetails", "id": ",".join(channel_ids[start : start + 50])},
            state,
        )
        for item in payload.get("items", []):
            channels[item.get("id")] = item
    return channels


def fetch_videos(channel: dict[str, Any], state: dict[str, Any]) -> list[dict[str, Any]]:
    """Fetch at most the channel's first 30 uploads and normalize them."""
    uploads = channel.get("contentDetails", {}).get("relatedPlaylists", {}).get("uploads")
    if not uploads:
        return []
    payload = yt_get(
        "playlistItems",
        {"part": "contentDetails", "playlistId": uploads, "maxResults": 50},
        state,
    )
    ids = [
        item.get("contentDetails", {}).get("videoId")
        for item in payload.get("items", [])[:30]
        if item.get("contentDetails", {}).get("videoId")
    ]
    if not ids:
        return []
    videos: list[dict[str, Any]] = []
    for start in range(0, len(ids), 50):
        details = yt_get(
            "videos",
            {"part": "snippet,statistics,contentDetails", "id": ",".join(ids[start : start + 50])},
            state,
        )
        videos.extend(_api_item_video(item) for item in details.get("items", []))
    return videos


def classify(
    channel: dict[str, Any],
    videos: list[dict[str, Any]],
    query: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """Classify a channel using weighted keyword hits and query fallback."""
    snippet = channel.get("snippet", {})
    text_parts = [
        str(channel.get("title", "")),
        str(channel.get("description", "")),
        str(snippet.get("title", "")),
        str(snippet.get("description", "")),
    ]
    video_parts: list[str] = []
    languages: list[str] = []
    tags: list[str] = []
    for video in videos:
        if "snippet" in video:
            video = _api_item_video(video)
        video_parts.extend(
            [str(video.get("title", "")), str(video.get("description", ""))]
            + [str(tag) for tag in video.get("tags", [])]
        )
        if video.get("default_language"):
            languages.append(video["default_language"].split("-")[0])
        tags.extend(str(tag) for tag in video.get("tags", []))
    scores: Counter[str] = Counter()
    for style, keywords in STYLE_KEYWORDS.items():
        for keyword in keywords:
            pattern = re.compile(r"(?<!\w)" + re.escape(keyword) + r"(?!\w)", re.IGNORECASE)
            scores[style] += 2 * sum(len(pattern.findall(text)) for text in text_parts)
            scores[style] += sum(len(pattern.findall(text)) for text in video_parts)
    style = scores.most_common(1)[0][0] if scores and scores.most_common(1)[0][1] else None
    if not style:
        style = (query or {}).get("style_hint") or "stock_footage"
    difficulty = DIFFICULTY.get(style, "medium")
    return {
        "production_style": style,
        "style_ru": STYLE_RU.get(style, "Смешанный"),
        "style_group": "ai" if style in {"stickman", "2d_animation", "ai_illustrations", "ai_video"} else "live",
        "uses_ai": style in {"stickman", "ai_illustrations", "ai_video"}
        or any(
            re.search(r"\bai\b", text, re.IGNORECASE) or "нейросет" in text.lower()
            for text in text_parts + video_parts
        ),
        "difficulty": difficulty,
        "difficulty_ru": DIFFICULTY_RU[difficulty],
        "solo_friendly": difficulty != "high",
        "language": languages[0] if languages else (query or {}).get("lang", "en"),
        "tags": sorted(set(tags)),
    }


def metrics(
    channel: dict[str, Any],
    videos: list[dict[str, Any]],
    *,
    now: dt.datetime | None = None,
    is_monetized: bool | None = None,
) -> dict[str, Any]:
    """Calculate channel metrics from normalized video records."""
    now = now or _utc_now()
    videos = [_api_item_video(video) if "snippet" in video else video for video in videos]
    long_videos = [video for video in videos if _number(video.get("duration_sec")) >= 90]
    long_videos.sort(key=lambda video: video.get("published_at") or "")
    views = [_number(video.get("views")) for video in long_videos]
    durations = [_number(video.get("duration_sec")) for video in long_videos]
    first_at = _parse_time(long_videos[0].get("published_at")) if long_videos else None
    age_days = max(1, (now - first_at).total_seconds() / 86400) if first_at else 1
    subs = _number(channel.get("statistics", {}).get("subscriberCount", channel.get("subs")))
    total_views = _number(
        channel.get("statistics", {}).get("viewCount", channel.get("total_views"))
    )
    avg_views = sum(views) / len(views) if views else 0
    avg_first = sum(views[:5]) / len(views[:5]) if views else 0
    median_views = median(views) if views else 0
    watch_hours = sum(
        view * (0.35 if duration > 600 else 0.45) * duration / 3600
        for view, duration in zip(views, durations)
    )
    subs_per_day = subs / age_days
    views_per_day = sum(views) / age_days
    watch_hours_per_day = watch_hours / age_days
    days_subs = max(0, 1000 - subs) / max(subs_per_day, 0.5)
    days_hours = max(0, 4000 - watch_hours) / max(watch_hours_per_day, 0.5)
    days_monetization = max(days_subs, days_hours)
    outlier_threshold = 3 * median_views
    outliers = [
        video["id"]
        for video in long_videos
        if _number(video.get("views")) >= outlier_threshold and outlier_threshold > 0
    ][:5]
    if is_monetized:
        forecast = "уже"
    elif days_monetization <= 30:
        forecast = "≤30 дн."
    elif days_monetization <= 90:
        forecast = "≤90 дн."
    else:
        forecast = "неясно"
    return {
        "videos_count_long": len(long_videos),
        "first_video_at": long_videos[0].get("published_at") if long_videos else None,
        "channel_age_days": round(age_days, 1),
        "avg_views": round(avg_views, 2),
        "median_views": round(median_views, 2),
        "avg_views_first_5": round(avg_first, 2),
        "avg_duration_sec": round(sum(durations) / len(durations), 2) if durations else 0,
        "views_per_day": round(views_per_day, 2),
        "subs_per_day": round(subs_per_day, 2),
        "watch_hours_est": round(watch_hours, 2),
        "days_to_monetization": round(0 if is_monetized else days_monetization, 2),
        "monetization_forecast": forecast,
        "outliers": outliers,
        "_long_videos": long_videos,
        "subs": subs,
        "total_views": total_views,
    }


def score(channel: dict[str, Any]) -> int:
    velocity = _clamp(math.log10(max(float(channel.get("avg_views_first_5", 0)), 1)) / 6, 0, 1)
    rpm_norm = _clamp(float(channel.get("rpm", 0)) / 15, 0, 1)
    mon = {"уже": 1, "≤30 дн.": 0.8, "≤90 дн.": 0.5, "неясно": 0.2}.get(
        channel.get("monetization_forecast"), 0.2
    )
    repl = {"low": 1, "medium": 0.6, "high": 0.2}.get(channel.get("difficulty"), 0.2)
    age = float(channel.get("channel_age_days", 0))
    fresh = 1 if age <= 90 else 0.7 if age <= 180 else 0.4
    return round(30 * velocity + 25 * rpm_norm + 20 * mon + 15 * repl + 10 * fresh)


def _region_data(
    niche: str,
    country: str | None,
    language: str,
    rpm_data: dict[str, Any],
    cache_entry: dict[str, Any] | None,
) -> tuple[float, str, str, str]:
    if cache_entry and cache_entry.get("rpm") is not None:
        country_top = cache_entry.get("country_top") or ""
        region = rpm_data["country_to_region"].get(country_top, country_top)
        region = region if region in rpm_data["region_ru"] else "other"
        return float(cache_entry["rpm"]), "nexlev", region, rpm_data["region_ru"].get(region, "Другое")
    region = rpm_data["country_to_region"].get(country or "")
    if not region:
        region = rpm_data["lang_to_region"].get(language.split("-")[0], "other")
    niche_data = rpm_data["niches"].get(niche, rpm_data["niches"]["other"])
    return float(niche_data.get(region, niche_data["other"])), "baseline", region, rpm_data["region_ru"].get(
        region, "Другое"
    )


def _channel_output(
    channel: dict[str, Any],
    videos: list[dict[str, Any]],
    query: dict[str, Any],
    rpm_data: dict[str, Any],
    cache: dict[str, Any],
    now: dt.datetime,
) -> dict[str, Any] | None:
    statistics = channel.get("statistics", {})
    video_count = _number(statistics.get("videoCount"))
    if (
        video_count < 3
        or video_count > 30
        or _number(statistics.get("subscriberCount")) < 200
        or statistics.get("hiddenSubscriberCount")
    ):
        return None
    long_videos = [video for video in videos if _number(video.get("duration_sec")) >= 90]
    first = min((_parse_time(video.get("published_at")) for video in long_videos), default=None)
    if not first or (now - first).days > 365 or len(long_videos) < 3:
        return None
    found_query = query
    classification = classify(channel, videos, query)
    cache_entry = cache.get(channel.get("id"), {})
    monetized = cache_entry.get("is_monetized") if "is_monetized" in cache_entry else None
    calculated = metrics(channel, videos, now=now, is_monetized=monetized)
    niche = query.get("niche", "other")
    rpm, rpm_source, region, region_ru = _region_data(
        niche, channel.get("snippet", {}).get("country"), classification["language"], rpm_data, cache_entry
    )
    result = {
        "id": channel.get("id"),
        "handle": channel.get("snippet", {}).get("customUrl", ""),
        "title": channel.get("snippet", {}).get("title", ""),
        "description": channel.get("snippet", {}).get("description", ""),
        "thumbnail": channel.get("snippet", {}).get("thumbnails", {}).get("medium", {}).get("url", ""),
        "country": channel.get("snippet", {}).get("country"),
        "language": classification["language"],
        "niche": niche,
        "niche_ru": rpm_data["niches"].get(niche, rpm_data["niches"]["other"])["ru_name"],
        "tags": classification["tags"],
        **{key: classification[key] for key in (
            "production_style", "style_ru", "style_group", "uses_ai", "difficulty",
            "difficulty_ru", "solo_friendly",
        )},
        "subs": calculated["subs"],
        "total_views": calculated["total_views"],
        "videos_count": video_count,
        **{key: calculated[key] for key in (
            "videos_count_long", "first_video_at", "channel_age_days", "avg_views",
            "median_views", "avg_views_first_5", "avg_duration_sec", "views_per_day",
            "subs_per_day", "watch_hours_est", "days_to_monetization",
            "monetization_forecast",
        )},
        "is_monetized": monetized,
        "rpm": rpm,
        "rpm_source": rpm_source,
        "region": region,
        "region_ru": region_ru,
        "found_by_queries": [found_query.get("text")],
        "updated_at": _iso_date(now),
        "videos": [
            {
                "id": video.get("id"),
                "title": video.get("title", ""),
                "thumbnail": video.get("thumbnail", ""),
                "views": _number(video.get("views")),
                "published_at": video.get("published_at"),
                "duration_sec": _number(video.get("duration_sec")),
                "is_outlier": video.get("id") in calculated["outliers"],
            }
            for video in sorted(long_videos, key=lambda item: item.get("published_at") or "", reverse=True)
        ],
    }
    result["score"] = score(result)
    return result


def merge(
    previous: dict[str, Any] | list[dict[str, Any]],
    current: list[dict[str, Any]] | dict[str, Any],
    *,
    now: dt.datetime | None = None,
) -> list[dict[str, Any]]:
    """Merge current channels with recent prior channels."""
    now = now or _utc_now()
    previous_channels = previous.get("channels", []) if isinstance(previous, dict) else previous
    current_channels = current.get("channels", []) if isinstance(current, dict) else current
    current_by_id = {channel["id"]: channel for channel in current_channels if channel.get("id")}
    merged: list[dict[str, Any]] = []
    for channel in current_channels:
        old = next((item for item in previous_channels if item.get("id") == channel.get("id")), None)
        if _number(channel.get("videos_count")) > 30:
            added = _parse_time(old.get("added_at")) if old else None
            if not old or not added or (now - added).days >= 90:
                continue
        result = dict(channel)
        result["added_at"] = old.get("added_at") if old and old.get("added_at") else _iso_date(now)
        result["stale"] = False
        if _number(channel.get("videos_count")) > 30:
            result["graduated"] = True
        elif old and old.get("graduated"):
            result["graduated"] = True
        merged.append(result)
    for old in previous_channels:
        if old.get("id") in current_by_id:
            continue
        added = _parse_time(old.get("added_at"))
        if not added:
            added = now
        updated = _parse_time(old.get("updated_at")) or added
        age = (now - updated).days
        if age <= 60:
            result = dict(old)
            result["stale"] = True
            merged.append(result)
    return merged


def _write_output(path: str, payload: dict[str, Any]) -> None:
    parent = os.path.dirname(os.path.abspath(path))
    os.makedirs(parent, exist_ok=True)
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
        handle.write("\n")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", default=os.path.join(BASE_DIR, "..", "data", "channels.json"))
    parser.add_argument("--max-queries", type=int)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args(argv)
    queries_data = _load_json(QUERIES_PATH, {"queries": [], "modifiers": []})
    previous = _load_json(args.out, {"generated_at": None, "channels": []})
    now = _utc_now()
    _load_cache()
    if args.dry_run:
        output = {
            "generated_at": None,
            "quota_units_used": 0,
            "queries_run": 0,
            "channels": merge(previous, [], now=now),
        }
        _write_output(args.out, output)
        _log(f"Dry run: wrote {args.out}")
        return 0
    state = _new_state()
    cache = _load_json(CACHE_PATH, {})
    rpm_data = _load_json(RPM_PATH, {})
    queries = rotate_queries(queries_data.get("queries", []), now)
    if args.max_queries is not None:
        queries = queries[: max(0, args.max_queries)]
    candidates: dict[str, tuple[dict[str, Any], dict[str, Any]]] = {}
    queries_run = 0
    for index, query in enumerate(queries):
        try:
            items = search(query, index, state, queries_data.get("modifiers", []))
        except QuotaExhausted:
            _log("Search quota exhausted; stopping search")
            break
        queries_run += 1
        for item in items:
            channel_id = item.get("snippet", {}).get("channelId")
            if channel_id and channel_id not in candidates:
                candidates[channel_id] = (query, item)
        _log(f"Search {queries_run}/{len(queries)}: {query['text']} ({len(candidates)} channels)")
    channels: dict[str, dict[str, Any]] = {}
    if candidates:
        try:
            channels = fetch_channels(list(candidates), state)
        except QuotaExhausted:
            _log("Enrichment quota exhausted while fetching channel metadata")
    current: list[dict[str, Any]] = []
    for channel_id, channel in channels.items():
        statistics = channel.get("statistics", {})
        if (
            _number(statistics.get("videoCount")) < 3
            or _number(statistics.get("videoCount")) > 30
            or _number(statistics.get("subscriberCount")) < 200
            or statistics.get("hiddenSubscriberCount")
        ):
            _log(f"Skipping ineligible channel {channel_id}")
            continue
        try:
            videos = fetch_videos(channel, state)
            query = candidates[channel_id][0]
            result = _channel_output(channel, videos, query, rpm_data, cache, now)
            if result:
                current.append(result)
        except QuotaExhausted:
            _log(f"Enrichment quota exhausted at channel {channel_id}; stopping channel fetch")
            break
        except Exception as error:  # a malformed channel must not stop the run
            _log(f"Skipping channel {channel_id}: {error}")
    output = {
        "generated_at": now.isoformat().replace("+00:00", "Z"),
        "quota_units_used": state["quota_units_used"],
        "queries_run": queries_run,
        "channels": merge(previous, current, now=now),
    }
    _write_output(args.out, output)
    _log(f"Wrote {len(output['channels'])} channels; quota units used: {state['quota_units_used']}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
