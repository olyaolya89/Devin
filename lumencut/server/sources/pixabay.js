export async function search(query) {
  const key = process.env.PIXABAY_API_KEY;
  if (!key) return [];
  const imageUrl = 'https://pixabay.com/api/?' + new URLSearchParams({ key, q: query, image_type: 'photo', orientation: 'horizontal', min_width: '1280' });
  const videoUrl = 'https://pixabay.com/api/videos/?' + new URLSearchParams({ key, q: query });
  const [images, videos] = await Promise.all([fetch(imageUrl), fetch(videoUrl)]);
  if (!images.ok) throw new Error(`images HTTP ${images.status}`);
  if (!videos.ok) throw new Error(`videos HTTP ${videos.status}`);
  const i = (await images.json()).hits || [];
  const v = Object.values((await videos.json()).hits || {});
  return [
    ...i.map(x => ({ source: 'pixabay', kind: 'image', url: x.largeImageURL, thumbUrl: x.webformatURL, width: x.imageWidth, height: x.imageHeight, durationSec: null, title: x.tags || '', description: x.tags || '', author: x.user, license: 'Pixabay', pageUrl: x.pageURL })),
    ...v.map(x => { const f = x.videos?.large || x.videos?.medium; return { source: 'pixabay', kind: 'video', url: f?.url, thumbUrl: x.picture_id ? `https://i.vimeocdn.com/video/${x.picture_id}_640x360.jpg` : '', width: f?.width || 0, height: f?.height || 0, durationSec: x.duration, title: x.tags || '', description: x.tags || '', author: x.user, license: 'Pixabay', pageUrl: `https://pixabay.com/videos/id-${x.id}/` }; })
  ].filter(x => x.url && x.width >= 1000 && x.height <= x.width);
}
