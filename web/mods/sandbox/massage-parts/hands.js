// Realistic skinned hands (the WebXR Input Profiles "generic-hand" models, MIT, see hand-models-LICENSE.md). Their 25
// bones are named after the WebXR hand joints and sit flat under the model, so a hand is posed by giving every joint a
// position and orientation in the holder's space: from live hand tracking, or from the model's own rest pose with the
// fingers curled (curledPose) for a hand lying relaxed.
import * as THREE from 'three';
import { GLTFLoader } from '../../../vendor/GLTFLoader.js';
import { clone as cloneSkinned } from '../../../vendor/SkeletonUtils.js';

export const JOINTS = ['wrist', 'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip',
  ...['index', 'middle', 'ring', 'pinky'].flatMap(f => ['metacarpal', 'phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal', 'tip'].map(j => `${f}-finger-${j}`))];
export const CHAINS = [JOINTS.slice(0, 5), ...[0, 1, 2, 3].map(i => ['wrist', ...JOINTS.slice(5 + i * 5, 10 + i * 5)])];
const BASE = new URL('./', import.meta.url).href;
const CDN = 'https://cdn.jsdelivr.net/npm/@webxr-input-profiles/assets@1.0/dist/profiles/generic-hand/';

const cache = {};
// The model file for 'left' or 'right' (local copy first, the CDN if that fails). Resolves to a parsed glTF.
export function loadHand(side) {
  return cache[side] ||= new GLTFLoader().loadAsync(`${BASE}${side}.glb`).catch(() => new GLTFLoader().loadAsync(`${CDN}${side}.glb`));
}

export class SkinnedHand {
  // gltf: from loadHand; material: what to draw it with.
  constructor(gltf, material) {
    this.root = new THREE.Group();
    const model = cloneSkinned(gltf.scene.children[0]);          // the Armature: bones and the skinned mesh, with its own skeleton
    this.root.add(model);
    this.mesh = null; this.bones = {};
    model.traverse(o => {
      if (o.isSkinnedMesh) { this.mesh = o; o.material = material; o.frustumCulled = false; }
      if (o.isBone && JOINTS.includes(o.name)) this.bones[o.name] = o;
    });
    // rest pose, in the model's own space
    this.rest = new Map(JOINTS.map(n => [n, { p: this.bones[n].position.clone(), q: this.bones[n].quaternion.clone() }]));
  }
  // pose: Map joint -> { p: Vector3, q: Quaternion } in the space of this.root's parent (root itself stays identity).
  setPose(pose) {
    for (const n of JOINTS) { const j = pose.get(n), b = this.bones[n]; if (!j || !b) continue; b.position.copy(j.p); b.quaternion.copy(j.q); }
  }
}

// The rest pose with each finger bent at its joints (radians, positive curls towards the palm), then moved so the wrist
// sits at `at` with orientation `wristQ`. Bending turns everything beyond a joint about that joint's own x axis.
export function curledPose(rest, { at, wristQ, curl = { thumb: [.1, .15, .15], finger: [.15, .3, .35, .25] } }) {
  const pose = new Map(), out = new Map();
  pose.set('wrist', { p: rest.get('wrist').p.clone(), q: rest.get('wrist').q.clone() });
  for (const chain of CHAINS) {
    const angles = chain[1].startsWith('thumb') ? [0, ...curl.thumb] : curl.finger;   // per joint, from the first after the wrist
    let acc = new THREE.Quaternion();
    for (let i = 1; i < chain.length; i++) {
      const prev = rest.get(chain[i - 1]), cur = rest.get(chain[i]), prevNew = pose.get(chain[i - 1]);
      const p = prevNew.p.clone().add(cur.p.clone().sub(prev.p).applyQuaternion(acc));
      const bend = angles[i - 1] || 0, q0 = acc.clone().multiply(cur.q);
      if (bend && i < chain.length - 1) {     // bend at this joint: rotate about its x axis (WebXR joints: -z along the bone, +y the back of the hand)
        const axis = new THREE.Vector3(1, 0, 0).applyQuaternion(q0);
        acc = new THREE.Quaternion().setFromAxisAngle(axis, -bend).multiply(acc);
      }
      pose.set(chain[i], { p, q: acc.clone().multiply(cur.q) });
    }
  }
  // place: rotate the whole pose about the wrist so the wrist gets wristQ, and move it to `at`
  const w = pose.get('wrist'), turn = wristQ.clone().multiply(w.q.clone().invert());
  for (const [n, j] of pose) out.set(n, { p: j.p.clone().sub(w.p).applyQuaternion(turn).add(at), q: turn.clone().multiply(j.q) });
  return out;
}
