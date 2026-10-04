// Target practice: little brick-built drones that buzz around the office while a blaster is drawn.
// They wander between random waypoints at head height inside the fitted room, and burst into loose bricks when a bolt hits them.
// Once every blaster is back in its holster they hang around a moment, then shrink away. A burst drone is replaced a few seconds later.
import * as THREE from 'three';

const COUNT = 3, RADIUS = .17, SPEED = .9, RESPAWN = 3.5, LINGER = 4, GRAVITY = 9.8;
const COLORS = [0xf2c94c, 0x27ae60, 0xeb5757, 0x9b51e0, 0xf2994a];

function makeDrone(color) {
  const group = new THREE.Group(); group.name = 'flyer';
  const plastic = new THREE.MeshStandardMaterial({ color, roughness: .35 }), dark = new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: .5 });
  const add = (geometry, material, x, y, z) => { const m = new THREE.Mesh(geometry, material); m.position.set(x, y, z); group.add(m); return m; };
  add(new THREE.BoxGeometry(.13, .05, .13), plastic, 0, 0, 0);
  add(new THREE.CylinderGeometry(.018, .018, .012, 10), plastic, 0, .031, 0);                                  // stud on top
  add(new THREE.BoxGeometry(.03, .02, .03), new THREE.MeshBasicMaterial({ color: 0xff3030, toneMapped: false }), 0, 0, .07);   // eye
  const rotors = [];
  for (const [x, z] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    const arm = add(new THREE.BoxGeometry(.1, .016, .022), dark, x * .075, .012, z * .075); arm.rotation.y = x * z * Math.PI / 4;
    const rotor = add(new THREE.BoxGeometry(.11, .004, .016), dark, x * .11, .03, z * .11); rotors.push(rotor);
  }
  return { group, rotors, material: plastic };
}

export class Flyers {
  constructor(scene) {
    this.scene = scene; this.flyers = []; this.debris = []; this.wanted = false; this.idle = 0; this.hits = 0;
    this.brick = new THREE.BoxGeometry(.035, .022, .035);
    this.onPop = null;   // (point) => void, for sound and score feedback
  }

  get live() { return this.flyers.filter(f => !f.dead && !f.leaving); }

  // Called every frame. `active`: a blaster is drawn, so targets should be out.
  update(dt, head, room, active) {
    this.room = room;
    if (active) { this.wanted = true; this.idle = 0; }
    else if (this.wanted && (this.idle += dt) > LINGER) this.wanted = false;
    if (this.wanted) {
      for (const f of this.flyers) f.leaving = false;
      if (this.flyers.length < COUNT && (this.nextSpawn ?? 0) <= 0) { this.spawn(head); this.nextSpawn = .6; }
    } else for (const f of this.flyers) f.leaving = true;
    this.nextSpawn = (this.nextSpawn ?? 0) - dt;

    for (const f of [...this.flyers]) {
      if (f.dead) { if ((f.respawn -= dt) <= 0) this.remove(f); continue; }
      f.age += dt;
      f.scale = f.leaving ? Math.max(0, f.scale - dt * 2) : Math.min(1, f.scale + dt * 2.5);
      if (f.leaving && f.scale <= 0) { this.remove(f); continue; }
      if (f.position.distanceTo(f.waypoint) < .3 || f.age > f.retarget) this.pickWaypoint(f, head);
      const desired = f.waypoint.clone().sub(f.position).normalize().multiplyScalar(f.speed);
      f.velocity.lerp(desired, Math.min(1, dt * 1.6));
      f.position.addScaledVector(f.velocity, dt);
      if (room?.known && room.constrain(f.position, .25)) this.pickWaypoint(f, head);
      f.position.y = THREE.MathUtils.clamp(f.position.y, .6, 2.6);
      const g = f.drone.group;
      g.position.copy(f.position); g.position.y += Math.sin(f.age * 3 + f.phase) * .03;
      g.rotation.set(0, Math.atan2(f.velocity.x, f.velocity.z), 0);
      g.rotateX(Math.min(.35, f.velocity.length() * .3));   // lean into the direction of travel
      g.scale.setScalar(Math.max(.001, f.scale));
      for (const r of f.drone.rotors) r.rotation.y += dt * 40;
    }

    for (const d of [...this.debris]) {
      d.age += dt;
      d.velocity.y -= GRAVITY * dt; d.mesh.position.addScaledVector(d.velocity, dt);
      d.mesh.rotation.x += d.spin.x * dt; d.mesh.rotation.z += d.spin.z * dt;
      if (d.mesh.position.y < .011) { d.mesh.position.y = .011; d.velocity.y *= -.35; d.velocity.x *= .6; d.velocity.z *= .6; d.spin.multiplyScalar(.6); }
      if (d.age > 2) d.mesh.scale.setScalar(Math.max(.001, 1 - (d.age - 2) * 2));
      if (d.age > 2.5) { d.mesh.removeFromParent(); this.debris.splice(this.debris.indexOf(d), 1); }
    }
  }

  // New drones swoop in from high up, a few metres off to the side, so they never pop into existence in your face.
  spawn(head) {
    const drone = makeDrone(COLORS[Math.floor(Math.random() * COLORS.length)]);
    const f = { drone, position: new THREE.Vector3(), velocity: new THREE.Vector3(), waypoint: new THREE.Vector3(),
      age: 0, retarget: 0, phase: Math.random() * 6, speed: SPEED * (.8 + Math.random() * .5), scale: 0, dead: false, leaving: false };
    this.pickWaypoint(f, head); f.position.copy(f.waypoint).setY(2.4);
    this.pickWaypoint(f, head);
    this.scene.add(drone.group); this.flyers.push(f);
  }
  pickWaypoint(f, head) {
    const p = new THREE.Vector3();
    for (let i = 0; i < 24; i++) {
      const a = Math.random() * Math.PI * 2, r = 1.3 + Math.random() * 2.4;
      p.set(head.x + Math.cos(a) * r, 1.1 + Math.random() * 1.1, head.z + Math.sin(a) * r);
      if (!this.room?.known || this.room.inside(p, .35)) break;
    }
    f.waypoint.copy(p); f.age = 0; f.retarget = 3 + Math.random() * 3;
  }
  remove(f) {
    f.drone.group.removeFromParent();
    f.drone.group.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    this.flyers.splice(this.flyers.indexOf(f), 1);
  }

  // The first drone the segment from → to passes through, as { point, onHit } for Blaster.intercept.
  intercept(from, to, direction) {
    const length = from.distanceTo(to); if (length < 1e-6) return null;
    const ray = new THREE.Ray(from, to.clone().sub(from).divideScalar(length)), sphere = new THREE.Sphere();
    let best = null;
    for (const f of this.live) {
      if (f.scale < .5) continue;
      const point = ray.intersectSphere(sphere.set(f.drone.group.position, RADIUS), new THREE.Vector3());
      const distance = point?.distanceTo(from);
      if (point && distance <= length && (!best || distance < best.distance)) best = { flyer: f, point, distance };
    }
    if (!best) return null;
    best.flyer.dead = true;   // claimed now, so a second bolt this frame cannot hit it too
    return { point: best.point, onHit: () => this.burst(best.flyer, direction || ray.direction) };
  }
  // Shatter into loose bricks thrown along the bolt's direction, then queue a replacement.
  burst(f, direction) {
    const at = f.drone.group.position.clone();
    f.drone.group.visible = false; f.respawn = RESPAWN; this.hits++;
    for (let i = 0; i < 9; i++) {
      const mesh = new THREE.Mesh(this.brick, i % 3 ? f.drone.material : f.drone.rotors[0].material);
      mesh.position.copy(at).add(new THREE.Vector3(Math.random() - .5, Math.random() - .5, Math.random() - .5).multiplyScalar(.1));
      this.scene.add(mesh);
      const velocity = new THREE.Vector3(Math.random() - .5, Math.random() * .8 + .3, Math.random() - .5).multiplyScalar(2.4).addScaledVector(direction, 1.5);
      this.debris.push({ mesh, velocity, spin: new THREE.Vector3(Math.random() * 12 - 6, 0, Math.random() * 12 - 6), age: 0 });
    }
    try { this.onPop?.(at, this.hits); } catch (error) { console.error(error); }
  }

  clear() {
    for (const f of [...this.flyers]) this.remove(f);
    for (const d of this.debris) d.mesh.removeFromParent();
    this.debris = []; this.wanted = false;
  }
}
