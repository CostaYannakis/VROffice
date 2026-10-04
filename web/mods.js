// Live mods: small modules in web/mods/ that add things to the office while it runs: props, decorations, lighting,
// accessories on the workers. Save a file and it appears within a second, in the headset too, with no refresh. Edit it and it
// is rebuilt; delete it and it goes away. Each mod default-exports a function that receives `ctx` (see ModContext below)
// and may return a cleanup function. Anything added through ctx is removed automatically when the mod reloads.
import * as THREE from 'three';
import { labelTexture } from './furniture.js';

const BONES = { head: 'Head', torso: 'Torso', left: 'Hand.L', right: 'Hand.R' };

export class ModHost {
  // office: getters into the running office (office group, scene, staff map, DESK sizes, notice()).
  constructor(office) { this.office = office; this.mods = new Map(); this.syncing = null; this.again = false; }

  // Compare web/mods with what is mounted: mount new and changed mods, unmount removed ones.
  sync(force = false) {
    if (this.syncing) { this.again = force || this.again === 'force' ? 'force' : true; return this.syncing; }   // run once more after this one
    this.syncing = (async () => {
      try {
        const r = await fetch(`/api/mods?set=${encodeURIComponent(this.office.modSet || 'enterprise')}`, { cache: 'no-store' }); if (!r.ok) return;
        const { mods } = await r.json(), names = new Set(mods.map(m => m.name));
        for (const name of [...this.mods.keys()]) if (!names.has(name)) { this.unmount(name); this.office.notice(`${pretty(name)} removed.`); }
        for (const { name, version } of mods) if (force || this.mods.get(name)?.version !== version) await this.mount(name, version);
      } catch {} finally {
        this.syncing = null;
        if (this.again) { const forceNext = this.again === 'force'; this.again = false; this.sync(forceNext); }
      }
    })();
    return this.syncing;
  }
  // The office rebuilt desks or bodies (a hot swap): run every mod again so its props land on the new ones.
  remountAll() { for (const [name, entry] of this.mods) this.mount(name, entry.version, true); }

  async mount(name, version, quiet = false) {
    this.unmount(name);
    const entry = { version, objects: [], frames: [], cleanups: [], error: null };
    this.mods.set(name, entry);
    try {
      const module = await import(`./mods/${name}?v=${version}`);
      if (this.mods.get(name) !== entry) return;                  // replaced while loading
      const run = module.default || module.mod;
      if (typeof run !== 'function') throw Error('it needs `export default function (ctx) { ... }`');
      const cleanup = await run(new ModContext(this.office, entry));
      if (typeof cleanup === 'function') entry.cleanups.push(cleanup);
      if (!quiet) this.office.notice(`${pretty(name)} is live.`);
    } catch (error) {
      entry.error = error.message; this.teardown(entry);
      console.error(`mod ${name}:`, error);
      this.office.notice(`${pretty(name)} failed: ${error.message}`);
    }
  }
  unmount(name) { const entry = this.mods.get(name); if (entry) { this.teardown(entry); this.mods.delete(name); } }
  teardown(entry) {
    for (const fn of entry.cleanups.splice(0)) { try { fn(); } catch (error) { console.error(error); } }
    for (const o of entry.objects.splice(0)) {
      o.removeFromParent();
      o.traverse(c => { c.geometry?.dispose(); for (const m of [].concat(c.material || [])) { m.map?.dispose(); m.dispose(); } });
    }
    entry.frames.length = 0;
  }
  update(dt, t) {
    for (const [name, entry] of this.mods) for (const fn of entry.frames) {
      try { fn(dt, t); } catch (error) { entry.frames.splice(entry.frames.indexOf(fn), 1); this.office.notice(`${pretty(name)} stopped: ${error.message}`); }
    }
  }
  disposeAll() { for (const name of [...this.mods.keys()]) this.unmount(name); }
  list() { return [...this.mods].map(([name, e]) => ({ name, error: e.error, objects: e.objects.length })); }
}
const pretty = name => name.replace(/^.*\//, '').replace(/\.js$/, '').replace(/[-_]/g, ' ');

// What a mod gets. Units are metres; the office floor is y = 0. Desk-relative positions: x across the desk (-0.75..0.75),
// z towards the worker's chair (+) or the monitor (-), y up from the desk top when onDesk is true.
class ModContext {
  constructor(office, entry) { this.officeApi = office; this.entry = entry; this.THREE = THREE; }
  get office() { return this.officeApi.office; }
  get scene() { return this.officeApi.scene; }
  get DESK() { return this.officeApi.DESK; }
  // Workers by id: { id, name, status, task } (ids: clyde, dex, ...).
  get workers() { return [...this.officeApi.staff.values()].map(s => ({ id: s.worker.id, name: s.worker.name, status: s.info.status, task: s.info.task, })); }
  worker(id) { return this.workers.find(w => w.id === id || w.name.toLowerCase() === String(id).toLowerCase()) || null; }

  // Put an object in the office. Options: desk (a worker id, to place it relative to their desk), onDesk (y from the desk top),
  // at [x, y, z], rotateY (radians). Returns the object.
  add(object, { desk = null, onDesk = false, at = [0, 0, 0], rotateY = 0 } = {}) {
    let parent = this.office;
    if (desk) {
      const s = this.find(desk);
      if (!s) throw Error(`no desk for "${desk}"`);
      parent = s.desk.group;
    }
    object.position.set(at[0], at[1] + (onDesk ? this.DESK.height : 0), at[2]);
    if (rotateY) object.rotation.y = rotateY;
    parent.add(object); this.track(object);
    return object;
  }
  // Fix an object to a worker's body so it follows them: part is 'head', 'torso', 'left' or 'right' (hands).
  // at is in metres from that part's pivot (head: y up from the neck; hands: along the arm).
  attach(workerId, part, object, { at = [0, 0, 0] } = {}) {
    const s = this.find(workerId); if (!s) throw Error(`no worker "${workerId}"`);
    const bone = s.avatar.bones[BONES[part] || part]; if (!bone) throw Error(`no body part "${part}"`);
    const holder = new THREE.Group(), scale = bone.getWorldScale(new THREE.Vector3()).x || 1;
    holder.scale.setScalar(1 / scale); holder.add(object); object.position.set(...at);
    bone.add(holder); this.track(holder);
    holder.traverse(o => { o.frustumCulled = false; });
    return object;
  }
  // Let the boss drag an object across the floor with a controller trigger or a hand pinch, keeping its height.
  // onMove(object) runs while it is dragged, onEnd(object) when it is let go. Ends when the mod reloads.
  movable(object, { onMove, onEnd } = {}) {
    const set = this.officeApi.movables; if (!set) return object;     // an older office without pointer drags
    object.userData.movable = { onMove, onEnd }; set.add(object);
    this.onCleanup(() => { set.delete(object); delete object.userData.movable; });
    return object;
  }
  // Run fn(dt, t) every frame while the mod is loaded (for animation).
  onFrame(fn) { this.entry.frames.push(fn); }
  // Called when the mod is reloaded or removed.
  onCleanup(fn) { this.entry.cleanups.push(fn); }
  notice(text) { this.officeApi.notice(text); }

  // ----- building blocks -----
  material(color, options = {}) { return new THREE.MeshStandardMaterial({ color, roughness: .45, ...options }); }
  // A toy brick w x h x d (metres) with studs on top, its base at y = 0.
  brick(w, h, d, color, { studs = true, stud = .024 } = {}) {
    const group = new THREE.Group(), material = this.material(color, { roughness: .32 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material); body.position.y = h / 2; group.add(body);
    if (studs) {
      const pitch = stud * 2, nx = Math.max(1, Math.round(w / pitch)), nz = Math.max(1, Math.round(d / pitch));
      const geometry = new THREE.CylinderGeometry(stud * .6, stud * .6, stud * .45, 14);
      for (let i = 0; i < nx; i++) for (let k = 0; k < nz; k++) {
        const s = new THREE.Mesh(geometry, material);
        s.position.set((i - (nx - 1) / 2) * (w / nx), h + stud * .22, (k - (nz - 1) / 2) * (d / nz)); group.add(s);
      }
    }
    return group;
  }
  // A flat text sign (both sides readable), width in metres.
  label(text, { width = .4, color = '#1d232b', background = '#fbfbf8', font = 'bold 64px system-ui, sans-serif' } = {}) {
    const { texture, redraw } = labelTexture(512, 192, (g, c) => {
      g.fillStyle = background; g.fillRect(0, 0, c.width, c.height);
      g.fillStyle = color; g.font = font; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillText(String(text), c.width / 2, c.height / 2, c.width - 40);
    });
    redraw();
    return new THREE.Mesh(new THREE.PlaneGeometry(width, width * 192 / 512), new THREE.MeshBasicMaterial({ map: texture, side: THREE.DoubleSide, toneMapped: false }));
  }

  // internals
  find(id) {
    for (const s of this.officeApi.staff.values()) if (s.worker.id === id || s.worker.name.toLowerCase() === String(id).toLowerCase()) return s;
    return null;
  }
  track(object) { this.entry.objects.push(object); object.traverse(o => { o.userData.mod = true; }); }
}
