// The permanent part of the office page: the renderer, the passthrough session and the frame loop.
// The office itself (office.js and everything it imports) runs inside it and is replaced live whenever office.js,
// voice.js or termview.js change: the old office tears itself down and hands over the session, the office's place
// in your room, the voice line and the audio, and the new office carries on in the same passthrough session.
// A new office.js that fails to load leaves the running one in place. Only office.html or shell.js changes need a reload.
import * as THREE from 'three';

const $ = id => document.getElementById(id);
const CORE = ['office.js', 'voice.js', 'termview.js'];   // changes to these replace the whole office app

class Shell {
  constructor() {
    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    r.setPixelRatio(Math.min(devicePixelRatio, 2)); r.setClearColor(0x1a2330, 1);
    r.xr.enabled = true; r.xr.setReferenceSpaceType('local-floor'); r.xr.setFoveation(.5);
    r.outputColorSpace = THREE.SRGBColorSpace; r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.05;
    $('stage').append(r.domElement);
    this.session = null; this.app = null; this.pending = null; this.stamps = null; this.lastCheck = 0;
    this.loading = false; this.loadAgain = false; this.generation = 0;
    r.setAnimationLoop((ms, frame) => this.frame(ms, frame));
  }

  frame(ms, frame) {
    if (this.app) { try { this.app.frame(ms, frame); } catch (error) { console.error(error); } }
    else if (!this.session) this.renderer.clear();
    // Timers are throttled while the headset shows passthrough, but XR frames keep coming: check for core changes from here too.
    if (performance.now() - this.lastCheck > 3000) this.check();
  }

  // Passthrough is owned here, so it survives office swaps.
  // mode: 'immersive-vr' (the walled virtual office) or 'immersive-ar' (passthrough). baseSpace is the session's own
  // floor-level space, kept here so moving around (an offset of it) carries across office swaps.
  async startSession(init, offered = null, mode = 'immersive-ar') {
    const session = offered || await navigator.xr.requestSession(mode, init);
    this.renderer.xr.setReferenceSpace(null);             // drop any offset left from a previous session
    await this.renderer.xr.setSession(session);
    this.session = session; this.baseSpace = this.renderer.xr.getReferenceSpace();
    session.addEventListener('end', () => {
      if (this.session === session) { this.session = null; this.baseSpace = null; this.renderer.xr.setReferenceSpace(null); }
      this.app?.sessionEnded?.(session);
    });
    return session;
  }

  // office.js calls this when it is imported; load() then starts it.
  register(app) { this.pending = app; }

  async load(initial = false) {
    if (this.loading) { this.loadAgain = true; return; }
    this.loading = true;
    try {
      this.pending = null;
      try { await import(`./office.js?v=${Date.now()}`); }
      catch (error) { console.error(error); this.notice(`Office update did not load, keeping the running one: ${error.message}`); return; }
      const next = this.pending;
      if (!next) { this.notice('office.js loaded but did not register with the shell.'); return; }
      const old = this.app;
      this.app = null;                                       // no frames into a half torn-down office
      let carry = null;
      if (old) { try { carry = await old.dispose(); } catch (error) { console.error(error); } }
      try { await next.start(carry); }
      catch (error) { console.error(error); this.notice(`Office update failed to start: ${error.message}`); }
      this.app = next; this.generation++;
      if (!initial) next.notice?.('Office updated live.');
    } finally {
      this.loading = false;
      if (this.loadAgain) { this.loadAgain = false; this.load(); }
    }
  }

  // Compare the core files' ETags; a change reloads the office app. office.js also calls codeChanged() as soon as the
  // server reports a change, so this usually runs within a second of a save.
  async check() {
    this.lastCheck = performance.now();
    if (this.checking) return;
    this.checking = true;
    try {
      const stamps = await Promise.all(CORE.map(f => fetch('/' + f, { cache: 'no-store' })
        .then(r => { r.body?.cancel(); return r.ok ? r.headers.get('etag') || '' : null; })));
      if (stamps.includes(null)) return;                     // server restarting: try again later
      const changed = this.stamps && stamps.some((s, i) => s !== this.stamps[i]);
      this.stamps = stamps;
      if (changed && this.app) this.load();
    } catch {} finally { this.checking = false; }
  }
  codeChanged(files = []) { if (files.some(f => CORE.includes(f))) this.check(); }
  notice(text) { const n = $('notice'); if (n) n.textContent = text; }
}

const shell = window.officeShell = new Shell();
shell.check();
shell.load(true);
