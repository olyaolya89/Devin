# Niche Radar collector

The collector uses the YouTube Data API to find young channels and writes the
static site's data file.

## Run locally

From the repository root:

```sh
export YOUTUBE_API_KEY="your-key"
python niche-radar/collector/collect.py --out niche-radar/data/channels.json
```

Use `--max-queries N` to limit a run, or `--dry-run` to write an empty,
network-free output. Multiple comma-separated API keys may be supplied for
quota rotation.

Queries rotate their start position daily so the search budget samples the
whole seed list over time. `--max-queries` is applied after that rotation.

## The "Обновить каналы" button

`live.js` runs a collection in the browser with the visitor's own API key. It used to take
N queries from the 277-entry seed list, rotated by the day. With the default of 6 that gave
each of the 92 niche×language buckets a turn roughly every 46 runs, so the catalogue spread
instead of deepening: 915 channels scattered so thinly that most niches held one or two and
a competitor count said more about catalogue size than about YouTube.

A run now digs. Two queries in every three take a title that has already performed for a
channel in the catalogue and search it verbatim — the channels publishing that same title
are its real siblings, so this is what fills a cluster out. The third query goes to the seed
list, weighted toward niches that already look alive, to keep finding new ground.

Two things fall out of this for free:

* the same response says how crowded the topic is, so a run also writes `competition` for
  the channels it mined — no extra quota;
* channels already in `channels.json` are not re-fetched, so the quota goes to new finds.

Mining prefers channels whose competition was checked longest ago, so repeated presses
sweep the catalogue instead of re-probing the same few channels.

Each search costs 100 quota units; a free key allows 10,000 a day. Picking a niche or a
language in the filters restricts the run to it.

Run the engine's tests (no API key needed — the YouTube API is stubbed):

```sh
node niche-radar/tests/test-live.mjs
```

## Measure competition on YouTube

The site's "Конкуренты (N)" used to count other channels *in this database* sharing a niche and
a language. That cannot tell you whether a niche is free: the database only holds young channels,
so every rival that grew past the filter vanished from the count, and 900 channels spread over
25 niches and 16 languages leaves buckets of one.

`competition.py` asks YouTube instead — it searches the channel's own best titles and counts how
many other channels publish the same thing, how many of those titles are near-copies, and how
big those rivals are:

```sh
export YOUTUBE_API_KEY="your-key"
python niche-radar/collector/competition.py --data niche-radar/data/channels.json --budget 2000
```

Each probe costs 100 quota units, so the default budget covers ~18 channels. Channels are taken
oldest-check-first, so running it daily sweeps the whole catalogue. `--channel UC...` probes
specific channels, `--dry-run` prints the queries without calling the API.

The result drives the "Конкуренция на YouTube" badge, the `Свободные темы вперёд` sort and the
`Только свободные темы` filter. Channels that have not been probed show "не проверена" and are
never treated as free.

## Seed from NexLev

To seed the site from `/home/ubuntu/nexlev_raw.json` without making API calls:

```sh
python niche-radar/collector/seed_from_nexlev.py --out niche-radar/data/channels.json
```

The script filters young channels, reuses the collector's classification,
metrics, scoring, and merge logic, and preserves existing channel dates.

## GitHub Actions secret

In the repository, open **Settings → Secrets and variables → Actions**, choose
**New repository secret**, name it `YOUTUBE_API_KEY`, and paste the YouTube API
key as its value. The daily workflow reads that secret without exposing it in
logs.

## Quota notes

YouTube search requests cost 100 quota units; channel, playlist, and video
requests cost 1 unit. The collector stops searching at 7,500 units and keeps
enrichment within a separate 1,500-unit budget. A comma-separated key list
rotates when a key receives a `quotaExceeded` response.
