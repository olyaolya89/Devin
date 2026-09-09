import datetime as dt
import importlib.util
import os
import sys
import unittest


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

    def test_rotate_queries_changes_daily_start(self):
        queries = [{"text": str(index)} for index in range(40)]
        first = collect.rotate_queries(queries, dt.datetime(2025, 1, 1, tzinfo=dt.timezone.utc))
        second = collect.rotate_queries(queries, dt.datetime(2025, 1, 2, tzinfo=dt.timezone.utc))
        self.assertNotEqual(first[0]["text"], second[0]["text"])

    def test_parse_nexlev_length_text(self):
        self.assertEqual(seed.parse_length_text("23:22"), 1402)
        self.assertEqual(seed.parse_length_text("1:02:03"), 3723)


if __name__ == "__main__":
    unittest.main()
