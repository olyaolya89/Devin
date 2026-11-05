import datetime as dt
import importlib.util
import os
import sys
import unittest

COLLECTOR_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, COLLECTOR_DIR)
spec = importlib.util.spec_from_file_location(
    "competition", os.path.join(COLLECTOR_DIR, "competition.py")
)
competition = importlib.util.module_from_spec(spec)
spec.loader.exec_module(competition)
collect = competition.collect

NOW = dt.datetime(2026, 11, 5, tzinfo=dt.timezone.utc)

# The clone cluster this module was built against: one title from Civilization Engine and
# the channels that republished it within two months, plus unrelated news that the same
# search returns and must not be counted.
PROBE = "How 10,000 People Live on the World's Biggest Cruise Ship"
SEARCH_PAGE = [
    ("UCnext", "NEXT ENGINE", "The world's largest Cruise ship. How 10,000 People Live on a Giant Cruise Ship?", "2026-10-05T00:00:00Z"),
    ("UCpresh", "Preshcute Builds", "How 10,000 People Live on the World's Biggest Cruise Ship", "2026-10-26T00:00:00Z"),
    ("UCaurio", "AURIO", "Life Inside the World's Biggest Cruise Ship | How 10,000 People Live in This Floating City", "2026-09-05T00:00:00Z"),
    ("UCroyal", "ROYAL ARCHIVES", "Inside a Giant CRUISE SHIP |How 10,000 PEOPLE Live on the World's Biggest CRUISE SHIP!", "2026-10-22T00:00:00Z"),
    ("UCbeyond", "Beyond Facts", "Inside the World's Largest Cruise Ship Ever Built", "2026-06-05T00:00:00Z"),
    ("UCnoise", "CTV News", "Crews begin production of Canada's largest ever polar icebreaker", "2026-10-01T00:00:00Z"),
    ("UCself", "Civilization Engine", PROBE, "2026-09-05T00:00:00Z"),
]


def _page(*_args, **_kwargs):
    return [
        {"snippet": {"channelId": cid, "channelTitle": name, "title": title, "publishedAt": pub}}
        for cid, name, title, pub in SEARCH_PAGE
    ]


class TitleOverlapTests(unittest.TestCase):
    def test_reworded_copies_score_above_the_clone_threshold(self):
        for title in [
            PROBE,
            "How 10,000 People Live on the Worlds Biggest Cruise Ship",
            "The world's largest Cruise ship. How 10,000 People Live on a Giant Cruise Ship?",
            "Life Inside the World's Biggest Cruise Ship | How 10,000 People Live in This Floating City",
        ]:
            with self.subTest(title=title):
                self.assertGreaterEqual(
                    competition.title_overlap(PROBE, title), competition.CLONE_OVERLAP
                )

    def test_same_subject_different_video_stays_below_clone_threshold(self):
        for title in [
            "Inside the World's Largest Cruise Ship Ever Built",
            "Inside a 249,000-Ton Floating City! How 10,000 People Live at Sea",
        ]:
            with self.subTest(title=title):
                overlap = competition.title_overlap(PROBE, title)
                self.assertLess(overlap, competition.CLONE_OVERLAP)
                self.assertGreaterEqual(overlap, 0.2)

    def test_unrelated_titles_score_zero(self):
        for title in [
            "Giant Helicopters: What Can They Do?",
            "How China Changed Africa: 5 Incredible Megaprojects",
        ]:
            with self.subTest(title=title):
                self.assertEqual(competition.title_overlap(PROBE, title), 0.0)

    def test_padding_a_title_does_not_hide_a_copy(self):
        """Jaccard rated this real copy 0.45 and would have missed it; containment is the
        reason the clone threshold can stay high."""
        padded = "Life Inside the World's Biggest Cruise Ship | How 10,000 People Live in This Floating City"
        self.assertLess(competition.title_similarity(PROBE, padded), competition.CLONE_OVERLAP)
        self.assertGreaterEqual(competition.title_overlap(PROBE, padded), competition.CLONE_OVERLAP)


class CompetitionIndexTests(unittest.TestCase):
    def test_verdicts_match_observed_niches(self):
        cases = [
            (dict(clone_channels=0, clone_share=0.0, rival_channels=1, big_rivals=0), "free"),
            (dict(clone_channels=1, clone_share=0.05, rival_channels=8, big_rivals=1), "free"),
            (dict(clone_channels=4, clone_share=0.22, rival_channels=6, big_rivals=2), "competitive"),
            (dict(clone_channels=8, clone_share=0.24, rival_channels=14, big_rivals=2), "saturated"),
        ]
        for kwargs, expected in cases:
            with self.subTest(**kwargs):
                _, verdict, _ = competition.competition_index(**kwargs)
                self.assertEqual(verdict, expected)

    def test_index_is_bounded(self):
        for kwargs in [
            dict(clone_channels=0, clone_share=0.0, rival_channels=0, big_rivals=0),
            dict(clone_channels=99, clone_share=1.0, rival_channels=99, big_rivals=99),
        ]:
            index, _, _ = competition.competition_index(**kwargs)
            self.assertGreaterEqual(index, 0)
            self.assertLessEqual(index, 100)


class MeasureTests(unittest.TestCase):
    def setUp(self):
        self._search, self._subs = competition._search, competition._rival_subs
        competition._search = _page
        competition._rival_subs = lambda ids, state: {
            "UCnext": 6980, "UCpresh": 4000, "UCaurio": 44900,
            "UCroyal": 300, "UCbeyond": 250000,
        }
        self.channel = {
            "id": "UCself",
            "title": "Civilization Engine",
            "language": "en",
            "videos": [{"title": PROBE, "views": 3737406, "is_outlier": True}],
        }

    def tearDown(self):
        competition._search, competition._rival_subs = self._search, self._subs

    def test_counts_clones_and_ignores_self_and_noise(self):
        result = competition.measure(self.channel, {"keys": ["k"], "quota_units_used": 0}, NOW)
        ids = [row["id"] for row in result["top_rivals"]]
        self.assertNotIn("UCself", ids, "the channel must not count as its own competitor")
        self.assertNotIn("UCnoise", ids, "unrelated news must not count as competition")
        self.assertEqual(result["clone_channels"], 4)
        self.assertEqual(result["rival_channels"], 5)
        # Preshcute (26 Oct) and ROYAL ARCHIVES (22 Oct) fall inside the 30-day window;
        # NEXT ENGINE (5 Oct) and AURIO (5 Sep) are older.
        self.assertEqual(result["clones_30d"], 2)
        self.assertEqual(result["big_rivals"], 1)
        self.assertEqual(result["verdict"], "competitive")
        self.assertEqual(result["checked_at"], "2026-11-05")

    def test_channel_without_videos_returns_none(self):
        self.assertIsNone(
            competition.measure({"id": "x", "videos": []}, {"keys": ["k"]}, NOW)
        )

    def test_probe_prefers_outliers(self):
        channel = {
            "videos": [
                {"title": "A quiet upload about container ships", "views": 100, "is_outlier": False},
                {"title": PROBE, "views": 3737406, "is_outlier": True},
            ]
        }
        queries = competition.probe_titles(channel, limit=1)
        self.assertEqual(len(queries), 1)
        self.assertIn("cruise", queries[0][1].lower())


class PickTests(unittest.TestCase):
    def test_oldest_check_first_and_skips_unprobeable(self):
        channels = [
            {"id": "fresh", "videos": [{"title": "t"}], "competition": {"checked_at": "2026-11-04"}},
            {"id": "never", "videos": [{"title": "t"}]},
            {"id": "stale", "videos": [{"title": "t"}], "stale": True},
            {"id": "empty", "videos": []},
            {"id": "old", "videos": [{"title": "t"}], "competition": {"checked_at": "2026-10-01"}},
        ]
        picked = [c["id"] for c in competition.pick(channels, budget=10_000)]
        self.assertEqual(picked[:3], ["never", "old", "fresh"])
        self.assertNotIn("stale", picked)
        self.assertNotIn("empty", picked)

    def test_budget_caps_the_batch(self):
        channels = [{"id": str(i), "videos": [{"title": "t"}]} for i in range(50)]
        picked = competition.pick(channels, budget=400)
        self.assertEqual(len(picked), 400 // (100 * competition.PROBES_PER_CHANNEL))


if __name__ == "__main__":
    unittest.main()
