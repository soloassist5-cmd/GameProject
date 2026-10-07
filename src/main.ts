import './style.css';
import { AudioEngine } from './audio/audio';
import { FixedLoop } from './core/loop';
import { Input } from './input/input';
import { Renderer } from './render/renderer';
import { Hud } from './ui/hud';
import { Game } from './app/game';

async function boot(): Promise<void> {
  const mount = document.getElementById('app')!;
  const renderer = new Renderer();
  await renderer.init(mount);
  const game = new Game(renderer, new AudioEngine(), new Hud(), new Input(renderer.app.canvas));
  // Playtest/debug hook: `?debug` exposes the game object in the console.
  if (new URLSearchParams(location.search).has('debug')) Object.assign(window, { echo: game });
  new FixedLoop(
    1 / 60,
    (dt) => game.update(dt),
    (dt) => game.render(dt),
  ).start();
  document.body.classList.add('ready');
}

boot().catch((err) => {
  console.error(err);
  document.body.innerHTML = `<pre style="color:#f55;padding:24px">Не удалось запустить игру:\n${String(err)}</pre>`;
});
