#!/usr/bin/env python3
"""Seed Niche Radar data from a NexLev export."""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
from typing import Any

import collect


BASE_DIR = os.path.dirname(os.path.abspath(__file__))
RAW_PATH = "/home/ubuntu/nexlev_raw.json"
RPM_PATH = os.path.join(BASE_DIR, "rpm_baseline.json")

CATEGORY_TO_NICHE = {
    "pets": "animals",
    "animals": "animals",
    "engineering": "engineering",
    "earth sciences": "geography",
    "geography": "geography",
    "history": "history",
    "finance": "finance",
    "personal finance": "finance",
    "religion": "religion",
    "spirituality": "religion",
    "psychology": "psychology",
    "science": "science",
    "true crime": "true_crime",
    "automotive": "auto",
    "travel": "relocation",
    "travel documentary": "relocation",
    "real estate": "relocation",
    "rural living": "relocation",
    "urban living": "relocation",
    "christianity": "religion",
    "christian end of time": "religion",
    "myths and folktales": "history",
    "royalty": "history",
    "military": "history",
    "politics": "history",
    "nostalgia": "nostalgia",
    "television": "nostalgia",
    "collecting": "collectibles",
    "antiques": "collectibles",
    "luxury": "collectibles",
    "wildlife": "animals",
    "architecture": "engineering",
    "do it yourself": "engineering",
    "tech": "engineering",
    "future & discoveries": "science",
    "business": "finance",
    "online business": "finance",
    "retail business": "finance",
    "automotive business": "auto",
    "self improvement": "psychology",
    "horror stories": "pov_stories",
    "investigative documentaries": "true_crime",
}


def parse_length_text(value: str | None) -> int:
    """Parse a NexLev mm:ss or hh:mm:ss duration."""
    if not value:
        return 0
    try:
        parts = [int(part) for part in value.split(":")]
    except ValueError:
        return 0
    if len(parts) == 2:
        minutes, seconds = parts
        return minutes * 60 + seconds
    if len(parts) == 3:
        hours, minutes, seconds = parts
        return hours * 3600 + minutes * 60 + seconds
    return 0


def _read_json(path: str, default: Any) -> Any:
    try:
        with open(path, encoding="utf-8") as handle:
            return json.load(handle)
    except FileNotFoundError:
        return default


def _category_name(record: dict[str, Any]) -> str:
    category = record.get("category", {})
    if isinstance(category, dict):
        return str(category.get("name", "other"))
    return str(category or "other")


def _niche(category: str) -> str:
    return CATEGORY_TO_NICHE.get(category.strip().lower(), "other")


def _region(country: str | None, rpm_data: dict[str, Any]) -> str:
    return rpm_data["country_to_region"].get(country or "", "other")


def _channel_from_record(channel_id: str, record: dict[str, Any]) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    stats = record.get("stats", {})
    videos = [
        {
            "id": video.get("video_id"),
            "title": video.get("video_title", ""),
            "thumbnail": video.get("video_thumbnail_url", ""),
            "views": collect._number(video.get("video_view_count")),
            "published_at": video.get("video_upload_date"),
            "duration_sec": parse_length_text(video.get("length_text")),
            "tags": [],
        }
        for video in record.get("lastUploadedVideos", [])
    ]
    channel = {
        "id": channel_id,
        "snippet": {
            "title": record.get("title", ""),
            "customUrl": record.get("username", ""),
            "description": "",
            "thumbnails": {"medium": {"url": record.get("thumbnailUrl", "")}},
            "country": record.get("location"),
        },
        "statistics": {
            "subscriberCount": stats.get("subscribers", 0),
            "viewCount": stats.get("totalViews", 0),
            "videoCount": stats.get("totalVideos", 0),
        },
    }
    return channel, videos


def channel_from_record(
    channel_id: str,
    record: dict[str, Any],
    rpm_data: dict[str, Any],
    now: dt.datetime,
) -> dict[str, Any] | None:
    stats = record.get("stats", {})
    total_videos = collect._number(stats.get("totalVideos"))
    first_date = collect._parse_time(stats.get("firstVideoDate"))
    if total_videos < 3 or total_videos > 30 or not first_date:
        return None
    if (now - first_date).days > 365:
        return None
    fake_channel, videos = _channel_from_record(channel_id, record)
    category = _category_name(record)
    niche = _niche(category)
    classification = collect.classify(fake_channel, videos, {"lang": "en"})
    if record.get("isAiChannel"):
        classification["uses_ai"] = True
    calculated = collect.metrics(
        fake_channel,
        videos,
        now=now,
        is_monetized=bool(record.get("isMonetizationEnabled")),
    )
    if len(videos) < 3:
        calculated["avg_views_first_5"] = float(stats.get("avgViewsPerVideo") or 0)
    first_video_at = calculated["first_video_at"] or stats.get("firstVideoDate")
    age_days = calculated["channel_age_days"]
    if first_video_at and not calculated["_long_videos"]:
        age_days = max(1, (now - collect._parse_time(first_video_at)).total_seconds() / 86400)
    region = _region(record.get("location"), rpm_data)
    monthly_views_est = int(float(stats.get("monthlyViews") or calculated["monthly_views_est"]))
    rpm = float(stats.get("rpm", {}).get("total") or 0)
    monthly_revenue_raw = stats.get("monthlyRevenue")
    try:
        monthly_revenue = None if monthly_revenue_raw is None else float(monthly_revenue_raw)
    except (TypeError, ValueError):
        monthly_revenue = None
    result = {
        "id": channel_id,
        "handle": record.get("username", ""),
        "title": record.get("title", ""),
        "description": "",
        "thumbnail": record.get("thumbnailUrl", ""),
        "country": record.get("location"),
        "language": "en",
        "niche": niche,
        "niche_ru": rpm_data["niches"].get(niche, rpm_data["niches"]["other"])["ru_name"],
        "tags": record.get("tags", []),
        "production_style": classification["production_style"],
        "style_ru": classification["style_ru"],
        "style_group": classification["style_group"],
        "uses_ai": classification["uses_ai"],
        "difficulty": classification["difficulty"],
        "difficulty_ru": classification["difficulty_ru"],
        "solo_friendly": classification["solo_friendly"],
        "subs": collect._number(stats.get("subscribers")),
        "total_views": collect._number(stats.get("totalViews")),
        "videos_count": total_videos,
        "videos_count_long": calculated["videos_count_long"],
        "first_video_at": first_video_at,
        "channel_age_days": round(age_days, 1),
        "avg_views": calculated["avg_views"] or float(stats.get("avgViewsPerVideo") or 0),
        "median_views": calculated["median_views"] or float(stats.get("medianViewsPerVideo") or 0),
        "avg_views_first_5": calculated["avg_views_first_5"],
        "avg_duration_sec": calculated["avg_duration_sec"] or float(stats.get("avgVideoLength") or 0),
        "views_per_day": calculated["views_per_day"],
        "monthly_views_est": monthly_views_est,
        "monthly_income_est": round(monthly_views_est / 1000 * rpm, 2),
        "subs_per_day": calculated["subs_per_day"],
        "watch_hours_est": calculated["watch_hours_est"],
        "days_to_monetization": calculated["days_to_monetization"],
        "monetization_forecast": calculated["monetization_forecast"],
        "is_monetized": bool(record.get("isMonetizationEnabled")),
        "rpm": rpm,
        "rpm_source": "nexlev",
        "monthly_revenue_nexlev": monthly_revenue,
        "region": region,
        "region_ru": rpm_data["region_ru"].get(region, "Другое"),
        "score": 0,
        "found_by_queries": [f"nexlev: {category}"],
        "added_at": collect._iso_date(now),
        "updated_at": collect._iso_date(now),
        "videos": [
            {
                "id": video.get("id"),
                "title": video.get("title", ""),
                "thumbnail": video.get("thumbnail", ""),
                "views": collect._number(video.get("views")),
                "published_at": video.get("published_at"),
                "duration_sec": collect._number(video.get("duration_sec")),
                "is_outlier": video.get("id") in calculated["outliers"],
            }
            for video in sorted(
                calculated["_long_videos"],
                key=lambda item: item.get("published_at") or "",
                reverse=True,
            )
        ],
    }
    result["score"] = collect.score(result)
    return result


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--out", default=os.path.join(BASE_DIR, "..", "data", "channels.json"))
    args = parser.parse_args(argv)
    raw = _read_json(RAW_PATH, None)
    if raw is None:
        raw = _read_json(os.path.join(BASE_DIR, "nexlev_seed.json"), {})
    rpm_data = _read_json(RPM_PATH, {})
    previous = _read_json(args.out, {"generated_at": None, "channels": []})
    now = collect._utc_now()
    current = []
    for channel_id, record in raw.items():
        try:
            channel = channel_from_record(channel_id, record, rpm_data, now)
            if channel:
                current.append(channel)
        except Exception as error:
            collect._log(f"Skipping NexLev channel {channel_id}: {error}")
    output = {
        "generated_at": now.isoformat().replace("+00:00", "Z"),
        "quota_units_used": 0,
        "queries_run": 0,
        "channels": collect.merge(previous, current, now=now),
    }
    collect._write_output(args.out, output)
    collect._log(f"Seeded {len(current)} NexLev channels; wrote {len(output['channels'])} channels")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
