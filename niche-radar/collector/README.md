# Niche Radar collector

The collector uses the YouTube Data API to find young channels and writes the
static site's data file. The catalogue and collection share the country and
language pairs in [markets.json](markets.json). A channel's primary language
uses the dominant declared audio language when available. The country is the
channel profile setting.

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

## Browser search

**Поиск на YouTube** accepts a topic, language, country, and publication period.
Each search checks up to 50 results, using the declared audio language (falling
back to the declared video language) and the country from the channel profile.
The results summarize public video views and channel statistics. The user
provides a YouTube Data API key, which stays in browser storage.

**Обновить каналы** searches around titles that already performed and also
explores new topics using seed queries. The niche, language, and country filters
limit the run. **Мои находки** shows the channels discovered in this browser.

## Competition

Catalogue competitors share the query channel's niche and primary language.
They must have a country from the supported list for that language.

A YouTube competition reading searches popular titles, verifies each video's
language and its channel's country, and then counts overlapping titles and
rival channels. The channel detail panel can run this check on demand.
Scheduled checks can also be run manually:

```sh
export YOUTUBE_API_KEY="your-key"
python niche-radar/collector/competition.py --data niche-radar/data/channels.json --budget 2000
```

Use `--channel UC...` for a specific channel or `--dry-run` to print query
plans. Only readings tagged with the supported market and verified language
are shown. A search with zero verified videos leaves competition unknown.

Run the browser-side tests without an API key:

```sh
node niche-radar/tests/test-live.mjs
node niche-radar/tests/test-catalogue.mjs
```

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

The collector accounts for a search as 100 internal points and caps discovery
at 75 searches. Enrichment uses a separate 1,500-request budget. Google applies
the API project's quota. A comma-separated key list rotates when a key receives
a `quotaExceeded` response.
