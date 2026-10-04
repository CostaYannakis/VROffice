// Getting around the office without walking: thumbstick move and snap turn, and teleport.
// Controllers: left stick moves (the way you look), right stick left/right snap-turns, right stick forward aims a
// teleport (release to jump). Tracked hands: pinch while pointing at the floor to aim, let go to teleport.
// It works by offsetting the XR reference space, so everything (head, hands, rays) moves together.
import * as THREE from 'three';

const SPEED = 1.8, TURN = Math.PI / 6, REACH = 9, BODY = .3;

export class Locomotion {
  // renderer: the shared WebGLRenderer. room: the office Room (walls in world space) for keeping you inside.
  constructor(scene, renderer, carry = null) {
    this.renderer = renderer; this.base = null; this.room = null;
    this.x = carry?.x || 0; this.z = carry?.z || 0; this.yaw = carry?.yaw || 0;
    this.moving = false; this.turnReady = true; this.aim = null; this.jumped = false;
    const ringMaterial = new THREE.MeshBasicMaterial({ color: 0x8fffd8, transparent: true, opacity: .85, depthTest: false, toneMapped: false });
    this.marker = new THREE.Mesh(new THREE.RingGeometry(.16, .22, 32), ringMaterial);
    this.marker.rotation.x = -Math.PI / 2; this.marker.renderOrder = 9; this.marker.visible = false; scene.add(this.marker);
    this.arc = new THREE.Line(new THREE.BufferGeometry().setFromPoints(Array.from({ length: 24 }, () => new THREE.Vector3())),
      new THREE.LineBasicMaterial({ color: 0x8fffd8, transparent: true, opacity: .7, depthTest: false, toneMapped: false }));
    this.arc.frustumCulled = false; this.arc.renderOrder = 9; this.arc.visible = false; scene.add(this.arc);
  }
  get state() { return { x: this.x, z: this.z, yaw: this.yaw }; }

  // The session's own floor-level space, before any of our offsets.
  attach(base) { this.base = base; this.apply(); }
  apply() {
    if (!this.base) return;
    // world = M · physical, M = translate(x, 0, z) · rotateY(yaw); the offset space wants the inverse of M.
    const m = new THREE.Matrix4().makeRotationY(this.yaw).setPosition(this.x, 0, this.z).invert();
    const p = new THREE.Vector3(), q = new THREE.Quaternion(); m.decompose(p, q, new THREE.Vector3());
    this.renderer.xr.setReferenceSpace(this.base.getOffsetReferenceSpace(new XRRigidTransform({ x: p.x, y: p.y, z: p.z }, { x: q.x, y: q.y, z: q.z, w: q.w })));
  }
  // Keep a standing spot inside the room's walls.
  // The room's own push-out ignores points far beyond a wall, so walk every wall line here (the office room is convex).
  clamp(point) {
    for (let pass = 0; pass < 2; pass++) for (const w of this.room?.walls || []) {
      const d = (point.x - w.cx) * w.nx + (point.z - w.cz) * w.nz;
      if (d < BODY) { point.x += w.nx * (BODY - d); point.z += w.nz * (BODY - d); }
    }
    return point;
  }

  moveBy(dx, dz, head) {
    const target = this.clamp(new THREE.Vector3(head.x + dx, 0, head.z + dz));
    this.x += target.x - head.x; this.z += target.z - head.z; this.apply();
  }
  turn(angle, head) {
    const offset = new THREE.Vector3(this.x - head.x, 0, this.z - head.z).applyAxisAngle(new THREE.Vector3(0, 1, 0), angle);
    this.x = head.x + offset.x; this.z = head.z + offset.z; this.yaw += angle; this.apply(); this.jumped = true;
  }
  teleport(target, head) {
    const spot = this.clamp(target.clone().setY(0));
    this.x += spot.x - head.x; this.z += spot.z - head.z; this.apply(); this.jumped = true;
  }

  // Where a ray lands on the floor (within reach), or null.
  floorHit(ray) {
    if (ray.direction.y > -.08) return null;
    const d = -ray.origin.y / ray.direction.y;
    return d > 0 && d < REACH ? ray.at(d, new THREE.Vector3()) : null;
  }
  showAim(from, to) {
    this.marker.visible = this.arc.visible = !!to;
    if (!to) return;
    this.marker.position.set(to.x, .01, to.z);
    const positions = this.arc.geometry.attributes.position, lift = Math.min(.6, from.distanceTo(to) * .15);
    for (let i = 0; i < positions.count; i++) {
      const k = i / (positions.count - 1), p = from.clone().lerp(to, k); p.y += Math.sin(k * Math.PI) * lift;
      positions.setXYZ(i, p.x, p.y, p.z);
    }
    positions.needsUpdate = true;
  }

  // Controllers: call each frame with the hands (from hands.js), the head position and gaze. Returns true while moving.
  update(dt, hands, head, gaze) {
    this.jumped = false;
    let moving = false, aiming = false;
    for (const h of Object.values(hands)) {
      const axes = h.controller && h.source?.gamepad?.axes; if (!axes) continue;
      const ax = axes[2] ?? axes[0] ?? 0, ay = axes[3] ?? axes[1] ?? 0;
      if (h.handedness === 'left') {
        if (Math.hypot(ax, ay) > .2) {
          const forward = new THREE.Vector3(gaze.x, 0, gaze.z).normalize(), right = new THREE.Vector3(-forward.z, 0, forward.x);
          const step = forward.multiplyScalar(-ay).add(right.multiplyScalar(ax)).multiplyScalar(SPEED * dt);
          this.moveBy(step.x, step.z, head); moving = true;
        }
      } else {
        if (Math.abs(ax) > .7 && this.turnReady && Math.abs(ay) < .6) { this.turn(-Math.sign(ax) * TURN, head); this.turnReady = false; }
        if (Math.abs(ax) < .3) this.turnReady = true;
        if (ay < -.7 && h.rayValid) { aiming = true; this.aim = this.floorHit(h.ray); this.showAim(h.ray.origin, this.aim); }
      }
    }
    if (!aiming && this.aim && this.marker.visible) { this.teleport(this.aim, head); this.aim = null; this.showAim(null, null); }
    else if (!aiming && !this.handAim) this.showAim(null, null);
    this.moving = moving;
    return moving;
  }
  // Tracked hands: begin aiming with a pinch at the floor; the office calls this while the pinch is held, then release().
  aimWithHand(h) {
    this.handAim = h; this.aim = this.floorHit(h.ray);
    this.showAim(h.ray.origin, this.aim);
    return !!this.aim;
  }
  release(head) {
    const target = this.aim; this.handAim = null; this.aim = null; this.showAim(null, null);
    if (target) this.teleport(target, head);
  }
  dispose() { for (const o of [this.marker, this.arc]) { o.removeFromParent(); o.geometry.dispose(); o.material.dispose(); } }
}
