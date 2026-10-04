// Cartoon hands for Quest hand tracking and controllers: each hand is a soft skin-tone mitten on a short jacket sleeve, plus a small dot on your index fingertip so poking buttons stays
// precise. Also the aim beams, and the gesture state the office reads.
import * as THREE from 'three';
import { mitten, SKIN, GLOW } from './avatar.js';

const FINGERS = {
  thumb: ['thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip'],
  index: ['index-finger-metacarpal', 'index-finger-phalanx-proximal', 'index-finger-phalanx-intermediate', 'index-finger-phalanx-distal', 'index-finger-tip'],
  middle: ['middle-finger-metacarpal', 'middle-finger-phalanx-proximal', 'middle-finger-phalanx-intermediate', 'middle-finger-phalanx-distal', 'middle-finger-tip'],
  ring: ['ring-finger-metacarpal', 'ring-finger-phalanx-proximal', 'ring-finger-phalanx-intermediate', 'ring-finger-phalanx-distal', 'ring-finger-tip'],
  pinky: ['pinky-finger-metacarpal', 'pinky-finger-phalanx-proximal', 'pinky-finger-phalanx-intermediate', 'pinky-finger-phalanx-distal', 'pinky-finger-tip'],
};
const JOINTS = ['wrist', ...Object.values(FINGERS).flat()];
const MITTEN = .085;               // mitten size in metres: about a real hand across
const SLEEVE = 0x2c5aa0;

class HandState {
  constructor(handedness) {
    this.handedness = handedness; this.joints = new Map(); this.valid = false;
    this.palm = new THREE.Vector3(); this.prevPalm = new THREE.Vector3(); this.velocity = new THREE.Vector3();
    this.palmNormal = new THREE.Vector3(); this.point = new THREE.Vector3(); this.indexTip = null; this.indexVelocity = new THREE.Vector3();
    this.prevIndex = new THREE.Vector3(); this.pinch = false; this.wasPinch = false; this.rayValid = false; this.fist = false; this.grab = false; this.wasGrab = false;
    this.trigger = false; this.wasTrigger = false; this.squeeze = false; this.wasSqueeze = false; this.controller = false; this.held = null; this.ray = new THREE.Ray(); this.yaw = 0;
    this.forward = new THREE.Vector3(0, 0, -1);
    for (const name of JOINTS) this.joints.set(name, new THREE.Vector3());
  }
}

export class HandRig {
  constructor(scene) {
    this.plastic = new THREE.MeshStandardMaterial({ color: SKIN, roughness: .6 });
    const sleeve = new THREE.MeshStandardMaterial({ color: SLEEVE, roughness: .45 });
    this.models = {}; this.controllerHands = {}; this.pointers = {}; this.tips = {};
    for (const side of ['left', 'right']) {
      // mitten in a pivot whose -Y points along your fingers and +Z out of your palm; the thumb sits on the
      // +X side for the left hand and -X for the right
      const model = new THREE.Group(); model.name = `office-${side}-hand`; model.visible = false; scene.add(model);
      const claw = mitten(this.plastic, side === 'left' ? -1 : 1, MITTEN); claw.rotation.z = Math.PI; claw.position.y = .047; model.add(claw);   // flipped to point down -Y
      claw.traverse(o => { o.frustumCulled = false; });
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(.026, .03, .085, 18), sleeve); cuff.position.y = .088; model.add(cuff);
      model.userData.claw = claw; this.models[side] = model;
      this.controllerHands[side] = model;        // kept for older callers: the same model serves controllers
      const tip = new THREE.Mesh(new THREE.SphereGeometry(.006, 10, 8), new THREE.MeshBasicMaterial({ color: GLOW, toneMapped: false }));
      tip.visible = false; tip.renderOrder = 4; scene.add(tip); this.tips[side] = tip;
      const beam = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
        new THREE.LineBasicMaterial({ color: 0xf8ce52, transparent: true, opacity: .8, depthTest: false }));
      beam.frustumCulled = false; beam.renderOrder = 5; beam.visible = false; scene.add(beam);
      const cursor = new THREE.Mesh(new THREE.SphereGeometry(.018, 12, 8),
        new THREE.MeshBasicMaterial({ color: 0xf8ce52, depthTest: false, toneMapped: false }));
      cursor.renderOrder = 6; cursor.visible = false; scene.add(cursor);
      this.pointers[side] = { beam, cursor };
    }
    this.meshes = [...Object.values(this.models), ...Object.values(this.tips)];
    this.hands = { left: new HandState('left'), right: new HandState('right') };
    this.visible = true;
  }
  setVisible(value) { this.visible = value; if (!value) for (const m of this.meshes) m.visible = false; }

  setPointer(h, hit = null, active = false, enabled = true) {
    const pointer = this.pointers[h.handedness];
    if (!pointer) return;
    // Always shown while the hand is tracked: bright on a target or while dragging, faint and short otherwise.
    const show = this.visible && enabled && h.valid && h.rayValid, live = h.controller || !!hit || active;
    pointer.beam.visible = show; pointer.cursor.visible = show && live;
    if (!show) return;
    pointer.beam.material.opacity = live ? .85 : .28;
    const end = hit?.point || h.ray.at(h.controller ? 4 : 1.6, new THREE.Vector3());
    const positions = pointer.beam.geometry.attributes.position;
    positions.setXYZ(0, h.ray.origin.x, h.ray.origin.y, h.ray.origin.z);
    positions.setXYZ(1, end.x, end.y, end.z); positions.needsUpdate = true;
    pointer.cursor.position.copy(end);
    pointer.cursor.material.color.set(active ? 0xffffff : hit ? 0x8fffd8 : 0xf8ce52);
  }

  // Put a side's hand at `centre`, fingers along `forward`, palm facing `normal`.
  placeModel(h, centre, forward, normal) {
    const model = this.models[h.handedness];
    const y = forward.clone().negate().normalize(), z = normal.clone().addScaledVector(y, -normal.dot(y));
    if (z.lengthSq() < 1e-6) z.set(0, 0, 1); z.normalize();
    const x = new THREE.Vector3().crossVectors(y, z);
    model.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(x, y, z));
    model.position.copy(centre);
    model.userData.claw.scale.setScalar(h.grab ? .93 : 1);     // a little squeeze when you grab
    model.visible = this.visible;
  }

  update(frame, reference, inputSources, dt) {
    for (const side of ['left', 'right']) { this.models[side].visible = false; this.tips[side].visible = false; }
    const seen = new Set();
    for (const source of inputSources) {
      const h = this.hands[source.handedness]; if (!h) continue;
      seen.add(source.handedness); h.wasGrab = h.grab; h.wasTrigger = h.trigger; h.wasPinch = h.pinch; h.wasSqueeze = h.squeeze; h.source = source;
      // Aim ray (controller pointer, or Quest's shoulder-to-hand ray for tracked hands) for distant menu presses.
      const rayPose = source.targetRaySpace && frame.getPose(source.targetRaySpace, reference);
      h.rayValid = !!rayPose;
      if (rayPose) { const o = rayPose.transform.position, r = rayPose.transform.orientation; h.ray.origin.set(o.x, o.y, o.z); h.ray.direction.set(0, 0, -1).applyQuaternion(new THREE.Quaternion(r.x, r.y, r.z, r.w)); }
      if (source.hand) {
        h.controller = false; let ok = true;
        for (const name of JOINTS) {
          const pose = frame.getJointPose(source.hand.get(name), reference);
          if (!pose) { ok = false; break; }
          const p = pose.transform.position; h.joints.get(name).set(p.x, p.y, p.z);
        }
        h.valid = ok; if (!ok) { h.grab = h.pinch = h.fist = h.squeeze = false; continue; }
        const J = n => h.joints.get(n);
        // Knuckles, not metacarpal bases: the bases sit almost on the wrist, which made the palm normal noisy.
        const wrist = J('wrist'), indexKnuckle = J('index-finger-phalanx-proximal'), pinkyKnuckle = J('pinky-finger-phalanx-proximal');
        h.palmNormal.subVectors(indexKnuckle, wrist).cross(new THREE.Vector3().subVectors(pinkyKnuckle, wrist)).normalize();
        if (h.handedness === 'left') h.palmNormal.negate();
        h.palm.copy(J('middle-finger-metacarpal')).lerp(J('middle-finger-phalanx-proximal'), .5);
        const pinchDistance = J('index-finger-tip').distanceTo(J('thumb-tip'));
        h.pinch = pinchDistance < (h.pinch ? .045 : .028);
        const curl = ['index', 'middle', 'ring', 'pinky'].reduce((sum, f) => sum + J(FINGERS[f][4]).distanceTo(h.palm), 0) / 4;
        h.fist = curl < (h.fist ? .08 : .065);
        h.grab = h.pinch || h.fist;
        // Trigger finger: the index tip curling in towards the palm (pulling the blaster trigger).
        h.squeeze = J('index-finger-tip').distanceTo(h.palm) < (h.squeeze ? .085 : .068);
        h.point.copy(h.pinch ? J('index-finger-tip').clone().lerp(J('thumb-tip'), .5) : h.palm);
        h.indexTip = J('index-finger-tip');
        h.forward.subVectors(J('middle-finger-phalanx-proximal'), wrist).normalize(); h.yaw = Math.atan2(h.forward.x, h.forward.z);
        if (this.visible) {
          this.placeModel(h, h.palm.clone().addScaledVector(h.forward, .01), h.forward, h.palmNormal);
          const tip = this.tips[h.handedness]; tip.position.copy(h.indexTip); tip.visible = !h.held;
        }
      } else if (source.gripSpace) {
        const pose = frame.getPose(source.gripSpace, reference); if (!pose) { h.valid = false; h.grab = h.trigger = false; continue; }
        h.controller = true; h.valid = true;
        const p = pose.transform.position, q = pose.transform.orientation, quat = new THREE.Quaternion(q.x, q.y, q.z, q.w);
        h.palm.set(p.x, p.y, p.z); h.point.copy(h.palm);
        h.palmNormal.set(h.handedness === 'left' ? 1 : -1, 0, 0).applyQuaternion(quat);
        const buttons = source.gamepad?.buttons || [];
        const down = b => !!b && (b.pressed || b.value > .5);
        h.trigger = down(buttons[0]); h.grab = down(buttons[1]); h.pinch = false; h.fist = h.grab; h.squeeze = false;
        h.indexTip = h.palm.clone().add(new THREE.Vector3(0, 0, -.06).applyQuaternion(quat));
        h.forward.set(0, 0, -1).applyQuaternion(quat); h.yaw = Math.atan2(h.forward.x, h.forward.z);
        if (this.visible) this.placeModel(h, h.palm, h.forward, h.palmNormal);
      }
      // smoothed velocities; sweepFrom lets fast slaps be tested along the whole path since last frame
      h.sweepFrom = h.prevValid ? h.prevPalm.clone() : h.palm.clone();
      if (h.prevValid) {
        const v = h.palm.clone().sub(h.prevPalm).divideScalar(Math.max(dt, .005)); h.velocity.lerp(v, .55);
        if (h.indexTip) h.indexVelocity.lerp(h.indexTip.clone().sub(h.prevIndex).divideScalar(Math.max(dt, .005)), .6);
      }
      h.prevPalm.copy(h.palm); if (h.indexTip) h.prevIndex.copy(h.indexTip); h.prevValid = h.valid;
    }
    for (const side of ['left', 'right']) if (!seen.has(side)) { const h = this.hands[side]; h.valid = h.prevValid = h.rayValid = false; h.wasGrab = h.grab; h.wasPinch = h.pinch; h.wasTrigger = h.trigger; h.wasSqueeze = h.squeeze; h.grab = h.pinch = h.trigger = h.squeeze = false; }
    return Object.values(this.hands).filter(h => h.valid || h.wasGrab || h.held);
  }
}
