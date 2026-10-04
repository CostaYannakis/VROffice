import * as THREE from 'three';
import { OrbitControls } from './vendor/OrbitControls.js';
import { TermClient, TerminalCanvas } from './termview.js';
import { OfficeVoice } from './voice.js';
import { Sfx } from './sfx.js';
import { makeDesk, makeEmptyDesk, makeBigScreen, labelTexture, DESK } from './furniture.js';
import { Avatar, loadKit } from './avatar.js';
import { HandRig } from './hands.js';
import { Room } from './room.js';
import { makeWallClock } from './clock.js';
import { makeWhiteboard } from './whiteboard.js';
import { ModHost } from './mods.js';
import { makeEnvironment } from './environment.js';
import { Locomotion } from './locomotion.js';
import { OfficeDog } from './dog.js';
import { Blaster } from './blaster.js';
import { Flyers } from './flyers.js';

const $ = id => document.getElementById(id);
const LAYOUT_KEY = 'brick-office-layout-v1';
// The page shell (shell.js) owns the renderer, the passthrough session and the frame loop, and swaps this module for a new
// copy when it changes. Everything this office starts (sockets, timers, listeners, the scene) is undone in disposeApp().
const shell = window.officeShell || null;
const cleanups = [];
const later = fn => cleanups.push(fn);
let disposed = false, carried = null, eventsSocket = null;
// VR (default): a walled virtual office you move around with thumbsticks or teleport. ?passthrough: the office in your real room.
const VR = !new URLSearchParams(location.search).has('passthrough');
let environment = null, locomotion = null;
// Office mode. Enterprise: the furnished office (dog, whiteboard, clock, blasters and target drones, its own mods in web/mods).
// Sandbox: an empty room with the two agents, for building whatever you like (mods in web/mods/sandbox).
// Chosen on the panel or the wrist menu, remembered per device; ?mode=sandbox|enterprise overrides.
const MODES = {
  enterprise: { label: 'Enterprise', dog: true, clock: true, whiteboard: true, blasters: true, furnished: true },
  sandbox: { label: 'Sandbox', dog: false, clock: false, whiteboard: false, blasters: false, furnished: false },
};
const MODE_KEY = 'brick-office-mode';
const OFFICE_MODE = (() => {
  const asked = new URLSearchParams(location.search).get('mode'); if (MODES[asked]) return asked;
  try { const saved = localStorage.getItem(MODE_KEY); if (MODES[saved]) return saved; } catch {}
  return 'enterprise';
})();
const PROFILE = MODES[OFFICE_MODE];
// Switch modes by swapping in a fresh office (no page reload, so VR carries on).
function setOfficeMode(mode) {
  if (!MODES[mode] || mode === OFFICE_MODE) return;
  try { localStorage.setItem(MODE_KEY, mode); } catch {}
  const url = new URL(location.href);
  if (url.searchParams.has('mode')) { url.searchParams.set('mode', mode); history.replaceState(null, '', url); }
  notice(`Switching to ${MODES[mode].label}…`);
  if (shell) shell.load(); else location.reload();
}
let sfx = new Sfx();
const clock = new THREE.Clock(), raycaster = new THREE.Raycaster();
const head = new THREE.Vector3(), headQuat = new THREE.Quaternion(), gaze = new THREE.Vector3(), headUp = new THREE.Vector3();
const staff = new Map();     // id -> { worker, client, view, desk, avatar, info, lastDraw, touch }
const emptyDesks = new Map();
let state, renderer, scene, camera, orbit, office, floor, session, voice, hands, bigScreen, menu, caption, kit;
let focusId = null, candidate = null, candidateSince = 0, voiceOn = false, arranging = false, bigFor = null;
let layout = loadLayout(), officeAnchor = null, anchorPending = false, firstFrame = false, lastConnectTry = 0;
let wallClock, updateReady = false, room, fittedVersion = -1, boundedSpace = null, boundedAsked = false, dog;
let questBattery = null;
let mouseHeld = null, lastStatusText = '', lastFrameError = '', blasters = [], flyers = null;
const movables = new Set();   // things the pointer can drag over the floor: mod props (ctx.movable) and the whiteboard

function notice(text) { $('notice').textContent = text; }
function setStatus(text) { if (text !== lastStatusText) { lastStatusText = text; $('status').textContent = text; } }
function loadLayout() { try { return JSON.parse(localStorage.getItem(LAYOUT_KEY)) || {}; } catch { return {}; } }
function saveLayout() {
  layout.desks = Object.fromEntries([...staff].map(([id, s]) => [id, { x: s.desk.group.position.x, z: s.desk.group.position.z, yaw: s.desk.group.rotation.y }]));
  layout.emptyDesks = Object.fromEntries([...emptyDesks].map(([id, d]) => [id, { x: d.group.position.x, z: d.group.position.z, yaw: d.group.rotation.y }]));
  try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)); } catch {}
  shareLayout(true);
}
// ---------------- shared desk layout ----------------
// The server holds one layout for every open office page. Moves go out while a desk is dragged and once on release;
// moves from another page (desktop preview or headset) slide the desks here. The anchor stays per headset.
const CLIENT_ID = Math.random().toString(36).slice(2, 12);
let lastLayoutSend = 0;
const spotOf = g => ({ x: g.position.x, z: g.position.z, yaw: g.rotation.y });
function shareLayout(final) {
  lastLayoutSend = now();
  const desks = Object.fromEntries([...staff].map(([id, s]) => [id, spotOf(s.desk.group)]));
  const empty = Object.fromEntries([...emptyDesks].map(([id, d]) => [id, spotOf(d.group)]));
  fetch('/api/layout', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Office-Token': state?.token || '' }, body: JSON.stringify({ client: CLIENT_ID, final, desks, emptyDesks: empty }) }).catch(() => {});
}
function draggedDesks() {
  const held = [...Object.values(hands?.hands || {}).map(h => h.held), mouseHeld].filter(x => x?.type === 'desk');
  return new Set(held.map(x => (x.s?.desk || x.empty || x.desk)?.group));
}
function applyLayout(msg) {
  const dragging = draggedDesks();
  const place = (g, spot) => {
    if (!g || !spot || dragging.has(g)) return;
    g.userData.slide = spot;
    if (msg.final) { g.position.set(spot.x, 0, spot.z); g.rotation.y = spot.yaw; g.userData.slide = null; }
  };
  for (const [id, spot] of Object.entries(msg.desks || {})) { const s = staff.get(id); if (s) place(s.desk.group, spot); }
  for (const [id, spot] of Object.entries(msg.emptyDesks || {})) place(emptyDesks.get(id)?.group, spot);
  if (!msg.final) return;
  layout.desks = { ...layout.desks, ...msg.desks }; layout.emptyDesks = { ...layout.emptyDesks, ...msg.emptyDesks };
  try { localStorage.setItem(LAYOUT_KEY, JSON.stringify(layout)); } catch {}
  if (room?.known) fitToRoom();   // keep them clear of this headset's real walls
}
// Ease desks towards spots received mid-drag, so remote moves glide instead of stepping ten times a second.
function slideDesks(dt) {
  const k = Math.min(1, dt * 12), dragging = draggedDesks();
  for (const g of [...[...staff.values()].map(s => s.desk.group), ...[...emptyDesks.values()].map(d => d.group)]) {
    const spot = g.userData.slide; if (!spot) continue;
    if (dragging.has(g)) { g.userData.slide = null; continue; }   // your own hand wins over a remote move
    g.position.x += (spot.x - g.position.x) * k; g.position.z += (spot.z - g.position.z) * k;
    g.rotation.y += Math.atan2(Math.sin(spot.yaw - g.rotation.y), Math.cos(spot.yaw - g.rotation.y)) * k;
  }
}
const now = () => performance.now() / 1000;

// ---------------- boot ----------------
async function boot(carry = carried) {
  carried = carry;
  const response = await fetch('/api/state');
  if (response.status === 401) { $('pair').hidden = false; setStatus('PAIR HEADSET'); return; }
  if (!response.ok) throw Error(await response.text());
  state = await response.json();
  // The server's layout wins over this browser's copy, so every page starts from the same desks.
  const sharedLayout = !!state.layout?.desks;
  if (sharedLayout) Object.assign(layout, { desks: state.layout.desks, emptyDesks: state.layout.emptyDesks || {} });
  $('pair').hidden = true; $('panel').hidden = false;
  await build();
  for (const worker of state.workers) await addWorker(worker);
  if (!sharedLayout && layout.desks) saveLayout();   // first run with a shared layout: hand this browser's layout to the server
  if (PROFILE.dog) { dog = new OfficeDog(room); office.add(dog.root); }
  if (PROFILE.clock) { wallClock = makeWallClock(); placeClock(); }
  syncVirtualRoom();
  if (PROFILE.whiteboard) { whiteboard = makeWhiteboard(); placeWhiteboard(); loadProjects(); }
  if (OFFICE_MODE === 'sandbox' && window.officeOpenedMode !== 'sandbox') await freshSandbox();
  window.officeOpenedMode = OFFICE_MODE;   // survives live swaps, so only a page load or a switch into Sandbox starts it fresh
  shareMode();
  mods = new ModHost(modOffice()); mods.sync();
  listen(); watchUpdates(); offerReentry();
  setStatus('READY');
  if (carried?.focusId && staff.has(carried.focusId)) focusId = carried.focusId;
  if (shell?.session) beginSession(shell.session, carried || {});   // a swap mid-passthrough: carry straight on
  $('enterBtn').textContent = VR ? '2 · Enter the office (VR)' : '2 · Enter passthrough';
  const supported = !!navigator.xr && await navigator.xr.isSessionSupported(SESSION_MODE).catch(() => false);
  $('enterBtn').disabled = !supported;
  $('xrHelp').textContent = supported ? `${VR ? 'VR' : 'Passthrough'} available. Enable voice first, then enter.` : 'Desktop preview. Open the Quest link in Quest Browser to step inside.';
}
$('pairForm').onsubmit = async e => {
  e.preventDefault(); $('pairError').textContent = 'Pairing…';
  try {
    const r = await fetch('/api/pair', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ code: $('code').value }) });
    if (!r.ok) throw Error(await r.text());
    await boot();
  } catch (error) { $('pairError').textContent = error.message; }
};

function listen() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = eventsSocket = new WebSocket(`${protocol}//${location.host}/api/events?token=${encodeURIComponent(state.token)}`);
  ws.onmessage = e => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'worker') workerInfo(msg);
    if (msg.type === 'projects') loadProjects();
    if (msg.type === 'code') { checkUpdates?.(); mods?.sync(); shell?.codeChanged(msg.files); }   // a file changed: pick it up now
    if (msg.type === 'roster') { if (shell) shell.load(); else if (!session) location.reload(); }
    if (msg.type === 'layout' && msg.client !== CLIENT_ID) applyLayout(msg);
    if (msg.type === 'perform' && msg.worker !== voice?.worker) staff.get(msg.worker)?.avatar.perform(msg.action);
  };
  ws.onclose = () => { if (!disposed) setTimeout(() => { if (!disposed) listen(); }, 2000); };
}

async function build() {
  if (shell) { renderer = shell.renderer; if (!shell.session) renderer.setClearColor(0x1a2330, 1); }
  else {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2)); renderer.setClearColor(0x1a2330, 1);
    renderer.xr.enabled = true; renderer.xr.setReferenceSpaceType('local-floor'); renderer.xr.setFoveation(.5);
    renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    $('stage').append(renderer.domElement);
  }
  scene = new THREE.Scene();
  camera = new THREE.PerspectiveCamera(60, 1, .02, 60); camera.position.set(0, 1.65, 1.6);
  orbit = new OrbitControls(camera, renderer.domElement); orbit.target.set(0, 1, -2); orbit.enableDamping = true; orbit.maxPolarAngle = Math.PI * .49;
  scene.add(new THREE.HemisphereLight(0xf2f6ff, 0x5a4d3c, 2.2));
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.2); sun.position.set(2, 4, 3); scene.add(sun);
  office = new THREE.Group(); office.name = 'office'; scene.add(office);
  floor = new THREE.Group();
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), new THREE.MeshStandardMaterial({ color: 0x5b5146, roughness: .9 })); ground.rotation.x = -Math.PI / 2; floor.add(ground);
  const grid = new THREE.GridHelper(20, 40, 0x7a6d5e, 0x6a5e51); grid.position.y = .002; floor.add(grid);
  scene.add(floor); floor.visible = false;
  environment = makeEnvironment({ furnished: PROFILE.furnished }); office.add(environment.group);
  locomotion = new Locomotion(scene, renderer, carried?.locomotion);
  hands = new HandRig(scene);
  if (PROFILE.blasters) {
    blasters = ['right', 'left'].map(side => new Blaster(scene, side));
    flyers = new Flyers(scene);
    flyers.onPop = (point, hits) => { sfx.boom ? sfx.boom(point) : sfx.thud(point, 1.5); if (hits % 5 === 0) sfx.done(point); };
    for (const b of blasters) b.intercept = (from, to, direction) => flyers.intercept(from, to, direction);
  }
  room = new Room(scene); locomotion.room = room;
  bigScreen = makeBigScreen(); scene.add(bigScreen.group);
  caption = makeCaption(); scene.add(caption.mesh);
  menu = makeMenu(); scene.add(menu.group);
  // The voice line and audio carry over from the previous office (unless voice.js itself changed, then start afresh).
  if (carried?.voice instanceof OfficeVoice) {
    voice = carried.voice; voice.state = state; voice.onEvent = onVoice; voiceOn = !!carried.voiceOn;
    if (voiceOn) $('voiceBtn').textContent = 'Voice on · tap to turn off';
  } else {
    carried?.voice?.stop?.().catch?.(() => {});
    voice = new OfficeVoice(state, onVoice);
    if (carried?.voiceOn) notice('Voice code changed: turn voice back on from the wrist menu.');
  }
  if (carried?.audio) sfx.use(carried.audio);
  menu.refresh();
  kit = await loadKit();
  const resize = new ResizeObserver(() => { if (session) return; const w = $('stage').clientWidth, h = $('stage').clientHeight; renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); });
  resize.observe($('stage')); later(() => resize.disconnect());
  if (!shell) renderer.setAnimationLoop(frameLoop);
  const canvas = renderer.domElement;
  for (const [type, fn] of [['pointerdown', mouseDown], ['pointermove', mouseMove], ['pointerup', mouseUp], ['pointercancel', mouseUp], ['dblclick', mouseDouble]]) {
    canvas.addEventListener(type, fn); later(() => canvas.removeEventListener(type, fn));
  }
  later(() => orbit.dispose());
  window.officeDebug = { room, fitToRoom, staff, emptyDesks, office, voice, hands, menu, focus, party, get focusId() { return focusId; }, get blasters() { return blasters; }, get flyers() { return flyers; }, get session() { return session; }, get zaps() { return zaps; }, get whiteboard() { return whiteboard; }, get locomotion() { return locomotion; }, get mods() { return mods; }, renderer, camera, scene, orbit };
}

async function addWorker(worker) {
  const client = new TermClient(worker.id, state.token, { onWorker: workerInfo });
  const view = new TerminalCanvas(client.model, { cell: [16, 30], font: 26, pad: 16 });
  const desk = makeDesk(worker, view.canvas);
  const index = staff.size, count = state.workers.length;
  const spot = layout.desks?.[worker.id] || { x: (index - (count - 1) / 2) * 2.1, z: -2.1, yaw: 0 };
  desk.group.position.set(spot.x, 0, spot.z); desk.group.rotation.y = spot.yaw;
  office.add(desk.group);
  const avatar = new Avatar(worker, kit); office.add(avatar.root);
  const s = { worker, client, view, desk, avatar, info: { status: worker.status || 'starting', task: worker.task }, lastDraw: 0, touch: {}, cooldown: 0 };
  staff.set(worker.id, s);
  desk.sign.redraw(s.info);
  for (const key of desk.keys) key.userData.worker = worker.id;
  const row = document.createElement('div'); row.className = 'row';
  row.innerHTML = `<span><b></b> <span class="muted"></span></span><button>Talk</button>`;
  row.querySelector('b').textContent = worker.name; row.querySelector('.muted').textContent = worker.agent;
  row.querySelector('button').onclick = () => focus(worker.id, true);
  $('roster').append(row);
}

function workerInfo(info) {
  const s = staff.get(info.id); if (!s) return;
  const before = s.info.status; s.info = { ...s.info, ...info };
  s.desk.sign.redraw(s.info);
  const where = s.avatar.root.getWorldPosition(new THREE.Vector3()).setY(1.3);
  if (before === 'working' && info.status === 'idle') { s.avatar.markDone(); sfx.done(where); }
  if (info.status === 'approval' && before !== 'approval') sfx.attention(where);
}

// ---------------- voice and focus ----------------
async function enableVoice() {
  if (voiceOn) { voiceOn = false; await voice.stop(); $('voiceBtn').textContent = '1 · Enable voice & microphone'; menu.refresh(); notice('Voice off.'); return; }
  notice('Allow the microphone so your staff can hear you.');
  try {
    await voice.prepare(); sfx.use(voice.context); voiceOn = true;
    $('voiceBtn').textContent = 'Voice on · tap to turn off'; notice('Walk up to a worker and start talking.');
    if (focusId) connectFocus();
  } catch (error) { notice('Microphone unavailable: ' + error.message); }
  menu.refresh();
}
function connectFocus(greet = true) {
  if (!voiceOn || !focusId) return;
  const id = focusId; lastConnectTry = now();
  setStatus(`CALLING ${staff.get(id).worker.name.toUpperCase()}`);
  voice.connect(id).then(() => { if (greet && voice.worker === id) voice.officeEvent('approached'); }).catch(error => notice(error.message));
}
function focus(id, explicit = false) {
  if (!staff.has(id)) return;
  if (focusId !== id) {
    focusId = id; caption.set('', '');
    for (const [key, s] of staff) s.desk.outline.visible = arranging || (key === id && !session);
    connectFocus();
  } else if (explicit && voiceOn && !voice.ready) connectFocus();
  if (bigScreen.group.visible) showBig(id);
  menu.refresh();
}
function onVoice(msg) {
  const s = staff.get(msg.worker);
  if (msg.type === 'ready') { setStatus(`TALKING TO ${s?.worker.name.toUpperCase()}`); notice(`${s?.worker.name} is listening.`); }
  if (msg.type === 'closed') setStatus(voiceOn ? 'VOICE IDLE' : 'READY');
  if (msg.type === 'perform' && s) { s.avatar.perform(msg.action); if (msg.action === 'dance') sfx.startMusic(10); }
  if (msg.type === 'transcript' && s) caption.set(msg.role === 'user' ? 'You' : s.worker.name, msg.text);
  if (msg.type === 'tool' && msg.name === 'assign_task' && s) s.avatar.express('focus', 2);
  if (msg.type === 'notice' || msg.type === 'error') notice(msg.text);
  menu.refresh();
}
function chooseFocus(t) {
  // The worker you are looking at and near becomes the one you are talking to.
  let best = null, score = Infinity;
  for (const [id, s] of staff) {
    const p = s.avatar.partCenter('head'), to = p.clone().sub(head), d = to.length();
    if (d > 3.2) continue;
    const angle = gaze.angleTo(to.normalize());
    if (angle > .6) continue;
    const value = angle + d * .12;
    if (value < score) { score = value; best = id; }
  }
  if (!best || best === focusId) { candidate = null; return; }
  if (candidate !== best) { candidate = best; candidateSince = t; return; }
  if (t - candidateSince > .9) { candidate = null; focus(best); }
}

// ---------------- interactions ----------------
function party() {
  for (const s of staff.values()) s.avatar.dance(15);
  sfx.startMusic(15);
  if (voice.ready) voice.officeEvent('dance');
}
function pressKey(id, key, cap) {
  const s = staff.get(id); if (!s) return;
  s.client.keys([key]);
  if (cap) { cap.position.y = cap.userData.rest - .008; cap.userData.pressedUntil = now() + .15; }
  sfx.click(cap?.getWorldPosition(new THREE.Vector3()));
}
function physical(s, event, extra = {}) {
  if (voice.ready && voice.worker === s.worker.id) voice.officeEvent(event, extra);
  else if (focusId !== s.worker.id) focus(s.worker.id);
}
function grabStart(h, point) {
  if (arranging) {
    for (const s of staff.values()) {
      const local = s.desk.group.worldToLocal(point.clone());
      if (Math.abs(local.x) < DESK.width / 2 + .12 && Math.abs(local.z) < DESK.depth / 2 + .12 && local.y > .45 && local.y < 1.6) {
        const start = office.worldToLocal(point.clone());
        h.held = { type: 'desk', s, start, origin: s.desk.group.position.clone(), yaw: s.desk.group.rotation.y, handYaw: h.yaw };
        s.desk.outline.material.color.set(0xffffff); return;
      }
    }
    for (const d of emptyDesks.values()) {
      const local = d.group.worldToLocal(point.clone());
      if (Math.abs(local.x) < DESK.width / 2 + .12 && Math.abs(local.z) < DESK.depth / 2 + .12 && local.y > .45 && local.y < 1.6) {
        const start = office.worldToLocal(point.clone());
        h.held = { type: 'desk', empty: d, start, origin: d.group.position.clone(), yaw: d.group.rotation.y, handYaw: h.yaw };
        d.outline.material.color.set(0xffffff);
        return;
      }
    }
  }
  if (bigScreen.group.visible) {
    const local = bigScreen.group.worldToLocal(point.clone());
    if (Math.abs(local.x) < .85 && Math.abs(local.y) < .55 && Math.abs(local.z) < .12) { h.held = { type: 'screen', offset: bigScreen.group.position.clone().sub(point) }; return; }
  }
  for (const s of staff.values()) {
    const part = s.avatar.touching(point, .05);
    if (!part) continue;
    s.avatar.grab(part);
    h.held = { type: 'avatar', s, part, offset: s.avatar.root.getWorldPosition(new THREE.Vector3()).sub(point) };
    focus(s.worker.id);
    physical(s, part === 'left' || part === 'right' ? 'led' : 'lifted');
    return;
  }
}
function grabMove(h, point, dt) {
  const held = h.held;
  if (held.type === 'avatar') {
    if (held.part === 'left' || held.part === 'right') held.s.avatar.lead(point, head, dt);
    else held.s.avatar.hold(point, held.offset);
  } else if (held.type === 'desk') {
    const p = office.worldToLocal(point.clone()), g = (held.s?.desk || held.empty).group;
    g.position.set(held.origin.x + p.x - held.start.x, 0, held.origin.z + p.z - held.start.z);
    if (!h.controller || h.fist) g.rotation.y = held.yaw + (h.yaw - held.handYaw);
    nudgeIntoRoom(g, DESK_PROBES);
  } else if (held.type === 'screen') {
    bigScreen.group.position.copy(point).add(held.offset); bigScreen.group.lookAt(head);
  }
}
function grabEnd(h) {
  const held = h.held; h.held = null; if (!held) return;
  if (held.type === 'avatar') {
    const velocity = held.pointer ? new THREE.Vector3() : h.velocity;
    held.s.avatar.release(velocity);
    if (velocity.length() > 2.2 && held.part !== 'left' && held.part !== 'right') physical(held.s, 'thrown');
  }
  if (held.type === 'desk') { (held.s?.desk || held.empty).outline.material.color.set(0xf8ce52); saveLayout(); }
  if (held.type === 'dog') { dog.dragging = false; dog.walking = false; dog.wait = .5; }
  if (held.type === 'blaster') held.blaster.holster();
  if (held.type === 'prop') held.group.userData.movable?.onEnd?.(held.group);
}

// Patting the dog: a gentle touch (or stroking) makes it happy; a fast slap makes it yelp and skid away.
function touchDog(h, t) {
  if (!dog || dog.dragging) return;
  const points = h.controller ? [h.palm] : [h.palm, h.joints.get('index-finger-tip'), h.joints.get('middle-finger-tip')];
  const inside = points.some(p => dog.touching(p));
  const was = dog.touch[h.handedness]; dog.touch[h.handedness] = inside;
  if (!inside) return;
  const speed = h.velocity.length(), where = dog.root.getWorldPosition(new THREE.Vector3()).setY(.5);
  const buzz = (amount, ms) => h.source?.gamepad?.hapticActuators?.[0]?.pulse?.(amount, ms);
  if (!was && speed > 1.25) { dog.hit(h.velocity, speed); dog.nextPat = t + 1; sfx.yelp?.(where); buzz(.7, 60); return; }
  if ((!was || speed > .15) && t > dog.nextPat) { dog.nextPat = t + .8; dog.pat(); sfx.bark?.(where); buzz(.25, 30); }
}

// ---------------- toy blaster ----------------
// What a bolt from origin along direction hits first: a worker, the dog, a wall or the floor (within 12 m).
function blastHit(origin, direction) {
  let best = { distance: 12, onHit: null };
  const ray = new THREE.Ray(origin, direction);
  const people = [...staff.values()].map(s => [s.avatar, () => physical(s, 'blasted')]);
  for (const [avatar, tell] of people) {
    const body = bodyRayHit(avatar, ray, best.distance); if (!body) continue;
    const point = body.point.clone();
    best = { distance: body.distance, onHit: () => { avatar.hit(direction, body.part === 'head' ? 2.8 : 2.2); zap(avatar, point); tell?.(); sfx.slap(point, 1.4); } };
  }
  if (dog) {
    raycaster.ray.set(origin, direction); raycaster.near = 0; raycaster.far = best.distance;
    const hit = raycaster.intersectObject(dog.root, true)[0];
    raycaster.far = Infinity;
    if (hit) best = { distance: hit.distance, onHit: () => { dog.hit(direction, 2); sfx.yelp?.(dog.root.getWorldPosition(new THREE.Vector3())); } };
  }
  for (const w of room?.walls || []) {
    const denom = direction.x * w.nx + direction.z * w.nz; if (denom > -1e-3) continue;   // only walls you are shooting towards
    const d = ((w.cx - origin.x) * w.nx + (w.cz - origin.z) * w.nz) / denom;
    if (d <= 0 || d >= best.distance) continue;
    const x = origin.x + direction.x * d, z = origin.z + direction.z * d;
    if (Math.abs((x - w.cx) * w.tx + (z - w.cz) * w.tz) <= w.hw) best = { distance: d, onHit: null };
  }
  if (direction.y < -1e-3) { const d = -origin.y / direction.y; if (d < best.distance) best = { distance: d, onHit: null }; }
  return best;
}
// While a blaster is in this hand: aim it, fire on trigger (controller) or pinch (tracked hand), holster it at its hip.
function holdBlaster(h, t) {
  if (!h.valid) { grabEnd(h); return; }
  const blaster = h.held.blaster;
  if (blaster.hold(h)) { h.held = null; sfx.click(blaster.hip); return; }
  const pull = h.controller ? h.trigger && !h.wasTrigger : (h.squeeze && !h.wasSqueeze) || (h.pinch && !h.wasPinch);
  if (!pull || !blaster.ready(t)) return;
  const { origin, direction } = blaster.muzzleRay(), target = blastHit(origin, direction);
  blaster.fire(t, origin, direction, target.distance, target.onHit);
  if (blaster.shotSound) blaster.shotSound(origin);
  else sfx.laser?.(origin);
  h.source?.gamepad?.hapticActuators?.[0]?.pulse?.(.5, 40);
}

// Controller trigger: aim at an object, then hold the trigger to move it.
function pointerTarget(h) {
  if (!h.rayValid) return null;
  const targets = [];
  for (const s of staff.values()) targets.push(...s.desk.keys);
  if (arranging) {
    for (const s of staff.values()) targets.push(s.desk.group);
    for (const d of emptyDesks.values()) targets.push(d.group);
  }
  if (bigScreen.group.visible) targets.push(bigScreen.group);
  if (dog) targets.push(dog.root);
  for (const m of movables) if (m.parent) targets.push(m);
  raycaster.ray.copy(h.ray); raycaster.near = 0; raycaster.far = 5;
  const hits = raycaster.intersectObjects(targets, true);
  raycaster.far = Infinity;
  let best = null;
  for (const hit of hits) {
    let o = hit.object;
    while (o && !best) {
      if (o.userData.key) best = { type: 'key', cap: o, hit };
      else if (o === bigScreen.group && bigScreen.group.visible) best = { type: 'screen', hit };
      else if (o === dog?.root) best = { type: 'dog', hit };
      else if (movables.has(o)) best = { type: 'prop', group: o, hit };
      else if (arranging && o.name.startsWith('desk:')) best = { type: 'desk', s: staff.get(o.name.slice(5)), empty: emptyDesks.get(o.name.slice(5)), hit };
      o = o.parent;
    }
    if (best) break;
  }
  for (const s of staff.values()) {
    const body = bodyRayHit(s.avatar, h.ray, 5);
    if (body && (!best || body.distance < best.hit.distance)) best = { type: 'avatar', s, hit: body };
  }
  return best;
}
// A ray against a worker's body as spheres (head, torso, hips, legs). Raycasting the body meshes every frame
// was slow on Quest and missed when the pose had moved away from the meshes' bounds.
function bodyRayHit(avatar, ray, far = 12) {
  const root = avatar.root, parts = [
    ['head', avatar.partCenter('head'), .33], ['torso', avatar.partCenter('torso'), .34],
    ['hips', root.localToWorld(new THREE.Vector3(0, .62, 0)), .3], ['legs', root.localToWorld(new THREE.Vector3(0, .3, 0)), .27]];
  let best = null;
  for (const [part, centre, radius] of parts) {
    const point = ray.intersectSphere(new THREE.Sphere(centre, radius), new THREE.Vector3());
    if (!point) continue;
    const distance = point.distanceTo(ray.origin);
    if (distance <= far && (!best || distance < best.distance)) best = { part, point, distance };
  }
  return best;
}
// Electric crackle round a zapped worker: jagged cyan arcs that flicker for a moment.
const zaps = [];
function zap(avatar, point) {
  const material = new THREE.LineBasicMaterial({ color: 0x8fe9ff, transparent: true, opacity: 1, toneMapped: false, depthTest: false });
  const group = new THREE.Group(); group.renderOrder = 7; scene.add(group);
  zaps.push({ avatar, group, material, age: 0, next: 0 });
  avatar.express('ouch', 1.6);
  sfx.tone?.(point, [140, 90, 160, 70], 'sawtooth', .045, .22);
}
function updateZaps(dt) {
  for (const z of [...zaps]) {
    z.age += dt;
    if (z.age > .8) { z.group.removeFromParent(); z.group.traverse(o => o.geometry?.dispose()); z.material.dispose(); zaps.splice(zaps.indexOf(z), 1); continue; }
    z.material.opacity = 1 - z.age / .8;
    if (z.age < z.next) continue;
    z.next = z.age + .05;
    for (const line of [...z.group.children]) { line.removeFromParent(); line.geometry.dispose(); }
    const centres = [z.avatar.partCenter('head'), z.avatar.partCenter('torso'), z.avatar.root.localToWorld(new THREE.Vector3(0, .5, 0))];
    for (let i = 0; i < 7; i++) {
      const c = centres[i % 3], points = [];
      let p = c.clone().add(new THREE.Vector3((Math.random() - .5) * .5, (Math.random() - .5) * .4, (Math.random() - .5) * .5));
      for (let k = 0; k < 5; k++) { points.push(p.clone()); p.add(new THREE.Vector3((Math.random() - .5) * .14, (Math.random() - .5) * .14, (Math.random() - .5) * .14)); }
      z.group.add(new THREE.Line(new THREE.BufferGeometry().setFromPoints(points), z.material));
    }
  }
}
function pointerStart(h, target) {
  if (!target) return;
  if (target.type === 'key') { pressKey(target.cap.userData.worker, target.cap.userData.key, target.cap); return; }
  const point = target.hit.point, depth = target.hit.distance;
  if (target.type === 'avatar') {
    const part = target.s.avatar.touching(point, .18) || 'torso';
    target.s.avatar.grab(part);
    h.held = { type: 'avatar', pointer: true, s: target.s, part, depth,
      offset: target.s.avatar.root.getWorldPosition(new THREE.Vector3()).sub(point) };
    focus(target.s.worker.id);
    physical(target.s, part === 'left' || part === 'right' ? 'led' : 'lifted');
  } else if (target.type === 'screen') {
    h.held = { type: 'screen', pointer: true, depth, offset: bigScreen.group.position.clone().sub(point) };
  } else if (target.type === 'desk' || target.type === 'dog') {
    const group = target.type === 'dog' ? dog.root : (target.s?.desk || target.empty).group;
    const plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -point.y);
    h.held = { type: target.type, pointer: true, s: target.s, empty: target.empty, plane, depth,
      start: office.worldToLocal(point.clone()), origin: group.position.clone(), group };
    if (target.type === 'dog') dog.dragging = true;
    else (target.s?.desk || target.empty).outline.material.color.set(0xffffff);
  } else if (target.type === 'prop') {                              // a mod's movable prop: slide it over the floor at its own height
    const g = target.group, plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -point.y);
    h.held = { type: 'prop', pointer: true, plane, depth, group: g, start: g.parent.worldToLocal(point.clone()), origin: g.position.clone() };
    sfx.click?.(point);
  }
}
function pointerMove(h, dt) {
  const held = h.held;
  if (held.type === 'avatar' || held.type === 'screen') {
    grabMove(h, h.ray.at(held.depth, new THREE.Vector3()), dt);
    return;
  }
  const point = h.ray.intersectPlane(held.plane, new THREE.Vector3());
  if (!point) return;
  if (held.type === 'prop') {
    const g = held.group; if (!g.parent) { h.held = null; return; }
    const p = g.parent.worldToLocal(point);
    g.position.set(held.origin.x + p.x - held.start.x, held.origin.y, held.origin.z + p.z - held.start.z);
    g.userData.movable?.onMove?.(g);
    return;
  }
  const p = office.worldToLocal(point), g = held.group;
  g.position.set(held.origin.x + p.x - held.start.x, 0, held.origin.z + p.z - held.start.z);
  if (held.type === 'desk') nudgeIntoRoom(g, DESK_PROBES);
  if (held.type === 'dog' && room?.known) {
    const world = g.getWorldPosition(new THREE.Vector3());
    if (room.constrain(world, .32)) g.position.copy(office.worldToLocal(world)).setY(0);
  }
}
// Palm or fingers entering a worker: slap, pat or poke, depending on speed.
function touches(h, t) {
  for (const s of staff.values()) {
    if (['held'].includes(s.avatar.mode)) continue;
    const swept = [.25, .5, .75].map(f => h.sweepFrom.clone().lerp(h.palm, f));
    const points = h.controller ? [...swept, h.palm] : [...swept, h.palm, h.joints.get('middle-finger-tip'), h.joints.get('index-finger-tip')];
    const part = points.map(p => s.avatar.touching(p)).find(Boolean) || null;
    const was = s.touch[h.handedness]; s.touch[h.handedness] = part;
    if (!part || was || t < s.cooldown) continue;
    const speed = h.velocity.length(), where = s.avatar.partCenter(part);
    s.cooldown = t + .45;
    if (speed > 1.25) {
      s.avatar.hit(h.velocity, speed); sfx.slap(where, speed); physical(s, 'slapped', { strength: speed });
      if (h.source?.gamepad?.hapticActuators?.[0]) h.source.gamepad.hapticActuators[0].pulse?.(Math.min(1, speed / 4), 60);
    } else if (speed > .2) {
      if (part === 'head' && h.velocity.y < -.1) { s.avatar.express('happy', 1.5); sfx.pop(where); physical(s, 'patted'); }
      else { s.avatar.hit(h.velocity, speed * .6); s.avatar.express('surprised', .8); sfx.pop(where); physical(s, 'poked'); }
    }
  }
}
function pokeKeys(h, t) {
  if (!h.indexTip || h.held) return;
  for (const s of staff.values()) for (const cap of s.desk.keys) {
    const local = cap.worldToLocal(h.indexTip.clone());
    const inside = Math.abs(local.x) < .024 && Math.abs(local.z) < .024 && local.y < .016 && local.y > -.03;
    const key = h.handedness + 'Key';
    if (inside && !cap.userData[key] && t > (cap.userData.cooldown || 0) && (h.controller ? h.trigger : h.indexVelocity.y < .05)) {
      cap.userData.cooldown = t + .35; pressKey(cap.userData.worker, cap.userData.key, cap);
    }
    cap.userData[key] = inside;
  }
}

// ---------------- XR session ----------------
const SESSION_MODE = VR ? 'immersive-vr' : 'immersive-ar';
const SESSION_INIT = VR ? { requiredFeatures: ['local-floor'], optionalFeatures: ['hand-tracking'] }
  : { requiredFeatures: ['local-floor'], optionalFeatures: ['hand-tracking', 'anchors', 'hit-test', 'plane-detection', 'bounded-floor'] };
async function readQuestBattery(xrSession) {
  questBattery = null;
  if (typeof navigator.getBattery !== 'function') return;
  try {
    const battery = await navigator.getBattery();
    if (session === xrSession) questBattery = battery;
  } catch { /* Battery access can be unsupported or denied by browser policy. */ }
}
async function enter(offered) {
  if (session) return;
  try {
    let next;
    if (shell) next = await shell.startSession(SESSION_INIT, offered, SESSION_MODE);
    else {
      next = offered || await navigator.xr.requestSession(SESSION_MODE, SESSION_INIT);
      renderer.xr.setReferenceSpace(null);
      await renderer.xr.setSession(next);
      next.baseSpace = renderer.xr.getReferenceSpace();
      next.addEventListener('end', () => sessionEnded(next));
    }
    beginSession(next, null);
  } catch (error) { notice('Could not enter passthrough: ' + error.message); session = null; questBattery = null; }
}
// Set the office up for a passthrough session: a new one (recentre or restore the saved anchor), or one carried over
// from the previous copy of this office (same place in the room, same anchor).
function beginSession(next, carry) {
  session = next;
  readQuestBattery(session);
  if (VR) renderer.setClearColor(0x1a2330, 1); else { renderer.setClearColor(0x000000, 0); environment.group.visible = false; }
  floor.visible = false; $('panel').hidden = true; firstFrame = !carry; officeAnchor = carry?.officeAnchor || null;
  for (const s of staff.values()) s.desk.outline.visible = arranging;
  for (const d of emptyDesks.values()) d.outline.visible = arranging;
  setStatus(VR ? 'IN THE OFFICE' : 'PASSTHROUGH'); boundedAsked = false; boundedSpace = null;
  if (VR) locomotion.attach(shell?.baseSpace || session.baseSpace || renderer.xr.getReferenceSpace());
  shareMode();
  if (carry) {
    if (carry.officePosition) { office.position.copy(carry.officePosition); office.quaternion.copy(carry.officeQuaternion); }
    anchorPending = !!carry.anchorPending;
    syncVirtualRoom();
    return;
  }
  if (!VR) {
    if (layout.anchor && session.restorePersistentAnchor) {
      // Wait for the saved spot instead of recentering on the first frame: recentering deletes the saved anchor,
      // and the restore would then hand back a deleted anchor. Fall back to recentering if it fails or takes too long.
      const restoring = session; firstFrame = false;
      const fallback = () => { if (session === restoring && !officeAnchor && !anchorPending) firstFrame = true; };
      session.restorePersistentAnchor(layout.anchor).then(anchor => {
        if (session !== restoring || officeAnchor || anchorPending) { anchor.delete?.(); return; }
        officeAnchor = anchor; notice('Office restored where you left it.');
      }).catch(() => { delete layout.anchor; saveLayout(); fallback(); });
      setTimeout(fallback, 3000);
    }
  }
}
function sessionEnded(ended) {
  if (session !== ended || disposed) return;
  session = null; questBattery = null; officeAnchor = null; boundedSpace = null; boundedAsked = false; renderer.setClearColor(0x1a2330, 1); $('panel').hidden = false;
  environment.group.visible = true; if (locomotion) locomotion.base = null;
  for (const h of Object.values(hands.hands)) { if (h.held) grabEnd(h); hands.setPointer(h, null, false, false); }
  notice(`${VR ? 'VR' : 'Passthrough'} ended. Your staff keep working.`);
}
// Put the office origin at your feet, facing where you look. Desks keep their layout around it.
function recenter() {
  office.position.set(head.x, 0, head.z);
  office.rotation.set(0, Math.atan2(-gaze.x, -gaze.z), 0);
  fittedVersion = -1; syncVirtualRoom();
  if (VR) return;                             // no real room to anchor to
  officeAnchor?.delete?.(); officeAnchor = null; anchorPending = true;
  if (layout.anchor && session?.deletePersistentAnchor) session.deletePersistentAnchor(layout.anchor).catch(() => {});
}
function anchorOffice(frame, reference) {
  anchorPending = false;
  if (!frame.createAnchor) return;
  const p = office.position, q = office.quaternion;
  frame.createAnchor(new XRRigidTransform({ x: p.x, y: p.y, z: p.z }, { x: q.x, y: q.y, z: q.z, w: q.w }), reference).then(async anchor => {
    officeAnchor = anchor;
    if (anchor.requestPersistentHandle) { layout.anchor = await anchor.requestPersistentHandle(); saveLayout(); }
  }).catch(() => {});
}
function showBig(id) {
  const s = staff.get(id || focusId); if (!s) return;
  bigFor = s.worker.id;
  bigScreen.show(s.desk.texture, s.view.canvas.height / s.view.canvas.width);
  if (!bigScreen.placed) {
    bigScreen.group.position.copy(head).add(new THREE.Vector3(gaze.x, 0, gaze.z).normalize().multiplyScalar(1.4)); bigScreen.group.position.y = head.y - .05;
    bigScreen.group.lookAt(head); bigScreen.placed = true;
  }
}
function toggleBig() {
  if (bigScreen.group.visible) { bigScreen.group.visible = false; bigScreen.placed = false; bigFor = null; }
  else if (focusId) showBig(focusId); else notice('Look at a worker first.');
  menu.refresh();
}
function toggleArrange() {
  arranging = !arranging;
    for (const s of staff.values()) s.desk.outline.visible = arranging;
    for (const d of emptyDesks.values()) d.outline.visible = arranging;
  for (const d of emptyDesks.values()) d.outline.visible = arranging;
  notice(arranging ? 'Arrange: grab a desk top to move it; twist your hand to turn it.' : 'Layout saved.');
  if (!arranging) saveLayout();
  menu.refresh();
}

// ---------------- updates & clock ----------------
// Passthrough cannot survive a page reload, so REFRESH ends the session, reloads, and offers to re-enter at the same anchored spot.
const WATCHED = ['office.js', 'hands.js', 'room.js', 'clock.js', 'avatar.js', 'furniture.js', 'whiteboard.js', 'mods.js', 'environment.js', 'locomotion.js', 'dog.js', 'blaster.js', 'flyers.js', 'termview.js', 'voice.js', 'sfx.js', 'style.css', 'office.html'];
// The check runs from the frame loop as well as a timer: in passthrough the page counts as hidden and its timers get throttled,
// but XR frames keep coming. Only one check runs at a time, so a slow fetch cannot swap the same module twice.
let checkUpdates = null, lastUpdateCheck = -10, htmlChanged = false;
const SHELL_SWAPS = ['office.js', 'voice.js', 'termview.js'];   // the shell replaces the whole office for these
function watchUpdates() {
  let stamps = null, checking = false;
  checkUpdates = async () => {
    if (checking) return;
    checking = true; lastUpdateCheck = now();
    try {
      const latest = await Promise.all(WATCHED.map(f => fetch('/' + f, { cache: 'no-store' }).then(r => { r.body?.cancel(); return r.ok ? r.headers.get('etag') || r.headers.get('last-modified') || '' : null; })));
      if (latest.includes(null)) return;      // the server is restarting (the tunnel answers 502): try again next round
      mods?.sync();
      if (!stamps) { stamps = latest; return; }
      // Hot files are swapped and re-stamped on their own, so a pending non-hot change never blocks later live swaps.
      const changed = latest.flatMap((v, i) => v !== stamps[i] ? [WATCHED[i]] : []).filter(f => !(shell && SHELL_SWAPS.includes(f)));
      if (changed.includes('office.html')) htmlChanged = true;
      for (const f of changed.filter(f => HOT[f])) { stamps[WATCHED.indexOf(f)] = latest[WATCHED.indexOf(f)]; await HOT[f](); }
      if (changed.some(f => !HOT[f]) && !updateReady) { updateReady = true; notice('A new version is ready. Use REFRESH on the wrist menu.'); sfx.pop?.(); menu.refresh(); }
    } catch {} finally { checking = false; }
  };
  checkUpdates(); const timer = setInterval(checkUpdates, 4000); later(() => clearInterval(timer));
}
// The clock is a leaf module with no state of its own, so an edit to it is swapped in live: no reload, no session interruption.
async function swapClock() {
  if (!PROFILE.clock) return;
  try {
    const next = (await import(`./clock.js?v=${Date.now()}`)).makeWallClock(), old = wallClock;
    wallClock = next;
    if (old) {
      next.group.position.copy(old.group.position); next.group.quaternion.copy(old.group.quaternion);
      (old.group.parent || office).add(next.group); old.group.removeFromParent();
      old.group.traverse(o => { o.geometry?.dispose(); o.material?.map?.dispose(); o.material?.dispose(); });
    } else placeClock();
    notice('Clock updated live.');
  } catch (error) { notice('Clock update failed: ' + error.message); }
}
// The room keeps its scanned walls, furniture and visibility across a swap, so the new code takes over without a rescan.
// The version is left alone on purpose: desks stay where they are, and FIT TO ROOM refits them if the new rules need it.
async function swapRoom() {
  try {
    const next = new (await import(`./room.js?v=${Date.now()}`)).Room(scene), old = room;
    for (const key of ['walls', 'obstacles', 'source', 'signature', 'version', 'lastScan', 'bounded', 'boundedTransform']) next[key] = old[key];
    next.group.visible = old.group.visible; next.rebuild();
    room = next; if (window.officeDebug) window.officeDebug.room = next;
    if (locomotion) locomotion.room = next;
    if (dog) dog.room = next;
    old.group.removeFromParent();
    old.group.traverse(o => o.geometry?.dispose()); old.brick.dispose();
    notice('Room updated live.');
  } catch (error) { notice('Room update failed: ' + error.message); }
}
// Sounds: the new Sfx takes over the live audio context, output and any music already playing.
async function swapSfx() {
  try {
    const next = new (await import(`./sfx.js?v=${Date.now()}`)).Sfx();
    Object.assign(next, { ctx: sfx.ctx, out: sfx.out, music: sfx.music });
    sfx = next;
    notice('Sounds updated live.');
  } catch (error) { notice('Sounds update failed: ' + error.message); }
}
// Hands: anything held is let go first, then a fresh rig takes over from the next frame's input sources.
async function swapHands() {
  try {
    const next = new (await import(`./hands.js?v=${Date.now()}`)).HandRig(scene), old = hands;
    for (const h of Object.values(old.hands)) if (h.held) grabEnd(h);
    next.setVisible(old.visible);
    hands = next; if (window.officeDebug) window.officeDebug.hands = next;
    // Everything the old rig put in the scene: hand meshes, controller hand models, and pointer beams and cursors.
    const parts = [...old.meshes, ...Object.values(old.controllerHands || {}), ...Object.values(old.pointers || {}).flatMap(p => [p.beam, p.cursor])];
    for (const o of parts) { o.removeFromParent(); o.traverse(c => { c.geometry?.dispose(); c.material?.dispose(); }); o.dispose?.(); }
    notice('Hands updated live.');
  } catch (error) { notice('Hands update failed: ' + error.message); }
}
// The server versions every module's static imports by the newest change in its import graph, so re-importing a module
// with a fresh ?v= also picks up edits to anything it imports (avatar.js -> furniture.js).
const fresh = name => import(`./${name}?v=${Date.now()}`);
// Skinned meshes from an older kit shared their geometry with every figure cloned from it, so those are left alone.
const disposeTree = root => { root.removeFromParent(); root.traverse(o => { if (o.isSkinnedMesh) { o.skeleton?.dispose(); return; } o.geometry?.dispose(); o.material?.dispose?.(); }); };
// Workers: everyone gets a new body in the same spot and pose; their state lives in the office, not the body.
async function swapAvatars() {
  try {
    const { Avatar } = await fresh('avatar.js');
    for (const s of staff.values()) {
      const old = s.avatar, next = new Avatar(s.worker, kit);
      next.root.position.copy(old.root.position); next.root.rotation.copy(old.root.rotation);
      for (const key of ['mode', 'swivel', 'until', 'thrown']) next[key] = old[key];
      office.add(next.root); disposeTree(old.root); s.avatar = next;
    }
    mods?.remountAll(); notice('Workers updated live.');
  } catch (error) { notice('Workers update failed: ' + error.message); }
}
// Desks: rebuilt around the same terminal views, in the same places.
async function swapFurniture() {
  try {
    const { makeDesk, makeEmptyDesk } = await fresh('furniture.js');
    for (const s of staff.values()) {
      const old = s.desk, next = makeDesk(s.worker, s.view.canvas);
      next.group.position.copy(old.group.position); next.group.rotation.copy(old.group.rotation);
      for (const key of next.keys) key.userData.worker = s.worker.id;
      next.sign.redraw(s.info); office.add(next.group); disposeTree(old.group); s.desk = next;
    }
    for (const [id, old] of emptyDesks) {
      const next = makeEmptyDesk(); next.group.position.copy(old.group.position); next.group.rotation.copy(old.group.rotation);
      office.add(next.group); disposeTree(old.group); emptyDesks.set(id, next);
    }
    mods?.remountAll(); notice('Desks updated live.');
  } catch (error) { notice('Desks update failed: ' + error.message); }
}
async function swapDog() {
  if (!dog) return;
  try {
    const next = new (await fresh('dog.js')).OfficeDog(room);
    next.root.position.copy(dog.root.position); next.root.rotation.copy(dog.root.rotation);
    office.add(next.root); disposeTree(dog.root); dog = next;
    notice('Dog updated live.');
  } catch (error) { notice('Dog update failed: ' + error.message); }
}
// Blasters go back in their holsters (anything held is let go) and fresh ones take their place.
async function swapBlasters() {
  try {
    const { Blaster } = await fresh('blaster.js');
    for (const h of Object.values(hands.hands)) if (h.held?.type === 'blaster') grabEnd(h);
    const next = blasters.map(old => { const b = new Blaster(scene, old.side || (old.group.name.endsWith('left') ? 'left' : 'right')); old.setActive(false); disposeTree(old.group); return b; });
    for (const b of next) b.intercept = (from, to, direction) => flyers?.intercept(from, to, direction);
    blasters = next;
    notice('Blasters updated live.');
  } catch (error) { notice('Blasters update failed: ' + error.message); }
}
async function swapFlyers() {
  if (!PROFILE.blasters) return;
  try {
    const next = new (await fresh('flyers.js')).Flyers(scene);
    next.onPop = flyers?.onPop; flyers?.clear?.();
    flyers = next;
    notice('Targets updated live.');
  } catch (error) { notice('Targets update failed: ' + error.message); }
}
// The stylesheet only dresses the 2D panels; swapping the link restyles them without a reload.
async function swapStyle() {
  const link = document.querySelector('link[rel="stylesheet"][href^="style.css"]');
  if (link) link.href = `style.css?v=${Date.now()}`;
}
// ---------------- project whiteboard ----------------
// It stands to the left of the desks, angled towards where you start, and shows the shared board from /api/projects.
// Point at it and hold the trigger (or pinch) to pull it somewhere else: it turns to face you as it moves, stays inside
// the room, and keeps that spot on this headset from then on.
let whiteboard = null, projectsLoading = false;
const BOARD_SPOT = 'office:whiteboard-spot';
function placeWhiteboard() {
  const desks = [...staff.values()].map(s => s.desk.group.position.x);
  let spot = null; try { spot = JSON.parse(localStorage.getItem(BOARD_SPOT)); } catch {}
  if (spot) { whiteboard.group.position.set(spot.x, 0, spot.z); whiteboard.group.rotation.y = spot.yaw; }
  else { whiteboard.group.position.set(Math.min(0, ...desks) - 2.3, 0, -1.9); whiteboard.group.rotation.y = .45; }
  office.add(whiteboard.group);
  if (room?.known) nudgeIntoRoom(whiteboard.group, BOARD_PROBES);
  movableBoard(whiteboard);
}
function movableBoard(board) {
  const g = board.group;
  g.userData.movable = {
    onMove() {
      if (room?.known) nudgeIntoRoom(g, BOARD_PROBES);
      const you = office.worldToLocal(head.clone());
      g.rotation.y = Math.atan2(you.x - g.position.x, you.z - g.position.z);   // the face (+z) turns towards you
    },
    onEnd() { try { localStorage.setItem(BOARD_SPOT, JSON.stringify({ x: g.position.x, z: g.position.z, yaw: g.rotation.y })); } catch {} },
  };
  movables.add(g); later(() => movables.delete(g));
}
async function loadProjects() {
  if (projectsLoading || !whiteboard) return;
  projectsLoading = true;
  try { const r = await fetch('/api/projects'); if (r.ok) whiteboard.setProjects((await r.json()).projects); } catch {} finally { projectsLoading = false; }
}
async function swapWhiteboard() {
  if (!PROFILE.whiteboard) return;
  try {
    const next = (await fresh('whiteboard.js')).makeWhiteboard(), old = whiteboard;
    if (old) {
      for (const h of Object.values(hands?.hands || {})) if (h.held?.group === old.group) grabEnd(h);
      next.group.position.copy(old.group.position); next.group.rotation.copy(old.group.rotation); office.add(next.group);
      movables.delete(old.group); old.dispose(); movableBoard(next);
    }
    whiteboard = next; if (!old) placeWhiteboard();
    await loadProjects();
    notice('Whiteboard updated live.');
  } catch (error) { notice('Whiteboard update failed: ' + error.message); }
}
// Tell the server which office this page shows, so the agents put new mods in the right folder.
// A page inside VR keeps reporting (every 20 s) and wins over pages outside it, so the agents follow the headset.
let lastModeShare = -100;
const PAGE_ID = window.officePageId ||= Math.random().toString(36).slice(2, 12);   // one per page, kept across live swaps
function shareMode() {
  lastModeShare = now();
  fetch('/api/office-mode', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Office-Token': state?.token || '' },
    body: JSON.stringify({ mode: OFFICE_MODE, inSession: !!session, page: PAGE_ID }) }).catch(() => {});
}
// Opening the Sandbox starts from an empty room: the server saves the last build to the sandbox-saves git branch first.
// It leaves the room alone when another page (the headset, say) is already in there.
async function freshSandbox() {
  try {
    const r = await fetch('/api/sandbox/fresh', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Office-Token': state?.token || '' },
      body: JSON.stringify({ page: PAGE_ID }) });
    if (!r.ok) return;
    const { fresh, saved, reason } = await r.json();
    if (fresh && saved) notice(`Fresh sandbox. The last build is saved in ${saved}.`);
    else if (!fresh) notice(`Keeping the current sandbox: ${reason}.`);
  } catch {}
}

// ---------------- the virtual room and moving around ----------------
// In VR the office's own walls are the room: hand them to the Room (in world space) so people, desks and you stay inside.
function syncVirtualRoom() {
  if (!VR || !environment || !room) return;
  office.updateMatrixWorld(true);
  const yaw = new THREE.Euler().setFromQuaternion(office.quaternion, 'YXZ').y;
  room.setRoom(environment.walls().map(w => {
    const c = office.localToWorld(new THREE.Vector3(w.cx, 0, w.cz)), n = new THREE.Vector3(w.nx, 0, w.nz).applyAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    return { cx: c.x, cz: c.z, nx: n.x, nz: n.z, hw: w.hw, label: 'wall' };
  }), [], 'virtual');
  room.setVisible(false);
}
async function swapEnvironment() {
  try {
    const next = (await fresh('environment.js')).makeEnvironment({ furnished: PROFILE.furnished });
    environment?.dispose(); environment = next; office.add(next.group);
    next.group.visible = VR || !session; syncVirtualRoom();
    notice('Office room updated live.');
  } catch (error) { notice('Office room update failed: ' + error.message); }
}
async function swapLocomotion() {
  try {
    const next = new (await fresh('locomotion.js')).Locomotion(scene, renderer, locomotion?.state);
    next.room = room; if (locomotion?.base) next.attach(locomotion.base);
    locomotion?.dispose(); locomotion = next;
    notice('Moving around updated live.');
  } catch (error) { notice('Locomotion update failed: ' + error.message); }
}

// ---------------- live mods (web/mods/*.js) ----------------
let mods = null;
// What mods may reach in the office. Getters, so hot swaps of the room, desks or bodies are always current.
function modOffice() {
  return { get office() { return office; }, get scene() { return scene; }, staff, DESK, movables, notice: text => notice(text), modSet: OFFICE_MODE };
}
async function swapMods() {
  try {
    const next = new (await fresh('mods.js')).ModHost(modOffice());
    mods?.disposeAll(); mods = next; await mods.sync(true);
    notice('Mod loader updated live.');
  } catch (error) { notice('Mod loader update failed: ' + error.message); }
}
// Modules that can be swapped in without ending the session. office.js, voice.js and termview.js (and office.html) still need REFRESH.
const HOT = { 'clock.js': swapClock, 'room.js': swapRoom, 'sfx.js': swapSfx, 'hands.js': swapHands, 'avatar.js': swapAvatars,
  'furniture.js': swapFurniture, 'dog.js': swapDog, 'blaster.js': swapBlasters, 'flyers.js': swapFlyers, 'whiteboard.js': swapWhiteboard, 'mods.js': swapMods, 'environment.js': swapEnvironment, 'locomotion.js': swapLocomotion, 'style.css': swapStyle };
function reloadOffice() {
  // Inside the shell, REFRESH swaps in a fresh office without leaving passthrough; only an office.html change needs a page reload.
  if (shell && !htmlChanged) { updateReady = false; menu.refresh(); shell.load(); return; }
  try { sessionStorage.setItem('brick-office-reenter', session ? '1' : ''); } catch {}
  if (session) session.end().catch(() => {});
  setTimeout(() => location.reload(), session ? 400 : 0);
}
// After a refresh from inside the headset, ask the browser to put passthrough straight back if it supports session offers.
function offerReentry() {
  let again = false; try { again = sessionStorage.getItem('brick-office-reenter') === '1'; sessionStorage.removeItem('brick-office-reenter'); } catch {}
  if (!again) return;
  notice('Refreshed. Tap "2 · Enter passthrough" to go back in; your office returns to where it was.');
  navigator.xr?.offerSession?.(SESSION_MODE, SESSION_INIT).then(offered => enter(offered)).catch(() => {});
}
// Hang the clock on the real wall you are facing, or float it at the back of the office when no walls are known.
function placeClock() {
  if (!wallClock) return;
  const g = wallClock.group, flat = new THREE.Vector3(gaze.x, 0, gaze.z);
  if (room?.walls.length && flat.lengthSq() > 1e-4) {
    flat.normalize();
    let best = null, bestScore = .2;
    for (const w of room.walls) {
      const toWall = new THREE.Vector3(w.cx - head.x, 0, w.cz - head.z), dist = toWall.length();
      if (w.hw < .6 || dist > 7 || ['door', 'window'].includes(w.label)) continue;
      const score = toWall.normalize().dot(flat) - dist * .02; if (score > bestScore) { bestScore = score; best = w; }
    }
    if (best) {
      const denom = flat.x * best.nx + flat.z * best.nz;
      const along = denom < -.05 ? ((best.cx - head.x) * best.nx + (best.cz - head.z) * best.nz) / denom : 0;
      const hit = { x: head.x + flat.x * along, z: head.z + flat.z * along };
      const a = Math.max(-best.hw + .45, Math.min(best.hw - .45, (hit.x - best.cx) * best.tx + (hit.z - best.cz) * best.tz));
      scene.add(g);
      g.position.set(best.cx + best.tx * a + best.nx * .025, 1.85, best.cz + best.tz * a + best.nz * .025);
      g.rotation.set(0, Math.atan2(best.nx, best.nz), 0); return;
    }
  }
  office.add(g); g.position.set(0, 1.95, -3.2); g.rotation.set(0, 0, 0);
}

// ---------------- room fitting ----------------
const DESK_PROBES = [[-.78, -.42], [.78, -.42], [-.78, .42], [.78, .42], [0, .95]];
const BOARD_PROBES = [[-.95, -.28], [.95, -.28], [-.95, .28], [.95, .28]];
// Push an office-space object (desk, podium) so every probe point is clear of walls and furniture. Returns the local shift.
function nudgeIntoRoom(group, probes, r = .1) {
  const shift = new THREE.Vector3();
  for (let pass = 0; pass < 3; pass++) {
    for (const [px, pz] of probes) {
      group.updateMatrixWorld(true);
      const world = group.localToWorld(new THREE.Vector3(px, 0, pz)), pushed = world.clone();
      if (!room.constrain(pushed, r)) continue;
      const local = pushed.sub(world).applyQuaternion(office.getWorldQuaternion(new THREE.Quaternion()).invert()); local.y = 0;
      group.position.add(local); shift.add(local);
    }
  }
  return shift;
}
// Move desks (and the whiteboard) inward until they sit inside the room, then keep them from overlapping each other.
function fitToRoom() {
  if (!room?.known || !office) return;
  office.updateMatrixWorld(true);
  const desks = [...staff.values()].map(s => s.desk.group).concat([...emptyDesks.values()].map(d => d.group));
  for (let round = 0; round < 4; round++) {
    for (const g of desks) nudgeIntoRoom(g, DESK_PROBES);
    for (let i = 0; i < desks.length; i++) for (let j = i + 1; j < desks.length; j++) {
      const a = desks[i], b = desks[j], dx = b.position.x - a.position.x, dz = b.position.z - a.position.z;
      if (Math.abs(dx) < 1.65 && Math.abs(dz) < 1.1) { const push = (1.65 - Math.abs(dx)) / 2 * (dx < 0 ? -1 : 1); a.position.x -= push; b.position.x += push; }
    }
  }
  for (const g of desks) nudgeIntoRoom(g, DESK_PROBES);
  if (whiteboard) nudgeIntoRoom(whiteboard.group, BOARD_PROBES);
  notice(room.summary);
}
// Real furniture and walls: keep standing, thrown and led workers inside the room.
function keepInRoom(avatar) {
  if (!room?.known || avatar.mode === 'seated') return;
  const world = avatar.root.getWorldPosition(new THREE.Vector3());
  if (!room.constrain(world, .3)) return;
  const y = avatar.root.position.y; avatar.root.position.copy(office.worldToLocal(world)); avatar.root.position.y = y;
  if (avatar.mode === 'airborne') { avatar.velocity.x *= -.3; avatar.velocity.z *= -.3; }
}
// Guardian boundary (bounded-floor) as a fallback room outline when no scanned walls are available.
function trackBoundary(frame, reference) {
  if (room.source === 'planes' || !session) return;
  if (!boundedAsked) {
    boundedAsked = true;
    session.requestReferenceSpace('bounded-floor').then(space => { boundedSpace = space; }).catch(() => {});
    return;
  }
  if (!boundedSpace || room.known || !boundedSpace.boundsGeometry?.length) return;
  // The bounded-floor origin can differ from local-floor: compare where the headset is in each to map between them.
  const a = frame.getViewerPose(reference), b = frame.getViewerPose(boundedSpace); if (!a || !b) return;
  const yawOf = q => new THREE.Euler().setFromQuaternion(new THREE.Quaternion(q.x, q.y, q.z, q.w), 'YXZ').y;
  const dyaw = yawOf(a.transform.orientation) - yawOf(b.transform.orientation), pa = a.transform.position, pb = b.transform.position;
  const rot = new THREE.Matrix4().makeRotationY(dyaw);
  room.setBoundary(boundedSpace.boundsGeometry.map(p => {
    const v = new THREE.Vector3(p.x - pb.x, 0, p.z - pb.z).applyMatrix4(rot); return { x: v.x + pa.x, z: v.z + pa.z };
  }));
}

// ---------------- frame ----------------
function frameLoop(ms, frame) {
  if (!scene || disposed) return;
  // three only re-requests the next frame after this callback returns, so an exception here would freeze the office.
  try { tick(frame); } catch (error) {
    if (error.message !== lastFrameError) { lastFrameError = error.message; console.error(error); notice('Frame error: ' + error.message); }
  }
  renderer.render(scene, camera);
}
function tick(frame) {
  const dt = Math.min(clock.getDelta(), .05), t = now();
  if (session && frame) {
    const reference = renderer.xr.getReferenceSpace(), viewer = frame.getViewerPose(reference);
    if (viewer) {
      const p = viewer.transform.position, q = viewer.transform.orientation;
      head.set(p.x, p.y, p.z); headQuat.set(q.x, q.y, q.z, q.w);
      gaze.set(0, 0, -1).applyQuaternion(headQuat); headUp.set(0, 1, 0).applyQuaternion(headQuat);
      if (firstFrame) { firstFrame = false; recenter(); }
      if (officeAnchor) {
        let pose = null;
        try { pose = frame.getPose(officeAnchor.anchorSpace, reference); } catch { officeAnchor = null; }  // anchor lost or deleted
        if (pose) {
          const a = pose.transform.position, o = pose.transform.orientation, e = new THREE.Euler().setFromQuaternion(new THREE.Quaternion(o.x, o.y, o.z, o.w), 'YXZ');
          // Only the anchor's spot and heading count. Its height is ignored: the office always stands on the local-floor floor (y = 0),
          // because a restored anchor can come back above or below where it was made (the floor estimate differs between sessions,
          // and anchors drift), which would sink every desk into the floor.
          office.position.set(a.x, 0, a.z); office.rotation.set(0, e.y, 0);
        }
      }
      if (anchorPending) anchorOffice(frame, reference);
      if (!VR) { room.update(frame, reference, head, t); trackBoundary(frame, reference); }
      const active = hands.update(frame, reference, session.inputSources, dt);
      if (VR) {
        locomotion.update(dt, hands.hands, head, gaze);
        if (locomotion.jumped) for (const h of Object.values(hands.hands)) h.prevValid = false;   // no fake hand speed from a jump
      }
      menu.place(hands.hands.left, hands.hands.right, head, t);
      for (const b of blasters) {
        b.setActive(true); b.track(head, gaze, dt);
        b.highlight(active.some(h => !h.held && b.near(h.palm)));
      }
      for (const h of active) {
        // Blasters come first: once drawn one owns this hand until it goes back in its holster. Either hand can draw from either hip.
        if (h.held?.type === 'blaster') { holdBlaster(h, t); hands.setPointer(h, null, false, false); continue; }
        const holstered = h.grab && !h.wasGrab && !h.held && blasters.find(b => b.near(h.palm));
        if (holstered) {
          h.held = { type: 'blaster', blaster: holstered }; holstered.draw(h); sfx.click(holstered.hip);
          h.source?.gamepad?.hapticActuators?.[0]?.pulse?.(.4, 40); hands.setPointer(h, null, false, false); continue;
        }
        if (menu.update(h, t)) { hands.setPointer(h, null, false, false); continue; }
        if (h.controller) {
          const target = pointerTarget(h);
          if (!h.held && h.trigger && !h.wasTrigger) pointerStart(h, target);
          if (h.held?.pointer) {
            if (h.trigger && h.rayValid) pointerMove(h, dt);
            else grabEnd(h);
          } else {
            if (h.grab && !h.wasGrab && !h.held) grabStart(h, h.point);
            if (h.held && h.grab) grabMove(h, h.point, dt);
            if (!h.grab && h.held) grabEnd(h);
          }
          const heldPoint = h.held?.pointer && h.held.plane ? h.ray.intersectPlane(h.held.plane, new THREE.Vector3()) : null;
          hands.setPointer(h, h.held?.pointer ? { point: heldPoint || h.ray.at(h.held.depth, new THREE.Vector3()) } : target?.hit, !!h.held);
          if (!h.held) touchDog(h, t);
          continue;
        }
        // Tracked hands: grab what is within reach; otherwise pinch while aiming at something to drag it from a distance.
        const target = !h.held && h.rayValid ? pointerTarget(h) : null;
        if (h.held?.pointer) {
          if (h.pinch && h.rayValid) pointerMove(h, dt);
          else grabEnd(h);
        } else {
          if (h.grab && !h.wasGrab && !h.held) {
            grabStart(h, h.point); if (!h.held && h.pinch && target) pointerStart(h, target);
            // a pinch at empty floor aims a teleport; letting go jumps there
            if (VR && !h.held && h.pinch && !target && locomotion.aimWithHand(h)) h.teleporting = true;
          }
          if (h.teleporting) { if (h.pinch && h.rayValid) locomotion.aimWithHand(h); else { h.teleporting = false; locomotion.release(head); for (const k of Object.values(hands.hands)) k.prevValid = false; } }
          if (h.held && !h.held.pointer && h.grab) grabMove(h, h.point, dt);
          if (!h.grab && h.held && !h.held.pointer) grabEnd(h);
        }
        const heldPoint = h.held?.pointer && h.held.plane ? h.ray.intersectPlane(h.held.plane, new THREE.Vector3()) : null;
        hands.setPointer(h, h.held?.pointer ? { point: heldPoint || h.ray.at(h.held.depth, new THREE.Vector3()) } : target?.hit, !!h.held?.pointer);
        if (!h.held && !h.grab && !locomotion?.moving) { touches(h, t); touchDog(h, t); }
        pokeKeys(h, t);
      }
      for (const h of Object.values(hands.hands)) if (!active.includes(h)) hands.setPointer(h);
    }
  } else {
    orbit.update(); camera.getWorldPosition(head); camera.getWorldDirection(gaze); headUp.set(0, 1, 0);
  }
  if (room.version !== fittedVersion) { fittedVersion = room.version; fitToRoom(); placeClock(); }
  wallClock?.update(new Date(), session ? questBattery : null);
  if (checkUpdates && t - lastUpdateCheck > 4) checkUpdates();
  if (now() - lastModeShare > 20) shareMode();   // every page keeps reporting, so the sandbox knows who is in it
  if (t % .3 < dt) chooseFocus(t);
  if (t - lastLayoutSend > .1 && draggedDesks().size) shareLayout(false);
  slideDesks(dt);
  // auto-reconnect the voice line when you speak to the focused worker again
  if (voiceOn && focusId && !voice.ready && !voice.connecting && t - voice.lastHuman < 1 && t - lastConnectTry > 4) connectFocus(false);

  for (const [id, s] of staff) {
    if (t - s.lastDraw > .12 && s.view.draw()) { s.desk.texture.needsUpdate = true; s.lastDraw = t; }
    const talking = voice.ready && voice.worker === id;
    s.avatar.update(dt, { desk: s.desk, listenerWorld: head, level: talking ? voice.level : 0, working: s.info.status === 'working', approval: s.info.status === 'approval', focused: focusId === id, talking });
    if (s.avatar.landed) {
      const where = s.avatar.root.getWorldPosition(new THREE.Vector3());
      sfx.thud(where, s.avatar.landed);
      if (s.avatar.mode === 'knocked') physical(s, 'dropped');
      s.avatar.landed = 0;
    }
    keepInRoom(s.avatar);
    for (const cap of s.desk.keys) if (cap.userData.pressedUntil && t > cap.userData.pressedUntil) { cap.position.y = cap.userData.rest; cap.userData.pressedUntil = 0; }
    s.desk.outline.visible = arranging || (!session && focusId === id);
  }
  dog?.update(dt, t, head, gaze);
  if (!session) { for (const b of blasters) b.setActive(false); flyers?.clear(); }
  for (const b of blasters) b.update(dt);
  if (session) flyers?.update(dt, head, room, blasters.some(b => b.held));
  updateZaps(dt);
  mods?.update(dt, t);
  if (sfx.music && !sfx.playing) sfx.stopMusic();
  const active = staff.get(voice.worker);
  voice.update(head, gaze, headUp, active ? active.avatar.partCenter('head') : head);
  caption.update(staff.get(focusId), head, t);
  if (!session) menu.place(null, null, head, t);
  if (bigScreen.group.visible && bigFor && !staff.has(bigFor)) bigScreen.group.visible = false;
}

// ---------------- captions above the focused worker ----------------
function makeCaption() {
  const label = labelTexture(1024, 220, (g, c, who, text) => {
    g.clearRect(0, 0, c.width, c.height); if (!text) return;
    g.fillStyle = '#0f1620e0'; g.beginPath(); g.roundRect(6, 6, c.width - 12, c.height - 12, 30); g.fill();
    g.fillStyle = who === 'You' ? '#8fd0ff' : '#f8ce52'; g.font = 'bold 34px system-ui, sans-serif'; g.fillText(who, 34, 58);
    g.fillStyle = '#f3f6fa'; g.font = '36px system-ui, sans-serif';
    const words = text.slice(-170).split(' '), lines = []; let line = '';
    for (const w of words) { if (g.measureText(line + w).width > c.width - 70) { lines.push(line); line = ''; } line += w + ' '; }
    lines.push(line); lines.slice(-3).forEach((l, i) => g.fillText(l.trim(), 34, 110 + i * 44));
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(.9, .9 * 220 / 1024), new THREE.MeshBasicMaterial({ map: label.texture, transparent: true, depthTest: false, toneMapped: false }));
  mesh.renderOrder = 6; mesh.visible = false;
  let shownAt = 0;
  return {
    mesh,
    set(who, text) { label.redraw(who, text); shownAt = now(); mesh.visible = !!text; },
    update(s, viewer, t) {
      if (!s || t - shownAt > 8) { mesh.visible = false; return; }
      const p = s.avatar.partCenter('head'); mesh.position.set(p.x, p.y + .42, p.z); mesh.lookAt(viewer);
    },
  };
}

// ---------------- wrist menu ----------------
// A cyberpunk HUD beside the left hand. It can be collapsed to a small MENU chip: press HIDE MENU (or the left controller's Y),
// then poke or point at the chip (or press Y) to open it again. Open or collapsed is remembered between sessions.
const MENU_KEY = 'office:wrist-menu-open';
const HUD = { cyan: '#33e6ff', pink: '#ff3fb4', yellow: '#fcee0a', ink: '#07080f', text: '#dff6ff', mono: 'ui-monospace, Consolas, "Droid Sans Mono", monospace' };
// A box with its top-right and bottom-left corners cut off.
function notchPath(g, x, y, w, h, n) {
  g.beginPath(); g.moveTo(x, y); g.lineTo(x + w - n, y); g.lineTo(x + w, y + n); g.lineTo(x + w, y + h); g.lineTo(x + n, y + h); g.lineTo(x, y + h - n); g.closePath();
}
function hudPlate(g, c, { stroke = HUD.cyan, fill = '#07080fe8', notch = 22, line = 4 } = {}) {
  g.clearRect(0, 0, c.width, c.height);
  notchPath(g, line, line, c.width - line * 2, c.height - line * 2, notch); g.fillStyle = fill; g.fill();
  g.save(); g.clip(); g.fillStyle = '#ffffff08'; for (let y = 0; y < c.height; y += 4) g.fillRect(0, y, c.width, 1); g.restore();   // scanlines
  g.shadowColor = stroke; g.shadowBlur = 12; g.strokeStyle = stroke; g.lineWidth = line; g.stroke(); g.shadowBlur = 0;
}
function makeMenu() {
  const group = new THREE.Group(); group.visible = false;
  const panel = new THREE.Group(); group.add(panel);          // everything but the collapsed chip
  const W = .085, H = .034, GAP = .006, buttons = [];
  let open = true;
  try { open = localStorage.getItem(MENU_KEY) !== '0'; } catch {}
  const items = [
    ['voice', () => voiceOn ? 'VOICE: ON' : 'VOICE: OFF', enableVoice],
    ['mic', () => voice?.micEnabled ? 'MUTE MIC' : 'UNMUTE MIC', () => voice.mute(voice.micEnabled)],
    ['big', () => bigScreen?.group.visible ? 'HIDE SCREEN' : 'BIG SCREEN', toggleBig],
    ['party', () => 'OFFICE PARTY', party],
    ['arrange', () => arranging ? 'DONE ARRANGING' : 'ARRANGE DESKS', toggleArrange],
    ['mode', () => `MODE: ${PROFILE.label.toUpperCase()}`, () => setOfficeMode(OFFICE_MODE === 'sandbox' ? 'enterprise' : 'sandbox')],
    ['recenter', () => 'OFFICE HERE', recenter],
    ['turnLeft', () => 'TURN LEFT', () => VR && locomotion.turn(Math.PI / 6, head)],
    ['turnRight', () => 'TURN RIGHT', () => VR && locomotion.turn(-Math.PI / 6, head)],
    ['hands', () => hands?.visible ? 'HIDE HANDS' : 'SHOW HANDS', () => hands.setVisible(!hands.visible)],
    ['border', () => room?.group.visible ? 'HIDE BORDER' : 'SHOW BORDER', () => room.setVisible(!room.group.visible)],
    ['fit', () => 'FIT TO ROOM', () => { fittedVersion = -1; notice(room.summary); }],
    ['refresh', () => updateReady ? 'REFRESH • NEW' : 'REFRESH', reloadOffice],
    ['exit', () => 'EXIT', () => session?.end()],
    ['hide', () => 'HIDE MENU', () => api.toggle(false)],
  ];
  const rows = Math.ceil(items.length / 2), rowY = r => (2 - r) * (H + GAP) - .02, headerY = (H + GAP) * 2.5 + .02;

  // backing plate behind the header and buttons, with neon corner brackets
  const top = headerY + .026, bottom = rowY(rows - 1) - H / 2 - .008, plateW = W * 2 + GAP + .016, plateH = top - bottom;
  const plate = labelTexture(512, Math.round(512 * plateH / plateW), (g, c) => {
    hudPlate(g, c, { stroke: '#33e6ff55', fill: '#05060ccc', notch: 30, line: 3 });
    g.lineWidth = 6; g.shadowBlur = 10;
    g.strokeStyle = g.shadowColor = HUD.cyan; g.beginPath(); g.moveTo(10, 60); g.lineTo(10, 10); g.lineTo(60, 10); g.stroke();
    g.strokeStyle = g.shadowColor = HUD.pink; g.beginPath(); g.moveTo(c.width - 10, c.height - 60); g.lineTo(c.width - 10, c.height - 10); g.lineTo(c.width - 60, c.height - 10); g.stroke();
    g.shadowBlur = 0;
  });
  plate.redraw();
  const plateMesh = new THREE.Mesh(new THREE.PlaneGeometry(plateW, plateH), new THREE.MeshBasicMaterial({ map: plate.texture, transparent: true, depthWrite: false, toneMapped: false }));
  plateMesh.position.set(0, (top + bottom) / 2, -.002); panel.add(plateMesh);

  const header = labelTexture(512, 96, (g, c) => {
    hudPlate(g, c, { stroke: HUD.cyan, notch: 18 });
    const s = staff.get(focusId);
    g.font = `bold 30px ${HUD.mono}`; g.fillStyle = HUD.cyan; g.shadowColor = HUD.cyan; g.shadowBlur = 10;
    g.fillText((s ? `${s.worker.name} · ${s.info.status}` : 'Look at a worker').toUpperCase(), 22, 42, c.width - 120); g.shadowBlur = 0;
    g.font = `22px ${HUD.mono}`; g.fillStyle = '#ff8fd0';
    g.fillText(`▸ ${voice?.ready ? 'on the line' : voiceOn ? 'voice idle' : 'voice off'} · US$${(voice?.usd || 0).toFixed(2)} today`, 22, 78, c.width - 44);
    g.font = `bold 18px ${HUD.mono}`; g.fillStyle = '#ffffff55'; g.textAlign = 'right'; g.fillText('L-100', c.width - 22, 36); g.textAlign = 'left';
  });
  const headerMesh = new THREE.Mesh(new THREE.PlaneGeometry(W * 2 + GAP, .04), new THREE.MeshBasicMaterial({ map: header.texture, transparent: true, toneMapped: false }));
  headerMesh.position.y = headerY; panel.add(headerMesh);

  const pinkIds = new Set(['exit', 'hide']);
  items.forEach(([id, text, action], i) => {
    const label = labelTexture(320, 128, (g, c, on) => {
      const pink = pinkIds.has(id), accent = on ? HUD.yellow : pink ? HUD.pink : HUD.cyan;
      hudPlate(g, c, { stroke: accent, fill: on ? HUD.yellow : '#0a1020ee', notch: 24 });
      g.fillStyle = on ? HUD.ink : accent; g.fillRect(16, 16, 14, 4);                     // a little tick in the corner
      g.font = `bold 34px ${HUD.mono}`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = on ? HUD.ink : pink ? '#ffc2e4' : HUD.text;
      if (!on) { g.shadowColor = accent; g.shadowBlur = 8; }
      g.fillText(text(), c.width / 2, c.height / 2 + 2, c.width - 36); g.shadowBlur = 0;
    });
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ map: label.texture, transparent: true, toneMapped: false }));
    mesh.position.set((i % 2 - .5) * (W + GAP), rowY(Math.floor(i / 2)), 0);
    mesh.userData = { id, action, label, pressedAt: 0 }; panel.add(mesh); buttons.push(mesh);
  });

  // the collapsed chip: poke it, point at it or press Y to open the menu
  const chipLabel = labelTexture(256, 96, (g, c, controller) => {
    hudPlate(g, c, { stroke: HUD.cyan, notch: 20 });
    g.font = `bold 34px ${HUD.mono}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillStyle = HUD.cyan; g.shadowColor = HUD.cyan; g.shadowBlur = 12;
    g.fillText(controller ? '▲ MENU · Y' : '▲ MENU', c.width / 2, c.height / 2 + 2, c.width - 30); g.shadowBlur = 0;
  });
  const chip = new THREE.Mesh(new THREE.PlaneGeometry(.075, .028), new THREE.MeshBasicMaterial({ map: chipLabel.texture, transparent: true, toneMapped: false }));
  chip.userData = { id: 'chip', action: () => api.toggle(true), label: chipLabel, pressedAt: 0 }; group.add(chip); buttons.push(chip);

  // Where you are pointing: a ring on the menu, plus a beam when aiming from a distance.
  const cursor = new THREE.Mesh(new THREE.RingGeometry(.004, .007, 24), new THREE.MeshBasicMaterial({ color: 0x33e6ff, depthTest: false, toneMapped: false }));
  cursor.renderOrder = 8; cursor.visible = false; group.add(cursor);
  const beam = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]), new THREE.LineBasicMaterial({ color: 0x33e6ff, transparent: true, opacity: .75, toneMapped: false }));
  beam.frustumCulled = false; beam.visible = false; scene.add(beam);
  let lastHeader = 0, lastFacing = -10, hovered = null, yWas = false, openedAt = -10, chipController = null, now = 0;
  const inside = new Map(), UP = new THREE.Vector3(0, 1, 0), tmp = new THREE.Vector3();
  const hover = b => { if (hovered === b) return; hovered?.scale.setScalar(1); hovered = b; b?.scale.setScalar(1.08); };
  const pointAt = world => { cursor.position.copy(group.worldToLocal(world.clone())).setZ(.003); cursor.visible = true; };
  const show = () => { panel.visible = open; chip.visible = !open; };
  show();
  const api = {
    group,
    get open() { return open; },
    refresh() {
      for (const b of buttons) if (b !== chip) b.userData.label.redraw(['voice', 'big', 'arrange', 'refresh'].includes(b.userData.id) && ((b.userData.id === 'refresh' && updateReady) || (b.userData.id === 'voice' && voiceOn) || (b.userData.id === 'big' && bigScreen?.group.visible) || (b.userData.id === 'arrange' && arranging)));
      header.redraw(); chipLabel.redraw(!!chipController);
    },
    // Collapse to the chip (false), open the full menu (true), or flip it (no argument).
    toggle(force) {
      open = typeof force === 'boolean' ? force : !open; openedAt = now; show();
      try { localStorage.setItem(MENU_KEY, open ? '1' : '0'); } catch {}
      hover(null); for (const b of buttons) inside.set(b, true);   // a finger already there must move off and back to press
      api.refresh();
    },
    press(b, t) {
      if (t - b.userData.pressedAt < .4) return;
      b.userData.pressedAt = t; sfx.click(b.getWorldPosition(new THREE.Vector3()));
      const done = () => api.refresh();
      try { Promise.resolve(b.userData.action()).then(done, error => { notice(error.message); done(); }); } catch (error) { notice(error.message); done(); }
    },
    // Beside the left hand when its palm faces you (always beside a left controller).
    place(left, right, viewer, t) {
      now = t;
      hover(null); cursor.visible = beam.visible = false;
      if (!session) { group.visible = false; return; }
      // The left controller's Y button opens and collapses the menu.
      const y = !!(left?.controller && left.source?.gamepad?.buttons?.[5]?.pressed);
      if (y && !yWas) { api.toggle(); if (group.visible) sfx.click(group.getWorldPosition(new THREE.Vector3())); }
      yWas = y;
      if (!!left?.controller !== chipController) { chipController = !!left?.controller; chipLabel.redraw(chipController); }
      const toViewer = left?.valid ? tmp.subVectors(viewer, left.palm).normalize() : null;
      // Easier to keep open than to open, so the menu does not flicker while you use it.
      const facing = !!toViewer && (left.controller || left.palmNormal.dot(toViewer) > (group.visible ? .25 : .5));
      // While your right finger is at the menu it holds still, and stays open briefly if the left hand drops out of tracking.
      const fingerNear = group.visible && right?.valid && !right.controller && right.indexTip?.distanceTo(group.position) < .18;
      if (facing) lastFacing = t;
      group.visible = facing || (group.visible && t - lastFacing < (fingerNear ? 1.5 : .35));
      if (!group.visible) return;
      if (facing && !fingerNear) {
        // On the thumb side (to your right), so the poking finger does not cover the hand being tracked.
        const flat = new THREE.Vector3(toViewer.x, 0, toViewer.z);
        if (flat.lengthSq() < 1e-4) flat.set(-gaze.x, 0, -gaze.z);
        flat.normalize();
        const side = new THREE.Vector3().crossVectors(UP, flat);
        group.position.copy(left.palm).addScaledVector(side, .14).addScaledVector(flat, .03).addScaledVector(UP, .03);
        group.lookAt(viewer); group.updateMatrixWorld(true);
      }
      // Opening unfolds the panel out of the chip.
      const k = Math.min(1, (t - openedAt) / .18), ease = 1 - (1 - k) ** 3;
      panel.scale.set(1, open ? .15 + .85 * ease : 1, 1); panel.position.y = open ? (1 - ease) * .04 : 0;
      chip.material.opacity = .8 + .2 * Math.sin(t * 4);
      if (open && t - lastHeader > .5) { header.redraw(); lastHeader = t; }
    },
    // Right hand only: poke with the index finger, or aim the hand/controller ray and pinch/pull the trigger.
    // Returns true while the hand is using the menu, so it does not also grab or slap.
    update(h, t) {
      if (!group.visible || h.handedness !== 'right' || h.held) return false;
      const live = buttons.filter(b => b.visible && b.parent.visible);    // the raycaster does not skip hidden meshes
      if (!h.controller && h.indexTip) {
        let near = false;
        for (const b of live) {
          const { width: bw, height: bh } = b.geometry.parameters;
          const local = b.worldToLocal(tmp.copy(h.indexTip));
          const over = Math.abs(local.x) < bw / 2 + .004 && Math.abs(local.y) < bh / 2 + .004;
          const pressed = over && local.z < .01 && local.z > -.035;
          if (over && local.z < .07 && local.z > -.035) { near = true; hover(b); pointAt(b.localToWorld(new THREE.Vector3(local.x, local.y, 0))); }
          if (pressed && !inside.get(b)) api.press(b, t);
          inside.set(b, pressed);
        }
        if (near) return true;
      }
      if (!h.rayValid) return false;
      raycaster.ray.copy(h.ray); raycaster.far = 4;
      const found = raycaster.intersectObjects(live, false)[0];
      raycaster.far = Infinity;
      if (!found) return false;
      hover(found.object); pointAt(found.point);
      const line = beam.geometry.attributes.position;
      line.setXYZ(0, h.ray.origin.x, h.ray.origin.y, h.ray.origin.z); line.setXYZ(1, found.point.x, found.point.y, found.point.z); line.needsUpdate = true;
      beam.visible = true;
      if (h.controller ? h.trigger && !h.wasTrigger : h.pinch && !h.wasPinch) api.press(found.object, t);
      return true;
    },
  };
  return api;
}

// ---------------- desktop preview mouse ----------------
function mouseRay(e) {
  const r = renderer.domElement.getBoundingClientRect();
  raycaster.setFromCamera(new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -(e.clientY - r.top) / r.height * 2 + 1), camera);
}
function pick() {
  const targets = [];
  for (const s of staff.values()) { targets.push(s.avatar.root, ...s.desk.keys); if (arranging) targets.push(s.desk.group); }
  if (arranging) for (const desk of emptyDesks.values()) targets.push(desk.group);
  for (const hit of raycaster.intersectObjects(targets, true)) {
    let o = hit.object;
    if (o.userData.key) return { type: 'key', cap: o, hit };
    if (o.userData.avatar) return { type: 'avatar', s: staff.get(o.userData.avatar.worker.id), hit };
    while (o && !o.name.startsWith('desk:')) o = o.parent;
    if (o) return { type: 'desk', s: staff.get(o.name.slice(5)), empty: emptyDesks.get(o.name.slice(5)), hit };
  }
  return null;
}
function mouseDown(e) {
  if (session || e.button !== 0) return;
  mouseRay(e); const target = pick(); if (!target) return;
  if (target.type === 'key') { pressKey(target.cap.userData.worker, target.cap.userData.key, target.cap); return; }
  if (target.type === 'avatar' && e.shiftKey) {
    const dir = raycaster.ray.direction.clone().setY(0).normalize(), strength = e.ctrlKey ? 4.2 : 2.6, where = target.hit.point;
    target.s.avatar.hit(dir, strength); sfx.slap(where, strength); focus(target.s.worker.id); physical(target.s, 'slapped', { strength });
    return;
  }
  orbit.enabled = false; renderer.domElement.setPointerCapture(e.pointerId);
  const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(gaze.clone().setY(0).normalize().negate(), target.hit.point);
  if (target.type === 'desk') {
    const desk = target.s?.desk || target.empty;
    mouseHeld = { type: 'desk', s: target.s, empty: target.empty, desk, plane: new THREE.Plane(new THREE.Vector3(0, 1, 0), -target.hit.point.y), start: office.worldToLocal(target.hit.point.clone()), origin: desk.group.position.clone() };
    return;
  }
  const part = target.s.avatar.touching(target.hit.point, .2) || 'torso';
  target.s.avatar.grab(part === 'head' ? 'head' : part);
  focus(target.s.worker.id);
  physical(target.s, part === 'left' || part === 'right' ? 'led' : 'lifted');
  mouseHeld = { type: 'avatar', s: target.s, part, plane, offset: target.s.avatar.root.getWorldPosition(new THREE.Vector3()).sub(target.hit.point), last: target.hit.point.clone(), velocity: new THREE.Vector3(), time: now() };
}
function mouseMove(e) {
  if (!mouseHeld) return;
  mouseRay(e); const point = raycaster.ray.intersectPlane(mouseHeld.plane, new THREE.Vector3()); if (!point) return;
  if (mouseHeld.type === 'desk') {
    const p = office.worldToLocal(point.clone()), g = mouseHeld.desk.group;
    g.position.set(mouseHeld.origin.x + p.x - mouseHeld.start.x, 0, mouseHeld.origin.z + p.z - mouseHeld.start.z); return;
  }
  const t = now(), dt = Math.max(t - mouseHeld.time, .008);
  mouseHeld.velocity.lerp(point.clone().sub(mouseHeld.last).divideScalar(dt), .5); mouseHeld.last.copy(point); mouseHeld.time = t;
  const part = mouseHeld.part;
  if (part === 'left' || part === 'right') mouseHeld.s.avatar.lead(point, head, dt);
  else mouseHeld.s.avatar.hold(point, mouseHeld.offset);
}
function mouseUp() {
  if (!mouseHeld) return;
  if (mouseHeld.type === 'avatar') {
    const v = now() - mouseHeld.time > .15 ? new THREE.Vector3() : mouseHeld.velocity;
    mouseHeld.s.avatar.release(v);
    if (v.length() > 2.2) physical(mouseHeld.s, 'thrown');
  } else saveLayout();
  mouseHeld = null; orbit.enabled = true;
}
function mouseDouble(e) { mouseRay(e); const target = pick(); if (target?.s) focus(target.s.worker.id, true); }

// ---------------- panel ----------------
$('voiceBtn').onclick = enableVoice;
$('enterBtn').onclick = () => enter();
$('refreshBtn').onclick = reloadOffice;
$('partyBtn').onclick = party;
$('arrangeBtn').onclick = toggleArrange;
$('bigBtn').onclick = () => { if (!focusId) { notice('Pick a worker first.'); return; } if (bigScreen.group.visible) toggleBig(); else { bigScreen.placed = false; showBig(focusId); } };
$('resetLayout').onclick = () => { localStorage.removeItem(LAYOUT_KEY); location.reload(); };
for (const mode of Object.keys(MODES)) {
  const button = $('mode-' + mode); if (!button) continue;
  button.classList.toggle('primary', mode === OFFICE_MODE); button.onclick = () => setOfficeMode(mode);
}
if ($('modeHelp')) $('modeHelp').textContent = OFFICE_MODE === 'sandbox'
  ? 'Sandbox: an empty room with your two agents. Ask them to build whatever you like.'
  : 'Enterprise: the full office, with project board, clock, dog and toys.';
// Hide or show the panel: the tab on its edge, or the M key. Remembered between visits. The tab is made here, not in
// office.html, so it arrives with a hot swap.
const PANEL_KEY = 'office:panel-collapsed';
const panelToggle = document.createElement('button');
panelToggle.id = 'panelToggle'; panelToggle.type = 'button'; panelToggle.setAttribute('aria-controls', 'panel');
$('panel').after(panelToggle); later(() => panelToggle.remove());
function collapsePanel(collapsed) {
  document.body.classList.toggle('panel-collapsed', collapsed);
  panelToggle.setAttribute('aria-expanded', String(!collapsed));
  panelToggle.title = collapsed ? 'Show the menu (M)' : 'Hide the menu (M)';
  panelToggle.innerHTML = collapsed ? '<span>▶</span> MENU' : '<span>◀</span>';
  try { localStorage.setItem(PANEL_KEY, collapsed ? '1' : ''); } catch {}
}
let panelCollapsed = false;
try { panelCollapsed = localStorage.getItem(PANEL_KEY) === '1'; } catch {}
collapsePanel(panelCollapsed);
panelToggle.onclick = () => collapsePanel(!document.body.classList.contains('panel-collapsed'));
const panelKey = e => {
  if (e.key.toLowerCase() !== 'm' || e.ctrlKey || e.metaKey || e.altKey || e.repeat) return;
  if (e.target.closest?.('input, textarea, select, [contenteditable]')) return;
  panelToggle.click();
};
window.addEventListener('keydown', panelKey); later(() => window.removeEventListener('keydown', panelKey));
const closeVoice = () => voice?.socket?.close();
window.addEventListener('beforeunload', closeVoice); later(() => window.removeEventListener('beforeunload', closeVoice));

// ---------------- teardown and handover ----------------
// Stop everything this office started and hand the shell what the next office should carry on with.
async function disposeApp() {
  disposed = true;
  for (const h of Object.values(hands?.hands || {})) if (h.held) { try { grabEnd(h); } catch {} }
  const carry = {
    voice, voiceOn, audio: sfx?.ctx || null, focusId,
    officePosition: office?.position.clone(), officeQuaternion: office?.quaternion.clone(), officeAnchor, anchorPending, locomotion: locomotion?.state,
  };
  for (const fn of cleanups.splice(0).reverse()) { try { fn(); } catch (error) { console.error(error); } }
  eventsSocket?.close();
  for (const s of staff.values()) s.client?.close?.();
  try { mods?.disposeAll(); } catch {}
  try { sfx?.stopMusic?.(); } catch {}
  $('roster')?.replaceChildren();
  if (scene) {
    scene.traverse(o => {
      if (o.isSkinnedMesh) { o.skeleton?.dispose(); return; }   // own bone texture; kit geometry is shared with the next office's figures
      o.geometry?.dispose();
      for (const m of [].concat(o.material || [])) { for (const key of ['map', 'emissiveMap']) m[key]?.dispose?.(); m.dispose?.(); }
    });
    scene.clear();
  }
  renderer?.renderLists?.dispose();
  return carry;
}
const app = {
  start: carry => boot(carry).catch(error => { notice(error.message); setStatus('UNAVAILABLE'); console.error(error); }),
  frame: frameLoop, dispose: disposeApp, sessionEnded, notice,
};
if (shell) shell.register(app);
else app.start(null);

