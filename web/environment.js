// The virtual office room: a floor, four walls with windows onto a city skyline, a door, a ceiling with light panels and
// some soft lighting. Built in office space (metres, floor at y = 0, the boss starts near the origin facing -z).
// walls() gives the wall lines the office uses to keep people, desks and you inside.
import * as THREE from 'three';
import { labelTexture } from './furniture.js';

export const ROOM = { minX: -4.6, maxX: 4.6, minZ: -4.4, maxZ: 3.2, height: 3 };
// The Sandbox room: twice the office's width and depth (same ceiling height), so there is space to build.
export const SANDBOX_ROOM = { minX: -9.2, maxX: 9.2, minZ: -8.8, maxZ: 6.4, height: 3 };

const mat = (color, options = {}) => new THREE.MeshStandardMaterial({ color, roughness: .8, ...options });

function canvasTexture(width, height, draw, repeat = [1, 1]) {
  const { texture, redraw } = labelTexture(width, height, draw);
  redraw();
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping; texture.repeat.set(...repeat); texture.anisotropy = 8;
  return texture;
}

// Warm oak planks.
function floorTexture(repeat = [5, 5]) {
  return canvasTexture(1024, 1024, (g, c) => {
    const rows = 8, h = c.height / rows;
    for (let r = 0; r < rows; r++) {
      let x = -((r * 397) % 600);
      while (x < c.width) {
        const w = 360 + ((r * 131 + x) % 280), tone = 160 + ((r * 53 + x) % 40);
        g.fillStyle = `rgb(${tone}, ${Math.round(tone * .72)}, ${Math.round(tone * .48)})`; g.fillRect(x, r * h, w, h);
        g.strokeStyle = 'rgba(70, 45, 25, .35)'; g.lineWidth = 3; g.strokeRect(x, r * h, w, h);
        g.strokeStyle = 'rgba(90, 60, 30, .12)'; g.lineWidth = 2;
        for (let k = 1; k < 4; k++) { g.beginPath(); g.moveTo(x, r * h + k * h / 4 + Math.sin(x) * 3); g.bezierCurveTo(x + w / 3, r * h + k * h / 4 - 4, x + w * 2 / 3, r * h + k * h / 4 + 4, x + w, r * h + k * h / 4); g.stroke(); }
        x += w;
      }
    }
  }, repeat);
}

// Dusk skyline seen through the windows.
function skyTexture() {
  return canvasTexture(1024, 512, (g, c) => {
    const sky = g.createLinearGradient(0, 0, 0, c.height);
    sky.addColorStop(0, '#24345c'); sky.addColorStop(.55, '#d9826a'); sky.addColorStop(1, '#f6c47a');
    g.fillStyle = sky; g.fillRect(0, 0, c.width, c.height);
    for (let i = 0; i < 46; i++) {
      const w = 30 + (i * 37) % 70, h = 120 + (i * 91) % 260, x = (i * 53) % c.width;
      g.fillStyle = i % 3 ? '#2a2f45' : '#353b58'; g.fillRect(x, c.height - h, w, h);
      g.fillStyle = 'rgba(255, 214, 140, .8)';
      for (let y = c.height - h + 14; y < c.height - 10; y += 22) for (let wx = x + 6; wx < x + w - 8; wx += 14) if ((wx * 7 + y * 3) % 5 < 2) g.fillRect(wx, y, 6, 9);
    }
  });
}

// furnished: false gives the bare sandbox room (the bigger SANDBOX_ROOM, no rug or sign), for people to fill with their own mods.
export function makeEnvironment({ furnished = true } = {}) {
  const { minX, maxX, minZ, maxZ, height } = furnished ? ROOM : SANDBOX_ROOM, width = maxX - minX, depth = maxZ - minZ;
  const scale = width / (ROOM.maxX - ROOM.minX);   // 1 for the office, 2 for the sandbox
  // n evenly spread positions across [from, to], one per `step` metres or so
  const spread = (from, to, step) => { const n = Math.max(1, Math.round((to - from) / step)); return Array.from({ length: n }, (_, i) => from + (i + .5) * (to - from) / n); };
  const cx = (minX + maxX) / 2, cz = (minZ + maxZ) / 2;
  const group = new THREE.Group(); group.name = 'environment';
  const add = (mesh, x, y, z, ry = 0) => { mesh.position.set(x, y, z); mesh.rotation.y = ry; group.add(mesh); return mesh; };

  const floor = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), mat('#ffffff', { map: floorTexture([5 * scale, 5 * scale]), roughness: .55 }));
  floor.rotation.x = -Math.PI / 2; add(floor, cx, 0, cz); floor.rotation.x = -Math.PI / 2;
  const rug = new THREE.Mesh(new THREE.PlaneGeometry(4.6, 2.6), mat('#3b4a63', { roughness: .95 }));
  rug.rotation.x = -Math.PI / 2; if (furnished) { add(rug, 0, .004, -1.6); rug.rotation.x = -Math.PI / 2; }

  const ceiling = new THREE.Mesh(new THREE.PlaneGeometry(width, depth), mat('#f2f0ea', { emissive: '#e8e4dc', emissiveIntensity: .55 }));   // lit by the panels, not the scene's warm ground light
  ceiling.rotation.x = Math.PI / 2; add(ceiling, cx, height, cz); ceiling.rotation.x = Math.PI / 2;
  const panel = mat('#fffaf0', { emissive: '#fff4dc', emissiveIntensity: 1.1 });
  const panelXs = scale === 1 ? [-2.4, 0, 2.4] : spread(minX, maxX, 2.4), panelZs = scale === 1 ? [-2.6, .2] : spread(minZ, maxZ, 2.8);
  const panels = new THREE.InstancedMesh(new THREE.BoxGeometry(1.2, .03, .6), panel, panelXs.length * panelZs.length), at = new THREE.Matrix4();
  panelXs.forEach((x, i) => panelZs.forEach((z, j) => panels.setMatrixAt(i * panelZs.length + j, at.makeTranslation(x, height - .02, z))));
  add(panels, 0, 0, 0);

  // walls: [centre x, centre z, length, rotation] with the inside facing the room
  const wall = mat('#e9e4da', { roughness: .9 }), trim = mat('#f8ce52', { roughness: .4 }), frame = mat('#2b3644', { roughness: .5 });
  const sides = [
    [cx, minZ, width, 0], [cx, maxZ, width, Math.PI], [minX, cz, depth, Math.PI / 2], [maxX, cz, depth, -Math.PI / 2],
  ];
  for (const [x, z, length, ry] of sides) {
    add(new THREE.Mesh(new THREE.PlaneGeometry(length, height), wall), x, height / 2, z, ry);
    // yellow brick skirting with studs
    const skirt = new THREE.Group(); add(skirt, x, 0, z, ry);
    const board = new THREE.Mesh(new THREE.BoxGeometry(length, .1, .04), trim); board.position.set(0, .05, .02); skirt.add(board);
    const count = Math.ceil((length - .08) / .16), studs = new THREE.InstancedMesh(new THREE.CylinderGeometry(.012, .012, .012, 10), trim, count), place = new THREE.Matrix4();
    for (let i = 0; i < count; i++) studs.setMatrixAt(i, place.makeTranslation(-length / 2 + .08 + i * .16, .106, .02));
    skirt.add(studs);
  }
  // a band of windows along the back wall, looking out at the skyline
  const sky = new THREE.MeshBasicMaterial({ map: skyTexture(), toneMapped: false });
  for (const x of scale === 1 ? [-3, 0, 3] : spread(minX, maxX, 3)) {
    const glass = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 1.3), sky); add(glass, x, 1.75, minZ + .012);
    for (const [w, h, dx, dy] of [[2.3, .06, 0, .68], [2.3, .06, 0, -.68], [.06, 1.4, -1.13, 0], [.06, 1.4, 1.13, 0], [.04, 1.3, 0, 0]]) {
      add(new THREE.Mesh(new THREE.BoxGeometry(w, h, .05), frame), x + dx, 1.75 + dy, minZ + .03);
    }
  }
  // a door in the wall behind you
  add(new THREE.Mesh(new THREE.BoxGeometry(1, 2.1, .05), mat('#8a5a34', { roughness: .6 })), 2.6, 1.05, maxZ - .03);
  add(new THREE.Mesh(new THREE.SphereGeometry(.035, 12, 8), mat('#d8b24a', { metalness: .6, roughness: .3 })), 2.2, 1.0, maxZ - .08);
  const sign = labelTexture(512, 128, (g, c) => { g.fillStyle = '#2b3644'; g.fillRect(0, 0, c.width, c.height); g.fillStyle = '#f8ce52'; g.font = 'bold 64px system-ui'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('BRICK OFFICE', c.width / 2, c.height / 2 + 4); });
  sign.redraw();
  if (furnished) add(new THREE.Mesh(new THREE.PlaneGeometry(1.4, .35), new THREE.MeshBasicMaterial({ map: sign.texture, toneMapped: false })), 0, 2.45, maxZ - .015, Math.PI);

  // soft fill so the enclosed room is not lit only by the scene's sun
  const fill = new THREE.PointLight('#fff1d8', 6, 12, 1.6); add(fill, 0, 2.6, -1);
  const back = new THREE.PointLight('#dfe8ff', 3, 10, 1.6); add(back, 0, 2.6, 2);
  if (scale > 1) {   // a few more soft fills spread over the bigger room, so its far corners are not dark
    for (const x of [minX + width / 4, maxX - width / 4]) for (const z of [minZ + depth / 4, maxZ - depth / 4]) add(new THREE.PointLight('#fff1d8', 6, 18, 1.6), x, 2.6, z);
  }

  group.traverse(o => { o.frustumCulled = false; });
  return {
    group,
    // Wall lines in office space with inward normals, for room.setRoom (after converting to world space).
    walls: () => [
      { cx, cz: minZ, nx: 0, nz: 1, hw: width / 2 }, { cx, cz: maxZ, nx: 0, nz: -1, hw: width / 2 },
      { cx: minX, cz, nx: 1, nz: 0, hw: depth / 2 }, { cx: maxX, cz, nx: -1, nz: 0, hw: depth / 2 },
    ],
    dispose() { group.removeFromParent(); group.traverse(o => { o.geometry?.dispose(); for (const m of [].concat(o.material || [])) { m.map?.dispose(); m.dispose(); } }); },
  };
}
