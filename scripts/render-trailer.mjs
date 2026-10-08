#!/usr/bin/env node
/**
 * Bakes the trailer into public/media:
 *   trailer.mp4 (H.264 + AAC), trailer.webm (VP9 + Opus), poster.jpg, og.jpg, shot-1..4.jpg
 *
 * The trailer page (`/trailer/?capture`) is stepped frame by frame in headless
 * Chromium, frames are piped into ffmpeg, and the soundtrack is rendered
 * offline from the very same simulation, so picture and sound match exactly.
 *
 * Usage: npm run trailer:render            (expects a fresh `npm run build`)
 *        npm run trailer:render -- --skip-video   (re-mix audio onto the last render)
 * Needs ffmpeg with libx264 on PATH.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const ROOT = resolve(import.meta.dirname, '..');
const OUT = join(ROOT, 'public', 'media');
const WORK = join(tmpdir(), 'echo-trailer');
const PORT = 4179;
const SIZE = { width: 1280, height: 720 };
const skipVideo = process.argv.includes('--skip-video');

/** Gallery stills and poster, by timestamp in seconds. */
const STILLS = { 'shot-1.jpg': 9.6, 'shot-2.jpg': 22.9, 'shot-3.jpg': 28.4, 'shot-4.jpg': 34.4, 'poster.jpg': 41.5 };

mkdirSync(OUT, { recursive: true });
mkdirSync(WORK, { recursive: true });

const run = (cmd, args) =>
  new Promise((ok, fail) => {
    const p = spawn(cmd, args, { stdio: ['ignore', 'inherit', 'inherit'] });
    p.on('close', (code) => (code === 0 ? ok() : fail(new Error(`${cmd} exited with ${code}`))));
  });

const server = spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], { cwd: ROOT, stdio: 'ignore' });
try {
  await waitForServer(`http://localhost:${PORT}/trailer/`);
  const browser = await chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
  });
  const page = await browser.newPage({ viewport: SIZE });
  page.on('pageerror', (e) => console.error('[page]', e.message));
  await page.goto(`http://localhost:${PORT}/trailer/?capture`);
  await page.waitForFunction(() => document.body.classList.contains('ready'));
  const { fps, frameCount } = await page.evaluate(() => window.capture);

  const wav = join(WORK, 'trailer.wav');
  writeFileSync(wav, Buffer.from(await page.evaluate(() => window.capture.audioWav()), 'base64'));
  console.log('soundtrack rendered');

  const video = join(WORK, 'video.mp4');
  if (!skipVideo || !existsSync(video)) {
    // Low bitrate cap: the look is mostly black, keep the file web-friendly.
    const ff = spawn(
      'ffmpeg',
      ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'image2pipe', '-framerate', String(fps), '-c:v', 'mjpeg',
        '-i', '-', '-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-maxrate', '4M', '-bufsize', '8M',
        '-pix_fmt', 'yuv420p', video],
      { stdio: ['pipe', 'inherit', 'inherit'] },
    );
    const t0 = Date.now();
    for (let f = 0; f < frameCount; f++) {
      await page.evaluate(() => window.capture.advance(true));
      const jpg = await page.screenshot({ type: 'jpeg', quality: 95 });
      if (!ff.stdin.write(jpg)) await new Promise((r) => ff.stdin.once('drain', r));
      if (f % 150 === 0) console.log(`frame ${f}/${frameCount} · ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
    ff.stdin.end();
    await new Promise((r) => ff.on('close', r));
  }
  await browser.close();

  // Mux with a brick-wall limiter at -1 dBFS so trailer hits never clip.
  const mp4 = join(OUT, 'trailer.mp4');
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', video, '-i', wav, '-map', '0:v', '-map', '1:a',
    '-c:v', 'copy', '-af', 'alimiter=limit=0.89:attack=2:release=80', '-c:a', 'aac', '-b:a', '192k', '-shortest',
    '-movflags', '+faststart', mp4]);

  // WebM twin for browsers without H.264 (e.g. open-source Chromium builds).
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-i', video, '-i', wav, '-map', '0:v', '-map', '1:a',
    '-c:v', 'libvpx-vp9', '-crf', '36', '-b:v', '0', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4',
    '-af', 'alimiter=limit=0.89:attack=2:release=80', '-c:a', 'libopus', '-b:a', '160k', '-shortest',
    join(OUT, 'trailer.webm')]);

  for (const [name, t] of Object.entries(STILLS)) {
    await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(t), '-i', mp4, '-frames:v', '1',
      '-q:v', '3', join(OUT, name)]);
  }
  // 1200×630 social card cropped from the logo frame.
  await run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', String(STILLS['poster.jpg']), '-i', mp4,
    '-frames:v', '1', '-vf', 'scale=1200:-1,crop=1200:630', '-q:v', '3', join(OUT, 'og.jpg')]);
  console.log('done →', OUT);
} finally {
  server.kill();
}

async function waitForServer(url) {
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(url)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Preview server did not start at ${url}`);
}
