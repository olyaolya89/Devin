import { getConfig } from '../settings.js';

export async function search(query) {
  const { pexelsApiKey: key } = await getConfig();
  if (!key) return [];
  const headers = { Authorization: key };
  const [images, videos] = await Promise.all([
    fetch('https://api.pexels.com/v1/search?' + new URLSearchParams({ query, per_page: '15', orientation: 'landscape' }), { headers }),
    fetch('https://api.pexels.com/videos/search?' + new URLSearchParams({ query, per_page: '10', orientation: 'landscape' }), { headers })
  ]);
  if (!images.ok) throw new Error(`images HTTP ${images.status}`);
  if (!videos.ok) throw new Error(`videos HTTP ${videos.status}`);
  const i = (await images.json()).photos || [];
  const v = (await videos.json()).videos || [];
  return [
    ...i.map(x => ({ source: 'pexels', kind: 'image', url: x.src.original, thumbUrl: x.src.medium, width: x.width, height: x.height, durationSec: null, title: x.alt || '', description: x.alt || '', author: x.photographer, license: 'Pexels', pageUrl: x.url })),
    ...v.map(x => ({ source: 'pexels', kind: 'video', url: (x.video_files || []).sort((a, b) => (b.width || 0) - (a.width || 0))[0]?.link, thumbUrl: x.image, width: x.width, height: x.height, durationSec: x.duration, title: '', description: '', author: x.user?.name || '', license: 'Pexels', pageUrl: x.url }))
  ].filter(x => x.url && x.width >= 1000 && x.height <= x.width);
}
