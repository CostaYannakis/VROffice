// Synthesised office sounds: slaps, thuds, chimes and a small dance beat. No audio files.
export class Sfx {
  constructor() { this.ctx = null; this.music = null; }
  use(context) { this.ctx = context; this.out = context.createGain(); this.out.gain.value = .8; this.out.connect(context.destination); }
  ensure() { if (!this.ctx) this.use(new AudioContext()); this.ctx.resume(); return this.ctx; }
  // A panner at a world position so sounds come from the worker.
  at(position) {
    const ctx = this.ensure(), p = ctx.createPanner();
    Object.assign(p, { panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 1, rolloffFactor: .8 });
    if (position) { p.positionX.value = position.x; p.positionY.value = position.y; p.positionZ.value = position.z; }
    p.connect(this.out); return p;
  }
  noise(seconds) {
    const ctx = this.ensure(), buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate), data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const source = ctx.createBufferSource(); source.buffer = buffer; return source;
  }
  slap(position, strength = 1) {
    const ctx = this.ensure(), t = ctx.currentTime, source = this.noise(.25), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
    filter.type = 'bandpass'; filter.frequency.value = 1800 + strength * 400; filter.Q.value = .8;
    gain.gain.setValueAtTime(Math.min(1.6, .5 + strength * .35), t); gain.gain.exponentialRampToValueAtTime(.001, t + .16);
    source.connect(filter).connect(gain).connect(this.at(position)); source.start(t); source.stop(t + .25);
  }
  thud(position, strength = 1) {
    const ctx = this.ensure(), t = ctx.currentTime, osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.frequency.setValueAtTime(140, t); osc.frequency.exponentialRampToValueAtTime(40, t + .25);
    gain.gain.setValueAtTime(Math.min(1.2, .4 + strength * .2), t); gain.gain.exponentialRampToValueAtTime(.001, t + .3);
    osc.connect(gain).connect(this.at(position)); osc.start(t); osc.stop(t + .32);
    const click = this.noise(.05), g2 = ctx.createGain(); g2.gain.setValueAtTime(.3, t); g2.gain.exponentialRampToValueAtTime(.001, t + .05);
    click.connect(g2).connect(this.at(position)); click.start(t);
  }
  tone(position, notes, type = 'sine', length = .18, volume = .25) {
    const ctx = this.ensure(), t = ctx.currentTime, out = this.at(position);
    notes.forEach((frequency, i) => {
      const osc = ctx.createOscillator(), gain = ctx.createGain(), start = t + i * length * .8;
      osc.type = type; osc.frequency.value = frequency;
      gain.gain.setValueAtTime(0, start); gain.gain.linearRampToValueAtTime(volume, start + .01); gain.gain.exponentialRampToValueAtTime(.001, start + length * 1.6);
      osc.connect(gain).connect(out); osc.start(start); osc.stop(start + length * 1.7);
    });
  }
  done(position) { this.tone(position, [784, 1046], 'sine', .16, .22); }
  attention(position) { this.tone(position, [988, 740, 988], 'triangle', .12, .18); }
  click(position) { this.tone(position, [2200], 'square', .02, .05); }
  pop(position) { this.tone(position, [520, 880], 'sine', .06, .15); }
  bark(position) { this.tone(position, [620, 880], 'square', .05, .09); }
  yelp(position) { this.tone(position, [1500, 1100, 800], 'sawtooth', .045, .1); }
  // Toy blaster "pew": a fast falling square sweep.
  laser(position) {
    const ctx = this.ensure(), t = ctx.currentTime, osc = ctx.createOscillator(), gain = ctx.createGain();
    osc.type = 'square'; osc.frequency.setValueAtTime(1900, t); osc.frequency.exponentialRampToValueAtTime(240, t + .2);
    gain.gain.setValueAtTime(.16, t); gain.gain.exponentialRampToValueAtTime(.001, t + .22);
    osc.connect(gain).connect(this.at(position)); osc.start(t); osc.stop(t + .24);
  }
  // A drone bursting: a short crackle of noise over a low pop.
  boom(position) {
    const ctx = this.ensure(), t = ctx.currentTime, out = this.at(position), source = this.noise(.35), filter = ctx.createBiquadFilter(), gain = ctx.createGain();
    filter.type = 'lowpass'; filter.frequency.setValueAtTime(3200, t); filter.frequency.exponentialRampToValueAtTime(300, t + .3);
    gain.gain.setValueAtTime(.7, t); gain.gain.exponentialRampToValueAtTime(.001, t + .32);
    source.connect(filter).connect(gain).connect(out); source.start(t);
    const osc = ctx.createOscillator(), g2 = ctx.createGain();
    osc.frequency.setValueAtTime(220, t); osc.frequency.exponentialRampToValueAtTime(50, t + .2);
    g2.gain.setValueAtTime(.5, t); g2.gain.exponentialRampToValueAtTime(.001, t + .25);
    osc.connect(g2).connect(out); osc.start(t); osc.stop(t + .27);
  }
  // Four-on-the-floor loop until stopMusic().
  startMusic(seconds = 20) {
    const ctx = this.ensure(); this.stopMusic();
    const bpm = 118, beat = 60 / bpm, start = ctx.currentTime + .05, bus = ctx.createGain(); bus.gain.value = .55; bus.connect(this.out);
    const bass = [55, 55, 65.4, 73.4, 55, 55, 82.4, 73.4];
    const stopAt = start + seconds;
    for (let i = 0, t = start; t < stopAt; i++, t = start + i * beat / 2) {
      if (i % 2 === 0) {           // kick
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.frequency.setValueAtTime(150, t); o.frequency.exponentialRampToValueAtTime(45, t + .12);
        g.gain.setValueAtTime(.9, t); g.gain.exponentialRampToValueAtTime(.001, t + .2); o.connect(g).connect(bus); o.start(t); o.stop(t + .22);
      } else {                    // hat
        const n = this.noise(.05), f = ctx.createBiquadFilter(), g = ctx.createGain(); f.type = 'highpass'; f.frequency.value = 7000;
        g.gain.setValueAtTime(.25, t); g.gain.exponentialRampToValueAtTime(.001, t + .05); n.connect(f).connect(g).connect(bus); n.start(t);
      }
      const o = ctx.createOscillator(), g = ctx.createGain(); o.type = 'sawtooth'; o.frequency.value = bass[(i >> 1) % 8] * (i % 2 ? 2 : 1);
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 700;
      g.gain.setValueAtTime(.14, t); g.gain.exponentialRampToValueAtTime(.001, t + beat / 2 * .9); o.connect(lp).connect(g).connect(bus); o.start(t); o.stop(t + beat / 2);
    }
    this.music = { bus, until: stopAt };
  }
  stopMusic() {
    if (!this.music) return;
    const { bus } = this.music; this.music = null;
    bus.gain.setTargetAtTime(0, this.ctx.currentTime, .05); setTimeout(() => bus.disconnect(), 300);
  }
  get playing() { return !!this.music && this.ctx.currentTime < this.music.until; }
}
