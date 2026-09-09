export async function search(query) {
  const url = 'https://api.openverse.org/v1/images/?' + new URLSearchParams({ q: query, page_size: '20', license_type: 'commercial,modification' });
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return (data.results || []).map(item => ({ source: 'openverse', kind: 'image', url: item.url, thumbUrl: item.thumbnail || item.url, width: item.width || 0, height: item.height || 0, durationSec: null, title: item.title || '', description: item.description || '', author: item.creator || '', license: item.license || '', pageUrl: item.foreign_landing_url || item.url })).filter(x => x.url && x.width >= 1000 && x.height <= x.width);
}
