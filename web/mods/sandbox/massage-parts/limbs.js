// Anatomical limbs for the massage client, lofted along a smooth path with a muscle profile round the bone. Shapes are
// for a man lying face down: on the arms the triceps face up (palms up, forearms turned in), on the legs the calves do,
// and the feet lie on their tops with the soles up and the toes curling over the end of the table.
import * as THREE from 'three';

const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const g = (x, m, s) => Math.exp(-(((x - m) / s) ** 2));
const ang = (a, m, s) => g(Math.atan2(Math.sin(a - m), Math.cos(a - m)), 0, s);    // angular distance

// A tube through points. radius(t, a): t 0..1 along the path, a the angle round it (0 = towards `up`, +pi/2 towards
// tangent x up). Ends are closed. UVs are in units of `uvScale` metres, so a tiled skin map keeps the same scale.
export function loft(points, radius, { along = 40, around = 28, up = new THREE.Vector3(0, 1, 0), uvScale = .12 } = {}) {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal'), length = curve.getLength();
  const pos = [], uv = [], idx = [], N = new THREE.Vector3(), Bn = new THREE.Vector3(), P = new THREE.Vector3();
  for (let i = 0; i <= along; i++) {
    const t = i / along, T = curve.getTangentAt(t); curve.getPointAt(t, P);
    N.copy(up).addScaledVector(T, -up.dot(T)).normalize(); Bn.crossVectors(T, N);
    for (let j = 0; j <= around; j++) {
      const a = -Math.PI + 2 * Math.PI * j / around, r = radius(t, a);   // seam underneath, out of sight
      pos.push(P.x + r * (Math.cos(a) * N.x + Math.sin(a) * Bn.x), P.y + r * (Math.cos(a) * N.y + Math.sin(a) * Bn.y), P.z + r * (Math.cos(a) * N.z + Math.sin(a) * Bn.z));
      uv.push(t * length / uvScale, (j / around) * 2 * Math.PI * radius(t, 0) / uvScale);
    }
  }
  const ring = around + 1;
  for (let i = 0; i < along; i++) for (let j = 0; j < around; j++) { const a = i * ring + j, b = a + ring; idx.push(a, a + 1, b, b, a + 1, b + 1); }
  for (const [i, flip] of [[0, true], [along, false]]) {            // caps
    const c = pos.length / 3, t = i / along; curve.getPointAt(t, P); pos.push(P.x, P.y, P.z); uv.push(0, 0);
    for (let j = 0; j < around; j++) { const a = i * ring + j; flip ? idx.push(c, a + 1, a) : idx.push(c, a, a + 1); }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setIndex(idx); geo.computeVertexNormals();
  return geo;
}

// Shoulder to wrist, one smooth tube. side: 1 his left (+z), -1 his right. Returns the geometry.
export function armGeometry(S, E, W, side) {
  const lenU = S.distanceTo(E), lenF = E.distanceTo(W), split = lenU / (lenU + lenF);
  return loft([S, S.clone().lerp(E, .5), E, E.clone().lerp(W, .5), W], (t, a) => {
    const out = side * Math.PI / 2;                     // the side away from his body
    if (t < split) {
      const u = t / split;
      let r = .046 - .01 * u;
      r += .009 * g(u, .08, .16) * (.6 + .4 * ang(a, out, 1.2));      // deltoid cap
      r += .007 * g(u, .45, .25) * ang(a, 0, 1);                      // triceps, facing up
      r += .006 * g(u, .58, .2) * ang(a, Math.PI, .9);                // biceps, underneath
      r += .003 * g(u, .97, .04) * ang(a, 0, .5);                     // point of the elbow
      return r * (1 - .1 * Math.abs(Math.sin(a)));                    // a little flatter side to side
    }
    const u = (t - split) / (1 - split);
    let r = .041 - .016 * sm(0, 1, u);
    r += .007 * g(u, .22, .2) * (.5 + .5 * ang(a, -out * .6, 1.4));  // forearm muscle belly
    r += .002 * g(u, .96, .04) * (ang(a, out, .4) + ang(a, -out, .4)); // wrist bones
    const flat = sm(.5, 1, u) * .28;                                  // the wrist is wider than it is deep
    return r * (1 - flat * Math.abs(Math.cos(a)) + .1 * flat * Math.abs(Math.sin(a)));
  }, { along: 56, around: 30 });
}

// Knee to ankle. side as for the arm.
export function calfGeometry(K, M, A, side) {
  const inner = -side * Math.PI / 2;
  return loft([K, M, A], (t, a) => {
    let r = .056 - .024 * sm(.25, 1, t);
    r += .016 * g(t, .3, .2) * ang(a, inner * .45, .8);               // gastrocnemius, the bigger inner head
    r += .011 * g(t, .28, .18) * ang(a, -inner * .45, .7);            // and the outer head
    r -= .008 * sm(.6, .9, t) * ang(a, 0, .9) * (1 - ang(a, 0, .18)); // either side of the Achilles tendon
    r += .006 * g(t, .96, .04) * (ang(a, Math.PI / 2, .45) + ang(a, -Math.PI / 2, .45));   // ankle bones
    return r;
  }, { along: 44, around: 28 });
}

// A foot lying on its top, sole up, from the heel to the base of the toes along +x, in the ankle's space.
// Returns { geometry, toes: [{ from, to, r }] } (toe capsules, positions relative to the ankle).
export function footParts(side) {
  const inner = -side;                                     // towards the other foot (z)
  const geometry = loft([new THREE.Vector3(-.035, .012, 0), new THREE.Vector3(.04, .0, inner * .004), new THREE.Vector3(.12, -.008, inner * .008), new THREE.Vector3(.168, -.014, inner * .01)], (t, a) => {
    const hz = .031 + .017 * sm(0, .8, t), hy = .036 - .016 * sm(.1, 1, t);              // half width and half height
    let r = 1 / Math.sqrt((Math.cos(a) / hy) ** 2 + (Math.sin(a) / hz) ** 2);
    r += .006 * g(t, .06, .1) * ang(a, 0, 1);                                            // heel pad
    r += .004 * g(t, .82, .1) * ang(a, 0, 1);                                            // ball of the foot
    r -= .006 * g(t, .45, .2) * ang(a, inner * Math.PI / 2 * .6, .6);                    // the arch, on the inside of the sole
    return r;
  }, { along: 36, around: 26 });
  // toes from the big toe (inside) to the little toe, curling down over the edge
  const toes = [[.032, .0115, .016], [.026, .0085, .004], [.023, .008, -.008], [.02, .0075, -.019], [.017, .0068, -.029]].map(([len, r, z]) => {
    const from = new THREE.Vector3(.168, -.016 + (z > 0 ? .002 : 0), inner * z), to = from.clone().add(new THREE.Vector3(len, -len * .45, inner * z * .12));
    return { from, to, r };
  });
  return { geometry, toes };
}
