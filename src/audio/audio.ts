import { clamp, type Vec2 } from '../core/math';

/**
 * Fully procedural audio: every sound is synthesized with Web Audio,
 * spatialised relative to the player and sent into a cave reverb.
 * In a game about echoes, sound is half of the visuals.
 */
export class AudioEngine {
  private ctx: BaseAudioContext | null = null;
  /** Offline mode: the time (s) new sounds get scheduled at. Null = live, use currentTime. */
  private clock: number | null = null;
  private master!: GainNode;
  private dry!: GainNode;
  private reverbIn!: GainNode;
  private noise!: AudioBuffer;
  private beaconGain!: GainNode;
  private beaconPan!: StereoPannerNode;
  private listener: Vec2 = { x: 0, y: 0 };
  private muted = false;

  get ready(): boolean {
    return this.ctx !== null;
  }

  /** Must be called from a user gesture (browser autoplay policy). */
  unlock(): void {
    if (this.ctx) {
      if (this.ctx instanceof AudioContext && this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    this.build(new AC());
  }

  /**
   * An engine that renders into a buffer instead of the speakers —
   * used to bake the trailer soundtrack frame-accurately.
   */
  static offline(seconds: number, sampleRate = 48000): AudioEngine {
    const engine = new AudioEngine();
    engine.clock = 0;
    engine.build(new OfflineAudioContext(2, Math.ceil(seconds * sampleRate), sampleRate));
    return engine;
  }

  /** Offline mode: schedule subsequent sounds at time `t` seconds. */
  seek(t: number): void {
    this.clock = t;
  }

  renderOffline(): Promise<AudioBuffer> {
    if (!(this.ctx instanceof OfflineAudioContext)) throw new Error('Not an offline engine');
    return this.ctx.startRendering();
  }

  private now(): number {
    return this.clock ?? this.ctx!.currentTime;
  }

  private build(ctx: BaseAudioContext): void {
    this.ctx = ctx;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    this.master = ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(comp).connect(ctx.destination);

    this.dry = ctx.createGain();
    this.dry.connect(this.master);

    const convolver = ctx.createConvolver();
    convolver.buffer = this.impulse(3.2, 2.6);
    const wet = ctx.createGain();
    wet.gain.value = 0.55;
    this.reverbIn = ctx.createGain();
    this.reverbIn.connect(convolver).connect(wet).connect(this.master);

    this.noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;

    this.startAmbience();
    this.startBeacon();
  }

  toggleMute(): boolean {
    this.muted = !this.muted;
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.8, this.now(), 0.05);
    return this.muted;
  }

  setListener(p: Vec2): void {
    this.listener = p;
  }

  /** Beacon hum loudness/pan follows the exit — navigate by ear. */
  updateBeacon(exit: Vec2, active: boolean): void {
    if (!this.ctx) return;
    const { gain, pan } = this.spatial(exit, 520);
    const t = this.now();
    this.beaconGain.gain.setTargetAtTime(active ? gain * 0.09 : 0, t, 0.15);
    this.beaconPan.pan.setTargetAtTime(pan, t, 0.15);
  }

  // --- Sound effects -------------------------------------------------------

  step(at: Vec2, soft: boolean): void {
    this.noiseHit(at, {
      gain: soft ? 0.12 : 0.3,
      type: 'bandpass',
      freq: soft ? 500 : 750 + Math.random() * 250,
      q: 1.4,
      decay: soft ? 0.05 : 0.08,
      reverb: soft ? 0.15 : 0.35,
    });
  }

  clap(at: Vec2): void {
    this.noiseHit(at, { gain: 0.9, type: 'highpass', freq: 1100, q: 0.7, decay: 0.09, reverb: 1.2 });
    this.noiseHit(at, { gain: 0.5, type: 'bandpass', freq: 2200, q: 2, decay: 0.03, reverb: 0.6, delay: 0.012 });
  }

  intro(at: Vec2): void {
    this.tone(at, { type: 'sine', from: 660, to: 640, gain: 0.08, decay: 1.6, reverb: 1.4 });
    this.tone(at, { type: 'sine', from: 990, to: 960, gain: 0.05, decay: 1.4, reverb: 1.4, delay: 0.06 });
  }

  throwStone(at: Vec2): void {
    this.tone(at, { type: 'sine', from: 900, to: 400, gain: 0.05, decay: 0.25, reverb: 0.1 });
  }

  stoneLand(at: Vec2): void {
    this.noiseHit(at, { gain: 0.6, type: 'bandpass', freq: 2600, q: 6, decay: 0.05, reverb: 0.9 });
    this.tone(at, { type: 'triangle', from: 180, to: 90, gain: 0.25, decay: 0.12, reverb: 0.5 });
  }

  enemyStep(at: Vec2): void {
    this.tone(at, { type: 'sine', from: 70, to: 45, gain: 0.5, decay: 0.18, reverb: 0.4, range: 420 });
    this.noiseHit(at, { gain: 0.12, type: 'lowpass', freq: 300, q: 1, decay: 0.1, reverb: 0.3, range: 420 });
  }

  enemyAlert(at: Vec2): void {
    this.tone(at, { type: 'sawtooth', from: 1400, to: 260, gain: 0.32, decay: 0.7, reverb: 1, filter: 1800, range: 900 });
    this.tone(at, { type: 'sawtooth', from: 1460, to: 240, gain: 0.22, decay: 0.75, reverb: 1, filter: 1600, range: 900 });
  }

  death(): void {
    const at = this.listener;
    this.tone(at, { type: 'sine', from: 120, to: 30, gain: 0.9, decay: 1.4, reverb: 1 });
    this.noiseHit(at, { gain: 0.7, type: 'lowpass', freq: 900, q: 0.5, decay: 1.2, reverb: 1.4 });
  }

  win(): void {
    const at = this.listener;
    [392, 523.25, 659.25, 783.99].forEach((f, i) =>
      this.tone(at, { type: 'triangle', from: f, to: f, gain: 0.16, decay: 2.2, reverb: 1.2, delay: i * 0.09 }),
    );
  }

  // --- Trailer score (non-spatial) ----------------------------------------

  heartbeat(intensity = 1): void {
    const at = this.listener;
    for (const [delay, g] of [
      [0, 1],
      [0.28, 0.7],
    ] as const) {
      this.tone(at, { type: 'sine', from: 62, to: 34, gain: 0.85 * g * intensity, decay: 0.32, reverb: 0.25, delay });
    }
  }

  /** Massive detuned brass-like swell — the trailer "BRAAM". */
  braam(duration = 2.4, gain = 0.5): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = this.now();
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.value = 2;
    filter.frequency.setValueAtTime(160, t);
    filter.frequency.exponentialRampToValueAtTime(1500, t + 0.25);
    filter.frequency.exponentialRampToValueAtTime(260, t + duration);
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(gain, t + 0.12);
    amp.gain.setTargetAtTime(gain * 0.6, t + 0.3, 0.4);
    amp.gain.exponentialRampToValueAtTime(0.001, t + duration);
    filter.connect(amp);
    amp.connect(this.dry);
    amp.connect(this.reverbIn);
    for (const [f, detune] of [
      [41.2, 0],
      [41.2, 14],
      [82.4, -9],
      [123.5, 6],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      osc.frequency.value = f;
      osc.detune.value = detune;
      osc.connect(filter);
      osc.start(t);
      osc.stop(t + duration + 0.1);
    }
    this.tone(this.listener, { type: 'sine', from: 55, to: 38, gain: 0.7, decay: duration * 0.8, reverb: 0.2 });
  }

  /** Short percussive impact for hard cuts. */
  hit(gain = 1): void {
    const at = this.listener;
    this.tone(at, { type: 'sine', from: 95, to: 28, gain: 0.9 * gain, decay: 0.9, reverb: 0.4 });
    this.noiseHit(at, { gain: 0.6 * gain, type: 'lowpass', freq: 1400, q: 0.6, decay: 0.45, reverb: 1.2 });
  }

  /** Rising noise + pitch sweep that slams into silence. */
  riser(duration = 2): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = this.now();
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 3;
    bp.frequency.setValueAtTime(250, t);
    bp.frequency.exponentialRampToValueAtTime(7000, t + duration);
    const osc = ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(110, t);
    osc.frequency.exponentialRampToValueAtTime(880, t + duration);
    const oscGain = ctx.createGain();
    oscGain.gain.value = 0.12;
    const amp = ctx.createGain();
    amp.gain.setValueAtTime(0.0001, t);
    amp.gain.exponentialRampToValueAtTime(0.5, t + duration);
    amp.gain.setValueAtTime(0, t + duration);
    src.connect(bp).connect(amp);
    osc.connect(oscGain).connect(amp);
    amp.connect(this.dry);
    amp.connect(this.reverbIn);
    src.start(t);
    osc.start(t);
    src.stop(t + duration + 0.05);
    osc.stop(t + duration + 0.05);
  }

  /** Slow, hopeful pad for the logo. */
  pad(duration = 6): void {
    const at = this.listener;
    [110, 164.8, 220, 261.6, 329.6].forEach((f, i) =>
      this.tone(at, { type: 'triangle', from: f, to: f, gain: 0.07, decay: duration, reverb: 1.5, delay: i * 0.04 }),
    );
  }

  // --- Building blocks -----------------------------------------------------

  private spatial(at: Vec2, range = 600): { gain: number; pan: number } {
    const dx = at.x - this.listener.x;
    const dy = at.y - this.listener.y;
    const d = Math.hypot(dx, dy);
    const gain = clamp(1 - d / range, 0, 1) ** 1.6;
    return { gain, pan: clamp(dx / 320, -0.9, 0.9) };
  }

  private route(source: AudioNode, at: Vec2, gain: number, reverb: number, range?: number): GainNode | null {
    const ctx = this.ctx!;
    const s = this.spatial(at, range);
    if (s.gain <= 0.001) return null;
    const amp = ctx.createGain();
    const pan = ctx.createStereoPanner();
    pan.pan.value = s.pan;
    source.connect(amp).connect(pan);
    const dry = ctx.createGain();
    dry.gain.value = gain * s.gain;
    pan.connect(dry).connect(this.dry);
    const wet = ctx.createGain();
    // Distant sounds are relatively wetter — sells the size of the cave.
    wet.gain.value = gain * reverb * Math.sqrt(s.gain);
    pan.connect(wet).connect(this.reverbIn);
    return amp;
  }

  private noiseHit(
    at: Vec2,
    o: { gain: number; type: BiquadFilterType; freq: number; q: number; decay: number; reverb: number; delay?: number; range?: number },
  ): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const filter = ctx.createBiquadFilter();
    filter.type = o.type;
    filter.frequency.value = o.freq;
    filter.Q.value = o.q;
    src.connect(filter);
    const amp = this.route(filter, at, o.gain, o.reverb, o.range);
    if (!amp) return;
    const t = this.now() + (o.delay ?? 0);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(1, t + 0.004);
    amp.gain.exponentialRampToValueAtTime(0.001, t + o.decay);
    src.start(t, Math.random() * 0.5);
    src.stop(t + o.decay + 0.05);
  }

  private tone(
    at: Vec2,
    o: { type: OscillatorType; from: number; to: number; gain: number; decay: number; reverb: number; delay?: number; filter?: number; range?: number },
  ): void {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const osc = ctx.createOscillator();
    osc.type = o.type;
    let out: AudioNode = osc;
    if (o.filter) {
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = o.filter;
      osc.connect(f);
      out = f;
    }
    const amp = this.route(out, at, o.gain, o.reverb, o.range);
    if (!amp) return;
    const t = this.now() + (o.delay ?? 0);
    osc.frequency.setValueAtTime(o.from, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.to), t + o.decay);
    amp.gain.setValueAtTime(0, t);
    amp.gain.linearRampToValueAtTime(1, t + 0.01);
    amp.gain.exponentialRampToValueAtTime(0.001, t + o.decay);
    osc.start(t);
    osc.stop(t + o.decay + 0.05);
  }

  private startAmbience(): void {
    const ctx = this.ctx!;
    const bus = ctx.createGain();
    bus.gain.value = 0.0;
    bus.gain.linearRampToValueAtTime(0.07, this.now() + 4);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 240;
    bus.connect(lp).connect(this.master);
    lp.connect(this.reverbIn);

    for (const [f, detune] of [
      [55, 0],
      [82.4, 7],
      [110.5, -5],
    ] as const) {
      const osc = ctx.createOscillator();
      osc.frequency.value = f;
      osc.detune.value = detune;
      const g = ctx.createGain();
      g.gain.value = 0.5;
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.05 + Math.random() * 0.08;
      const lfoAmt = ctx.createGain();
      lfoAmt.gain.value = 0.35;
      lfo.connect(lfoAmt).connect(g.gain);
      osc.connect(g).connect(bus);
      osc.start();
      lfo.start();
    }

    const wind = ctx.createBufferSource();
    wind.buffer = this.noise;
    wind.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 380;
    bp.Q.value = 0.8;
    const wg = ctx.createGain();
    wg.gain.value = 0.35;
    wind.connect(bp).connect(wg).connect(bus);
    wind.start();
  }

  private startBeacon(): void {
    const ctx = this.ctx!;
    this.beaconGain = ctx.createGain();
    this.beaconGain.gain.value = 0;
    this.beaconPan = ctx.createStereoPanner();
    this.beaconGain.connect(this.beaconPan).connect(this.master);
    this.beaconPan.connect(this.reverbIn);
    const trem = ctx.createGain();
    trem.gain.value = 0.6;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 1 / 2.6;
    const lfoAmt = ctx.createGain();
    lfoAmt.gain.value = 0.4;
    lfo.connect(lfoAmt).connect(trem.gain);
    trem.connect(this.beaconGain);
    for (const f of [220, 330, 440.5]) {
      const osc = ctx.createOscillator();
      osc.type = f === 220 ? 'triangle' : 'sine';
      osc.frequency.value = f;
      osc.connect(trem);
      osc.start();
    }
    lfo.start();
  }

  private impulse(seconds: number, decay: number): AudioBuffer {
    const ctx = this.ctx!;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return buf;
  }
}
