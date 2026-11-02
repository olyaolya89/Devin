import datetime as dt
import importlib.util
import json
import os
import sys
import tempfile
import unittest
from unittest import mock


COLLECTOR_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, COLLECTOR_DIR)
spec = importlib.util.spec_from_file_location("collect", os.path.join(COLLECTOR_DIR, "collect.py"))
collect = importlib.util.module_from_spec(spec)
spec.loader.exec_module(collect)
seed_spec = importlib.util.spec_from_file_location(
    "seed_from_nexlev", os.path.join(COLLECTOR_DIR, "seed_from_nexlev.py")
)
seed = importlib.util.module_from_spec(seed_spec)
seed_spec.loader.exec_module(seed)


class CollectTests(unittest.TestCase):
    def test_classify_keyword_mapping_and_default(self):
        cases = [
            ("stickman psychology", "stickman"),
            ("world maps and borders", "maps_graphics"),
            ("AI generated video with Sora", "ai_video"),
            ("quiet nature footage", "stock_footage"),
        ]
        for title, expected in cases:
            with self.subTest(title=title):
                result = collect.classify({"snippet": {"title": title}}, [])
                self.assertEqual(result["production_style"], expected)

    def test_score_formula(self):
        channel = {
            "avg_views_first_5": 1000000,
            "rpm": 15,
            "monetization_forecast": "≤30 дн.",
            "difficulty": "low",
            "channel_age_days": 90,
        }
        # 30*1 + 25*1 + 20*.8 + 15*1 + 10*1.
        self.assertEqual(collect.score(channel), 96)

    def test_metrics_and_forecast_buckets(self):
        now = dt.datetime(2025, 1, 31, tzinfo=dt.timezone.utc)
        videos = [
            {
                "id": str(index),
                "title": f"Video {index}",
                "views": views,
                "duration_sec": 3600,
                "published_at": f"2025-01-{day:02d}T00:00:00Z",
            }
            for index, (day, views) in enumerate(
                [(1, 1000), (8, 2000), (15, 3000), (22, 4000), (29, 5000)]
            )
        ]
        result = collect.metrics(
            {"statistics": {"subscriberCount": "950", "viewCount": "15000"}},
            videos,
            now=now,
        )
        self.assertEqual(result["avg_views_first_5"], 3000)
        self.assertEqual(result["videos_count_long"], 5)
        self.assertEqual(result["monthly_views_est"], 15000)
        self.assertEqual(result["days_to_monetization"], 1.58)
        self.assertEqual(result["monetization_forecast"], "≤30 дн.")

        output = collect._channel_output(
            {
                "id": "synthetic",
                "snippet": {"title": "Synthetic", "country": "US"},
                "statistics": {
                    "subscriberCount": "950",
                    "viewCount": "15000",
                    "videoCount": "5",
                },
            },
            videos,
            {"text": "engineering", "niche": "engineering", "lang": "en"},
            collect._load_json(collect.RPM_PATH, {}),
            {},
            now,
        )
        self.assertEqual(output["monthly_views_est"], 15000)
        self.assertEqual(output["monthly_income_est"], 105.0)

        result = collect.metrics(
            {"statistics": {"subscriberCount": "0", "viewCount": "15000"}},
            videos,
            now=now,
        )
        self.assertEqual(result["monetization_forecast"], "неясно")

    def test_merge_preserves_added_at_and_marks_stale(self):
        now = dt.datetime(2025, 2, 1, tzinfo=dt.timezone.utc)
        previous = {
            "channels": [
                {"id": "same", "added_at": "2025-01-01", "title": "old"},
                {"id": "recent", "added_at": "2025-01-15", "title": "recent"},
                {"id": "expired", "added_at": "2024-10-01", "title": "expired"},
            ]
        }
        current = [{"id": "same", "title": "new", "updated_at": "2025-02-01"}]
        result = collect.merge(previous, current, now=now)
        by_id = {item["id"]: item for item in result}
        self.assertEqual(by_id["same"]["added_at"], "2025-01-01")
        self.assertTrue(by_id["recent"]["stale"])
        self.assertNotIn("expired", by_id)

    def test_title_query_strips_numbers_and_punctuation(self):
        self.assertEqual(
            collect.title_query("10 Pieces Of Old Carnival Glass That Are Secretly Worth A Fortune!"),
            "pieces of old carnival glass that",
        )

    def test_snowball_queries_use_verified_outlier_titles(self):
        now = dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc)
        channels = [
            {"id": "a", "verified": True, "niche": "history", "language": "es", "videos_count": 20,
             "videos": [{"title": "La batalla olvidada de 1942", "views": 900, "is_outlier": True},
                        {"title": "Otro video normal aqui", "views": 10}]},
            {"id": "b", "verified": False, "niche": "history", "videos": [{"title": "Rejected channel big hit", "views": 9}]},
            {"id": "c", "verified": True, "niche": "x", "videos_count": 120, "videos": [{"title": "Too many videos here", "views": 9}]},
        ]
        self.assertEqual(
            collect.snowball_queries(channels, now),
            [{"text": "la batalla olvidada de", "niche": "history", "lang": "es", "snowball": True}],
        )

    def test_search_uses_one_pass_per_query(self):
        calls = []
        with mock.patch.object(collect, "yt_get", side_effect=lambda *a, **k: calls.append(a[1]) or {"items": []}):
            collect.search({"text": "q", "lang": "en"}, 1, collect._new_state(), ["explained"])
        self.assertEqual([(c["q"], c["videoDuration"]) for c in calls], [("q", "long")])

    def test_rotate_queries_changes_daily_start(self):
        queries = [{"text": str(index)} for index in range(40)]
        first = collect.rotate_queries(queries, dt.datetime(2025, 1, 1, tzinfo=dt.timezone.utc))
        second = collect.rotate_queries(queries, dt.datetime(2025, 1, 2, tzinfo=dt.timezone.utc))
        self.assertNotEqual(first[0]["text"], second[0]["text"])

    def test_parse_nexlev_length_text(self):
        self.assertEqual(seed.parse_length_text("23:22"), 1402)
        self.assertEqual(seed.parse_length_text("1:02:03"), 3723)

    def test_entry_scores_verdicts_and_bounds(self):
        now = dt.datetime(2025, 2, 1, tzinfo=dt.timezone.utc)

        def channel(cluster, average, added="2025-01-31"):
            niche, style_group, language = cluster.split("|")
            return {
                "id": f"{niche}-{style_group}-{language}-{average}-{added}",
                "niche": niche,
                "niche_ru": niche,
                "style_group": style_group,
                "language": language,
                "avg_views_first_5": average,
                "avg_views": average,
                "total_views": 100000,
                "subs": 100,
                "rpm": 5,
                "added_at": added,
            }

        channels = [
            channel("open|live|en", 30000),
            *[channel("crowded|live|en", 30000) for _ in range(9)],
            *[channel("unproven|live|en", 1000) for _ in range(2)],
            *[channel("filling|live|en", 30000) for _ in range(6)],
        ]
        clusters = collect.entry_scores(channels, now=now)
        self.assertEqual(clusters["open|live|en"]["verdict"], "open")
        self.assertEqual(clusters["crowded|live|en"]["verdict"], "crowded")
        self.assertEqual(clusters["unproven|live|en"]["verdict"], "unproven")
        self.assertEqual(clusters["filling|live|en"]["verdict"], "filling")
        self.assertTrue(all(0 <= item["entry_score"] <= 100 for item in clusters.values()))

    def test_write_history_filename_and_keys(self):
        now = dt.datetime(2025, 2, 1, tzinfo=dt.timezone.utc)
        output = {
            "generated_at": "2025-02-01T00:00:00Z",
            "channels": [{"id": "one", "subs": 2}],
            "clusters": {"animals|live|en": {"n": 1, "share_growing": 1}},
        }
        with tempfile.TemporaryDirectory() as directory:
            path = collect.write_history(directory, output, now)
            self.assertEqual(path, os.path.join(directory, "2025-02-01.json"))
            with open(path, encoding="utf-8") as handle:
                history = json.load(handle)
        self.assertEqual(history["generated_at"], output["generated_at"])
        self.assertEqual(history["channels"][0]["id"], "one")
        self.assertEqual(history["clusters"]["animals|live|en"]["n"], 1)

    def test_merge_keep_ids_preserves_graduated_channel(self):
        previous = {"channels": []}
        current = [{"id": "labeled", "videos_count": collect.MAX_VIDEOS + 1, "title": "Reference"}]
        result = collect.merge(previous, current, keep_ids={"labeled"})
        self.assertEqual(len(result), 1)
        self.assertTrue(result[0]["graduated"])

    def test_channel_output_accepts_a_single_long_video(self):
        now = dt.datetime(2025, 1, 31, tzinfo=dt.timezone.utc)
        videos = [
            {
                "id": "only",
                "title": "Only video",
                "views": 40000,
                "duration_sec": 3600,
                "published_at": "2025-01-10T00:00:00Z",
            }
        ]
        output = collect._channel_output(
            {
                "id": "breakout",
                "snippet": {"title": "Breakout", "country": "US"},
                "statistics": {
                    "subscriberCount": "400",
                    "viewCount": "40000",
                    "videoCount": "1",
                },
            },
            videos,
            {"text": "engineering", "niche": "engineering", "lang": "en"},
            collect._load_json(collect.RPM_PATH, {}),
            {},
            now,
        )
        self.assertIsNotNone(output)
        self.assertEqual(output["videos_count_long"], 1)


    def test_eligible_accepts_proven_channels_with_many_videos(self):
        self.assertTrue(collect.eligible({"videoCount": 100, "subscriberCount": 150000}))
        self.assertFalse(collect.eligible({"videoCount": 101, "subscriberCount": 150000}))
        self.assertFalse(collect.eligible({"videoCount": 400, "subscriberCount": 5000}))
        self.assertFalse(collect.eligible({"videoCount": 20, "subscriberCount": 500000}))
        self.assertFalse(collect.eligible({"videoCount": 20, "subscriberCount": 5000, "hiddenSubscriberCount": True}))

    def test_merge_keeps_ai_notes_and_appends_daily_metrics(self):
        now = dt.datetime(2025, 2, 2, tzinfo=dt.timezone.utc)
        previous = {"channels": [{
            "id": "one", "added_at": "2025-01-01", "enriched_at": "2025-01-20",
            "notes_ru": "Заметки", "subniche_ru": "Военная история",
            "daily": [["2025-01-31", 100, 1000], ["2025-02-01", 110, 1500]],
        }]}
        current = [{"id": "one", "videos_count": 10, "subs": 120, "total_views": 2100, "subniche_ru": "Другое"}]
        result = collect.merge(previous, current, now=now)[0]
        self.assertEqual(result["notes_ru"], "Заметки")
        self.assertEqual(result["subniche_ru"], "Военная история")
        self.assertEqual(result["daily"][-1], ["2025-02-02", 120, 2100])
        self.assertEqual(len(result["daily"]), 3)

    def test_daily_search_limit_429_stops_search_instead_of_crashing(self):
        import io
        import urllib.error
        from unittest import mock
        body = json.dumps({"error": {"errors": [{"reason": "rateLimitExceeded"}]}}).encode()
        def boom(*args, **kwargs):
            raise urllib.error.HTTPError("u", 429, "Too Many Requests", {}, io.BytesIO(body))
        state = collect._new_state(["k"])
        with mock.patch("urllib.request.urlopen", boom):
            with self.assertRaises(collect.QuotaExhausted):
                collect.yt_get("search", {}, state, cost=100, is_search=True)

    def test_lang_checks_count_channels_and_rotate_oldest_first(self):
        from unittest import mock
        queries = [{"text": "a", "niche": "history", "lang": "en"}, {"text": "b", "niche": "history", "lang": "de"}]
        payload = {"items": [{"snippet": {"channelId": "x"}}, {"snippet": {"channelId": "x"}}, {"snippet": {"channelId": "y"}}]}
        now = dt.datetime(2026, 1, 2, tzinfo=dt.timezone.utc)
        with tempfile.TemporaryDirectory() as directory:
            path = os.path.join(directory, "lc.json")
            with open(path, "w", encoding="utf-8") as handle:
                json.dump({"history|en": {"channels": 9, "checked_at": "2026-01-01"}}, handle)
            with mock.patch.object(collect, "yt_get", return_value=payload) as call:
                checks = collect.run_lang_checks(queries, {}, now, path=path, per_run=1)
            self.assertEqual(call.call_args[0][1]["relevanceLanguage"], "de")
            self.assertEqual(checks["history|de"]["channels"], 2)
            self.assertEqual(checks["history|en"]["channels"], 9)


class EnrichTests(unittest.TestCase):
    def setUp(self):
        enrich_spec = importlib.util.spec_from_file_location("enrich", os.path.join(COLLECTOR_DIR, "enrich.py"))
        self.enrich = importlib.util.module_from_spec(enrich_spec)
        enrich_spec.loader.exec_module(self.enrich)
        self.channel = {"id": "c", "title": "T", "videos": [
            {"id": "a", "title": "Small", "views": 10},
            {"id": "b", "title": "Big Battle", "views": 900, "duration_sec": 900},
        ]}

    def test_pick_model_prefers_configured_then_newest_stable_flash(self):
        pick = self.enrich.pick_model
        self.assertEqual(pick(["models/gemini-2.5-flash", "models/gemini-3-flash"], "gemini-2.5-flash"), "gemini-2.5-flash")
        names = ["models/gemini-2.0-flash", "models/gemini-3-flash", "models/gemini-3-flash-lite", "models/gemini-3.5-flash-preview", "models/gemini-3-pro"]
        self.assertEqual(pick(names, "gemini-2.5-flash"), "gemini-3-flash")
        self.assertIsNone(pick(["models/text-embedding-004"], "gemini-2.5-flash"))

    def test_attempt_does_not_wait_on_exhausted_quota(self):
        import io, urllib.error
        calls = []
        def call(body, key):
            calls.append(1)
            raise urllib.error.HTTPError("u", 429, "q", {}, io.BytesIO(b'{"message": "You exceeded your current quota, please check your plan"}'))
        with mock.patch.object(self.enrich.time, "sleep") as sleep:
            with self.assertRaises(self.enrich.GeminiError):
                self.enrich.attempt(call, {}, "k")
        self.assertEqual((len(calls), sleep.call_count), (1, 0))

    def test_switch_model_follows_retired_model_hint(self):
        self.enrich.MODEL = "gemini-2.5-flash"
        body = '"message": "This model models/gemini-2.5-flash is no longer available to new users. Please update your code to use models/gemini-3.8-flash for the latest"'
        self.assertTrue(self.enrich.switch_model(body))
        self.assertEqual(self.enrich.MODEL, "gemini-3.8-flash")
        self.assertFalse(self.enrich.switch_model(body.replace("2.5", "3.8")))
        self.assertFalse(self.enrich.switch_model("quota exceeded"))

    def test_apply_sets_niche_from_gemini_key_and_rpm(self):
        channel = {"niche": "history", "niche_ru": "История", "rpm_source": "baseline", "region": "us", "rpm": 6.0, "monthly_views_est": 100000}
        result = {"fits": True, "niche_key": "military", "notes_ru": "x", "production_ru": "y", "subniche_ru": "z"}
        self.enrich.apply(channel, result, watched=None, now=dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc))
        self.assertEqual((channel["niche"], channel["niche_ru"], channel["niche_ai"]), ("military", "Военное дело", "military"))
        self.assertEqual((channel["rpm"], channel["monthly_income_est"]), (7.0, 700.0))

    def test_every_query_niche_has_rpm_baseline(self):
        base = os.path.join(os.path.dirname(os.path.abspath(collect.__file__)))
        niches = json.load(open(os.path.join(base, "rpm_baseline.json"), encoding="utf-8"))["niches"]
        queries = json.load(open(os.path.join(base, "queries.json"), encoding="utf-8"))["queries"]
        self.assertEqual([q for q in queries if q["niche"] not in niches], [])

    def test_apply_saves_mixed_production_shares(self):
        channel = {"id": "a"}
        result = {"fits": True, "niche_ru": "История", "notes_ru": "n", "production_ru": "p", "subniche_ru": "s",
                  "uses_ai": "mixed", "difficulty": "medium", "extra_monetization": ["none"],
                  "production_mix": [{"style": "stock_footage", "share": 30}, {"style": "ai_images", "share": 50},
                                     {"style": "bogus", "share": 20}]}
        self.enrich.apply(channel, result, watched=None, now=dt.datetime(2026, 1, 1, tzinfo=dt.timezone.utc))
        self.assertEqual(channel["production_mix"], [{"style": "ai_images", "share": 50}, {"style": "stock_footage", "share": 30}])

    def test_competitor_counts_by_niche_and_language(self):
        chans = [{"id": "a", "niche": "history", "language": "en"}, {"id": "b", "niche": "history", "language": "en-US"},
                 {"id": "c", "niche": "history", "language": "es"}]
        self.assertEqual(self.enrich.competitor_counts(chans), {"a": 1, "b": 1, "c": 0})

    def test_request_watches_first_two_minutes_of_top_video(self):
        body = self.enrich.request_body(self.channel, watch=True)
        parts = body["contents"][0]["parts"]
        self.assertEqual(parts[0]["fileData"]["fileUri"], "https://www.youtube.com/watch?v=b")
        self.assertEqual(parts[0]["videoMetadata"]["endOffset"], "120s")
        self.assertIn("Big Battle", parts[1]["text"])

    def test_enrich_falls_back_to_text_and_applies_result(self):
        calls = []

        def fake(body, key):
            calls.append(body)
            if len(calls) == 1:
                raise ValueError("video not accepted")
            return {"fits": True, "niche_ru": "Военное дело", "notes_ru": "О войне.", "production_ru": "Карты (~50%).", "subniche_ru": "Военная история",
                    "uses_ai": "mix", "difficulty": "medium", "extra_monetization": ["own_product", "none"],
                    "production_styles": ["maps_graphics", "bogus"], "categories": ["history"], "has_ai_avatar": False}

        now = dt.datetime(2025, 3, 5, tzinfo=dt.timezone.utc)
        self.assertTrue(self.enrich.enrich(self.channel, "k", now, call=fake))
        self.assertEqual(len(calls[1]["contents"][0]["parts"]), 1)
        self.assertEqual(self.channel["subniche_ru"], "Военная история")
        self.assertEqual(self.channel["extra_monetization"], ["own_product"])
        self.assertTrue(self.channel["uses_ai"])
        self.assertEqual(self.channel["difficulty_ru"], "Средняя")
        self.assertIn("05.03", self.channel["notes_ru"])
        self.assertEqual(self.channel["notes_source"], "gemini")
        self.assertEqual(self.channel["production_styles"], ["maps_graphics"])
        self.assertEqual(self.channel["categories"], ["history"])
        self.assertFalse(self.channel["has_ai_avatar"])
        self.assertTrue(self.channel["verified"])
        self.assertEqual(self.channel["niche_ai_ru"], "Военное дело")


if __name__ == "__main__":
    unittest.main()
