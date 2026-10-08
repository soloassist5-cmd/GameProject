import './landing.css';
import { EchoField } from './echo-field';

new EchoField(document.getElementById('echo-field') as HTMLCanvasElement);

// Big play button: start the trailer with sound and hand over to native controls.
const video = document.getElementById('trailer-video') as HTMLVideoElement;
const play = document.getElementById('video-play')!;
play.addEventListener('click', () => {
  video.muted = false;
  void video.play();
});
video.addEventListener('play', () => play.classList.add('hidden'));
video.addEventListener('ended', () => play.classList.remove('hidden'));

// Reveal sections as they scroll in (CSS hides them only under .js).
document.documentElement.classList.add('js');
const io = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (e.isIntersecting) {
        e.target.classList.add('in');
        io.unobserve(e.target);
      }
    }
  },
  { rootMargin: '0px 0px -10% 0px' },
);
document.querySelectorAll('.section').forEach((el) => io.observe(el));

document.querySelector('.nav')?.classList.toggle('solid', scrollY > 40);
addEventListener('scroll', () => document.querySelector('.nav')?.classList.toggle('solid', scrollY > 40), {
  passive: true,
});
