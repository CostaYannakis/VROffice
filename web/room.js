// Room awareness: finds the real walls (Quest Space Setup planes, or the guardian boundary as a fallback),
// keeps virtual things inside them, and draws a yellow brick border along the floor so you can see the limits.
import * as THREE from 'three';

const WALLISH = new Set(['wall', 'door', 'window', 'wall art', 'wall_art', 'door frame', 'window frame', 'screen', 'other']);
const FURNITURE = new Set(['table', 'couch', 'bed', 'storage', 'desk', 'sofa']);
const UP = new THREE.Vector3(0, 1, 0);

export class Room {
  constructor(scene) {
    this.walls = []; this.obstacles = []; this.source = 'none'; this.version = 0;
    this.group = new THREE.Group(); this.group.name = 'room'; scene.add(this.group);
    this.brick = new THREE.MeshStandardMaterial({ color: 0xf8ce52, emissive: 0x6a4a00, roughness: .4 });
    this.lastScan = -10; this.signature = '';
    this.bounded = null; this.boundedTransform = null;
  }
  get known() { return this.walls.length > 0 || this.obstacles.length > 0; }
  get summary() {
    if (!this.known) return 'No room data. Scan your room in Quest Space Setup so the office can fit it.';
    return `Room fitted (${this.source}): ${this.walls.length} wall${this.walls.length === 1 ? '' : 's'}${this.obstacles.length ? `, ${this.obstacles.length} furniture` : ''}.`;
  }

  // Replace the room from explicit data. Walls: { cx, cz, nx, nz, hw } with (nx, nz) pointing into the room.
  setRoom(walls, obstacles = [], source = 'manual') {
    this.walls = walls.map(w => ({ ...w, tx: -w.nz, tz: w.nx })); this.obstacles = obstacles; this.source = source;
    this.version++; this.rebuild();
  }
  clear() { this.walls = []; this.obstacles = []; this.source = 'none'; this.signature = ''; this.version++; this.rebuild(); }

  // Quest detected planes; call every frame, it rescans a couple of times a second.
  update(frame, reference, head, t) {
    if (t - this.lastScan < .6) return false;
    this.lastScan = t;
    let walls = [], obstacles = [], seen = false;
    const planes = frame?.detectedPlanes;
    if (planes && planes.size) {
      seen = true;
      for (const plane of planes) {
        const pose = frame.getPose(plane.planeSpace, reference); if (!pose || !plane.polygon?.length) continue;
        const label = (plane.semanticLabel || '').toLowerCase();
        const m = new THREE.Matrix4().compose(new THREE.Vector3(pose.transform.position.x, pose.transform.position.y, pose.transform.position.z),
          new THREE.Quaternion(pose.transform.orientation.x, pose.transform.orientation.y, pose.transform.orientation.z, pose.transform.orientation.w), new THREE.Vector3(1, 1, 1));
        const pts = plane.polygon.map(p => new THREE.Vector3(p.x, p.y, p.z).applyMatrix4(m));
        const normal = new THREE.Vector3(0, 1, 0).transformDirection(m);
        if (plane.orientation === 'vertical' || Math.abs(normal.y) < .35) {
          if (label && !WALLISH.has(label)) continue;
          const n = new THREE.Vector3(normal.x, 0, normal.z); if (n.lengthSq() < 1e-4) continue; n.normalize();
          const t2 = new THREE.Vector3().crossVectors(UP, n).normalize();
          const centre = pts.reduce((a, p) => a.add(p), new THREE.Vector3()).divideScalar(pts.length);
          let lo = Infinity, hi = -Infinity, ymax = -Infinity;
          for (const p of pts) { const a = p.clone().sub(centre).dot(t2); lo = Math.min(lo, a); hi = Math.max(hi, a); ymax = Math.max(ymax, p.y); }
          if (hi - lo < .4 || (label === 'other' && ymax < 1)) continue;
          if (n.dot(new THREE.Vector3(head.x - centre.x, 0, head.z - centre.z)) < 0) n.negate();
          const mid = centre.clone().addScaledVector(t2, (lo + hi) / 2);
          walls.push({ cx: mid.x, cz: mid.z, nx: n.x, nz: n.z, tx: t2.x, tz: t2.z, hw: (hi - lo) / 2, label: label || 'wall' });
        } else if (FURNITURE.has(label)) {
          const box = new THREE.Box3().setFromPoints(pts);
          if (box.max.y > .15 && box.min.y < 1.6) obstacles.push({ minx: box.min.x, maxx: box.max.x, minz: box.min.z, maxz: box.max.z, label });
        }
      }
    }
    if (!walls.length && !obstacles.length) {
      if (seen) return false;
      if (this.source === 'planes') return false;       // keep what we had if planes vanish for a moment
      return false;
    }
    const signature = walls.map(w => [w.cx, w.cz, w.hw].map(v => Math.round(v * 5)).join(',')).join('|') + '#' + obstacles.map(o => [o.minx, o.maxx, o.minz, o.maxz].map(v => Math.round(v * 5)).join(',')).join('|');
    if (signature === this.signature) return false;
    this.signature = signature; this.walls = walls; this.obstacles = obstacles; this.source = 'planes'; this.version++; this.rebuild();
    return true;
  }

  // Guardian boundary: a polygon of points in the same world space. Only used when no scanned walls exist.
  setBoundary(points) {
    if (this.source === 'planes' || points.length < 3) return false;
    const centre = points.reduce((a, p) => ({ x: a.x + p.x / points.length, z: a.z + p.z / points.length }), { x: 0, z: 0 });
    const walls = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i], b = points[(i + 1) % points.length], dx = b.x - a.x, dz = b.z - a.z, len = Math.hypot(dx, dz); if (len < .2) continue;
      let nx = -dz / len, nz = dx / len; const cx = (a.x + b.x) / 2, cz = (a.z + b.z) / 2;
      if (nx * (centre.x - cx) + nz * (centre.z - cz) < 0) { nx = -nx; nz = -nz; }
      walls.push({ cx, cz, nx, nz, hw: len / 2 + .05, label: 'boundary' });
    }
    this.setRoom(walls, [], 'boundary'); return true;
  }

  // Push a world-space point out of walls and furniture. r is the body radius. Returns true if it moved.
  constrain(v, r = .25) {
    let moved = false;
    for (let pass = 0; pass < 4; pass++) {
      let again = false;
      for (const w of this.walls) {
        const dx = v.x - w.cx, dz = v.z - w.cz, along = dx * w.tx + dz * w.tz, d = dx * w.nx + dz * w.nz;
        if (Math.abs(along) <= w.hw + r * .5 && d < r && d > -4) { v.x += w.nx * (r - d); v.z += w.nz * (r - d); again = moved = true; }
      }
      for (const o of this.obstacles) {
        if (v.x > o.minx - r && v.x < o.maxx + r && v.z > o.minz - r && v.z < o.maxz + r) {
          const push = [[o.minx - r - v.x, 'x'], [o.maxx + r - v.x, 'x'], [o.minz - r - v.z, 'z'], [o.maxz + r - v.z, 'z']].sort((a, b) => Math.abs(a[0]) - Math.abs(b[0]))[0];
          if (push[1] === 'x') v.x += push[0]; else v.z += push[0]; again = moved = true;
        }
      }
      if (!again) break;
    }
    return moved;
  }
  // True when a point is clear of walls and furniture.
  inside(v, r = .25) { const p = v.clone(); return !this.constrain(p, r); }

  // Brick-yellow strip on the floor along each wall and around furniture.
  rebuild() {
    for (const child of [...this.group.children]) { this.group.remove(child); child.geometry?.dispose(); }
    const strip = (cx, cz, yaw, length, depth = .035) => {
      const m = new THREE.Mesh(new THREE.BoxGeometry(length, .012, depth), this.brick);
      m.position.set(cx, .006, cz); m.rotation.y = yaw; this.group.add(m);
      const studs = Math.max(1, Math.floor(length / .16));
      for (let i = 0; i < studs; i++) {
        const stud = new THREE.Mesh(new THREE.CylinderGeometry(.011, .011, .008, 10), this.brick);
        stud.position.set((i - (studs - 1) / 2) * .16, .016, 0); m.add(stud);
      }
    };
    for (const w of this.walls) strip(w.cx + w.nx * .03, w.cz + w.nz * .03, Math.atan2(-w.tz, w.tx), w.hw * 2);
    for (const o of this.obstacles) {
      const w = o.maxx - o.minx, d = o.maxz - o.minz, cx = (o.minx + o.maxx) / 2, cz = (o.minz + o.maxz) / 2;
      strip(cx, o.minz, 0, w); strip(cx, o.maxz, 0, w); strip(o.minx, cz, Math.PI / 2, d); strip(o.maxx, cz, Math.PI / 2, d);
    }
  }
  setVisible(value) { this.group.visible = value; }
}
