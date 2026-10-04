// Hands-free Gemini Live voice for whichever worker you are talking to.
// Adapted from dioarama/character/quest-audio.js. Only one worker holds the line at a time.
export class OfficeVoice {
  constructor(state, onEvent) {
    this.state = state; this.onEvent = onEvent;
    this.context = null; this.socket = null; this.ready = false; this.micEnabled = false;
    this.sources = []; this.nextAudio = 0; this.speakingUntil = 0; this.waiting = false;
    this.worker = null; this.lastHuman = -100; this.usd = 0; this.connecting = null;
  }
  get speaking() { return performance.now() < this.speakingUntil; }
  // 0..1 loudness of the worker's voice right now, for lip movement.
  get level() {
    if (!this.analyser || !this.speaking) return 0;
    this.analyser.getFloatTimeDomainData(this.levelData);
    let sum = 0; for (const v of this.levelData) sum += v * v;
    return Math.min(1, Math.sqrt(sum / this.levelData.length) * 6);
  }
  async output() {
    if (!this.context) {
      this.context = new AudioContext({ latencyHint: 'interactive' });
      this.panner = this.context.createPanner();
      Object.assign(this.panner, { panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 1, maxDistance: 12, rolloffFactor: .6 });
      this.analyser = this.context.createAnalyser(); this.analyser.fftSize = 512; this.levelData = new Float32Array(512);
      this.panner.connect(this.analyser); this.analyser.connect(this.context.destination);
    }
    await this.context.resume();
  }
  async prepare() {
    await this.output();
    if (this.stream) return;
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
    this.input = this.context.createMediaStreamSource(this.stream);
    let worklet = true;
    try { await Promise.race([this.context.audioWorklet.addModule('/capture.js'), new Promise((_, reject) => setTimeout(() => reject(Error('fallback')), 1500))]); }
    catch { worklet = false; }
    if (worklet) {
      this.processor = new AudioWorkletNode(this.context, 'capture');
      this.processor.port.onmessage = e => { if (e.data instanceof ArrayBuffer) this.sendAudio(e.data); };
      this.processor.port.postMessage(true);
    } else {
      this.processor = this.context.createScriptProcessor(2048, 1, 1);
      let samples = [], position = 0;
      this.processor.onaudioprocess = e => {
        const input = e.inputBuffer.getChannelData(0); samples.push(...input);
        const ratio = this.context.sampleRate / 16000, out = [];
        while (position + ratio <= samples.length) {
          let sum = 0, n = 0; for (let i = Math.floor(position); i < Math.floor(position + ratio); i++) { sum += samples[i]; n++; }
          out.push(Math.max(-32768, Math.min(32767, Math.round(sum / n * 32767)))); position += ratio;
        }
        const used = Math.floor(position); samples.splice(0, used); position -= used;
        if (out.length) this.sendAudio(new Int16Array(out).buffer);
      };
    }
    this.silent = this.context.createGain(); this.silent.gain.value = 0;
    this.input.connect(this.processor); this.processor.connect(this.silent).connect(this.context.destination);
    this.micEnabled = true;
  }
  sendAudio(data) {
    if (!this.micEnabled) return;
    const pcm = new Int16Array(data); let sum = 0, n = 0;
    for (let i = 0; i < pcm.length; i += 8) { sum += (pcm[i] / 32768) ** 2; n++; }
    if (Math.sqrt(sum / Math.max(n, 1)) > .02) { this.lastHuman = performance.now() / 1000; this.onEvent({ type: 'human_activity' }); }
    if (this.ready && this.socket?.readyState === 1) this.socket.send(data);
  }
  connect(workerId) {
    if (this.worker === workerId && (this.ready || this.connecting)) return this.connecting || Promise.resolve();
    this.connecting = this._connect(workerId).finally(() => { this.connecting = null; });
    return this.connecting;
  }
  async _connect(workerId) {
    await this.close();
    if (!this.stream) await this.prepare();
    this.worker = workerId; this.waiting = false;
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${location.host}/api/live?token=${encodeURIComponent(this.state.token)}&worker=${encodeURIComponent(workerId)}`);
    socket.binaryType = 'arraybuffer'; this.socket = socket;
    this.onEvent({ type: 'connecting', worker: workerId });
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { socket.close(); reject(Error('The voice connection took too long.')); }, 45000);
      socket.onmessage = e => {
        if (e.data instanceof ArrayBuffer) { this.play(e.data); return; }
        const msg = JSON.parse(e.data);
        if (msg.type === 'ready') { this.ready = true; clearTimeout(timer); resolve(); }
        if (msg.type === 'usage') this.usd = msg.dailyUsd;
        if (msg.type === 'interrupted') this.flush();
        if (msg.type === 'transcript' && msg.role === 'user') this.waiting = true;
        if (msg.type === 'turn_complete') this.waiting = false;
        if (msg.type === 'error') { clearTimeout(timer); reject(Error(msg.text)); }
        this.onEvent({ ...msg, worker: workerId });
      };
      socket.onerror = () => { clearTimeout(timer); reject(Error('Voice connection unavailable.')); };
      socket.onclose = () => {
        clearTimeout(timer);
        if (this.socket === socket) { this.socket = null; this.ready = false; this.waiting = false; this.worker = null; this.onEvent({ type: 'closed', worker: workerId }); }
        this.closedResolve?.(); this.closedResolve = null;
        reject(Error('Voice line closed.'));
      };
    });
  }
  play(data) {
    const samples = new Int16Array(data), buffer = this.context.createBuffer(1, samples.length, 24000), channel = buffer.getChannelData(0);
    for (let i = 0; i < samples.length; i++) channel[i] = samples[i] / 32768;
    const source = this.context.createBufferSource(); source.buffer = buffer; source.connect(this.panner);
    const at = Math.max(this.context.currentTime + .04, this.nextAudio); source.start(at);
    this.nextAudio = at + buffer.duration;
    this.speakingUntil = performance.now() + (this.nextAudio - this.context.currentTime) * 1000;
    this.sources.push(source); source.onended = () => { this.sources = this.sources.filter(s => s !== source); };
  }
  flush() {
    for (const s of this.sources) { try { s.stop(); } catch {} }
    this.sources = []; this.nextAudio = this.context?.currentTime || 0; this.speakingUntil = 0;
  }
  send(body) { if (this.ready && this.socket?.readyState === 1) this.socket.send(JSON.stringify(body)); }
  officeEvent(event, extra = {}) { this.send({ type: 'office_event', event, ...extra }); }
  text(text) { this.waiting = true; this.send({ type: 'text', text }); }
  mute(value) {
    this.micEnabled = !value;
    if (value) this.send({ type: 'audio_pause' });
    this.onEvent({ type: 'mic', enabled: this.micEnabled });
  }
  // Place the worker's voice at their head in 3D.
  update(listener, forward, up, source) {
    if (!this.context) return;
    const l = this.context.listener, t = this.context.currentTime;
    const pairs = [[l.positionX, listener.x], [l.positionY, listener.y], [l.positionZ, listener.z], [l.forwardX, forward.x], [l.forwardY, forward.y], [l.forwardZ, forward.z],
      [l.upX, up.x], [l.upY, up.y], [l.upZ, up.z], [this.panner.positionX, source.x], [this.panner.positionY, source.y], [this.panner.positionZ, source.z]];
    for (const [param, value] of pairs) param?.setValueAtTime(value, t);
  }
  async close() {
    const socket = this.socket; if (!socket) return;
    await new Promise(resolve => {
      this.closedResolve = resolve;
      if (socket.readyState === 1) socket.send(JSON.stringify({ type: 'disconnect' })); else socket.close();
      setTimeout(() => { if (socket.readyState !== 3) socket.close(); resolve(); }, 4000);
    });
  }
  async stop() {
    await this.close();
    this.stream?.getTracks().forEach(t => t.stop()); this.input?.disconnect(); this.processor?.disconnect(); this.silent?.disconnect();
    this.stream = null; this.micEnabled = false; this.flush();
  }
}
