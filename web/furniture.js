// A worker's desk: table, monitor (live terminal texture), chair, key pad and status sign.
// Desk-local axes: the worker sits on the +Z side facing the monitor at -Z. Units are metres.
import * as THREE from 'three';

export const DESK = { width: 1.5, depth: .75, height: .74, chairZ: .62, seatHeight: .47 };
export const STATUS_COLORS = { working: '#5fb4ff', idle: '#69d391', approval: '#ffb347', starting: '#c9d3df', exited: '#ff7b7b', stopped: '#ff7b7b' };
export const STATUS_TEXT = { working: 'WORKING', idle: 'READY', approval: 'NEEDS YOU', starting: 'STARTING', exited: 'STOPPED', stopped: 'STOPPED' };
export const PAD_KEYS = [['ESC', 'escape'], ['↑', 'up'], ['↓', 'down'], ['⏎', 'enter'], ['1', '1'], ['2', '2'], ['3', '3'], ['^C', 'ctrl-c']];

const mat = (color, roughness = .6, metalness = 0) => new THREE.MeshStandardMaterial({ color, roughness, metalness });
function box(w, h, d, material, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material); m.position.set(x, y, z); return m;
}

export function labelTexture(width, height, draw) {
  const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 4;
  const redraw = (...args) => { draw(canvas.getContext('2d'), canvas, ...args); texture.needsUpdate = true; };
  return { canvas, texture, redraw };
}

function keyCap(label) {
  const { texture, redraw } = labelTexture(128, 128, (ctx) => {
    ctx.fillStyle = '#2b3542'; ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = '#f2f4f7'; ctx.font = `bold ${label.length > 2 ? 40 : 60}px system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, 64, 68);
  });
  redraw();
  const materials = [mat('#2b3542'), mat('#2b3542'), new THREE.MeshStandardMaterial({ map: texture, roughness: .5 }), mat('#2b3542'), mat('#2b3542'), mat('#2b3542')];
  return new THREE.Mesh(new THREE.BoxGeometry(.045, .02, .045), materials);
}

export function makeDesk(worker, terminalCanvas) {
  const group = new THREE.Group(); group.name = `desk:${worker.id}`;
  const wood = mat('#c9a77c', .55), metal = mat('#3b4148', .4, .6), dark = mat('#1c2128', .5);
  const { width: w, depth: d, height: h } = DESK;
  // table
  group.add(box(w, .04, d, wood, 0, h - .02, 0));
  for (const x of [-w / 2 + .05, w / 2 - .05]) for (const z of [-d / 2 + .05, d / 2 - .05]) group.add(box(.04, h - .04, .04, metal, x, (h - .04) / 2, z));
  group.add(box(w - .1, .3, .015, metal, 0, h - .25, -d / 2 + .05));
  // monitor
  const aspect = terminalCanvas.height / terminalCanvas.width, sw = .92, sh = sw * aspect;
  const monitor = new THREE.Group(); monitor.position.set(0, h + .12 + sh / 2, -d / 2 + .16); group.add(monitor);
  monitor.add(box(sw + .04, sh + .04, .03, dark, 0, 0, -.017));
  const texture = new THREE.CanvasTexture(terminalCanvas); texture.colorSpace = THREE.SRGBColorSpace; texture.anisotropy = 8;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(sw, sh), new THREE.MeshBasicMaterial({ map: texture, toneMapped: false }));
  screen.name = 'screen'; monitor.add(screen);
  group.add(box(.05, .12 + sh / 2, .05, metal, 0, h + (.12 + sh / 2) / 2, -d / 2 + .12), box(.28, .015, .2, metal, 0, h + .008, -d / 2 + .14));
  // keyboard, mug and a little plant
  group.add(box(.46, .02, .15, dark, 0, h + .01, .14));
  const mug = new THREE.Mesh(new THREE.CylinderGeometry(.04, .036, .1, 16), mat(worker.torso, .4)); mug.position.set(-.48, h + .05, .05); group.add(mug);
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(.06, .045, .1, 12), mat('#b5653b')); pot.position.set(-.6, h + .05, -.25); group.add(pot);
  for (let i = 0; i < 5; i++) { const leaf = new THREE.Mesh(new THREE.SphereGeometry(.05, 8, 6), mat('#3e8f4e')); leaf.position.set(-.6 + Math.sin(i * 1.3) * .04, h + .15 + i * .025, -.25 + Math.cos(i * 1.3) * .04); leaf.scale.y = 1.6; group.add(leaf); }
  // key pad on the right of the desk; poke or click to press keys in the terminal
  const pad = new THREE.Group(); pad.position.set(.5, h + .012, .12); group.add(pad);
  pad.add(box(.23, .012, .12, dark, 0, -.004, 0));
  const keys = PAD_KEYS.map(([label, key], i) => {
    const cap = keyCap(label); cap.position.set((i % 4 - 1.5) * .053, .012, (Math.floor(i / 4) - .5) * .053);
    cap.userData = { key, rest: .012, pressedUntil: 0 }; pad.add(cap); return cap;
  });
  // chair: a group that swivels, positioned where the worker sits
  const chair = new THREE.Group(); chair.position.set(0, 0, DESK.chairZ); group.add(chair);
  const fabric = mat('#2f3a48', .8), seatY = DESK.seatHeight;
  chair.add(box(.5, .07, .48, fabric, 0, seatY - .035, 0));
  chair.add(box(.48, .55, .06, fabric, 0, seatY + .33, .25));
  chair.add(new THREE.Mesh(new THREE.CylinderGeometry(.03, .03, seatY - .1, 10), metal).translateY((seatY - .1) / 2 + .06));
  for (let i = 0; i < 5; i++) { const leg = box(.28, .03, .04, metal, 0, .05, 0); leg.rotation.y = i * Math.PI * 2 / 5; leg.translateX(.14); chair.add(leg); }
  // status sign above the monitor
  const sign = labelTexture(1024, 180, (ctx, c, info) => {
    ctx.clearRect(0, 0, c.width, c.height);
    ctx.fillStyle = '#10161ee6'; ctx.beginPath(); ctx.roundRect(4, 4, c.width - 8, c.height - 8, 26); ctx.fill();
    const color = STATUS_COLORS[info.status] || '#c9d3df';
    ctx.fillStyle = worker.torso; ctx.fillRect(28, 34, 16, 112);
    ctx.fillStyle = '#ffffff'; ctx.font = 'bold 64px system-ui, sans-serif'; ctx.textBaseline = 'alphabetic'; ctx.fillText(worker.name, 66, 96);
    ctx.font = '30px system-ui, sans-serif'; ctx.fillStyle = '#9fb0c3';
    ctx.fillText(`${{ claude: 'Claude Code', codex: 'Codex', shell: 'PowerShell' }[worker.agent]} · ${worker.project.split(/[\\/]/).pop()}`, 68, 144);
    ctx.fillStyle = color; ctx.font = 'bold 40px system-ui, sans-serif'; ctx.textAlign = 'right'; ctx.fillText(STATUS_TEXT[info.status] || info.status.toUpperCase(), c.width - 36, 92);
    ctx.font = '26px system-ui, sans-serif'; ctx.fillStyle = '#b8c4d2';
    const task = info.task ? info.task.slice(0, 48) + (info.task.length > 48 ? '…' : '') : '';
    ctx.fillText(task, c.width - 36, 144); ctx.textAlign = 'left';
  });
  const signMesh = new THREE.Mesh(new THREE.PlaneGeometry(.92, .92 * 180 / 1024), new THREE.MeshBasicMaterial({ map: sign.texture, transparent: true, toneMapped: false }));
  signMesh.position.set(0, sh / 2 + .1, 0); monitor.add(signMesh);
  // soft contact shadow for passthrough grounding
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(w + .3, d + 1), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: .22, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.set(0, .002, .25); group.add(shadow);
  // arrange-mode highlight
  const outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w + .04, .06, d + .04)), new THREE.LineBasicMaterial({ color: 0xf8ce52 }));
  outline.position.y = h - .02; outline.visible = false; group.add(outline);
  return { group, monitor, screen, texture, chair, keys, sign, outline, screenSize: [sw, sh] };
}

// A complete decorative workstation for a future hire. It has no terminal or
// avatar attached, so it can be placed in the office before the worker is hired.
export function makeEmptyDesk() {
  const group = new THREE.Group(); group.name = 'desk:future-worker';
  const wood = mat('#d4b58a', .5), edge = mat('#9d7046', .42), metal = mat('#424d58', .38, .55);
  const screen = mat('#101821', .3), accent = mat('#f8ce52', .35, .2);
  const { width: w, depth: d, height: h } = DESK;
  // Warm timber top with a contrasting front apron and sturdy metal legs.
  group.add(box(w, .055, d, wood, 0, h - .0275, 0));
  group.add(box(w - .08, .018, .018, edge, 0, h - .056, d / 2 - .015));
  for (const x of [-w / 2 + .055, w / 2 - .055]) for (const z of [-d / 2 + .055, d / 2 - .055]) {
    group.add(box(.045, h - .06, .045, metal, x, (h - .06) / 2, z));
  }
  group.add(box(w - .2, .24, .025, edge, 0, h - .19, d / 2 - .04));
  // Monitor with a calm welcome card, plus keyboard, mouse, notebook and plant.
  const monitor = new THREE.Group(); monitor.position.set(0, h + .36, -d / 2 + .14); group.add(monitor);
  monitor.add(box(.84, .5, .045, metal, 0, 0, -.012));
  monitor.add(box(.8, .46, .012, screen, 0, 0, .014));
  monitor.add(box(.12, .13, .08, metal, 0, -.31, 0), box(.32, .025, .2, metal, 0, -.38, .035));
  const welcome = labelTexture(800, 460, (ctx, canvas) => {
    const grad = ctx.createLinearGradient(0, 0, canvas.width, canvas.height);
    grad.addColorStop(0, '#182a38'); grad.addColorStop(1, '#263b48');
    ctx.fillStyle = grad; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#f8ce52'; ctx.beginPath(); ctx.arc(400, 145, 45, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#17232c'; ctx.font = 'bold 54px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('+', 400, 146);
    ctx.fillStyle = '#f3f6fa'; ctx.font = 'bold 42px system-ui, sans-serif'; ctx.fillText('YOUR NEW WORKSPACE', 400, 265);
    ctx.fillStyle = '#a9bac8'; ctx.font = '28px system-ui, sans-serif'; ctx.fillText('Ready when you are', 400, 325);
  });
  const panel = new THREE.Mesh(new THREE.PlaneGeometry(.78, .4485), new THREE.MeshBasicMaterial({ map: welcome.texture, toneMapped: false }));
  panel.position.set(0, 0, .022); monitor.add(panel);
  group.add(box(.5, .018, .16, mat('#303b45'), -.12, h + .012, .15));
  group.add(box(.07, .022, .09, accent, .32, h + .014, .15));
  const book = box(.2, .035, .14, mat('#477e88'), .49, h + .018, .08); book.rotation.y = -.12; group.add(book);
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(.055, .045, .1, 14), mat('#b56d4a'));
  pot.position.set(-.55, h + .05, -.2); group.add(pot);
  for (let i = 0; i < 5; i++) {
    const leaf = new THREE.Mesh(new THREE.SphereGeometry(.045, 9, 7), mat('#4f9560'));
    leaf.position.set(-.55 + Math.sin(i * 1.25) * .04, h + .15 + i * .018, -.2 + Math.cos(i * 1.25) * .04);
    leaf.scale.y = 1.6; group.add(leaf);
  }
  // Matching padded chair and five spoke base.
  const chair = new THREE.Group(); chair.position.set(0, 0, DESK.chairZ); group.add(chair);
  const fabric = mat('#385565', .78), seatY = DESK.seatHeight;
  chair.add(box(.5, .07, .48, fabric, 0, seatY - .035, 0));
  chair.add(box(.48, .55, .06, fabric, 0, seatY + .33, .25));
  chair.add(new THREE.Mesh(new THREE.CylinderGeometry(.03, .03, seatY - .1, 10), metal).translateY((seatY - .1) / 2 + .06));
  for (let i = 0; i < 5; i++) { const leg = box(.28, .03, .04, metal, 0, .05, 0); leg.rotation.y = i * Math.PI * 2 / 5; leg.translateX(.14); chair.add(leg); }
  const shadow = new THREE.Mesh(new THREE.PlaneGeometry(w + .3, d + 1), new THREE.MeshBasicMaterial({ color: 0, transparent: true, opacity: .2, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2; shadow.position.set(0, .002, .25); group.add(shadow);
  const outline = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(w + .04, .06, d + .04)), new THREE.LineBasicMaterial({ color: 0xf8ce52 }));
  outline.position.y = h - .02; group.add(outline);
  return { group, chair, outline, welcome };
}

// Large floating copy of a terminal, for reading at a glance.
export function makeBigScreen() {
  const group = new THREE.Group(); group.visible = false;
  const material = new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true, opacity: .97 });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1), material); group.add(screen);
  const frame = new THREE.Mesh(new THREE.PlaneGeometry(1.64, 1.04), new THREE.MeshBasicMaterial({ color: 0xf8ce52 })); frame.position.z = -.003; group.add(frame);
  return { group, screen, show(texture, aspect) { material.map = texture; material.needsUpdate = true; screen.scale.y = aspect / (1 / 1.6); frame.scale.y = screen.scale.y; group.visible = true; } };
}
