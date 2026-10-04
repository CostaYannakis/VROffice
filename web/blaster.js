// A brick-built toy laser blaster that rides in a holster on your hip: a red one on the right, a blue one on the left.
// Reach down and grab it (grip button, fist or pinch) to draw it; fire with the trigger or a pinch;
// bring it back to its hip to holster it. Bolts fly at a visible speed and report what they hit on arrival.
// Moving targets (see `intercept`) are checked along the bolt's path every frame, so they are hit where they are, not where they were.
import * as THREE from 'three';

const Y = new THREE.Vector3(0, 1, 0), BOLT_SPEED = 22, COOLDOWN = .2;
// Holstering: any part of a drawn blaster (grip to muzzle) within SNAP of the holster sleeve (hip along the resting barrel,
// SLEEVE long) snaps it home, once it has first been ARM away from it since the draw. It glides in over GLIDE seconds.
const SNAP = .13, ARM = .2, SLEEVE = .22, GLIDE = .12;

export class Blaster {
  constructor(scene, side = 'right') {
    this.scene = scene; this.side = side; this.sign = side === 'left' ? -1 : 1;
    this.group = new THREE.Group(); this.group.name = `blaster-${side}`; this.group.visible = false; scene.add(this.group);
    const plastic = color => new THREE.MeshStandardMaterial({ color, roughness: .35 });
    this.shell = plastic(0x3a4250); const red = plastic(side === 'left' ? 0x1f6fd6 : 0xd62828), grey = plastic(0x8a96a6);
    const box = (size, position, material) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(...size), material); m.position.set(...position); this.group.add(m); return m;
    };
    // The origin sits in the grip, so it lands in your palm; the barrel points down -Z.
    box([.03, .085, .04], [0, -.03, .01], this.shell).rotation.x = -.25;   // grip
    box([.045, .05, .15], [0, .025, -.05], red);                          // body
    box([.02, .02, .09], [0, .03, -.165], grey);                           // barrel
    box([.03, .03, .02], [0, .03, -.215], this.shell);                     // emitter
    for (const z of [-.02, -.08]) {
      const stud = new THREE.Mesh(new THREE.CylinderGeometry(.009, .009, .008, 10), red); stud.position.set(0, .054, z); this.group.add(stud);
    }
    this.muzzle = new THREE.Vector3(0, .03, -.23);
    this.flash = new THREE.Mesh(new THREE.SphereGeometry(.03, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff6040, transparent: true, opacity: 0, toneMapped: false, depthWrite: false }));
    this.flash.position.copy(this.muzzle); this.group.add(this.flash);
    this.boltGeometry = new THREE.CylinderGeometry(.008, .008, .32, 6);
    this.boltMaterial = new THREE.MeshBasicMaterial({ color: 0xff3b2f, toneMapped: false });
    this.sparkGeometry = new THREE.SphereGeometry(1, 10, 8);
    this.hip = new THREE.Vector3(); this.facing = new THREE.Vector3(0, 0, -1); this.hipOut = .2;   // metres out from your centre line
    this.snapRadius = SNAP; this.armDistance = ARM;                       // read by mods, e.g. for a snap-zone glow
    this.glide = null; this.restDir = new THREE.Vector3(0, -1, 0);
    this.hand = null; this.awayFromHip = false; this.lastShot = -10; this.bolts = []; this.sparks = [];
    this.aim = new THREE.Vector3(0, 0, -1); this.matrix = new THREE.Matrix4();
    this.intercept = null;   // (from, to) => { point, onHit } | null: moving targets along a bolt's path this frame
  }

  get held() { return !!this.hand; }
  // Follow the body: the holster sits at this blaster's hip, turning with your facing (smoothed, so glancing around does not swing it).
  track(head, gaze, dt) {
    const flat = new THREE.Vector3(gaze.x, 0, gaze.z);
    if (flat.lengthSq() > .04) this.facing.lerp(flat.normalize(), Math.min(1, dt * 3)).normalize();
    const f = this.facing;
    const s = this.sign;   // right of facing is (-f.z, f.x)
    const out = this.hipOut;
    this.hip.set(head.x - s * f.z * out + f.x * .02, Math.max(.45, head.y - .62), head.z + s * f.x * out + f.z * .02);
    this.restDir.set(0, -1, 0).addScaledVector(f, .25).normalize();
    if (this.hand) return;
    this.pose(this.hip, this.restDir, f);
    if (this.glide) {                                                     // just holstered: ease from where it was let go
      const g = this.glide, k = Math.min(1, (g.t += dt) / GLIDE), e = k * (2 - k);
      this.group.position.lerpVectors(g.position, this.group.position, e);
      this.group.quaternion.slerpQuaternions(g.quaternion, this.group.quaternion.clone(), e);
      this.group.updateMatrixWorld(true);
      if (k >= 1) this.glide = null;
    }
  }
  // How far the blaster's nearest part (grip to muzzle) is from the holster sleeve's axis, in metres.
  holsterGap() {
    const sleeve = new THREE.Line3(this.hip.clone(), this.hip.clone().addScaledVector(this.restDir, SLEEVE)), p = new THREE.Vector3();
    const grip = this.group.position, muzzle = this.group.localToWorld(this.muzzle.clone());
    let best = Infinity;
    for (let i = 0; i <= 4; i++) {
      const q = grip.clone().lerp(muzzle, i / 4);
      best = Math.min(best, q.distanceTo(sleeve.closestPointToPoint(q, true, p)));
    }
    return best;
  }
  near(point, radius = .2) { return !this.hand && point.distanceTo(this.hip) < radius; }
  highlight(on) { this.shell.emissive.set(on ? 0x2a6fd6 : 0x000000); }
  draw(h) { this.hand = h; this.awayFromHip = false; this.glide = null; this.highlight(false); }
  holster() {
    if (this.hand) this.glide = { t: 0, position: this.group.position.clone(), quaternion: this.group.quaternion.clone() };
    this.hand = null;
  }

  // While drawn: sit in the palm and aim along the hand's pointing ray. Returns true once it is brought back to its holster.
  hold(h) {
    if (h.rayValid) this.aim.copy(h.ray.direction).normalize();
    this.pose(h.palm, this.aim, Math.abs(this.aim.y) > .95 ? this.facing : Y);
    const gap = this.holsterGap();
    if (gap > ARM) this.awayFromHip = true;
    if (this.awayFromHip && gap < SNAP) { this.holster(); return true; }
    return false;
  }
  pose(position, direction, up) {
    this.matrix.lookAt(position, position.clone().add(direction), up);   // -Z (the barrel) points along direction
    this.group.position.copy(position); this.group.quaternion.setFromRotationMatrix(this.matrix);
    this.group.updateMatrixWorld(true);
  }

  ready(t) { return t - this.lastShot > COOLDOWN; }
  muzzleRay() { return { origin: this.group.localToWorld(this.muzzle.clone()), direction: this.aim.clone() }; }
  // Launch a bolt that travels `distance` metres, then calls onHit (if any) and leaves a spark.
  fire(t, origin, direction, distance, onHit = null) {
    this.lastShot = t; this.flash.material.opacity = 1;
    const mesh = new THREE.Mesh(this.boltGeometry, this.boltMaterial);
    mesh.quaternion.setFromUnitVectors(Y, direction); mesh.position.copy(origin); mesh.renderOrder = 4; this.scene.add(mesh);
    this.bolts.push({ mesh, origin: origin.clone(), direction: direction.clone(), distance, travelled: 0, onHit });
  }
  update(dt) {
    this.flash.material.opacity = Math.max(0, this.flash.material.opacity - dt * 12);
    for (const bolt of [...this.bolts]) {
      const from = bolt.mesh.position.clone();
      bolt.travelled = Math.min(bolt.distance, bolt.travelled + BOLT_SPEED * dt);
      bolt.mesh.position.copy(bolt.origin).addScaledVector(bolt.direction, bolt.travelled);
      let onHit = bolt.onHit;
      const caught = this.intercept?.(from, bolt.mesh.position, bolt.direction);
      if (caught) { bolt.mesh.position.copy(caught.point); onHit = caught.onHit; }
      else if (bolt.travelled < bolt.distance) continue;
      this.bolts.splice(this.bolts.indexOf(bolt), 1); bolt.mesh.removeFromParent();
      this.spark(bolt.mesh.position);
      try { onHit?.(); } catch (error) { console.error(error); }
    }
    for (const spark of [...this.sparks]) {
      spark.age += dt; const k = spark.age / .25;
      if (k >= 1) { this.sparks.splice(this.sparks.indexOf(spark), 1); spark.mesh.removeFromParent(); spark.mesh.material.dispose(); continue; }
      spark.mesh.scale.setScalar(.02 + k * .13); spark.mesh.material.opacity = 1 - k;
    }
  }
  spark(position) {
    const mesh = new THREE.Mesh(this.sparkGeometry, new THREE.MeshBasicMaterial({ color: 0xffb070, transparent: true, depthWrite: false, toneMapped: false }));
    mesh.position.copy(position); mesh.scale.setScalar(.02); this.scene.add(mesh); this.sparks.push({ mesh, age: 0 });
  }
  setActive(on) {
    this.group.visible = on;
    if (!on) { this.hand = null; for (const b of this.bolts) b.mesh.removeFromParent(); this.bolts = []; }
  }
}
