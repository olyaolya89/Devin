#!/usr/bin/env python3
"""Measure how crowded a channel's own topics are on YouTube.

Why this exists
---------------
The site used to call "competitors" the other channels *inside its own database* that
shared a niche and a language. That number cannot answer "is this niche free?" for two
reasons:

* the database only holds young channels (3-30 videos, under a year old), so every rival
  that succeeded and grew past the filter silently disappeared from the count — a niche
  looked emptiest exactly when its winners had grown;
* 915 channels spread over ~25 niches and 16 languages leaves buckets of one, so the
  answer was an artefact of catalogue size, not of YouTube.

This module asks YouTube instead. It takes the channel's own best-performing titles,
searches for them, and counts how many *other* channels are publishing the same topic
right now, how many of those titles are near-copies, and how big those rivals are.
That is the thing a creator actually needs to know before entering a niche.

Quota
-----
`search.list` costs 100 units, `channels.list` costs 1. One probe per channel is
100 units plus one cheap channels.list, so the default 2,000-unit budget covers about
18 channels per run. Channels are processed oldest-check-first, so repeated runs sweep
the whole catalogue.

Usage
-----
    export YOUTUBE_API_KEY="key1,key2"
    python niche-radar/collector/competition.py --data niche-radar/data/channels.json
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import re
import sys
import urllib.error
from statistics import median
from typing import Any

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import collect  # noqa: E402 - needs the path tweak above

# A search page holds 50 results; that is the denominator for "share of the page".
PAGE = 50
# Rivals are only interesting if they published recently; older videos no longer compete
# for the same recommendations.
WINDOW_DAYS = 180
# Above this many subscribers a rival is an established channel rather than a newcomer.
BIG_RIVAL_SUBS = 100_000
DEFAULT_BUDGET = 2_000
# One probe per channel keeps the quota predictable; a second title is only worth it when
# the first returns almost nothing.
PROBES_PER_CHANNEL = 2
STOPWORDS = {
    "the", "a", "an", "of", "in", "on", "to", "for", "and", "or", "is", "are", "was",
    "were", "how", "why", "what", "who", "this", "that", "it", "its", "with", "from",
    "at", "by", "as", "be", "been", "do", "does", "did", "will", "would", "can",
}


def _words(title: str) -> set[str]:
    """Meaningful words of a title, normalised hard enough that cosmetic rewrites match.

    `title_query` already drops punctuation, digits and emoji. Apostrophes survive it,
    so "world's" and "worlds" would count as different words and a word-for-word copy
    would score well below 1.0; stripping them keeps real copies near the top of the
    range and leaves a clear gap to unrelated titles.
    """
    cleaned = collect.title_query(title, words=40).replace("'", "")
    return {w for w in cleaned.split() if w and w not in STOPWORDS}


def title_similarity(a: str, b: str) -> float:
    """Jaccard overlap of meaningful words — near-1.0 means the same title."""
    left, right = _words(a), _words(b)
    if not left or not right:
        return 0.0
    return len(left & right) / len(left | right)


def title_overlap(source: str, other: str) -> float:
    """Share of the source title's meaningful words that `other` also uses.

    Deliberately asymmetric. Jaccard punishes a rival for padding its title — a real
    word-for-word copy with "| Inside This Floating City" bolted on scored 0.45 and
    would have been missed, while containment scores it 0.83. Measured against the
    clone clusters this was built for, containment put every known copy at 0.67-1.00
    and every merely-same-subject video at 0.33-0.67.
    """
    left, right = _words(source), _words(other)
    if not left or not right:
        return 0.0
    return len(left & right) / len(left)


# A rival title reusing 70%+ of our words is our title rewritten.
CLONE_OVERLAP = 0.7
# Below that, 40%+ still means the same subject from a different angle — a competitor
# for the same recommendations, but not a copy.
TOPIC_OVERLAP = 0.4


def probe_titles(channel: dict[str, Any], limit: int = PROBES_PER_CHANNEL) -> list[tuple[str, str]]:
    """The channel's own hits, because those are the titles rivals copy.

    Outliers first: a video that beat the channel's median is the one worth cloning, so
    it is also the one whose search page shows the real competition.

    Returns `(query, full_title)` pairs. The query is shortened for `search.list`, but
    similarity has to be judged against the *whole* original title — scoring a 7-word
    query against a rival's full title inflates the union and makes word-for-word copies
    look unrelated.
    """
    videos = [v for v in (channel.get("videos") or []) if v.get("title")]
    videos.sort(key=lambda v: -collect._number(v.get("views")))
    ordered = [v for v in videos if v.get("is_outlier")] + [v for v in videos if not v.get("is_outlier")]
    out: list[tuple[str, str]] = []
    for video in ordered:
        text = collect.title_query(video["title"], words=7)
        if len(text.split()) >= 3 and all(text != q for q, _ in out):
            out.append((text, video["title"]))
        if len(out) >= limit:
            break
    return out


def _search(query: str, lang: str, state: dict[str, Any], after: str) -> list[dict[str, Any]]:
    params = {
        "part": "snippet",
        "type": "video",
        "q": query,
        "order": "relevance",
        "publishedAfter": after,
        "maxResults": PAGE,
        "relevanceLanguage": (lang or "en").split("-")[0],
    }
    payload = collect.yt_get("search", params, state, cost=100, is_search=True)
    return payload.get("items", [])


def _rival_subs(channel_ids: list[str], state: dict[str, Any]) -> dict[str, int]:
    """Subscriber counts for the rivals, so a crowd of tiny channels is not mistaken
    for a crowd of established ones."""
    out: dict[str, int] = {}
    for start in range(0, len(channel_ids), 50):
        batch = channel_ids[start : start + 50]
        try:
            payload = collect.yt_get(
                "channels", {"part": "statistics", "id": ",".join(batch)}, state, cost=1
            )
        except (collect.QuotaExhausted, urllib.error.HTTPError):
            break
        for item in payload.get("items", []):
            out[item.get("id")] = collect._number(item.get("statistics", {}).get("subscriberCount"))
    return out


def competition_index(
    *, clone_channels: int, clone_share: float, rival_channels: int, big_rivals: int
) -> tuple[int, str, str]:
    """0 = nobody else is on this topic, 100 = the topic is saturated.

    Four signals, weighted by how much each one actually predicts a newcomer's trouble:

    * `clone_channels` (40) — how many *different* channels publish this title rewritten.
      The sharpest signal there is: a topic with five channels shipping the same title is
      hostile no matter how big they are. The ship-documentary cluster this was built
      against had 12+ such channels on one title within two months.
    * `clone_share` (25) — how much of the result page those copies occupy.
    * `rival_channels` (20) — channels on the subject at all, copying or not.
    * `big_rivals` (15) — whether a newcomer would be up against established channels.

    The denominators are deliberately small: ten distinct channels on one specific topic
    is already crowded, so dividing by 30 (as a first cut did) rated a visibly saturated
    niche as "moderate".
    """
    value = round(
        40 * collect._clamp(clone_channels / 8, 0, 1)
        + 25 * collect._clamp(clone_share / 0.25, 0, 1)
        + 20 * collect._clamp(rival_channels / 15, 0, 1)
        + 15 * collect._clamp(big_rivals / 6, 0, 1)
    )
    value = max(0, min(100, value))
    if value <= 25:
        return value, "free", "Свободно"
    if value <= 50:
        return value, "moderate", "Умеренно"
    if value <= 75:
        return value, "competitive", "Конкурентно"
    return value, "saturated", "Переполнено"


def measure(channel: dict[str, Any], state: dict[str, Any], now: dt.datetime) -> dict[str, Any] | None:
    """Probe one channel's topics. Returns the `competition` payload, or None if no probe
    could be built or the quota ran out before any search succeeded."""
    titles = probe_titles(channel)
    if not titles:
        return None
    after = (now - dt.timedelta(days=WINDOW_DAYS)).isoformat().replace("+00:00", "Z")
    lang = (channel.get("language") or "en").split("-")[0]
    own_id = channel.get("id")
    used: list[str] = []
    rivals: dict[str, dict[str, Any]] = {}
    clones: list[dict[str, Any]] = []
    videos_seen = 0
    for query, source_title in titles:
        try:
            items = _search(query, lang, state, after)
        except collect.QuotaExhausted:
            break
        except urllib.error.HTTPError as error:
            print(f"[competition] search failed for {query!r}: {error}", file=sys.stderr)
            continue
        used.append(query)
        videos_seen += len(items)
        for item in items:
            snippet = item.get("snippet", {})
            rival_id = snippet.get("channelId")
            if not rival_id or rival_id == own_id:
                continue
            rival_title = snippet.get("title", "")
            overlap = title_overlap(source_title, rival_title)
            if overlap < TOPIC_OVERLAP:
                # Search returns loosely related videos too; they are not competition
                # for this topic and would inflate every count.
                continue
            row = rivals.setdefault(
                rival_id,
                {
                    "id": rival_id,
                    "title": snippet.get("channelTitle", ""),
                    "videos": 0,
                    "best_overlap": 0.0,
                    "clone": False,
                    "latest": None,
                },
            )
            row["videos"] += 1
            row["best_overlap"] = max(row["best_overlap"], round(overlap, 2))
            published = snippet.get("publishedAt")
            if published and (row["latest"] is None or published > row["latest"]):
                row["latest"] = published
            if overlap >= CLONE_OVERLAP:
                row["clone"] = True
                clones.append(
                    {
                        "channel_id": rival_id,
                        "channel": snippet.get("channelTitle", ""),
                        "title": rival_title,
                        "published_at": published,
                        "overlap": round(overlap, 2),
                    }
                )
        # One probe is usually enough; spend the second only when the first page was thin.
        if len(rivals) >= 10:
            break
    if not used:
        return None

    subs = _rival_subs([r for r in rivals][:50], state)
    for rival_id, row in rivals.items():
        if rival_id in subs:
            row["subs"] = subs[rival_id]

    clone_share = len(clones) / max(videos_seen, 1)
    clone_channels = sum(1 for r in rivals.values() if r.get("clone"))
    big_rivals = sum(1 for r in rivals.values() if (r.get("subs") or 0) >= BIG_RIVAL_SUBS)
    cutoff = (now - dt.timedelta(days=30)).isoformat().replace("+00:00", "Z")
    clones_30d = sum(1 for c in clones if (c.get("published_at") or "") >= cutoff)
    index, verdict, verdict_ru = competition_index(
        clone_channels=clone_channels,
        clone_share=clone_share,
        rival_channels=len(rivals),
        big_rivals=big_rivals,
    )
    top = sorted(
        rivals.values(),
        key=lambda r: (-r["best_overlap"], -(r.get("subs") or 0), -r["videos"]),
    )[:10]
    rival_subs = [r["subs"] for r in rivals.values() if r.get("subs")]
    return {
        "queries": used,
        "videos_seen": videos_seen,
        "rival_channels": len(rivals),
        "clone_channels": sum(1 for r in rivals.values() if r.get("clone")),
        "clone_videos": len(clones),
        "clone_share": round(clone_share, 3),
        "clones_30d": clones_30d,
        "big_rivals": big_rivals,
        "median_rival_subs": int(median(rival_subs)) if rival_subs else None,
        "top_rivals": top,
        "clone_examples": sorted(clones, key=lambda c: -c["overlap"])[:8],
        "index": index,
        "verdict": verdict,
        "verdict_ru": verdict_ru,
        "window_days": WINDOW_DAYS,
        "checked_at": now.date().isoformat(),
    }


def pick(channels: list[dict[str, Any]], budget: int) -> list[dict[str, Any]]:
    """Oldest check first, so repeated runs sweep the catalogue instead of re-probing
    the same channels. Channels with no videos cannot be probed at all."""
    # Each channel costs one or two searches plus a cheap channels.list.
    capacity = max(1, budget // (100 * PROBES_PER_CHANNEL))
    eligible = [
        c
        for c in channels
        if (c.get("videos") or []) and not c.get("graduated") and not c.get("stale")
    ]
    eligible.sort(
        key=lambda c: (
            (c.get("competition") or {}).get("checked_at") or "",
            -(c.get("score") or 0),
        )
    )
    return eligible[:capacity]


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--data", default=os.path.join(os.path.dirname(__file__), "..", "data", "channels.json")
    )
    parser.add_argument(
        "--budget",
        type=int,
        default=DEFAULT_BUDGET,
        help="search quota units this run may spend (100 per probe)",
    )
    parser.add_argument("--limit", type=int, default=0, help="cap the number of channels")
    parser.add_argument(
        "--channel", action="append", default=[], help="probe these channel ids only"
    )
    parser.add_argument("--dry-run", action="store_true", help="list the picks, make no calls")
    args = parser.parse_args(argv)

    with open(args.data, encoding="utf-8") as handle:
        data = json.load(handle)
    channels = data.get("channels") or []
    by_id = {c.get("id"): c for c in channels}

    if args.channel:
        batch = [by_id[cid] for cid in args.channel if cid in by_id]
        missing = [cid for cid in args.channel if cid not in by_id]
        for cid in missing:
            print(f"[competition] unknown channel id {cid}", file=sys.stderr)
    else:
        batch = pick(channels, args.budget)
    if args.limit:
        batch = batch[: args.limit]

    if args.dry_run:
        for channel in batch:
            queries = [q for q, _ in probe_titles(channel)]
            print(
                f"[competition] would probe {channel.get('title')} -> {queries}",
                file=sys.stderr,
            )
        return 0

    state = collect._new_state()
    if not state.get("keys"):
        print("[competition] YOUTUBE_API_KEY is not set - skipping", file=sys.stderr)
        return 0
    # This script only searches, so give the whole budget to the search bucket.
    collect.SEARCH_LIMIT = args.budget
    now = dt.datetime.now(dt.timezone.utc)
    done = 0
    try:
        for channel in batch:
            try:
                result = measure(channel, state, now)
            except collect.QuotaExhausted:
                print("[competition] quota budget spent - stopping", file=sys.stderr)
                break
            if not result:
                continue
            channel["competition"] = result
            channel["competition_index"] = result["index"]
            channel["competition_verdict"] = result["verdict"]
            channel["competition_verdict_ru"] = result["verdict_ru"]
            done += 1
            print(
                f"[competition] {channel.get('title')}: index {result['index']} "
                f"({result['verdict_ru']}) — {result['rival_channels']} каналов, "
                f"{result['clone_videos']} копий заголовка",
                file=sys.stderr,
            )
    finally:
        collect._write_output(args.data, data)
    print(
        f"[competition] measured {done}/{len(batch)} channels, "
        f"{state['quota_units_used']} quota units",
        file=sys.stderr,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
