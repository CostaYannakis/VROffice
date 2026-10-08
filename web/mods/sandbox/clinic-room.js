// Brick Back Clinic: the massage table's own room in the east wing of the Sandbox, half day spa, half chiropractor.
// A door from the office (sign over it) opens into reception: a desk under a neon sign, a waiting bench, a coffee
// table, plants. Past a low planter divider is the treatment room: warm pendant lamps over the table, a glowing x-ray
// box and a spine chart, a model spine on a stand, a sideboard with candles, a diffuser and stones, a shelf of rolled
// towels. The table itself (and everything to do with the client) is massage-simulator.js; the room's place is in
// massage-parts/clinic-layout.js, which both read. Static parts are merged into one mesh per material.
import { mergeGeometries } from '../../vendor/BufferGeometryUtils.js';
import { roundBox } from '../../avatar.js';
import { CLINIC, TABLE } from './massage-parts/clinic-layout.js';

export default function (ctx) {
  const { THREE } = ctx;
  const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
  const room = new THREE.Group(); room.name = 'clinic-room';
  ctx.add(room, { at: [0, 0, 0] });
  const disposables = [];
  ctx.onCleanup(() => { for (const d of disposables) d.dispose(); });

  // ---------- materials ----------
  const std = (color, roughness = .45, extra = {}) => { const m = new THREE.MeshStandardMaterial({ color, roughness, ...extra }); disposables.push(m); return m; };
  const glow = color => { const m = new THREE.MeshBasicMaterial({ color, toneMapped: false }); disposables.push(m); return m; };
  const M = {
    wall: std('#f1e6d4', .8), sage: std('#8fb39d', .6), trim: std('#b98a5a', .5), woodDark: std('#7a5234', .5), wood: std('#c99a66', .5),
    white: std('#fbfaf6', .35), cream: std('#f3e7cf', .5), teal: std('#2a9d96', .5), tealDark: std('#1f6f6a', .5), stone: std('#8d8a86', .7),
    stoneLight: std('#bdb8b0', .7), terracotta: std('#c8673e', .6), pot: std('#f6f1e7', .4), soil: std('#4a3426', .9), leaf: std('#3f8f4f', .55),
    leafLight: std('#62b25b', .55), leafDark: std('#2d6b3e', .55), bone: std('#efe6cf', .4), disc: std('#7fa7c9', .4), metal: std('#9aa3ad', .3),
    black: std('#2b3644', .4), pink: std('#e86a92', .45), gold: std('#d9a640', .3), shade: std('#f7ead2', .5, { emissive: '#ffd9a0', emissiveIntensity: .35, side: THREE.DoubleSide }),
    bulb: glow('#ffe2a8'), flame: glow('#ffc65c'),
  };

  // ---------- the kit: static parts, merged per material at the end ----------
  const kit = new Map();
  const EUL = new THREE.Euler(), Q = new THREE.Quaternion(), MAT = new THREE.Matrix4();
  function part(geo, mat, x, y, z, { rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1, parent = null } = {}) {
    let g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (g.attributes.uv) g.deleteAttribute('uv');
    if (g.attributes.uv1) g.deleteAttribute('uv1');
    MAT.compose(V(x, y, z), Q.setFromEuler(EUL.set(rx, ry, rz)), V(sx, sy, sz));
    if (parent) MAT.premultiply(parent);
    g.applyMatrix4(MAT);
    if (!kit.has(mat)) kit.set(mat, []);
    kit.get(mat).push(g);
  }
  const G = {
    box: new THREE.BoxGeometry(1, 1, 1), cyl: new THREE.CylinderGeometry(1, 1, 1, 18), cyl8: new THREE.CylinderGeometry(1, 1, 1, 8),
    ball: new THREE.SphereGeometry(1, 16, 10), cone: new THREE.ConeGeometry(1, 1, 12), stud: new THREE.CylinderGeometry(1, 1, 1, 10),
  };
  disposables.push(...Object.values(G));
  // a box w x h x d standing on y (its base), centred on x, z
  const box = (w, h, d, mat, x, y, z, o = {}) => part(G.box, mat, x, y + h / 2, z, { ...o, sx: w, sy: h, sz: d });
  const cyl = (r, h, mat, x, y, z, o = {}) => part(o.low ? G.cyl8 : G.cyl, mat, x, y + h / 2, z, { ...o, sx: r, sy: h, sz: r });
  const ball = (r, mat, x, y, z, o = {}) => part(G.ball, mat, x, y, z, { sx: r * (o.fx || 1), sy: r * (o.fy || 1), sz: r * (o.fz || 1), ...o });
  const cone = (r, h, mat, x, y, z, o = {}) => part(G.cone, mat, x, y + h / 2, z, { ...o, sx: r, sy: h, sz: r });
  const rbox = (w, h, d, r, mat, x, y, z, o = {}) => { const geo = roundBox(w, h, d, r); part(geo, mat, x, y + h / 2, z, o); geo.dispose(); };
  // studs along a line: the toy-brick top of a wall or a box
  function studRow(mat, x0, z0, x1, z1, y, pitch = .16, r = .034) {
    const n = Math.max(1, Math.round(Math.hypot(x1 - x0, z1 - z0) / pitch));
    for (let i = 0; i < n; i++) { const t = (i + .5) / n; part(G.stud, mat, x0 + (x1 - x0) * t, y + .012, z0 + (z1 - z0) * t, { sx: r, sy: .024, sz: r }); }
  }

  // ---------- canvas pictures ----------
  function picture(w, h, px, draw, { basic = true, transparent = false } = {}) {
    const c = document.createElement('canvas'); c.width = px; c.height = Math.round(px * h / w);
    draw(c.getContext('2d'), c.width, c.height);
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    const mat = basic ? new THREE.MeshBasicMaterial({ map: tex, toneMapped: false, transparent }) : new THREE.MeshStandardMaterial({ map: tex, roughness: .6 });
    const geo = new THREE.PlaneGeometry(w, h); disposables.push(tex, mat, geo);
    const mesh = new THREE.Mesh(geo, mat); room.add(mesh); return mesh;
  }
  // a framed picture on a wall: 'n' (north wall, facing +z), 's', 'e' (facing -x), 'w' (facing +x)
  const WALL = { n: [0, 1], s: [0, -1], e: [-1, 0], w: [1, 0] };
  function framed(wall, along, y, w, h, px, draw, { frame = M.woodDark, depth = .04, lit = false } = {}) {
    const [nx, nz] = WALL[wall], face = wall === 'n' ? CLINIC.minZ : wall === 's' ? CLINIC.maxZ : wall === 'e' ? CLINIC.maxX : CLINIC.minX;
    const ry = Math.atan2(nx, nz);
    const at = (off) => wall === 'n' || wall === 's' ? [along, face + nz * off] : [face + nx * off, along];
    const [fx, fz] = at(depth / 2);
    box(w + .07, h + .07, depth, frame, fx, y - (h + .07) / 2, fz, { ry });
    const pic = picture(w, h, px, draw, { basic: lit });
    const [px2, pz2] = at(depth + .002); pic.position.set(px2, y, pz2); pic.rotation.y = ry;
    return pic;
  }

  const { minX, maxX, minZ, maxZ, wall: WH, door, split, gap } = CLINIC, T = .12;

  // ---------- floor and rugs ----------
  {
    const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d');
    const tones = ['#c89b6a', '#bf9061', '#d2a776', '#b88a5c', '#c4966a', '#cba070'];
    for (let row = 0; row < 8; row++) {
      let x = -(row * 97 % 260);
      while (x < 512) {
        const len = 200 + (row * 53 + x) % 140;
        g.fillStyle = tones[(row * 7 + Math.abs(x)) % tones.length]; g.fillRect(x, row * 64, len, 64);
        g.strokeStyle = 'rgba(80,50,25,.12)'; g.lineWidth = 2; for (let k = 0; k < 4; k++) { g.beginPath(); g.moveTo(x + 10, row * 64 + 12 + k * 12); g.bezierCurveTo(x + len * .3, row * 64 + 8 + k * 13, x + len * .7, row * 64 + 18 + k * 11, x + len - 10, row * 64 + 12 + k * 12); g.stroke(); }
        g.fillStyle = 'rgba(60,35,15,.55)'; g.fillRect(x, row * 64, 3, 64); x += len;
      }
      g.fillStyle = 'rgba(60,35,15,.45)'; g.fillRect(0, row * 64, 512, 3);
    }
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.anisotropy = 8;
    tex.repeat.set((maxX - minX) / 1.6, (maxZ - minZ) / 1.6);
    const mat = new THREE.MeshStandardMaterial({ map: tex, roughness: .65 }), geo = new THREE.PlaneGeometry(maxX - minX, maxZ - minZ);
    disposables.push(tex, mat, geo);
    const floor = new THREE.Mesh(geo, mat); floor.rotation.x = -Math.PI / 2; floor.position.set((minX + maxX) / 2, .004, (minZ + maxZ) / 2); room.add(floor);
  }
  const rug = (w, d, x, z, draw, round = false) => {
    const m = picture(w, d, 512, draw, { basic: false }); m.rotation.x = -Math.PI / 2; m.position.set(x, .009, z);
    if (round) { m.material.transparent = true; m.material.alphaTest = .5; }
    return m;
  };
  rug(3.0, 1.9, TABLE.x, TABLE.z + .1, (g, w, h) => {          // an oval rug under the table
    const rings = ['#e9dcc3', '#8fb39d', '#f4ecdc', '#c99a66', '#f4ecdc', '#8fb39d'];
    rings.forEach((col, i) => { g.fillStyle = col; g.beginPath(); g.ellipse(w / 2, h / 2, w / 2 - i * 22, h / 2 - i * 14, 0, 0, Math.PI * 2); g.fill(); });
  }, true);
  rug(2.1, 1.4, 6.35, .75, (g, w, h) => {                       // a striped rug in the waiting area
    g.fillStyle = '#f2e8d8'; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 9; i++) { g.fillStyle = i % 2 ? '#2a9d96' : '#e86a92'; g.fillRect(30 + i * 52, 30, 20, h - 60); }
    g.strokeStyle = '#c99a66'; g.lineWidth = 14; g.strokeRect(14, 14, w - 28, h - 28);
  });

  // ---------- walls: warm plaster, a sage wainscot with a wooden rail, studs along the top ----------
  function wall(x0, z0, x1, z1, inward, segments = [[0, WH]]) {        // inner face along x0,z0 -> x1,z1; inward: [nx, nz]
    const len = Math.hypot(x1 - x0, z1 - z0), cx = (x0 + x1) / 2 - inward[0] * T / 2, cz = (z0 + z1) / 2 - inward[1] * T / 2;
    const ry = Math.atan2(x1 - x0, z1 - z0) - Math.PI / 2;
    for (const [y0, y1] of segments) box(len + (y0 === 0 ? T * 2 : 0), y1 - y0, T, M.wall, cx, y0, cz, { ry });
    const ix = (x0 + x1) / 2 + inward[0] * .011, iz = (z0 + z1) / 2 + inward[1] * .011;
    if (segments[0][0] === 0) {
      box(len, .95, .022, M.sage, ix, 0, iz, { ry });
      box(len, .045, .04, M.trim, ix + inward[0] * .01, .95, iz + inward[1] * .01, { ry });
      box(len, .1, .035, M.woodDark, ix + inward[0] * .007, 0, iz + inward[1] * .007, { ry });          // skirting
    }
    box(len + T * 2, .05, T + .04, M.trim, cx, WH, cz, { ry });                                       // cap
    studRow(M.trim, x0 - inward[0] * T / 2, z0 - inward[1] * T / 2, x1 - inward[0] * T / 2, z1 - inward[1] * T / 2, WH + .05);
  }
  wall(minX, minZ, maxX, minZ, [0, 1]);
  wall(maxX, minZ, maxX, maxZ, [-1, 0]);
  wall(minX, maxZ, maxX, maxZ, [0, -1]);
  wall(minX, minZ, minX, door[0], [1, 0]);
  wall(minX, door[1], minX, maxZ, [1, 0]);
  box(T, WH - 2.2, door[1] - door[0], M.wall, minX - T / 2, 2.2, (door[0] + door[1]) / 2);           // over the door
  box(T + .04, .05, door[1] - door[0], M.trim, minX - T / 2, WH, (door[0] + door[1]) / 2);
  studRow(M.trim, minX - T / 2, door[0], minX - T / 2, door[1], WH + .05);
  for (const z of [door[0] + .05, door[1] - .05]) box(T + .08, 2.2, .1, M.woodDark, minX - T / 2, 0, z);   // door frame
  box(T + .08, .1, door[1] - door[0], M.woodDark, minX - T / 2, 2.15, (door[0] + door[1]) / 2);
  box(.7, .015, 1.1, M.tealDark, minX - .55, 0, (door[0] + door[1]) / 2);                            // welcome mat outside

  // ---------- plants ----------
  function plant(x, z, size = 1, { pot = M.pot, tall = false } = {}) {
    const s = size;
    cyl(.16 * s, .34 * s, pot, x, 0, z);
    cyl(.18 * s, .04 * s, pot, x, .32 * s, z);
    cyl(.15 * s, .02, M.soil, x, .34 * s, z);
    if (tall) {
      cyl(.025 * s, 1.0 * s, M.woodDark, x, .34 * s, z, { low: true });
      const leaves = [[0, 1.45, 0, .32], [.16, 1.2, .08, .24], [-.15, 1.25, -.06, .26], [.05, 1.0, -.14, .2], [-.08, .95, .13, .2]];
      leaves.forEach(([dx, y, dz, r], i) => ball(r * s, [M.leaf, M.leafLight, M.leafDark][i % 3], x + dx * s, y * s, z + dz * s, { fy: .8 }));
    } else {
      for (let i = 0; i < 9; i++) {
        const a = i * 2.4, tilt = .35 + (i % 3) * .22, len = (.32 + (i % 4) * .06) * s;       // blades leaning out all round
        const ox = -Math.sin(tilt) * Math.cos(a) * len * .5, oz = Math.sin(tilt) * Math.sin(a) * len * .5;
        ball(.12 * s, [M.leaf, M.leafLight, M.leafDark][i % 3], x + ox, .36 * s + Math.cos(tilt) * len * .55, z + oz, { fx: .45, fy: 1.4, fz: .18, ry: a, rz: tilt });
      }
    }
  }
  // the divider between reception and treatment: two long planters of grasses, a wide gap in the middle
  for (const [x0, x1] of [[minX, gap[0]], [gap[1], maxX]]) {
    const w = x1 - x0, cx = (x0 + x1) / 2;
    box(w, .55, .36, M.wood, cx, 0, split);
    box(w + .04, .04, .4, M.woodDark, cx, .55, split);
    for (let k = -2; k <= 2; k++) box(w, .012, .006, M.woodDark, cx, .1 + (k + 2) * .1, split + .183);    // slats
    box(w - .06, .02, .3, M.soil, cx, .56, split);
    for (let i = 0; i < Math.round(w / .14); i++) {
      const x = x0 + .07 + i * .14 + (i % 2) * .03, z = split + (i % 3 - 1) * .08;
      cone(.05, .5 + (i * 37 % 5) * .08, [M.leaf, M.leafLight, M.leafDark][i % 3], x, .56, z, { rz: (i % 2 ? .12 : -.12) });
    }
  }
  plant(maxX - .3, minZ + .3, 1.3, { tall: true });
  plant(minX + .25, minZ + .25, .9, { pot: M.terracotta });
  plant(maxX - .28, split - .4, 1.1, { tall: true, pot: M.terracotta });
  plant(minX + .27, maxZ - .27, 1.25, { tall: true });
  plant(7.62, maxZ - .25, .95, { pot: M.terracotta });
  plant(maxX - .25, maxZ - .25, 1.0);
  plant(minX + .3, door[0] - .45, .85);

  // ---------- treatment room ----------
  // pendant lamps over the table, and a warm light
  for (const dx of [-.45, .45]) {
    const x = TABLE.x + dx, z = TABLE.z;
    cyl(.006, .5, M.black, x, WH - .5, z, { low: true });
    part(new THREE.CylinderGeometry(.07, .2, .18, 24, 1, true), M.shade, x, WH - .58, z);
    cyl(.02, .02, M.gold, x, WH - .5, z);
    ball(.045, M.bulb, x, WH - .66, z);
  }
  const lamp = new THREE.PointLight('#ffd9a6', 3, 6, 1.5); lamp.position.set(TABLE.x, WH - .75, TABLE.z); room.add(lamp);
  const reception = new THREE.PointLight('#ffe6c4', 2, 5, 1.5); reception.position.set(7.0, WH - .4, .2); room.add(reception);
  // wall sconces (west wall)
  for (const z of [-4.6, -2.4]) {
    box(.04, .26, .16, M.gold, minX + .02, 1.68, z);
    part(new THREE.CylinderGeometry(.09, .06, .2, 20, 1, true, 0, Math.PI), M.shade, minX + .05, 1.86, z, { ry: Math.PI / 2 });
    ball(.03, M.bulb, minX + .07, 1.84, z);
  }

  // the x-ray light box, north wall, glowing
  framed('n', 5.55, 1.6, .6, .8, 384, (g, w, h) => {
    const bg = g.createRadialGradient(w / 2, h / 2, 20, w / 2, h / 2, h * .7); bg.addColorStop(0, '#1d3550'); bg.addColorStop(1, '#070d18'); g.fillStyle = bg; g.fillRect(0, 0, w, h);
    g.strokeStyle = 'rgba(200,225,255,.35)'; g.lineWidth = 7;
    for (let i = 0; i < 9; i++) { const y = 110 + i * 26; for (const s of [-1, 1]) { g.beginPath(); g.moveTo(w / 2 + s * 18, y); g.bezierCurveTo(w / 2 + s * 120, y - 30, w / 2 + s * 150, y + 40, w / 2 + s * 110, y + 70); g.stroke(); } }
    for (let i = 0; i < 22; i++) {
      const t = i / 21, y = 40 + t * 380, x = w / 2 + Math.sin(t * Math.PI * 2.2 + .4) * 14, s = 12 + t * 12;
      g.fillStyle = `rgba(235,245,255,${.75 + .2 * Math.random()})`; g.beginPath(); g.roundRect(x - s, y, s * 2, s * .78, 5); g.fill();
    }
    g.fillStyle = 'rgba(230,240,255,.7)'; g.beginPath(); g.ellipse(w / 2, 455, 95, 34, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#070d18'; g.beginPath(); g.ellipse(w / 2, 462, 30, 20, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(180,215,255,.8)'; g.font = 'bold 20px system-ui, sans-serif'; g.fillText('L', 18, 30); g.fillText('PA SPINE', w - 110, 30);
  }, { frame: M.white, depth: .07, lit: true });
  // the spine chart, north wall
  const REGIONS = [['CERVICAL', 'C', 7, '#e86a92'], ['THORACIC', 'T', 12, '#2a9d96'], ['LUMBAR', 'L', 5, '#f5a623']];
  framed('n', 8.45, 1.6, .58, .82, 512, (g, w, h) => {
    g.fillStyle = '#fbf6ea'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#1d232b'; g.font = '900 40px system-ui, sans-serif'; g.textAlign = 'center'; g.fillText('YOUR SPINE', w / 2, 52);
    g.font = '600 18px system-ui, sans-serif'; g.fillStyle = '#5b6573'; g.fillText('24 vertebrae · 1 happy back', w / 2, 80);
    let y = 104, i = 0;
    for (const [name, letter, n, col] of REGIONS) {
      const y0 = y;
      for (let k = 1; k <= n; k++, i++) {
        const t = i / 23, x = w * .42 + Math.sin(t * Math.PI * 2.1 + .5) * 26, s = 26 + t * 26, hgt = 16 + t * 6;
        g.fillStyle = col; g.beginPath(); g.roundRect(x - s, y, s * 2, hgt, 6); g.fill();
        g.fillStyle = '#1d232b'; g.font = '700 13px system-ui, sans-serif'; g.textAlign = 'left'; g.fillText(`${letter}${k}`, x + s + 8, y + hgt - 3);
        y += hgt + 5;
      }
      g.fillStyle = col; g.fillRect(w * .82, y0, 8, y - y0 - 5);
      g.save(); g.translate(w * .9, (y0 + y) / 2); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.font = '800 17px system-ui, sans-serif'; g.fillText(name, 0, 6); g.restore();
    }
    g.fillStyle = '#c99a66'; g.beginPath(); g.moveTo(w * .42 - 40, y + 4); g.lineTo(w * .42 + 40, y + 4); g.lineTo(w * .42, y + 70); g.closePath(); g.fill();
  }, { frame: M.woodDark });
  // a floating shelf of rolled towels, candles and oils, north wall over the board
  box(1.3, .04, .24, M.wood, TABLE.x, 2.02, minZ + .12);
  for (const dx of [-.5, .5]) box(.03, .12, .2, M.gold, TABLE.x + dx, 1.9, minZ + .1);
  [[-.5, 0, M.white], [-.38, 0, M.teal], [-.44, .1, M.white]].forEach(([dx, dy, m]) => cyl(.055, .2, m, TABLE.x + dx, 2.1 + dy, minZ + .12, { rx: Math.PI / 2, ry: 0 }));
  [[-.1, M.terracotta], [0, M.gold], [.08, M.teal]].forEach(([dx, m], i) => { cyl(.03, .12 + i * .02, m, TABLE.x + dx, 2.06, minZ + .12); cyl(.012, .04, M.black, TABLE.x + dx, 2.18 + i * .02, minZ + .12); });
  ball(.07, M.leafLight, TABLE.x + .32, 2.17, minZ + .12, { fy: .7 }); cyl(.06, .1, M.pot, TABLE.x + .32, 2.06, minZ + .12);

  // the model spine on its stand, by the x-ray box
  {
    const sx = 5.2, sz = -4.45, turn = Math.atan2(TABLE.x - sx, TABLE.z + 1 - sz);
    const frame = new THREE.Matrix4().compose(V(sx, 0, sz), Q.setFromEuler(EUL.set(0, turn, 0)), V(1, 1, 1));
    const P = (geo, mat, x, y, z, o = {}) => part(geo, mat, x, y, z, { ...o, parent: frame });
    P(G.cyl, M.black, 0, .03, 0, { sx: .22, sy: .06, sz: .22 });
    P(G.cyl8, M.metal, 0, .65, -.12, { sx: .015, sy: 1.2, sz: .015 });
    P(G.box, M.metal, 0, 1.2, -.07, { sx: .03, sy: .03, sz: .1 });
    let y = 1.18;
    for (let i = 0; i < 24; i++) {
      const t = i / 23, r = .02 + t * .022, h = .022 + t * .012, z = .03 * Math.sin(t * Math.PI * 2.1 + .3);
      P(G.cyl, M.bone, 0, y - h / 2, z, { sx: r, sy: h, sz: r });
      P(G.box, M.bone, 0, y - h / 2, z - r - .012, { sx: .012, sy: h * .7, sz: .03, rx: -.4 });
      for (const s of [-1, 1]) P(G.box, M.bone, s * (r + .008), y - h / 2, z - r * .3, { sx: .02, sy: h * .5, sz: .012 });
      y -= h;
      if (i < 23) { P(G.cyl, M.disc, 0, y - .004, z, { sx: r * .92, sy: .008, sz: r * .92 }); y -= .008; }
    }
    P(new THREE.TorusGeometry(.085, .035, 10, 24), M.bone, 0, y - .06, .01, { rx: Math.PI / 2 - .5, sx: 1.2 });
    P(G.cone, M.bone, 0, y - .04, -.03, { sx: .045, sy: .1, sz: .03, rx: Math.PI });
    P(G.ball, M.bone, 0, 1.24, .02, { sx: .045, sy: .025, sz: .05 });                    // the atlas
  }
  // the sideboard on the east wall: candles, a reed diffuser, a stone stack, towels
  {
    const x = maxX - .2, z0 = -5.4, z1 = -4.25, zc = (z0 + z1) / 2, len = z1 - z0;
    rbox(.38, .78, len, .02, M.white, x, 0, zc);
    box(.4, .04, len + .03, M.wood, x, .78, zc);
    for (const k of [-1, 0, 1]) { box(.01, .3, len / 3 - .04, M.cream, x - .195, .38, zc + k * len / 3); ball(.016, M.gold, x - .205, .53, zc + k * len / 3); }
    box(.01, .22, len - .04, M.cream, x - .195, .1, zc);
    [[0, .055], [.035, .045], [.062, .036], [.084, .028]].forEach(([y, r], i) => ball(r, i % 2 ? M.stoneLight : M.stone, x - .02, .82 + y + r * .4, z0 + .2, { fy: .45 }));
    cyl(.045, .12, M.tealDark, x, .82, z0 + .42);
    for (let k = 0; k < 6; k++) part(G.cyl8, M.woodDark, x + Math.sin(k) * .02, 1.04, z0 + .42 + Math.cos(k) * .02, { sx: .003, sy: .3, sz: .003, rz: Math.sin(k * 1.7) * .18, rx: Math.cos(k * 1.3) * .18 });
    [[.0, M.white], [.05, M.teal], [.1, M.white]].forEach(([dy, m]) => rbox(.3, .05, .22, .02, m, x, .82 + dy, z1 - .17));
  }
  framed('e', -4.85, 1.65, .72, .5, 512, (g, w, h) => {             // BREATHE: a calm print over the sideboard
    const sky = g.createLinearGradient(0, 0, 0, h); sky.addColorStop(0, '#f7d6b8'); sky.addColorStop(1, '#f3e7cf'); g.fillStyle = sky; g.fillRect(0, 0, w, h);
    g.fillStyle = '#f2a97a'; g.beginPath(); g.arc(w * .7, h * .42, 46, 0, Math.PI * 2); g.fill();
    [['#8fb39d', .62], ['#5f8f78', .72], ['#2a6b62', .84]].forEach(([col, y]) => { g.fillStyle = col; g.beginPath(); g.moveTo(0, h); for (let x = 0; x <= w; x += 16) g.lineTo(x, h * y + Math.sin(x / 60 + y * 9) * 18); g.lineTo(w, h); g.fill(); });
    g.fillStyle = '#ffffff'; g.font = '800 48px system-ui, sans-serif'; g.textAlign = 'center'; g.fillText('B R E A T H E', w / 2, 70);
  });
  framed('e', -3.55, 1.62, .4, .3, 384, (g, w, h) => {              // a (made-up) certificate
    g.fillStyle = '#fffaf0'; g.fillRect(0, 0, w, h); g.strokeStyle = '#d9a640'; g.lineWidth = 10; g.strokeRect(14, 14, w - 28, h - 28);
    g.fillStyle = '#1d232b'; g.textAlign = 'center'; g.font = '800 30px Georgia, serif'; g.fillText('Certificate of', w / 2, 74); g.fillText('Excellent Cracking', w / 2, 112);
    g.font = 'italic 20px Georgia, serif'; g.fillStyle = '#5b6573'; g.fillText('awarded to the Brick Back Clinic', w / 2, 160);
    g.fillStyle = '#d9a640'; g.beginPath(); g.arc(w / 2, 222, 30, 0, Math.PI * 2); g.fill();
  }, { frame: M.gold, depth: .025 });
  framed('w', -3.5, 1.6, .9, .6, 512, (g, w, h) => {                // big leaf print on the west wall
    g.fillStyle = '#eef1e6'; g.fillRect(0, 0, w, h);
    const leaf = (x, y, s, a, col) => { g.save(); g.translate(x, y); g.rotate(a); g.fillStyle = col; g.beginPath(); g.moveTo(0, 0); g.bezierCurveTo(s * .5, -s * .35, s, -s * .1, s * 1.2, 0); g.bezierCurveTo(s, s * .1, s * .5, s * .35, 0, 0); g.fill();
      g.strokeStyle = 'rgba(255,255,255,.5)'; g.lineWidth = 3; g.beginPath(); g.moveTo(0, 0); g.lineTo(s * 1.15, 0); g.stroke(); g.restore(); };
    [[120, 300, 170, -.8, '#5f8f78'], [200, 320, 200, -.3, '#2a6b62'], [260, 300, 150, -1.4, '#8fb39d'], [330, 330, 190, .2, '#3f7f62'], [90, 340, 140, -2.6, '#2a9d96'], [420, 310, 120, -1.0, '#8fb39d']]
      .forEach(([x, y, s, a, c]) => leaf(x, y, s, a, c));
  });

  // ---------- reception ----------
  {
    const x = maxX - .62, z = .15, len = 1.5;
    box(.6, 1.0, len, M.white, x, 0, z);
    box(.68, .05, len + .08, M.wood, x - .02, 1.0, z);
    box(.02, .88, len - .1, M.sage, x - .31, .06, z);
    studRow(M.wood, x - .02, z - len / 2 + .05, x - .02, z + len / 2 - .05, 1.05, .14, .028);
    // on the desk: a monitor facing visitors, a bell, flowers, a little card stand
    box(.06, .03, .22, M.black, x + .05, 1.05, z - .35); box(.02, .12, .03, M.black, x + .05, 1.08, z - .35);
    rbox(.03, .24, .4, .01, M.black, x + .04, 1.17, z - .35);
    cyl(.05, .015, M.gold, x - .1, 1.05, z + .1); ball(.042, M.gold, x - .1, 1.068, z + .1, { fy: .8 });
    cyl(.04, .16, M.teal, x + .05, 1.05, z + .5);
    [[0, 0, M.pink], [.04, .02, M.gold], [-.03, .03, M.white], [.01, -.04, M.pink], [-.02, -.02, M.gold]].forEach(([dx, dz, m]) => { part(G.cyl8, M.leafDark, x + .05 + dx * .5, 1.27, z + .5 + dz * .5, { sx: .004, sy: .14, sz: .004 }); ball(.03, m, x + .05 + dx, 1.36, z + .5 + dz); });
    box(.08, .06, .12, M.wood, x - .2, 1.05, z + .38);
  }
  const screenPic = picture(.38, .22, 512, (g, w, h) => {
    g.fillStyle = '#1b2433'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#7cf0ff'; g.font = '900 52px system-ui, sans-serif'; g.textAlign = 'center'; g.fillText('BOOK NOW', w / 2, 92);
    g.fillStyle = '#ffffff'; g.font = '600 28px system-ui, sans-serif'; g.fillText('massage · adjustments · neck', w / 2, 150);
    g.fillStyle = '#e86a92'; g.fillText('walk-ins welcome', w / 2, 198);
  });
  screenPic.position.set(maxX - .62 + .02, 1.17 + .12, .15 - .35); screenPic.rotation.y = -Math.PI / 2;
  const deskSign = picture(1.2, .34, 1024, (g, w, h) => {
    g.fillStyle = '#8fb39d'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#ffffff'; g.font = '900 96px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('RECEPTION', w / 2, h / 2 + 4);
  }, { basic: false });
  deskSign.position.set(maxX - .62 - .325, .55, .15); deskSign.rotation.y = -Math.PI / 2;
  // the neon sign over the desk
  {
    box(.04, .72, 1.9, M.black, maxX - .02, 1.66, .15);
    const neon = picture(1.8, .64, 1024, (g, w, h) => {
      g.clearRect(0, 0, w, h); g.textAlign = 'center'; g.textBaseline = 'middle';
      const tube = (text, y, size, col) => { g.font = `900 ${size}px system-ui, sans-serif`; for (const [blur, a] of [[40, .9], [18, 1], [0, 1]]) { g.shadowColor = col; g.shadowBlur = blur; g.fillStyle = blur ? col : '#fff6fb'; g.globalAlpha = a; g.fillText(text, w / 2, y); } g.globalAlpha = 1; g.shadowBlur = 0; };
      tube('BRICK BACK CLINIC', h * .4, 112, '#ff4d9a');
      tube('massage  ·  chiropractic', h * .76, 58, '#3ff0e0');
    }, { transparent: true });
    neon.position.set(maxX - .045, 2.02, .15); neon.rotation.y = -Math.PI / 2;
    ctx.onFrame((dt, t) => { neon.material.opacity = Math.sin(t * 37) > .985 ? .75 : 1; });
  }
  // waiting bench along the south wall, a coffee table with magazines
  {
    const x0 = 5.35, x1 = 7.25, z = maxZ - .26, cx = (x0 + x1) / 2, len = x1 - x0;
    box(len, .3, .46, M.woodDark, cx, 0, z);
    for (let i = 0; i < 3; i++) { const x = x0 + len / 6 + i * len / 3; rbox(len / 3 - .04, .12, .44, .04, M.teal, x, .3, z); rbox(len / 3 - .06, .4, .12, .05, M.tealDark, x, .44, z + .18, { rx: -.12 }); }
    box(len + .04, .05, .1, M.trim, cx, .9, maxZ - .05);
    const tx = 6.35, tz = .7;
    cyl(.38, .04, M.wood, tx, .38, tz); cyl(.05, .38, M.woodDark, tx, 0, tz); cyl(.22, .03, M.woodDark, tx, 0, tz);
    [[-.12, .05, M.pink, .3], [.0, -.1, M.teal, -.2], [.14, .08, M.white, .9]].forEach(([dx, dz, m, a]) => box(.2, .012, .27, m, tx + dx, .42, tz + dz, { ry: a }));
    cyl(.05, .07, M.terracotta, tx - .12, .42, tz - .17); ball(.06, M.leafLight, tx - .12, .52, tz - .17, { fy: .8 });
  }
  framed('s', 5.8, 1.6, .42, .42, 256, (g, w, h) => { g.fillStyle = '#f3e7cf'; g.fillRect(0, 0, w, h); [[128, 190, 70, 26, '#8d8a86'], [128, 148, 54, 22, '#bdb8b0'], [128, 112, 40, 18, '#8d8a86'], [128, 82, 28, 14, '#bdb8b0']].forEach(([x, y, rx, ry, c]) => { g.fillStyle = c; g.beginPath(); g.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2); g.fill(); }); });
  framed('s', 6.35, 1.6, .42, .42, 256, (g, w, h) => { g.fillStyle = '#e4efe9'; g.fillRect(0, 0, w, h); g.strokeStyle = '#2a9d96'; g.lineWidth = 10; for (let i = 0; i < 5; i++) { g.beginPath(); for (let x = 0; x <= w; x += 8) g.lineTo(x, 60 + i * 36 + Math.sin(x / 26 + i) * 12); g.stroke(); } });
  framed('s', 6.9, 1.6, .42, .42, 256, (g, w, h) => { g.fillStyle = '#fbe9e1'; g.fillRect(0, 0, w, h); g.fillStyle = '#e86a92'; for (let i = 0; i < 8; i++) { g.save(); g.translate(128, 128); g.rotate(i * Math.PI / 4); g.beginPath(); g.ellipse(0, -48, 22, 46, 0, 0, Math.PI * 2); g.fill(); g.restore(); } g.fillStyle = '#f5a623'; g.beginPath(); g.arc(128, 128, 22, 0, Math.PI * 2); g.fill(); });

  // ---------- outside: the sign over the door, a plaque ----------
  {
    const sign = picture(1.3, .36, 1024, (g, w, h) => {
      g.fillStyle = '#2a9d96'; g.beginPath(); g.roundRect(0, 0, w, h, 40); g.fill();
      g.strokeStyle = '#ffffff'; g.lineWidth = 10; g.beginPath(); g.roundRect(14, 14, w - 28, h - 28, 30); g.stroke();
      g.fillStyle = '#ffffff'; g.font = '900 104px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('BRICK BACK CLINIC', w / 2, h / 2 + 4);
    }, { basic: false });
    sign.position.set(minX - T - .015, 2.4, (door[0] + door[1]) / 2); sign.rotation.y = -Math.PI / 2;
    const plaque = picture(.5, .3, 512, (g, w, h) => {
      g.fillStyle = '#fbf6ea'; g.fillRect(0, 0, w, h); g.fillStyle = '#1d232b'; g.textAlign = 'center';
      g.font = '800 40px system-ui, sans-serif'; g.fillText('MASSAGE', w / 2, 70); g.fillText('CHIROPRACTIC', w / 2, 122);
      g.fillStyle = '#e86a92'; g.font = '700 30px system-ui, sans-serif'; g.fillText('walk-ins welcome', w / 2, 186); g.fillStyle = '#2a9d96'; g.fillText('→ come on in', w / 2, 240);
    }, { basic: false });
    plaque.position.set(minX - T - .015, 1.45, door[0] - .45); plaque.rotation.y = -Math.PI / 2;
  }

  // ---------- candles that flicker (the sideboard, the coffee table, the shelf) ----------
  const flames = [];
  for (const [x, y, z, s] of [[maxX - .22, .82, -4.76, 1], [maxX - .2, .82, -4.66, .8], [maxX - .12, .82, -4.71, .65], [6.47, .42, .82, .8], [TABLE.x + .2, 2.06, minZ + .12, .7]]) {
    cyl(.035 * s + .005, .12 * s, M.cream, x, y, z);
    const f = new THREE.Mesh(G.cone, M.flame); f.scale.set(.011, .035, .011); f.position.set(x, y + .12 * s + .02, z); room.add(f); flames.push(f);
  }
  ctx.onFrame((dt, t) => { flames.forEach((f, i) => { const k = 1 + .18 * Math.sin(t * 11 + i * 2) + .1 * Math.sin(t * 23 + i); f.scale.set(.011, .035 * k, .011); }); lamp.intensity = 3 + .08 * Math.sin(t * 1.3); });

  // ---------- merge the kit ----------
  for (const [mat, geos] of kit) {
    const merged = mergeGeometries(geos, false); geos.forEach(g => g.dispose());
    if (!merged) { console.warn('clinic: could not merge', mat.color?.getHexString()); continue; }
    disposables.push(merged);
    const mesh = new THREE.Mesh(merged, mat); mesh.name = `clinic-${mat.color?.getHexString?.() || 'part'}`; room.add(mesh);
  }
}
