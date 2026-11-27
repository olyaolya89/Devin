import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

export const ROOT = path.resolve(process.cwd());
export const DATA = path.join(ROOT, 'data');
export const PROJECTS = path.join(DATA, 'projects');

export async function ensureProjectDirs(id) {
  const dir = path.join(PROJECTS, id);
  await Promise.all([
    fs.mkdir(path.join(dir, 'audio'), { recursive: true }),
    fs.mkdir(path.join(dir, 'media'), { recursive: true }),
    fs.mkdir(path.join(dir, 'clips'), { recursive: true }),
    fs.mkdir(path.join(dir, 'render'), { recursive: true })
  ]);
  return dir;
}

export function projectDir(id) { return path.join(PROJECTS, id); }
export function projectFile(id) { return path.join(projectDir(id), 'project.json'); }

export async function saveProject(project) {
  project.updatedAt = new Date().toISOString();
  await ensureProjectDirs(project.id);
  await fs.writeFile(projectFile(project.id), JSON.stringify(project, null, 2));
  return project;
}

export async function getProject(id) {
  try { return JSON.parse(await fs.readFile(projectFile(id), 'utf8')); } catch { return null; }
}

export async function listProjects() {
  await fs.mkdir(PROJECTS, { recursive: true });
  const names = await fs.readdir(PROJECTS);
  const projects = await Promise.all(names.map(getProject));
  return projects.filter(Boolean).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export async function deleteProject(id) {
  await fs.rm(projectDir(id), { recursive: true, force: true });
}

export function newId() {
  return `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
}

export function log(project, step, msg) {
  project.log ||= [];
  project.log.push({ ts: new Date().toISOString(), step, msg });
}
