import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';

const bin = process.env.FFMPEG_PATH || 'ffmpeg';
const probeBin = process.env.FFPROBE_PATH || bin.replace(/ffmpeg$/, 'ffprobe');

export function run(args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { ...options, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.on('data', d => { stdout += d; });
    child.stderr.on('data', d => { stderr += d; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve({ stdout, stderr }) : reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-1600)}`)));
  });
}

export async function probe(file) {
  return new Promise((resolve, reject) => {
    const child = spawn(probeBin, ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]);
    let output = ''; let error = '';
    child.stdout.on('data', d => { output += d; });
    child.stderr.on('data', d => { error += d; });
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve(JSON.parse(output)) : reject(new Error(error || `ffprobe exited ${code}`)));
  });
}

export async function duration(file) {
  const p = await probe(file);
  return Number(p.format?.duration || p.streams?.[0]?.duration || 0);
}

export async function ensureFile(file) { await fs.mkdir(file.slice(0, file.lastIndexOf('/')), { recursive: true }); }
