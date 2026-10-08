import './trailer.css';
import { AudioEngine } from '../audio/audio';
import { FixedLoop } from '../core/loop';
import { Renderer } from '../render/renderer';
import { Director, TICK } from './director';
import { createShots } from './shots';
import { encodeWav, toBase64 } from './wav';

const $ = (id: string) => document.getElementById(id)!;

/**
 * Two modes:
 *  - live (default): click to watch, real-time engine + real-time procedural sound;
 *  - `?capture`: frame-stepped by a headless browser to bake the video file,
 *    plus an offline render of the exact same soundtrack.
 */
async function boot(): Promise<void> {
  const capture = new URLSearchParams(location.search).has('capture');
  const renderer = new Renderer();
  await renderer.init($('stage'), { autoStart: !capture });
  await document.fonts.ready;

  if (capture) {
    document.body.classList.add('capture');
    renderer.setGrain(0.02);
    const director = new Director(createShots(), new AudioEngine(), renderer, $('cards'), $('fade'));
    const fps = 30;
    const ticksPerFrame = Math.round(1 / fps / TICK);
    Object.assign(window, {
      capture: {
        fps,
        frameCount: Math.ceil(director.duration * fps),
        duration: director.duration,
        /** Step one video frame; skip the GPU draw when the frame won't be captured. */
        advance(draw = true) {
          for (let i = 0; i < ticksPerFrame; i++) director.step();
          director.frame(1 / fps);
          if (draw) renderer.present();
        },
        async audioWav(): Promise<string> {
          const audio = AudioEngine.offline(director.duration + 1.5);
          const offline = new Director(createShots(), audio, null, null, null);
          while (!offline.done) offline.step();
          return toBase64(encodeWav(await audio.renderOffline()));
        },
      },
    });
    document.body.classList.add('ready');
    return;
  }

  const audio = new AudioEngine();
  let director: Director | null = null;
  const start = () => {
    audio.unlock();
    $('cards').innerHTML = '';
    director = new Director(createShots(), audio, renderer, $('cards'), $('fade'));
    document.body.classList.remove('ended');
    document.body.classList.add('playing');
  };
  $('play').addEventListener('click', start);
  $('replay').addEventListener('click', start);

  new FixedLoop(
    TICK,
    () => {
      if (!director) return;
      director.step();
      if (director.done) {
        document.body.classList.remove('playing');
        document.body.classList.add('ended');
      }
    },
    (dt) => director?.frame(dt),
  ).start();
  document.body.classList.add('ready');
}

boot().catch((err) => {
  console.error(err);
  document.body.innerHTML = `<pre style="color:#f55;padding:24px">${String(err)}</pre>`;
});
