// Life-size cartoon office worker: simple rounded parts on the skeleton and clips in ../assets/rig.glb.
// Positions are kept in the office space (the avatar root's parent); public methods take world-space input.
import * as THREE from 'three';
import { GLTFLoader } from './vendor/GLTFLoader.js';
import { clone } from './vendor/SkeletonUtils.js';
import { mergeVertices } from './vendor/BufferGeometryUtils.js';
import { DESK } from './furniture.js';

const KIT_HEIGHT = 4.292;
export const LIFE = 1.75 / KIT_HEIGHT;       // a 1.75 m tall figure
const HIP_UNITS = 1.27;                       // Leg bone height in kit units
const SEAT_ROOT_Y = DESK.seatHeight + .11 - HIP_UNITS * LIFE;
const SIT_LEG = Math.PI * .62;                // legs forward, angled down so the feet clear the desk (rest is Math.PI)
const UP = new THREE.Vector3(0, 1, 0);
const tmp = new THREE.Vector3(), tmp2 = new THREE.Vector3(), quat = new THREE.Quaternion();
const BONES = new Set(['Root', 'Torso', 'Head', 'LegL', 'LegR', 'ArmL', 'ArmR', 'ForearmL', 'ForearmR', 'HandL', 'HandR']);
export const SHELL = '#f2f4f7', SKIN = '#fbcfa5', GLOW = '#7cf0ff';
const SHOES = '#2a2e35', HAIR_STYLES = ['short', 'swept', 'bob', 'crop'];

let kitPromise;
export function loadKit() { return kitPromise ||= new GLTFLoader().loadAsync('/assets/rig.glb'); }

// A tiny soft-studio reflection map so the plastic has highlights even in rooms without an environment map.
let studio;
function studioMap() {
  if (studio) return studio;
  const face = (top, bottom) => {
    const c = document.createElement('canvas'); c.width = c.height = 32; const g = c.getContext('2d');
    const grad = g.createLinearGradient(0, 0, 0, 32); grad.addColorStop(0, top); grad.addColorStop(1, bottom);
    g.fillStyle = grad; g.fillRect(0, 0, 32, 32); return c;
  };
  const side = () => face('#ffffff', '#6f7a88');
  studio = new THREE.CubeTexture([side(), side(), face('#ffffff', '#ffffff'), face('#4a525c', '#4a525c'), side(), side()]);
  studio.colorSpace = THREE.SRGBColorSpace; studio.needsUpdate = true; return studio;
}
export function plastic(color, roughness = .3) {
  return new THREE.MeshStandardMaterial({ color, roughness, envMap: studioMap(), envMapIntensity: .45 });
}

// A plastic box with rounded edges, centred on the origin: r rounds the edges, corner the outline's corners (at least r).
export function roundBox(w, h, d, r = Math.min(w, h, d) * .18, corner = 2 * r) {
  // the bevel grows the outline by r on every side, so the outline itself is r smaller all round
  const W = w / 2 - r, H = h / 2 - r, c = Math.max(.001, Math.min(corner - r, W * .98, H * .98)), x = W - c, y = H - c, s = new THREE.Shape();
  s.moveTo(-x, -H); s.lineTo(x, -H); s.quadraticCurveTo(W, -H, W, -y); s.lineTo(W, y);
  s.quadraticCurveTo(W, H, x, H); s.lineTo(-x, H); s.quadraticCurveTo(-W, H, -W, y);
  s.lineTo(-W, -y); s.quadraticCurveTo(-W, -H, -x, -H);
  const depth = Math.max(.001, d - 2 * r);
  const g = new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: r, bevelSize: r * .999, bevelSegments: Math.max(4, Math.round(r * 26)), curveSegments: Math.max(6, Math.round(corner * 20)) });
  g.translate(0, 0, -depth / 2); g.deleteAttribute('uv');
  const smooth = mergeVertices(g, 1e-4); smooth.computeVertexNormals(); g.dispose(); return smooth;   // smooth shading across the bevels
}
// A round mitten pointing along +Y from its wrist, thumb on the +X side (mirror with side = -1).
export function mitten(material, side = 1, size = 1) {
  const hand = new THREE.Group();
  const palm = new THREE.Mesh(new THREE.SphereGeometry(.5 * size, 24, 16), material);
  palm.scale.set(1, 1.15, .78); palm.position.y = .55 * size; hand.add(palm);
  const thumb = new THREE.Mesh(new THREE.CapsuleGeometry(.17 * size, .22 * size, 6, 12), material);
  thumb.position.set(.42 * size * side, .42 * size, .12 * size); thumb.rotation.z = -.6 * side; hand.add(thumb);
  return hand;
}

// ---------- faces (drawn on a patch of the head) ----------
// The face canvas covers the front of the head: x across, y down, the eyes on the middle line.
const FACE = 512;
const faceCache = new Map();
function drawFace(expression, brow) {
  const c = document.createElement('canvas'); c.width = c.height = FACE; const g = c.getContext('2d');
  const ink = '#2b1d16', lips = '#7a2b2b', eyes = [152, 360], ey = 196, my = 362;
  g.lineCap = 'round'; g.lineJoin = 'round';
  const cheeks = (alpha = .26) => { g.fillStyle = `rgba(240,110,110,${alpha})`; for (const x of [104, 408]) { g.beginPath(); g.ellipse(x, 300, 44, 22, 0, 0, Math.PI * 2); g.fill(); } };
  const ovalEyes = (rx = 27, ry = 38, dy = 0) => {
    for (const x of eyes) {
      g.fillStyle = ink; g.beginPath(); g.ellipse(x, ey + dy, rx, ry, 0, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#ffffff'; g.beginPath(); g.arc(x + rx * .35, ey + dy - ry * .4, rx * .4, 0, Math.PI * 2); g.fill();
    }
  };
  const brows = (dy = 0, tilt = 0) => {
    g.strokeStyle = brow; g.lineWidth = 15;
    for (const [i, x] of eyes.entries()) { const s = i ? -1 : 1; g.beginPath(); g.moveTo(x - 38 * s, ey - 62 + dy + tilt); g.quadraticCurveTo(x, ey - 76 + dy, x + 34 * s, ey - 66 + dy - tilt); g.stroke(); }
  };
  const smile = (w = 44, h = 15) => { g.strokeStyle = ink; g.lineWidth = 10; g.beginPath(); g.moveTo(256 - w, my); g.quadraticCurveTo(256, my + h * 2, 256 + w, my); g.stroke(); };
  const openMouth = (w, h) => {
    g.fillStyle = lips; g.beginPath(); g.ellipse(256, my + 6, w, h, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#d9686b'; g.beginPath(); g.ellipse(256, my + 6 + h * .45, w * .55, h * .4, 0, 0, Math.PI * 2); g.fill();
  };
  switch (expression) {
    case 'blink':
      brows(); g.strokeStyle = ink; g.lineWidth = 10;
      for (const x of eyes) { g.beginPath(); g.moveTo(x - 24, ey + 4); g.quadraticCurveTo(x, ey + 18, x + 24, ey + 4); g.stroke(); }
      cheeks(); smile(); break;
    case 'talkA': brows(); ovalEyes(); cheeks(); openMouth(28, 13); break;
    case 'talkB': brows(-5); ovalEyes(); cheeks(); openMouth(32, 25); break;
    case 'ouch':
      brows(10, 12); g.strokeStyle = ink; g.lineWidth = 11;
      for (const [i, x] of eyes.entries()) { const s = i ? -1 : 1; g.beginPath(); g.moveTo(x - 22 * s, ey - 24); g.lineTo(x + 18 * s, ey); g.lineTo(x - 22 * s, ey + 24); g.stroke(); }
      g.lineWidth = 10; g.beginPath(); g.moveTo(214, my + 4); for (let i = 1; i <= 4; i++) g.lineTo(214 + i * 21, i % 2 ? my - 10 : my + 10); g.stroke(); break;
    case 'happy':
      brows(-10); g.strokeStyle = ink; g.lineWidth = 11;
      for (const x of eyes) { g.beginPath(); g.arc(x, ey + 14, 24, Math.PI * 1.1, Math.PI * 1.9); g.stroke(); }
      cheeks(.42); g.fillStyle = lips; g.beginPath(); g.moveTo(208, my - 8); g.quadraticCurveTo(256, my + 62, 304, my - 8); g.closePath(); g.fill(); break;
    case 'surprised': brows(-20); ovalEyes(27, 40); cheeks(.16); g.fillStyle = lips; g.beginPath(); g.ellipse(256, my + 10, 16, 21, 0, 0, Math.PI * 2); g.fill(); break;
    case 'focus': brows(14, -10); ovalEyes(24, 22, 6); g.strokeStyle = ink; g.lineWidth = 10; g.beginPath(); g.moveTo(232, my + 4); g.lineTo(280, my + 2); g.stroke(); break;
    default: brows(); ovalEyes(); cheeks(); smile();
  }
  const texture = new THREE.CanvasTexture(c); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4; return texture;
}
function face(expression, brow) {
  const key = expression + brow;
  if (!faceCache.has(key)) faceCache.set(key, drawFace(expression, brow)); return faceCache.get(key);
}

function iconSprite(text, color) {
  const c = document.createElement('canvas'); c.width = c.height = 128; const g = c.getContext('2d');
  g.fillStyle = color; g.beginPath(); g.arc(64, 64, 58, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#16202b'; g.font = 'bold 84px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(text, 64, 70);
  const texture = new THREE.CanvasTexture(c); texture.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture, depthTest: false })); sprite.scale.setScalar(.18); sprite.renderOrder = 5; sprite.visible = false; return sprite;
}

// ---------- avatar ----------
export class Avatar {
  constructor(worker, gltf) {
    this.worker = worker;
    this.root = new THREE.Group(); this.root.name = `worker:${worker.id}`;
    this.tilt = new THREE.Group(); this.root.add(this.tilt);
    this.model = clone(gltf.scene); this.model.scale.setScalar(LIFE); this.tilt.add(this.model);
    this.bones = {};
    const meshes = [];
    this.model.traverse(o => {
      if (o.isMesh) meshes.push(o);   // an older kit's own body parts, if one is still loaded
      else if (BONES.has(o.name)) this.bones[o.name.replace(/^(Leg|Arm|Forearm|Hand)([LR])$/, '$1.$2')] = o;   // GLTFLoader drops the dots
    });
    for (const m of meshes) m.removeFromParent();
    this.buildBody();
    this.setExpression('neutral');
    this.pose = Object.values(this.bones).map(bone => [bone, bone.quaternion.clone()]);   // last mixer output
    this.mixer = new THREE.AnimationMixer(this.model);
    this.actions = Object.fromEntries(gltf.animations.map(clip => [clip.name, this.mixer.clipAction(clip)]));
    this.clipLength = Object.fromEntries(gltf.animations.map(clip => [clip.name, clip.duration]));
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(.32, 24), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: .25, depthWrite: false }));
    shadow.rotation.x = -Math.PI / 2; shadow.position.y = .003; this.shadow = shadow; this.root.add(shadow);
    this.alert = iconSprite('!', '#ffb347'); this.done = iconSprite('✓', '#69d391'); this.tilt.add(this.alert, this.done);
    // motion state
    this.mode = 'seated'; this.swivel = 0; this.velocity = new THREE.Vector3();
    this.lean = new THREE.Vector2(); this.leanVelocity = new THREE.Vector2(); this.jolt = 0; this.joltVelocity = 0;
    this.look = new THREE.Vector2(); this.until = 0; this.expressionUntil = 0; this.nextBlink = 2;
    this.active = null; this.gestureUntil = 0; this.doneUntil = 0; this.knock = 0; this.time = Math.random() * 10;
  }

  // The figure: rigid parts fixed to the bones, in kit units (the model is scaled by LIFE).
  // Bone frames: legs point down their +Y with the front at -Z; arm, forearm and hand bones run along +Y;
  // torso and head are upright with the front at +Z.
  buildBody() {
    const w = this.worker, soft = (color, roughness = .55) => plastic(color, roughness);
    const skin = soft(w.skin || SKIN, .6), shirt = soft(w.torso, .7), trousers = soft(w.legs, .7), shoes = soft(SHOES, .45);
    const hair = soft(w.hair, .65), white = soft(SHELL, .4);
    this.glow = new THREE.MeshStandardMaterial({ color: '#1c2a30', emissive: GLOW, emissiveIntensity: 1, roughness: .2, toneMapped: false });
    const b = this.bones;
    const add = (bone, geometry, material, [x, y, z] = [0, 0, 0], [rx, ry, rz] = [0, 0, 0], scale) => {
      const m = geometry.isObject3D ? geometry : new THREE.Mesh(geometry, material);
      m.position.set(x, y, z); m.rotation.set(rx, ry, rz); if (scale) m.scale.set(...scale);
      m.traverse(o => { if (o.isMesh) { o.frustumCulled = false; o.userData.avatar = this; } });
      bone.add(m); return m;
    };
    const lathe = (points, segments = 32) => new THREE.LatheGeometry(points.map(([r, y]) => new THREE.Vector2(r, y)), segments);
    // legs: slim trousers and rounded shoes pointing forward
    for (const side of ['L', 'R']) {
      const leg = b[`Leg.${side}`];
      add(leg, new THREE.CapsuleGeometry(.19, .72, 8, 18), trousers, [0, .5, 0]);
      add(leg, roundBox(.4, .26, .64, .12, .2), shoes, [0, 1.13, -.1]);
    }
    // torso: hips, a tapered long-sleeve top with rounded shoulders, neck, and an ID badge on a lanyard
    add(b.Torso, lathe([[0, -.18], [.5, -.18], [.56, -.05], [.56, .12], [0, .12]]), trousers, [0, 0, 0], [0, 0, 0], [1, 1, .72]);
    add(b.Torso, lathe([[0, .02], [.58, .02], [.6, .12], [.57, .5], [.53, .9], [.5, 1.1], [.42, 1.24], [.26, 1.32], [0, 1.34]]), shirt, [0, 0, 0], [0, 0, 0], [1, 1, .72]);
    add(b.Torso, new THREE.CylinderGeometry(.16, .18, .3, 18), skin, [0, 1.38, 0]);
    for (const x of [-.6, .6]) add(b.Torso, new THREE.SphereGeometry(.17, 18, 12), shirt, [x, 1.1, 0]);
    const badge = new THREE.Group();
    badge.add(new THREE.Mesh(roundBox(.26, .34, .03, .012, .04), white));
    const stripe = new THREE.Mesh(roundBox(.26, .08, .034, .012, .03), soft(w.legs, .5)); stripe.position.y = .12; badge.add(stripe);
    this.light = new THREE.Mesh(new THREE.SphereGeometry(.035, 12, 8), this.glow); this.light.position.set(.08, -.1, .02); badge.add(this.light);
    add(b.Torso, badge, null, [-.24, .8, .39], [-.14, 0, -.05]);   // clipped to the chest, on the wearer's left
    // arms: long sleeves in the shirt colour, round hands
    for (const side of ['L', 'R']) {
      add(b[`Arm.${side}`], new THREE.CapsuleGeometry(.14, .46, 6, 16), shirt, [0, .3, 0]);
      add(b[`Forearm.${side}`], new THREE.CapsuleGeometry(.13, .26, 6, 16), shirt, [0, .16, 0]);
      add(b[`Hand.${side}`], new THREE.SphereGeometry(.2, 20, 14), skin, [0, .14, 0]);
    }
    // head: a big egg-shaped head with ears, a small nose, a drawn face and the worker's hair
    const head = new THREE.Group(); add(b.Head, head, null, [0, .62, 0], [0, 0, 0], [1, 1.12, .96]);
    const R = .62;
    head.add(new THREE.Mesh(new THREE.SphereGeometry(R, 40, 28), skin));
    this.screen = new THREE.Mesh(new THREE.SphereGeometry(R * 1.004, 32, 24, Math.PI / 2 - .65, 1.3, .9, 1.4),
      new THREE.MeshStandardMaterial({ transparent: true, alphaTest: .4, roughness: .6, polygonOffset: true, polygonOffsetFactor: -1 }));
    head.add(this.screen);
    const nose = new THREE.Mesh(new THREE.SphereGeometry(.075, 14, 10), skin); nose.position.set(0, -.08, R * .97); nose.scale.set(1, .8, .8); head.add(nose);
    for (const x of [-1, 1]) { const ear = new THREE.Mesh(new THREE.SphereGeometry(.11, 14, 10), skin); ear.position.set(x * R * .97, -.02, 0); ear.scale.set(.5, 1, .8); head.add(ear); }
    this.addHair(head, hair, R);
    head.traverse(o => { if (o.isMesh) { o.frustumCulled = false; o.userData.avatar = this; } });
    this.face = this.screen;
  }

  // Hair as shells over the head: a cap over the top and back, and a fringe band whose shape depends on the style.
  addHair(head, material, R) {
    const style = this.worker.hairStyle || { clyde: 'short', dex: 'swept' }[this.worker.id]
      || HAIR_STYLES[[...this.worker.id].reduce((n, ch) => n + ch.charCodeAt(0), 0) % HAIR_STYLES.length];
    material.side = THREE.DoubleSide;
    const shell = (r, phiStart, phiLength, thetaStart, thetaLength) => {
      const m = new THREE.Mesh(new THREE.SphereGeometry(r, 40, 20, phiStart, phiLength, thetaStart, thetaLength), material);
      head.add(m); return m;
    };
    const front = Math.PI / 2, back = Math.PI * 1.5;
    shell(R * 1.045, 0, Math.PI * 2, 0, style === 'crop' ? .82 : .98);                 // cap
    shell(R * 1.045, back - 1.45, 2.9, .8, style === 'bob' ? 1.75 : 1.2);             // back and sides, down to the nape
    if (style === 'short') {                                                            // a short even fringe
      shell(R * 1.05, front - 1.15, 2.3, .9, .26);
    } else if (style === 'swept') {                                                     // a fringe swept low to one side
      const fringe = shell(R * 1.055, front - 1.25, 2.5, .8, .48); fringe.rotation.z = -.16;
    } else if (style === 'bob') {                                                       // a straight fringe and sides to the jaw
      shell(R * 1.05, front - 1.2, 2.4, .9, .3);
      for (const x of [-1, 1]) shell(R * 1.06, x < 0 ? Math.PI - .55 : -.55 + 0, 1.1, .9, 1.45);
    }
  }

  setExpression(name) {
    if (this.expression === name) return;
    this.expression = name; this.face.material.map = face(name, this.worker.hair || '#3b2a1e'); this.face.material.needsUpdate = true;
  }
  express(name, seconds) { this.override = name; this.expressionUntil = this.time + seconds; }

  // ---------- animation layering ----------
  want(name, options = {}) { this.desired = [name, options]; }
  activate(name, { frame = null, speed = 1, once = false } = {}) {
    const action = this.actions[name] || this.actions.Idle;
    const key = `${name}:${frame}:${once}`;
    if (this.activeKey === key) { action.timeScale = speed; return; }
    this.activeKey = key;
    action.reset(); action.enabled = true; action.setEffectiveWeight(1);
    action.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, Infinity); action.clampWhenFinished = once;
    action.timeScale = speed; action.paused = frame !== null; if (frame !== null) action.time = frame * this.clipLength[name];
    action.fadeIn(.25).play();
    if (this.active && this.active !== action) this.active.fadeOut(.25);
    this.active = action;
  }
  gesture(name) {
    if (!this.actions[name]) return;
    this.gestureName = name; this.gestureUntil = this.time + this.clipLength[name];
  }

  // ---------- geometry helpers (world space) ----------
  space() { return this.root.parent; }
  toSpace(world) { return this.space().worldToLocal(tmp.copy(world)); }
  partCenter(part) {
    const bone = { head: this.bones.Head, torso: this.bones.Torso, left: this.bones['Hand.L'], right: this.bones['Hand.R'] }[part];
    const offset = { head: [0, .55, 0], torso: [0, .6, 0], left: [0, .25, 0], right: [0, .25, 0] }[part];
    return bone.localToWorld(new THREE.Vector3(...offset));
  }
  // Which body part (if any) a world point touches, nearest first.
  touching(point, slack = 0) {
    const radius = { head: .32, torso: .3, left: .12, right: .12 };
    let best = null, distance = Infinity;
    for (const part of ['left', 'right', 'head', 'torso']) {
      const d = this.partCenter(part).distanceTo(point) - radius[part] - slack;
      if (d < 0 && d < distance) { best = part; distance = d; }
    }
    return best;
  }
  seat(desk) {
    const g = desk.group, p = new THREE.Vector3(0, 0, DESK.chairZ).applyAxisAngle(UP, g.rotation.y).add(g.position);
    return { position: p, yaw: g.rotation.y + Math.PI };
  }

  // ---------- interactions ----------
  hit(directionWorld, strength) {
    if (this.mode === 'held') return;
    const parentQuat = this.space().getWorldQuaternion(quat).invert();
    const d = tmp2.copy(directionWorld).applyQuaternion(parentQuat).setY(0);
    if (d.lengthSq() < 1e-6) d.set(0, 0, 1);
    d.normalize();
    const local = d.clone().applyAxisAngle(UP, -this.root.rotation.y);
    const push = Math.min(strength, 5);
    this.leanVelocity.x += local.z * push * 2.6; this.leanVelocity.y -= local.x * push * 2.6;
    this.joltVelocity += (local.x >= 0 ? 1 : -1) * push * 7;
    this.express('ouch', 1.4);
    if (strength > 3.4 && this.mode !== 'airborne' && this.mode !== 'knocked') {   // a real wallop: off the chair
      this.mode = 'airborne'; this.thrown = true;
      this.velocity.set(d.x * Math.min(push * .7, 3), 1.6, d.z * Math.min(push * .7, 3));
      this.root.position.y = Math.max(this.root.position.y, .05);
    }
  }
  grab(part) {
    this.holdPart = part;
    if (part === 'left' || part === 'right') { this.mode = 'led'; this.express('happy', 2); }
    else { this.mode = 'held'; this.express('surprised', 999); }
  }
  hold(pointWorld, offsetWorld) {          // offsetWorld: root minus grab point at grab time, in world
    const p = this.toSpace(tmp.copy(pointWorld).add(offsetWorld));
    const previous = this.root.position.clone();
    this.root.position.set(p.x, Math.max(0, p.y), p.z);
    this.heldVelocity = this.root.position.clone().sub(previous);
  }
  lead(handWorld, userWorld, dt) {
    const hand = this.toSpace(handWorld).clone(), user = this.toSpace(userWorld).clone();
    const away = new THREE.Vector3(this.root.position.x - hand.x, 0, this.root.position.z - hand.z);
    if (away.lengthSq() < 1e-4) away.set(user.x - hand.x, 0, user.z - hand.z).negate();
    away.normalize().multiplyScalar(.42);
    const target = new THREE.Vector3(hand.x + away.x, 0, hand.z + away.z);
    const delta = target.sub(this.root.position).setY(0), step = Math.min(delta.length(), 2.2 * dt);
    this.moving = delta.length() > .03;
    if (delta.lengthSq() > 1e-6) this.root.position.add(delta.normalize().multiplyScalar(step));
    this.root.position.y = 0;
    this.faceTowards(user, dt, 8);
  }
  release(velocityWorld) {
    this.override = null; this.holdPart = null;
    if (this.mode === 'led') { this.mode = 'standing'; this.until = this.time + 2.5; return; }
    const parentQuat = this.space().getWorldQuaternion(quat).invert();
    this.velocity.copy(velocityWorld).applyQuaternion(parentQuat);
    this.thrown = this.velocity.length() > 2.2;
    this.mode = 'airborne';
  }
  dance(seconds = 10) {
    if (['held', 'airborne', 'knocked'].includes(this.mode)) return;
    if (this.mode === 'seated') this.standUp();
    this.mode = 'dancing'; this.until = this.time + seconds; this.express('happy', seconds);
  }
  standUp(seconds = 8) {
    if (this.mode !== 'seated') { this.mode = 'standing'; this.until = this.time + seconds; return; }
    const out = new THREE.Vector3(.45, 0, -.1).applyAxisAngle(UP, this.root.rotation.y);
    this.root.position.add(out).setY(0); this.mode = 'standing'; this.until = this.time + seconds;
  }
  perform(action) {
    if (action === 'dance') this.dance(10);
    else if (action === 'stand') this.standUp(20);
    else if (action === 'sit') this.mode = this.mode === 'seated' ? 'seated' : 'returning';
    else if (action === 'wave') this.gesture('Wave');
    else if (action === 'point') this.gesture('Point');
    else if (action === 'celebrate' || action === 'shrug') { this.gesture('Celebrate'); this.express('happy', 3); }
    else if (action === 'bow') { this.bowUntil = this.time + 1.6; }
    else if (action === 'facepalm') { this.facepalmUntil = this.time + 2; this.express('blink', 2); }
  }
  faceTowards(target, dt, rate = 4) {
    const yaw = Math.atan2(target.x - this.root.position.x, target.z - this.root.position.z);
    const delta = Math.atan2(Math.sin(yaw - this.root.rotation.y), Math.cos(yaw - this.root.rotation.y));
    this.root.rotation.y += delta * Math.min(1, dt * rate);
  }

  // ---------- per frame ----------
  update(dt, ctx) {
    this.time += dt;
    const { desk, listenerWorld, level = 0, working = false, approval = false, focused = false, talking = false } = ctx;
    const listener = this.toSpace(listenerWorld).clone();
    const seat = this.seat(desk);
    const toUser = Math.hypot(listener.x - this.root.position.x, listener.z - this.root.position.z);
    this.moving = false;

    // ----- locomotion and base pose -----
    switch (this.mode) {
      case 'seated': {
        let swivelTarget = 0;
        if (focused && toUser < 3.5 && (talking || !working)) {
          const yaw = Math.atan2(listener.x - seat.position.x, listener.z - seat.position.z);
          swivelTarget = Math.max(-2, Math.min(2, Math.atan2(Math.sin(yaw - seat.yaw), Math.cos(yaw - seat.yaw))));
          if (!talking) swivelTarget *= .35;
        }
        this.swivel += (swivelTarget - this.swivel) * Math.min(1, dt * 2.5);
        this.root.position.set(seat.position.x, SEAT_ROOT_Y, seat.position.z);
        this.root.rotation.y = seat.yaw + this.swivel;
        desk.chair.rotation.y = this.swivel;
        const typing = working && Math.abs(this.swivel) < .5;
        if (approval && Math.abs(this.swivel) < .9) this.want('Wave');
        else if (typing) this.want('ArmsExtend', { frame: .3 });   // hands forward at keyboard height
        else this.want('Idle');
        break;
      }
      case 'standing':
        this.root.position.y = 0;
        if (focused && toUser < 4) this.faceTowards(listener, dt, 3);
        this.want(approval ? 'Wave' : 'Idle');
        if (this.time > this.until) this.mode = 'returning';
        break;
      case 'returning': {
        desk.chair.rotation.y += (0 - desk.chair.rotation.y) * Math.min(1, dt * 3);
        const target = seat.position.clone().add(new THREE.Vector3(0, 0, .55).applyAxisAngle(UP, seat.yaw - Math.PI));
        const delta = target.clone().sub(this.root.position).setY(0);
        if (delta.length() < .08) { this.mode = 'seated'; this.swivel = 0; break; }
        const step = Math.min(delta.length(), 1.1 * dt);
        this.root.position.add(delta.normalize().multiplyScalar(step)); this.root.position.y = 0;
        this.faceTowards(target, dt, 7); this.moving = true; this.want('Walk', { speed: 1.1 });
        break;
      }
      case 'held': {
        const lifted = this.root.position.y > .08;
        this.want(lifted ? 'Run' : 'Idle', { speed: 1.6 });
        const v = this.heldVelocity || tmp.set(0, 0, 0);
        const local = v.clone().applyAxisAngle(UP, -this.root.rotation.y).divideScalar(Math.max(dt, .001));
        this.leanVelocity.x -= local.z * dt * 6; this.leanVelocity.y += local.x * dt * 6;   // swing like a pendulum
        break;
      }
      case 'led':
        this.want(this.moving ? 'Walk' : 'ArmsExtend', this.moving ? { speed: 1.3 } : { frame: .5 });
        break;
      case 'airborne': {
        this.velocity.y -= 9.8 * dt;
        this.root.position.addScaledVector(this.velocity, dt);
        this.want('Run', { speed: 2 });
        if (this.root.position.y <= 0) {
          const impact = Math.abs(this.velocity.y) + Math.hypot(this.velocity.x, this.velocity.z) * .5;
          this.root.position.y = 0; this.velocity.set(0, 0, 0);
          this.landed = impact;      // read and cleared by the office for sound/voice
          if (impact > 2.6 || this.thrown) { this.mode = 'knocked'; this.until = this.time + 1.8; this.express('ouch', 2.6); }
          else { this.mode = 'standing'; this.until = this.time + 1.2; this.express('surprised', 1); }
        }
        break;
      }
      case 'knocked':
        this.want('Idle');
        if (this.time > this.until + .6) { this.mode = 'standing'; this.until = this.time + 1.5; }
        break;
      case 'dancing': {
        this.want('Celebrate', { speed: 1.15 });
        const beat = this.time * Math.PI * 2 * 118 / 60 / 2;
        this.root.position.y = Math.abs(Math.sin(beat)) * .07;
        this.root.rotation.y += Math.sin(beat * .5) * dt * 2.2;
        if (this.time > this.until) { this.root.position.y = 0; this.mode = 'returning'; }
        break;
      }
    }
    if (this.mode !== 'seated' && this.mode !== 'returning') desk.chair.rotation.y += (0 - desk.chair.rotation.y) * Math.min(1, dt * 2);

    // one-shot gestures temporarily replace the base pose
    if (this.time < this.gestureUntil && !['airborne', 'held', 'knocked'].includes(this.mode)) this.desired = [this.gestureName, { once: true }];
    if (this.desired) this.activate(...this.desired);
    // three's mixer only writes a bone when its blended value changes, so undo last frame's procedural
    // offsets by restoring the mixer's previous output (not the rest pose) before updating.
    for (const [bone, q] of this.pose) bone.quaternion.copy(q);
    this.mixer.update(dt);
    for (const [bone, q] of this.pose) q.copy(bone.quaternion);

    // ----- procedural layer on top of the clips -----
    const b = this.bones, seated = this.mode === 'seated';
    if (seated) for (const leg of [b['Leg.L'], b['Leg.R']]) leg.rotation.set(SIT_LEG, 0, 0);
    if (seated && working && Math.abs(this.swivel) < .5 && !approval) {
      b['Forearm.L'].rotateX(Math.sin(this.time * 19) * .12); b['Forearm.R'].rotateX(Math.sin(this.time * 17 + 1.3) * .12);
      b['Hand.L'].rotateZ(Math.sin(this.time * 23) * .1); b['Hand.R'].rotateZ(Math.sin(this.time * 21 + 2) * .1);
    }
    if (this.mode === 'dancing') {
      const beat = this.time * Math.PI * 2 * 118 / 60;
      b['Leg.L'].rotation.x = Math.PI + Math.sin(beat) * .35; b['Leg.R'].rotation.x = Math.PI - Math.sin(beat) * .35;
      b.Torso.rotateY(Math.sin(beat / 2) * .35);
    }
    if (this.time < (this.facepalmUntil || 0)) { b['Arm.R'].rotateX(-1.1); b['Forearm.R'].rotateX(-1.2); b.Head.rotateX(.35); }

    // head looks at the boss (or the monitor while working)
    let yaw = 0, pitch = 0;
    const headWorld = b.Head.getWorldPosition(tmp2);
    const lookAtUser = focused && toUser < 4.5 && (talking || !working || !seated);
    if (lookAtUser && !['airborne', 'knocked'].includes(this.mode)) {
      const local = this.model.worldToLocal(listenerWorld.clone()), head = this.model.worldToLocal(headWorld.clone());
      const d = local.sub(head);
      yaw = Math.max(-1.1, Math.min(1.1, Math.atan2(d.x, d.z)));
      pitch = Math.max(-.5, Math.min(.5, -Math.atan2(d.y, Math.hypot(d.x, d.z))));
    } else if (seated && working) { pitch = .12; yaw = Math.sin(this.time * .7) * .12; }
    this.look.x += (yaw - this.look.x) * Math.min(1, dt * 5); this.look.y += (pitch - this.look.y) * Math.min(1, dt * 5);
    // springs: slap lean and head jolt
    this.leanVelocity.addScaledVector(this.lean, -70 * dt).multiplyScalar(Math.max(0, 1 - 7 * dt));
    this.lean.addScaledVector(this.leanVelocity, dt).clampScalar(-.9, .9);
    this.joltVelocity += -this.jolt * 90 * dt; this.joltVelocity *= Math.max(0, 1 - 9 * dt); this.jolt += this.joltVelocity * dt;
    b.Head.rotateY(this.look.x + this.jolt); b.Head.rotateX(this.look.y);
    const knockTarget = this.mode === 'knocked' ? -Math.PI / 2 : 0;
    this.knock += (knockTarget - this.knock) * Math.min(1, dt * (knockTarget ? 9 : 3));
    const bow = this.time < (this.bowUntil || 0) ? Math.sin((this.bowUntil - this.time) / 1.6 * Math.PI) * .55 : 0;
    this.tilt.rotation.set(this.lean.x + this.knock + bow, 0, this.lean.y);

    // ----- face and icons -----
    if (this.override && this.time > this.expressionUntil) this.override = null;
    if (this.time > this.nextBlink) { this.blinkUntil = this.time + .12; this.nextBlink = this.time + 2 + Math.random() * 3; }
    let expression = working && seated ? 'focus' : 'neutral';
    if (this.override === 'ouch') expression = 'ouch';
    else if (level > .04) expression = level > .3 ? 'talkB' : 'talkA';
    else if (this.override) expression = this.override;
    else if (this.time < (this.blinkUntil || 0)) expression = 'blink';
    this.setExpression(expression);
    // badge light: amber asking for approval, quick cyan pulse while working, slow green breathing at rest
    const [glowColor, rate, low] = approval ? ['#ffb347', 7, .45] : working ? [GLOW, 5, .55] : ['#5dff9a', 1.4, .5];
    this.glow.emissive.set(glowColor);
    this.glow.emissiveIntensity = low + (1.1 - low) * (.5 + .5 * Math.sin(this.time * rate));
    const iconY = this.tilt.worldToLocal(this.partCenter('head')).y + .48 + Math.sin(this.time * 4) * .03;
    this.alert.visible = approval; this.alert.position.y = iconY;
    this.done.visible = !approval && this.time < this.doneUntil; this.done.position.y = iconY;
    this.shadow.position.y = .003 - this.root.position.y; this.shadow.material.opacity = Math.max(.05, .25 - this.root.position.y * .2);
  }
  markDone() { this.doneUntil = this.time + 25; this.express('happy', 2.5); }
}
