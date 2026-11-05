# Collector spec (authoritative — implement exactly)

## Inputs
- `queries.json` — seed queries. For each query run YouTube `search.list` twice: `text` and `text + " " + random(modifiers)` (deterministic: modifier index = query index mod len).
  Params: `part=snippet, type=video, videoDuration=medium, order=viewCount, publishedAfter=now-45d, maxResults=25, relevanceLanguage=lang`.
  Also for `lang in (en)` run a second pass with `order=date`.
- `rpm_baseline.json`, `nexlev_cache.json` (map ytChannelId -> {rpm, is_monetized, is_faceless, is_ai, country_top, category, format, fetched_at}).
- Env `YOUTUBE_API_KEY` (comma-separated multiple keys; rotate on 403 quotaExceeded).

## Quota budget
search.list = 100 units, channels.list/videos.list/playlistItems.list = 1 unit. Stop issuing searches at 7 500 units; keep enrichment ≤ 1 500 units. Log units used.

## Filtering ("young channel")
Collect unique channelIds from search results. `channels.list part=snippet,statistics,contentDetails` in batches of 50. Keep if:
- `statistics.videoCount <= 30` and `>= 3`
- `statistics.subscriberCount >= 200`
- channel not `hiddenSubscriberCount`
Then fetch all uploads via `playlistItems.list` (uploads playlist, ≤ 30 ids) and `videos.list part=snippet,statistics,contentDetails`. Drop Shorts (duration < 90 s) from stats but count them. Keep channel only if first long video published ≤ 365 days ago and ≥ 3 long videos.

## Heuristic classification (no LLM)
`production_style` — score each class by keyword hits in channel title/description/video titles/tags, weighted; fallback `query.style_hint`, else `stock_footage`:
- stickman: stickman, stick figure, stick-figure, stickly, палочный
- 2d_animation: animated, animation, cartoon, анимация, мультфильм
- ai_illustrations: illustrated, ai art, midjourney, drawn, ilustrado, dibujado, иллюстрации
- ai_video: ai generated, ai video, sora, veo, kling, нейросеть
- maps_graphics: map, maps, geography, карта, состояние, state, border
- screencast_slides: tutorial, how to, screen, excel, code
- talking_head: vlog, my, i tried, я попробовал, reaction
- stock_footage: default
`uses_ai` = style in (stickman, ai_illustrations, ai_video) or keyword hit for ai.
`style_group` = "ai" if style in (stickman, 2d_animation, ai_illustrations, ai_video) else "live".
`difficulty`: low = stock_footage, screencast_slides, ai_illustrations; medium = maps_graphics, stickman, ai_video; high = 2d_animation, talking_head.
`solo_friendly` = difficulty != high.
`language`: the language the channel sells to, not the first tag YouTube returns. All metadata
requests pass `hl=en`, so `snippet.localized` holds the English branding when the channel ships
an English localization and `snippet.title` holds its own default locale; a difference between
the two marks a multi-language channel. Then:
1. majority vote over the uploads' `defaultAudioLanguage`, and separately over `defaultLanguage`;
2. if an English localization is present on at least half the uploads **and** the channel country
   is an English market (`US GB CA AU NZ IE`) or the audio majority is already English →
   `language = "en"`;
3. else the audio majority, else the text majority, else the query language.

Also emits `languages` (every language found, primary first), `audio_language`, `is_multilang`
and `language_source` (`en_localization` | `audio_majority` | `text_majority` | `query_fallback`).
Taking `languages[0]` from the first upload — the previous rule — filed a US-facing English
channel under Spanish, which left it alone in its `niche|language` bucket and made the site
report zero competitors.
`niche` = query.niche of the query that found it (first hit). `niche_ru` from rpm_baseline.

## Metrics
- long videos sorted by publishedAt; `videos_count_long`, `first_video_at`, `channel_age_days` (from first long video)
- `avg_views`, `median_views`, `avg_views_first_5` (first 5 chronological), `avg_duration_sec`
- `views_per_day` = total long views / channel_age_days
- `subs_per_day` = subs / channel_age_days
- `outliers` = videos with views >= 3 × median (list, max 5)
- `watch_hours_est` = Σ views_i × share × duration_i / 3600, share = 0.35 if duration > 600 s else 0.45
- `days_to_1000_subs` = max(0, 1000 - subs) / max(subs_per_day, 0.5)
- `watch_hours_per_day` = watch_hours_est / channel_age_days
- `days_to_4000_hours` = max(0, 4000 - watch_hours_est) / max(watch_hours_per_day, 0.5)
- `days_to_monetization` = max(both); `monetization_forecast`: nexlev is_monetized → "уже"; days ≤ 30 → "≤30 дн."; ≤ 90 → "≤90 дн."; else "неясно"
- `rpm`, `rpm_source` ("nexlev" | "baseline"), `region`, `region_ru`. baseline: region = country_to_region[channel country] or lang_to_region[language] or "other".

## Score (0–100)
```
velocity = clamp(log10(max(avg_views_first_5,1)) / 6, 0, 1)      # 1M views → 1.0
rpm_norm = clamp(rpm / 15, 0, 1)
mon = {"уже":1, "≤30 дн.":0.8, "≤90 дн.":0.5, "неясно":0.2}[forecast]
repl = {"low":1, "medium":0.6, "high":0.2}[difficulty]
fresh = 1 if age ≤ 90 else 0.7 if ≤ 180 else 0.4
score = round(30*velocity + 25*rpm_norm + 20*mon + 15*repl + 10*fresh)
```

## Competition on YouTube (`competition.py`)

Separate script, separate run. Measures how crowded a channel's *own topics* are instead of
counting catalogue neighbours.

For each channel (oldest `competition.checked_at` first, `--budget` units per run, 100 per probe):
1. take up to 2 of its own best titles, outliers first, shortened to 7 words by `title_query`;
2. `search.list part=snippet type=video order=relevance maxResults=50 publishedAfter=now-180d
   relevanceLanguage=<channel language>`;
3. for every result, `title_overlap(own_title, rival_title)` = share of the own title's
   meaningful words the rival reuses. `< 0.4` is discarded as unrelated, `>= 0.7` counts as a
   copy of the title, in between as the same subject;
4. `channels.list part=statistics` on the rivals (1 unit per 50) for subscriber counts.

Overlap is deliberately asymmetric. Jaccard rates a word-for-word copy padded with
`| Inside This Floating City` at 0.45 and would miss it; containment rates it 0.83.

```
index = 40*clamp(clone_channels/8) + 25*clamp(clone_share/0.25)
      + 20*clamp(rival_channels/15) + 15*clamp(big_rivals/6)
```
`clone_share` = copies ÷ results seen; `big_rivals` = rivals with ≥100 000 subscribers.
Verdicts: ≤25 `free`, ≤50 `moderate`, ≤75 `competitive`, else `saturated`.

Writes `competition` (`queries, videos_seen, rival_channels, clone_channels, clone_videos,
clone_share, clones_30d, big_rivals, median_rival_subs, top_rivals[], clone_examples[], index,
verdict, verdict_ru, window_days, checked_at`) plus flat `competition_index`,
`competition_verdict`, `competition_verdict_ru`.

## Output `data/channels.json`
```
{"generated_at": iso, "quota_units_used": int, "queries_run": int,
 "channels": [ {id, handle, title, description, thumbnail, country, language, niche, niche_ru, tags[],
   production_style, style_ru, style_group, uses_ai, difficulty, difficulty_ru, solo_friendly,
   subs, total_views, videos_count, videos_count_long, first_video_at, channel_age_days,
   avg_views, median_views, avg_views_first_5, avg_duration_sec, views_per_day, monthly_views_est,
   monthly_income_est, monthly_revenue_nexlev, subs_per_day,
   watch_hours_est, days_to_monetization, monetization_forecast, is_monetized (bool|null),
   rpm, rpm_source, region, region_ru, score,
   found_by_queries[], added_at (first seen date — preserve from previous channels.json), updated_at,
   cluster, entry_verdict, entry_verdict_ru, entry_score, labeled_role,
   videos: [{id, title, thumbnail, views, published_at, duration_sec, is_outlier}]  (all long videos, newest first)
 } ], "clusters": {cluster_key: {n, share_growing, median_vpv, median_vps, newcomers_30d,
   median_rpm, niche_ru, style_group, language, channel_ids, entry_score, verdict, verdict_ru, label}} }
```
Merge with the previous `data/channels.json`: preserve `added_at`; keep channels not re-found in this run for 60 days (mark `stale: true`); drop channels that now exceed 30 videos unless `added_at` < 90 days ago (they stay with `graduated: true`).

style_ru map: stickman→"Стикманы", 2d_animation→"2D-анимация", ai_illustrations→"ИИ-иллюстрации", ai_video→"ИИ-видео", stock_footage→"Стоковый футаж", maps_graphics→"Карты и графика", screencast_slides→"Скринкаст/слайды", talking_head→"С лицом", mixed→"Смешанный".
difficulty_ru: low→"Низкая", medium→"Средняя", high→"Высокая".
