// A small block-built brick office dog that wanders around the fitted room.
import * as THREE from 'three';

export class OfficeDog {
  constructor(room) {
    this.room = room;
    this.root = new THREE.Group(); this.root.name = 'brick-office-dog';
    this.body = new THREE.Group(); this.body.position.y = .04; this.root.add(this.body);
    const tan = 0xc88745, cream = 0xf4d8a0, dark = 0x171717;
    const brick = (parent, name, size, color, position, studRadius = .018) => {
      const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshStandardMaterial({ color, roughness: .38 }));
      mesh.name = name; mesh.position.set(...position); mesh.castShadow = true; mesh.receiveShadow = true; parent.add(mesh);
      if (studRadius) {
        const stud = new THREE.Mesh(new THREE.CylinderGeometry(studRadius, studRadius, .012, 12), mesh.material);
        stud.position.y = size[1] / 2 + .006; stud.castShadow = true; mesh.add(stud);
      }
      return mesh;
    };
    brick(this.body, 'dog:body', [.46, .3, .72], tan, [0, .26, 0], .034);
    brick(this.body, 'dog:saddle', [.34, .12, .42], 0x9f5d30, [0, .47, -.02], .023);
    brick(this.body, 'dog:chest', [.32, .29, .22], cream, [0, .26, .32], .025);
    const head = new THREE.Group(); head.position.set(0, .46, .48); this.body.add(head); this.head = head;
    brick(head, 'dog:head', [.42, .38, .4], tan, [0, .12, .08], .03);
    brick(head, 'dog:muzzle', [.28, .17, .23], cream, [0, .035, .32], .014);
    brick(head, 'dog:nose', [.12, .09, .09], dark, [0, .065, .445], 0);
    for (const side of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(.027, 12, 10), new THREE.MeshStandardMaterial({ color: dark, roughness: .25 }));
      eye.position.set(side * .11, .2, .283); head.add(eye);
      const ear = brick(head, 'dog:ear', [.13, .28, .12], 0x754324, [side * .235, .04, .035], 0);
      ear.rotation.z = side * -.16; ear.rotation.x = -.12;
    }
    this.legs = [];
    for (const x of [-.15, .15]) for (const z of [-.22, .27]) {
      const leg = new THREE.Group(); leg.position.set(x, .16, z); this.body.add(leg);
      brick(leg, 'dog:leg', [.12, .24, .13], tan, [0, -.08, 0], .018);
      brick(leg, 'dog:paw', [.15, .09, .17], cream, [0, -.19, .018], .014);
      this.legs.push({ group: leg, phase: (x < 0) === (z < 0) ? 0 : Math.PI });
    }
    const tail = new THREE.Group(); tail.position.set(0, .4, -.34); this.body.add(tail); this.tail = tail;
    brick(tail, 'dog:tail', [.1, .22, .11], tan, [0, .1, -.02], 0).rotation.x = -.4;
    brick(tail, 'dog:tail-tip', [.1, .11, .11], cream, [0, .22, -.06], .012);
    this.yaw = Math.PI; this.root.rotation.y = this.yaw;
    this.wait = 0; this.walking = false; this.stride = 0;
    this.roamTarget = null; this.roamPause = 0;
    this.happy = 0; this.startle = 0; this.knock = new THREE.Vector3(); this.touch = {}; this.nextPat = 0;
  }

  // A world point inside the dog: 'head', 'body' or null. Used for pats and slaps.
  touching(point) {
    if (!point) return null;
    const p = this.root.worldToLocal(point.clone());
    if (Math.abs(p.x) > .3 || p.y < -.05 || p.y > .95 || p.z < -.5 || p.z > .95) return null;
    return p.z > .38 && p.y > .4 ? 'head' : 'body';
  }
  // Gentle touch: wag hard, look up at you, hop on the spot.
  pat() { this.happy = 2.2; this.startle = 0; }
  // Hard slap (or a laser bolt): skid away from the blow, ears down, then come back.
  hit(directionWorld, strength = 1) {
    const parent = this.root.parent; if (!parent) return;
    const dir = directionWorld.clone().setY(0); if (dir.lengthSq() < 1e-6) dir.set(0, 0, 1);
    dir.normalize().applyQuaternion(parent.getWorldQuaternion(new THREE.Quaternion()).invert());
    this.knock.copy(dir).multiplyScalar(Math.min(2.4, .8 + strength * .5));
    this.happy = 0; this.startle = .9; this.wait = .9; this.walking = false;
  }

  // Pick a nearby clear spot in world space, then store it in the office group's local space.
  chooseRoamTarget(parent) {
    const origin = parent.localToWorld(this.root.position.clone());
    for (let attempt = 0; attempt < 16; attempt++) {
      const angle = Math.random() * Math.PI * 2;
      const distance = .6 + Math.random() * 1.2;
      const candidate = origin.clone().add(new THREE.Vector3(Math.sin(angle) * distance, 0, Math.cos(angle) * distance));
      if (this.room?.known && !this.room.inside(candidate, .32 * this.root.scale.x)) continue;
      this.roamTarget = parent.worldToLocal(candidate); this.roamTarget.y = 0;
      return;
    }
    this.roamTarget = null;
    this.roamPause = 1;
  }

  // Wander between clear spots in the room, with a short rest at each one.
  update(dt, time) {
    const happy = this.happy > 0;
    this.tail.rotation.x = happy ? Math.sin(time * 24) * .6 : this.startle > 0 ? -.5 : Math.sin(time * 8) * .35;
    if (happy) { this.happy -= dt; this.head.rotation.x = -.3; this.head.rotation.z = Math.sin(time * 3) * .2; }
    else if (this.startle > 0) { this.startle -= dt; this.head.rotation.x = .35; this.head.rotation.z = 0; }
    else { this.head.rotation.x *= Math.max(0, 1 - dt * 6); this.head.rotation.z *= Math.max(0, 1 - dt * 6); }
    if (this.dragging || !this.root.parent) return;
    const parent = this.root.parent;
    if (this.knock.lengthSq() > 1e-4) {
      this.root.position.addScaledVector(this.knock, dt); this.knock.multiplyScalar(Math.max(0, 1 - dt * 4));
      if (this.room?.known) { const world = parent.localToWorld(this.root.position.clone()); if (this.room.constrain(world, .32 * this.root.scale.x)) this.root.position.copy(parent.worldToLocal(world)).setY(0); }
    }
    if (happy) {                                        // stay put, face you and bounce while being patted
      this.body.position.y = .04 + Math.abs(Math.sin(time * 9)) * .06;
      for (const leg of this.legs) leg.group.rotation.x = Math.sin(time * 18 + leg.phase) * .15;
      return;
    }
    if (this.wait > 0) { this.wait -= dt; this.settle(dt); return; }
    if (this.roamPause > 0) { this.roamPause -= dt; this.settle(dt); return; }
    if (!this.roamTarget || this.roamTarget.distanceTo(this.root.position) > 2.2) this.chooseRoamTarget(parent);
    if (!this.roamTarget) { this.settle(dt); return; }
    const delta = this.roamTarget.clone().sub(this.root.position); delta.y = 0;
    const distance = delta.length();
    if (distance < .08) { this.roamTarget = null; this.roamPause = .5 + Math.random() * 2; this.walking = false; this.settle(dt); return; }
    this.walking = true;
    this.turnTo(Math.atan2(delta.x, delta.z), dt * 6);
    const speed = THREE.MathUtils.clamp(distance * 1.4, .35, .85), step = Math.min(distance, dt * speed);
    this.root.position.x += Math.sin(this.yaw) * step; this.root.position.z += Math.cos(this.yaw) * step;
    if (this.room?.known) {
      const world = parent.localToWorld(this.root.position.clone());
      if (this.room.constrain(world, .32 * this.root.scale.x)) {
        this.root.position.copy(parent.worldToLocal(world)).setY(0);
        this.roamTarget = null; this.roamPause = .3;
      }
    }
    this.stride += dt * (6 + speed * 5);
    this.body.position.y = .04 + Math.abs(Math.sin(this.stride)) * .025;
    for (const leg of this.legs) leg.group.rotation.x = Math.sin(this.stride + leg.phase) * .42;
  }

  turnTo(yaw, amount) {
    const turn = THREE.MathUtils.euclideanModulo(yaw - this.yaw + Math.PI, Math.PI * 2) - Math.PI;
    this.yaw += turn * Math.min(1, amount); this.root.rotation.y = this.yaw;
  }
  settle(dt) {
    this.body.position.y = .04;
    for (const leg of this.legs) leg.group.rotation.x *= Math.max(0, 1 - dt * 8);
  }
}
