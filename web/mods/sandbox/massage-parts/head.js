// A sculpted, life-size male head for the massage client, in its own space: face towards +z, crown +y, metres.
// A sphere is pushed out to real proportions (head ~15.5 cm wide, 20 cm front to back, 23 cm chin to crown) and then
// shaped: occiput, brow ridge, eye sockets with closed lids, nose, cheekbones, lips, chin and jaw. Vertex colour gives
// the lips, eyebrows, lash lines, stubble and redder ears, nose and cheeks. Short cropped hair is a textured shell.
// Expressions are blend shapes: setExpression({ open, smile, wince }) each 0..1.
import * as THREE from 'three';

const A = .0775, B = .118, C = .1;                 // half width, half height, half depth
const g2 = (d2, s) => Math.exp(-d2 / (s * s));
// bump: direction n near direction (x, y, z) (normalised), angular size s
function near(n, x, y, z, s) { const l = Math.hypot(x, y, z), dx = n.x - x / l, dy = n.y - y / l, dz = n.z - z / l; return g2(dx * dx + dy * dy + dz * dz, s); }
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Distance from the centre to the skin along unit direction n.
function radius(n) {
  let r = 1 / Math.sqrt((n.x / A) ** 2 + (n.y / B) ** 2 + (n.z / C) ** 2);
  const front = sm(.1, .6, n.z), low = sm(-.15, -.75, n.y);
  r *= 1 - .2 * low * (1 - .4 * sm(-.2, -.7, n.z)) * Math.abs(n.x) ** .8;   // narrower jaw and chin than skull
  r += .010 * near(n, 0, .1, -1, .5) * (1 - low);                        // occiput
  r -= .004 * (near(n, 1, .35, .2, .25) + near(n, -1, .35, .2, .25));                // temples
  r += .005 * front * g2((n.y - .27) ** 2 + 0, .06) * sm(.55, .2, Math.abs(n.x));   // brow ridge
  for (const sx of [-1, 1]) {
    r -= .009 * near(n, sx * .33, .15, .93, .13);                         // eye socket
    r += .005 * near(n, sx * .33, .13, .93, .08);                         // closed eyelid over the eye
    r += .006 * near(n, sx * .62, -.05, .78, .2);                         // cheekbone
    r += .005 * near(n, sx * .72, -.5, .15, .22);                         // angle of the jaw
    r += .004 * near(n, sx * .14, -.12, .99, .06);                        // side of the nostril
  }
  const ridge = g2(n.x * n.x, .06) * front * sm(.22, .1, n.y) * sm(-.2, -.06, n.y);   // nose: from the bridge to the tip
  r += .024 * ridge * sm(.2, -.1, n.y);
  r += .007 * near(n, 0, -.29, .95, .1) + .006 * near(n, 0, -.39, .92, .09);           // upper and lower lip
  r -= .003 * near(n, 0, -.47, .88, .07);                                             // under the lower lip
  r += .010 * near(n, 0, -.62, .78, .16);                                             // chin
  return r;
}
// 1 where the hair grows: crown, back and sides above the ears, down to the nape.
function hairMask(n) {
  const back = sm(.25, -.1, n.z);
  const line = n.z > 0 ? .62 - .4 * Math.abs(n.x) : lerp(.05, -.62, back);            // the hairline height around the head
  const ears = 1 - near(n, Math.sign(n.x) || 1, -.05, -.05, .32);
  return sm(line - .06, line + .05, n.y) * ears;
}
const lerp = (a, b, t) => a + (b - a) * t;

function hairTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  g.fillStyle = '#2a1d14'; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 2600; i++) {                     // short strands, all combed the same way
    const x = Math.random() * 256, y = Math.random() * 256, l = 3 + Math.random() * 5, a = -1.2 + Math.random() * .3, t = 30 + Math.random() * 40;
    g.strokeStyle = `rgba(${t + 40},${t + 22},${t + 8},${.35 + Math.random() * .4})`; g.lineWidth = .8 + Math.random() * .7;
    g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l); g.stroke();
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 4; return t;
}

// One ear in its own space: x out from the head, y up, z towards the face. About 6.2 cm tall and 3.5 cm wide: a cupped
// bowl (concha) inside a rolled rim (helix), a ridge between them (antihelix), a fleshy lobe and the small flap in front
// of the ear hole (tragus).
function earGeometry() {
  const geo = new THREE.SphereGeometry(1, 48, 36), P = geo.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < P.count; i++) {
    v.fromBufferAttribute(P, i);
    const y = v.y, z = v.z, r = Math.min(1, Math.hypot(y, z)), outer = Math.max(0, v.x);
    const width = .0175 * (1 - .25 * sm(.2, 1, -y)) * (1 + .1 * sm(0, .8, y));   // narrower towards the lobe
    let x = v.x * .0062;
    x += outer * (.0035 * sm(.62, .9, r) - .0055 * (1 - sm(.15, .65, r)) * sm(-.6, -.1, -y * .5 + z * .3) + .0018 * g2((r - .55) ** 2, .1)); // rim up, bowl down, ridge
    x += .004 * g2((y + .8) ** 2, .18) * (1 - Math.abs(z));              // lobe, thicker
    x += outer * .0035 * g2((z - .72) ** 2 + (y + .05) ** 2, .15);       // tragus
    P.setXYZ(i, x + .002, y * .031, z * width - .004 * y * y);
  }
  geo.computeVertexNormals();
  return geo;
}

export function buildHead(skinMaterial, { skin = '#d9a07e', hair = '#3a2a1e' } = {}) {
  const group = new THREE.Group();
  const geo = new THREE.SphereGeometry(1, 112, 84), P = geo.attributes.position, count = P.count;
  const base = new Float32Array(count * 3), colors = new Float32Array(count * 3), dirs = new Float32Array(count * 3);
  const tone = new THREE.Color(skin), hairColor = new THREE.Color(hair), lip = new THREE.Color('#a8584f'), stubble = new THREE.Color('#7d6a62'), ink = new THREE.Color('#3b2a22');
  const n = new THREE.Vector3(), c = new THREE.Color();
  for (let i = 0; i < count; i++) {
    n.fromBufferAttribute(P, i).normalize(); dirs.set([n.x, n.y, n.z], i * 3);
    const r = radius(n); base.set([n.x * r, n.y * r, n.z * r], i * 3);
    c.copy(tone);
    const blush = .5 * near(n, .6, -.08, .78, .2) + .5 * near(n, -.6, -.08, .78, .2) + .6 * near(n, 0, -.05, 1, .12);
    c.lerp(new THREE.Color('#d47b6a'), .25 * blush);
    c.lerp(stubble, .35 * sm(-.2, -.45, n.y) * sm(.2, .55, n.z + .2 * Math.abs(n.y)) * (1 - near(n, 0, -.34, .94, .12)));   // jaw, chin and upper lip stubble
    c.lerp(lip, .75 * Math.max(near(n, 0, -.3, .95, .07) * sm(.16, .08, Math.abs(n.x)), near(n, 0, -.38, .93, .065) * sm(.15, .07, Math.abs(n.x))));
    for (const sx of [-1, 1]) {
      c.lerp(hairColor, .85 * g2((n.y - .25 - .05 * (1 - Math.abs(n.x - sx * .33) / .2)) ** 2, .022) * g2((n.x - sx * .33) ** 2, .11) * sm(.6, .85, n.z));   // eyebrow
      c.lerp(ink, .7 * g2((n.y - .118 + 2 * (n.x - sx * .33) ** 2) ** 2, .012) * g2((n.x - sx * .33) ** 2, .1) * sm(.75, .9, n.z));                  // closed lash line
    }
    c.lerp(hairColor, .7 * hairMask(n));             // scalp under the hair: no pale edge where the shell thins out
    colors.set([c.r, c.g, c.b], i * 3);
  }
  P.array.set(base); geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  const uv = geo.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 5, uv.getY(i) * 2.5);   // skin detail at the same scale as the body
  geo.computeVertexNormals();
  const material = skinMaterial.clone(); material.vertexColors = true; material.color = new THREE.Color('#ffffff');   // the colour is in the vertices
  const face = new THREE.Mesh(geo, material); face.frustumCulled = false; group.add(face);

  // blend shapes
  const shapes = { open: new Float32Array(count * 3), smile: new Float32Array(count * 3), wince: new Float32Array(count * 3) };
  for (let i = 0; i < count; i++) {
    n.fromArray(dirs, i * 3); const k = i * 3;
    const jaw = sm(-.33, -.5, n.y) * sm(.1, .5, n.z) * (1 - sm(.5, .85, Math.abs(n.x)));              // lower lip, chin and jaw drop
    shapes.open[k + 1] = -.014 * jaw; shapes.open[k + 2] = -.004 * jaw;
    for (const sx of [-1, 1]) {
      const corner = near(n, sx * .2, -.33, .93, .1);
      shapes.smile[k] += sx * .003 * corner; shapes.smile[k + 1] += .005 * corner; shapes.smile[k + 2] -= .003 * corner;
      const cheek = near(n, sx * .45, -.1, .87, .15); shapes.smile[k + 1] += .002 * cheek;
      const brow = near(n, sx * .2, .25, .95, .12), lid = near(n, sx * .33, .1, .93, .1);
      shapes.wince[k] -= sx * .003 * brow; shapes.wince[k + 1] -= .005 * brow + .002 * lid;
    }
    const nose = near(n, 0, .02, 1, .12); shapes.wince[k + 1] += .002 * nose;
  }
  const weights = { open: 0, smile: 0, wince: 0 }, lipGap = new Float32Array(count);
  for (let i = 0; i < count; i++) { n.fromArray(dirs, i * 3); lipGap[i] = g2((n.y + .345) ** 2, .02) * sm(.75, .9, n.z) * sm(.17, .1, Math.abs(n.x)); }
  let dirty = false;
  function setExpression(w) {
    for (const key of Object.keys(weights)) { const v = Math.min(1, Math.max(0, w[key] || 0)); if (Math.abs(v - weights[key]) > .02) { weights[key] = v; dirty = true; } }
    if (!dirty) return; dirty = false;
    const arr = P.array, col = geo.attributes.color.array;
    for (let i = 0; i < count * 3; i++) arr[i] = base[i] + shapes.open[i] * weights.open + shapes.smile[i] * weights.smile + shapes.wince[i] * weights.wince;
    for (let i = 0; i < count; i++) if (lipGap[i] > .01) {          // the mouth opening darkens as the lips part
      const f = 1 - .8 * lipGap[i] * weights.open;
      for (let ch = 0; ch < 3; ch++) col[i * 3 + ch] = colors[i * 3 + ch] * f;
    }
    P.needsUpdate = true; geo.attributes.color.needsUpdate = true; geo.computeVertexNormals();
  }

  // hair: a thin shell where the hair grows, thicker on top
  {
    const hg = new THREE.SphereGeometry(1, 96, 64), hp = hg.attributes.position, keep = [];
    for (let i = 0; i < hp.count; i++) { n.fromBufferAttribute(hp, i).normalize(); const m = hairMask(n), r = radius(n) + (.0028 + .005 * sm(-.3, .6, n.y)) * sm(.15, .6, m) - .003 * (1 - sm(.15, .45, m)); hp.setXYZ(i, n.x * r, n.y * r, n.z * r); keep.push(m); }   // the edge dips under the skin: a soft, even hairline
    const idx = hg.index.array, tris = [];
    for (let t = 0; t < idx.length; t += 3) if (Math.max(keep[idx[t]], keep[idx[t + 1]], keep[idx[t + 2]]) > .05) tris.push(idx[t], idx[t + 1], idx[t + 2]);
    hg.setIndex(tris); const huv = hg.attributes.uv; for (let i = 0; i < huv.count; i++) huv.setXY(i, huv.getX(i) * 6, huv.getY(i) * 3);
    hg.computeVertexNormals();
    const map = hairTexture();
    const hairMesh = new THREE.Mesh(hg, new THREE.MeshStandardMaterial({ map, color: '#9a8270', roughness: .8, metalness: 0 }));
    hairMesh.frustumCulled = false; group.add(hairMesh);
  }

  // ears: a sculpted shell each, flaring out from the head towards the back
  const earMat = material.clone(); earMat.vertexColors = false; earMat.color = new THREE.Color(skin).lerp(new THREE.Color('#c8705e'), .18);
  const earGeo = earGeometry();
  for (const sx of [-1, 1]) {
    const ear = new THREE.Mesh(earGeo, earMat);
    ear.position.set(sx * .071, -.012, -.012); ear.scale.set(sx, 1, 1); ear.rotation.set(-.12, sx * -.42, 0);
    ear.frustumCulled = false; group.add(ear);
  }
  return { group, setExpression, radius: dir => radius(dir) };
}
