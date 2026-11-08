import fs from 'node:fs/promises';
import path from 'node:path';

export async function layout(project, dir) {
  project.timeline = project.scenes.map(scene => ({
    sceneId: scene.id, startMs: scene.startMs, endMs: scene.endMs,
    media: { kind: scene.pick?.kind || 'placeholder', path: scene.mediaPath || null },
    kenBurns: { zoomFrom: 1, zoomTo: 1.08 }, subtitle: scene.text,
    ...(scene.index === 0 ? { title: project.title } : {})
  }));
  await fs.writeFile(path.join(dir, 'timeline.json'), JSON.stringify(project.timeline, null, 2));
}
