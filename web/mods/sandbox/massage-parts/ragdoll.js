// A massage client as a rag doll: a rigged, skinned human (web/models/<kind>.glb, made with MPFB / MakeHuman, CC0)
// whose joints move like a person's. Every joint has three anatomical angles in degrees, measured from the model's rest
// (A) pose: flex (the bone swings forward, or up for a bone that already points forward), out (away from the midline;
// the trunk bends to his left) and twist (about the bone), each with human limits. Poses lay him on the table face down,
// on his back or sitting on its edge, and he moves between them smoothly. You can take hold of an arm or a leg and move
// it: a solver bends the joints from the shoulder or hip to follow your hand, never past a limit and never stretching a
// bone. Let go and every joint springs back towards the pose, so the limb flops back down.
import * as THREE from 'three';
import { GLTFLoader } from '../../../vendor/GLTFLoader.js';
import { clone as cloneSkinned } from '../../../vendor/SkeletonUtils.js';

const MODELS = { female: '/models/female.glb', male: '/models/male.glb' };
const cache = {};
export function loadClientModel(kind) { return cache[kind] ||= new GLTFLoader().loadAsync(MODELS[kind]); }

const DEG = Math.PI / 180, Z = new THREE.Vector3(0, 0, 1), V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const ease = t => t < .5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;

// [flex, out, twist] limits in degrees from the rest pose (the arms rest about 45 degrees out from the sides).
const LIMITS = {
  spine_01: [[-10, 25], [-10, 10], [-10, 10]], spine_02: [[-10, 25], [-10, 10], [-12, 12]], spine_03: [[-10, 25], [-10, 10], [-12, 12]],
  neck_01: [[-30, 40], [-25, 25], [-40, 40]], head: [[-25, 25], [-15, 15], [-45, 45]],
  clavicle: [[-10, 15], [-10, 20], [0, 0]],
  upperarm: [[-50, 170], [-75, 120], [-80, 80]],
  lowerarm: [[-38, 105], [0, 0], [-80, 80]],                // the rest pose already bends the elbow about 38 degrees
  hand: [[-70, 80], [-20, 30], [0, 0]],
  thigh: [[-20, 120], [-30, 45], [-40, 40]],
  calf: [[-145, 0], [0, 0], [-10, 10]],
  foot: [[-45, 25], [-20, 20], [0, 0]],
};
// the bone each joint points at (its direction defines the joint's axes)
const AIM = { spine_01: 'spine_02', spine_02: 'spine_03', spine_03: 'neck_01', neck_01: 'head', head: null, clavicle: 'upperarm', upperarm: 'lowerarm',
  lowerarm: 'hand', hand: 'middle_01', thigh: 'calf', calf: 'foot', foot: 'ball' };
const SIDED = new Set(['clavicle', 'upperarm', 'lowerarm', 'hand', 'thigh', 'calf', 'foot']);
// limbs you can take hold of: the bone, how thick it is, and the joints that move to follow your hand (from the trunk out)
const GRIPS = {
  upperarm: { r: .065, chain: ['clavicle', 'upperarm'] }, lowerarm: { r: .055, chain: ['clavicle', 'upperarm', 'lowerarm'] },
  hand: { r: .06, chain: ['spine_03', 'clavicle', 'upperarm', 'lowerarm', 'hand'] },
  thigh: { r: .095, chain: ['thigh'] }, calf: { r: .07, chain: ['thigh', 'calf'] }, foot: { r: .065, chain: ['thigh', 'calf', 'foot'] },
};
const STIFF = 26, DAMP = 6.5;                                   // the spring that pulls joints back to the pose: floppy, a little swing

// Poses. joints: [flex, out, twist] in degrees ('*' joints apply to both sides). The body is laid out from `basis` (where
// the model's x, y and z axes point on the table) with `anchor` placed at `at`; lying down, `at.y` is lifted by the depth
// of his chest (face down) or back (on his back) so he rests on the pad.
const POSES = {
  faceDown: { basis: [[0, 0, 1], [-1, 0, 0], [0, -1, 0]], anchor: 'neck_01', at: [-.8, 0, 0], rest: 'front',
    joints: { 'clavicle*': [0, -5, 0], 'upperarm*': [-4, -40, 30], 'lowerarm*': [-28, 0, 40], 'thigh*': [0, -3, 0], 'calf*': [-6, 0, 0], 'foot*': [-42, 0, 0], neck_01: [2, 0, 0] } },
  faceUp: { basis: [[0, 0, -1], [-1, 0, 0], [0, 1, 0]], anchor: 'neck_01', at: [-.8, 0, 0], rest: 'back',
    joints: { 'clavicle*': [0, -5, 0], 'upperarm*': [2, -40, -10], 'lowerarm*': [-30, 0, -30], 'thigh*': [2, -2, 8], 'calf*': [-8, 0, 0], 'foot*': [-18, 0, 0], neck_01: [6, 0, 0] } },
  sitting: { basis: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], anchor: 'pelvis', at: [0, 0, -.04], rest: 'seat',
    joints: { spine_01: [6, 0, 0], spine_02: [3, 0, 0], 'upperarm*': [22, -36, 10], 'lowerarm*': [55, 0, 30], 'thigh*': [88, 6, 0], 'calf*': [-86, 0, 0], 'foot*': [-6, 0, 0] } },
};
export const POSE_NAMES = Object.keys(POSES);

// Solid skin, eyes and teeth; clean cut-outs for hair, brows, lashes and clothing edges (the export marks everything as
// blended, which draws parts in the wrong order). Short hair needs a stricter cut-out than a ponytail.
function fixMaterials(scene) {
  scene.traverse(o => {
    if (!o.isMesh) return;
    o.frustumCulled = false;
    const m = o.material, name = m.name || '', hair = /hair|short0|ponytail|braid|bob0|afro|long0/i.test(name);
    const cut = hair || /eyebrow|eyelash|suit|cloth|shoe|short/i.test(name);
    m.transparent = false; m.depthWrite = true; m.opacity = 1; m.alphaTest = hair ? (/short0/i.test(name) ? .8 : .5) : cut ? .5 : 0;
    if (cut) m.side = THREE.DoubleSide;
    m.needsUpdate = true;
  });
}

export class RagdollClient {
  // kind: 'female' or 'male'; pad: the height of the table top (the group sits in table space).
  static async create(kind, { pad }) { return new RagdollClient(kind, await loadClientModel(kind), pad); }

  constructor(kind, gltf, pad) {
    this.kind = kind; this.pad = pad;
    this.group = new THREE.Group(); this.group.name = `client-${kind}`;
    this.scene = cloneSkinned(gltf.scene); this.group.add(this.scene); fixMaterials(this.scene);
    this.scene.updateMatrixWorld(true);
    this.bones = {}; this.scene.traverse(o => { if (o.isBone) this.bones[o.name] = o; });
    this.restPos = Object.fromEntries(Object.entries(this.bones).map(([n, b]) => [n, b.getWorldPosition(V())]));   // model space, standing at rest
    this.body = null; this.scene.traverse(o => { if (o.isSkinnedMesh && /body/i.test(o.material?.name || '') && !this.body) this.body = o; });
    this.measure();
    // joints: rest frames and axes, all in the model's own (rest) space
    this.joints = {};
    for (const name of Object.keys(this.bones)) {
      const base = name.replace(/_[lr]$/, ''), limits = LIMITS[base]; if (!limits) continue;
      const side = /_l$/.test(name) ? 1 : /_r$/.test(name) ? -1 : 0, bone = this.bones[name], sfx = side ? (side > 0 ? '_l' : '_r') : '';
      const aimName = AIM[base] ? (AIM[base] + (SIDED.has(AIM[base]) || /^(middle_01|ball)$/.test(AIM[base]) ? sfx : '')) : null;
      const P = bone.getWorldPosition(V()), T = aimName && this.bones[aimName] ? this.bones[aimName].getWorldPosition(V()).sub(P).normalize() : V(0, 1, 0);
      let hinge = null;                                          // the elbow bends about the axis across the arm, not just side to side
      if (base === 'lowerarm') hinge = this.bones[`upperarm${sfx}`].getWorldPosition(V()).sub(P).negate().normalize().cross(T);
      const { F, A } = axes(T, side || 1, hinge);
      const Cp = bone.parent.getWorldQuaternion(new THREE.Quaternion()), rest = bone.quaternion.clone();
      this.joints[name] = { name, base, side, bone, T, F, A, Cp, CpInv: Cp.clone().invert(), rest,
        lim: limits.map(r => r.slice()),                         // the same ranges both sides: the axes are mirrored
        x: [0, 0, 0], v: [0, 0, 0], target: [0, 0, 0], held: false };
    }
    this.hands = {};                                             // side -> { grip, chain, offset }
    this.extra = {};                                             // joint -> [flex, out, twist] added on top of the pose (the head turning, say)
    this.pose = null; this.trans = null;
    this.setPose('faceDown', 0);
  }

  // How deep his chest, back and seat are, from the skin at rest: what he rests on, lying down or sitting.
  measure() {
    const P = this.body.geometry.attributes.position; let front = 0, back = 0, mid = 0, seat = .1;
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i), y = P.getY(i), z = P.getZ(i); if (Math.abs(x) > .19) continue;   // the trunk only, not the arms
      if (y > 1.0 && y < 1.4) front = Math.max(front, z);
      if (y > .8 && y < 1.4) back = Math.min(back, z);
      if (y > 1.1 && y < 1.3 && Math.abs(x) < .12) mid = Math.min(mid, z);
    }
    this.depth = { front, back: -back, midBack: -mid, seat };
  }

  // The joint angles a pose asks for (plus any extra offsets).
  poseTargets(name) {
    const out = {};
    for (const j of Object.values(this.joints)) out[j.name] = [0, 0, 0];
    for (const [key, v] of Object.entries(POSES[name].joints)) {
      const base = key.replace('*', '');
      for (const j of Object.values(this.joints)) if (key.endsWith('*') ? j.base === base : j.name === key) out[j.name] = v.slice();
    }
    return out;
  }
  placement(name) {
    const p = POSES[name], [bx, by, bz] = p.basis.map(a => V(...a));
    const q = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(bx, by, bz));
    const at = V(...p.at); at.y += this.pad + (p.rest === 'front' ? this.depth.front : p.rest === 'back' ? this.depth.back : this.depth.seat);
    const anchor = this.restPos[p.anchor].clone();
    return { q, pos: at.sub(anchor.applyQuaternion(q)) };
  }
  // Move to a pose over `seconds` (0: at once). Rolling over lifts him in an arc so he never goes through the table.
  setPose(name, seconds = 2.4) {
    if (!POSES[name] || name === this.pose && !this.trans) return;
    const to = this.placement(name), targets = this.poseTargets(name);
    if (!seconds || !this.pose) {
      this.group.quaternion.copy(to.q); this.group.position.copy(to.pos);
      for (const j of Object.values(this.joints)) { j.target = targets[j.name].slice(); if (!seconds) { j.x = j.target.slice(); j.v = [0, 0, 0]; } }
      this.pose = name; this.trans = null; this.apply(); return;
    }
    const from = { q: this.group.quaternion.clone(), pos: this.group.position.clone(), targets: Object.fromEntries(Object.values(this.joints).map(j => [j.name, j.target.slice()])) };
    const lift = (this.pose === 'sitting') !== (name === 'sitting') ? .12 : .32;
    this.trans = { from, to, targets, t: 0, seconds, name, lift };
  }
  get moving() { return !!this.trans; }

  // ---------- grabbing ----------
  // A world point near an arm or a leg: which bone and how far. null if none is in reach.
  limbAt(world) {
    const p = this.scene.worldToLocal(world.clone()); let best = null;
    for (const [name, j] of Object.entries(this.joints)) {
      const grip = GRIPS[j.base]; if (!grip) continue;
      const a = j.bone.getWorldPosition(V()), child = this.childOf(name), b = child ? child.getWorldPosition(V()) : a.clone();
      this.scene.worldToLocal(a); this.scene.worldToLocal(b);
      const d = segDist(p, a, b) - grip.r;
      if (d < .035 && (!best || d < best.d)) best = { name, d };
    }
    return best;
  }
  childOf(name) { const j = this.joints[name], sfx = j.side ? (j.side > 0 ? '_l' : '_r') : ''; const aim = AIM[j.base]; return aim ? this.bones[aim + (SIDED.has(aim) || /^(middle_01|ball)$/.test(aim) ? sfx : '')] : null; }
  // Take hold of the limb at a world point with one of your hands ('left' / 'right'). Returns the bone name or null.
  grab(hand, world) {
    if (this.trans) return null;
    const hit = this.limbAt(world); if (!hit) return null;
    const j = this.joints[hit.name], sfx = j.side > 0 ? '_l' : j.side < 0 ? '_r' : '';
    const chain = GRIPS[j.base].chain.map(b => this.joints[b === 'spine_03' ? b : b + sfx]).filter(Boolean);
    this.scene.updateMatrixWorld(true);
    const local = this.scene.worldToLocal(world.clone()), W = j.bone.getWorldQuaternion(new THREE.Quaternion()).premultiply(this.sceneQinv());
    const P = this.modelPos(j.bone), offset = local.sub(P).applyQuaternion(W.invert());
    for (const c of chain) c.held = true;
    this.hands[hand] = { name: hit.name, chain, offset, target: this.scene.worldToLocal(world.clone()), prev: chain.map(c => c.x.slice()) };
    return hit.name;
  }
  drag(hand, world) { const h = this.hands[hand]; if (h) h.target = this.tableClamp(world); }
  release(hand) {
    const h = this.hands[hand]; if (!h) return;
    for (const c of h.chain) if (!Object.values(this.hands).some(o => o !== h && o.chain.includes(c))) c.held = false;
    delete this.hands[hand];
  }
  releaseAll() { for (const k of Object.keys(this.hands)) this.release(k); }
  holding(hand) { return this.hands[hand]?.name || null; }
  // How far (metres) the held point is from your hand: past the limb's reach or its joints' limits this grows.
  gap(hand) { const h = this.hands[hand]; return h ? this.reach(h, h.chain.map(c => c.x)).distanceTo(h.target) : 0; }
  // keep a limb you are moving above the table top where it is over the pad
  tableClamp(world) {
    const t = this.group.parent ? this.group.parent.worldToLocal(world.clone()) : world.clone();
    if (Math.abs(t.x) < .95 && Math.abs(t.z) < .36) t.y = Math.max(t.y, this.pad + .035);
    return this.scene.worldToLocal(this.group.parent ? this.group.parent.localToWorld(t) : t);
  }
  sceneQinv() { return this.scene.getWorldQuaternion(new THREE.Quaternion()).invert(); }
  modelPos(bone) { return this.scene.worldToLocal(bone.getWorldPosition(V())); }

  // ---------- solving ----------
  // Rotation for a joint from its three angles, as the bone's local quaternion.
  local(j, x, out = new THREE.Quaternion()) {
    const ex = this.extra[j.name] || ZERO, s = j.side < 0 ? -1 : 1;
    const R = QA.setFromAxisAngle(j.F, (x[0] + ex[0]) * DEG).multiply(QB.setFromAxisAngle(j.A, (x[1] + ex[1]) * DEG)).multiply(QC.setFromAxisAngle(j.T, s * (x[2] + ex[2]) * DEG));
    return out.copy(j.CpInv).multiply(R).multiply(j.Cp).multiply(j.rest);
  }
  // Where the held point ends up for the chain's angles (model space), starting from the chain's parent as posed now.
  reach(h, xs) {
    const first = h.chain[0].bone, par = first.parent;
    let W = par.getWorldQuaternion(QW).premultiply(this.sceneQinv()), P = this.modelPos(par);
    for (let i = 0; i < h.chain.length; i++) {
      const j = h.chain[i];
      P = P.add(TMP.copy(j.bone.position).applyQuaternion(W));
      W = W.multiply(this.local(j, xs[i], QL));
    }
    return P.add(TMP.copy(h.offset).applyQuaternion(W));
  }
  solve(h) {
    const xs = h.chain.map(c => c.x.slice()), err = () => {
      let e = this.reach(h, xs).distanceToSquared(h.target);
      xs.forEach((x, i) => {                                     // prefer bending the limb to moving the trunk, and bending to twisting
        const c = h.chain[i]; if (c.base === 'spine_03' || c.base === 'clavicle') e += .00002 * ((x[0] - c.target[0]) ** 2 + (x[1] - c.target[1]) ** 2);
        e += .000004 * (x[2] - c.target[2]) ** 2;
      });
      return e;
    };
    let best = err(), step = 12;
    for (let pass = 0; pass < 9; pass++, step *= .55) for (let i = 0; i < xs.length; i++) for (let d = 0; d < 3; d++) {
      const [lo, hi] = h.chain[i].lim[d]; if (lo === hi) continue;
      for (const s of [step, -step]) {
        const keep = xs[i][d]; xs[i][d] = clamp(keep + s, lo, hi); const e = err();
        if (e < best) { best = e; break; } xs[i][d] = keep;
      }
    }
    return xs;
  }

  // ---------- every frame ----------
  update(dt) {
    dt = Math.min(dt, .05);
    if (this.trans) {                                            // moving between poses
      const tr = this.trans; tr.t = Math.min(1, tr.t + dt / tr.seconds); const k = ease(tr.t);
      this.group.quaternion.slerpQuaternions(tr.from.q, tr.to.q, k);
      this.group.position.lerpVectors(tr.from.pos, tr.to.pos, k); this.group.position.y += tr.lift * Math.sin(Math.PI * k);
      for (const j of Object.values(this.joints)) j.target = tr.from.targets[j.name].map((a, d) => a + (tr.targets[j.name][d] - a) * k);
      if (tr.t >= 1) { this.pose = tr.name; this.trans = null; }
    }
    this.scene.updateMatrixWorld(true);
    for (const h of Object.values(this.hands)) {                  // the limbs you are holding follow your hands
      const xs = this.solve(h);
      h.chain.forEach((c, i) => { for (let d = 0; d < 3; d++) c.v[d] = (xs[i][d] - c.x[d]) / Math.max(dt, 1e-3) * .6; c.x = xs[i]; });
    }
    for (const j of Object.values(this.joints)) {                // the rest swing back towards the pose
      if (j.held) continue;
      for (let d = 0; d < 3; d++) {
        const [lo, hi] = j.lim[d]; if (lo === hi) { j.x[d] = 0; continue; }
        j.v[d] += (STIFF * (j.target[d] - j.x[d]) - DAMP * j.v[d]) * dt; j.x[d] += j.v[d] * dt;
        if (j.x[d] < lo || j.x[d] > hi) { j.x[d] = clamp(j.x[d], lo, hi); j.v[d] = 0; }
      }
    }
    this.apply();
  }
  apply() { for (const j of Object.values(this.joints)) this.local(j, j.x, j.bone.quaternion); }

  // World position of a bone (head, hands, feet...).
  boneWorld(name, out = V()) { return this.bones[name]?.getWorldPosition(out) || null; }
  dispose() { this.group.removeFromParent(); this.scene.traverse(o => { if (o.isSkinnedMesh) o.skeleton.dispose(); }); }
}

const ZERO = [0, 0, 0], QA = new THREE.Quaternion(), QB = new THREE.Quaternion(), QC = new THREE.Quaternion(), QW = new THREE.Quaternion(), QL = new THREE.Quaternion(), TMP = V();
function segDist(p, a, b) { const ab = b.clone().sub(a), t = ab.lengthSq() ? clamp(p.clone().sub(a).dot(ab) / ab.lengthSq(), 0, 1) : 0; return p.distanceTo(a.clone().addScaledVector(ab, t)); }
// A joint's flex axis F (positive swings the bone forward, or up if it already points forward) and out axis A (positive
// moves it away from the midline, or up for a bone pointing sideways; side -1 mirrors it for the right).
function axes(T, side, hinge) {
  const F = (hinge && hinge.lengthSq() > 1e-4 ? hinge.clone() : V().crossVectors(T, Z));
  if (F.lengthSq() < .04) F.set(1, 0, 0);
  F.normalize();
  const p = T.clone().applyAxisAngle(F, .1).sub(T);
  if ((Math.abs(T.z) > .8 ? p.y : p.z) < 0) F.negate();
  const A = V().crossVectors(T, F).normalize(), q = T.clone().applyAxisAngle(A, .1).sub(T);
  if ((Math.abs(T.x) > .7 ? q.y : q.x * side) < 0) A.negate();
  return { F, A };
}
