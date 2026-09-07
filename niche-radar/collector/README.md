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
