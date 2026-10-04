// The project whiteboard: a free-standing mobile whiteboard showing the shared project board (/api/projects) as sticky notes
// in To do / Doing / Blocked / Done columns. Workers update it by voice (add_project / update_project); it redraws when the
// server broadcasts a change. Office-local, like the desks.
import * as THREE from 'three';
import { labelTexture } from './furniture.js';

const W = 1.7, H = 1.05, BOTTOM = .78;          // board size and the height of its lower edge, in metres
const COLUMNS = [['todo', 'TO DO'], ['doing', 'DOING'], ['blocked', 'BLOCKED'], ['done', 'DONE']];
const NOTE = { You: '#ffe66d', Clyde: '#ffb26b', Dex: '#8fe3b0', Both: '#9fd0ff' };
const mat = (color, roughness = .5, extra = {}) => new THREE.MeshStandardMaterial({ color, roughness, ...extra });

function wrap(g, text, width, maxLines) {
  const words = String(text || '').split(/\s+/).filter(Boolean), lines = [];
  let line = '';
  for (const word of words) {
    if (line && g.measureText(line + ' ' + word).width > width) { lines.push(line); line = word; if (lines.length === maxLines) break; }
    else line = line ? line + ' ' + word : word;
  }
  if (lines.length < maxLines && line) lines.push(line);
  if (lines.length === maxLines && words.join(' ').length > lines.join(' ').length) lines[maxLines - 1] = lines[maxLines - 1].replace(/.{0,2}$/, '…');
  return lines;
}

function drawBoard(g, c, projects) {
  g.fillStyle = '#fbfbf8'; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = '#1b2a3a'; g.font = 'bold 64px "Comic Sans MS", "Segoe Print", system-ui'; g.textBaseline = 'alphabetic';
  g.fillText('PROJECT BOARD', 48, 88);
  g.fillStyle = '#6a7686'; g.font = '30px system-ui, sans-serif';
  g.fillText(projects ? `${projects.length} project${projects.length === 1 ? '' : 's'} · ask Clyde or Dex to add or move a card` : 'loading…', 48, 132);
  const colW = (c.width - 96) / COLUMNS.length, top = 170;
  COLUMNS.forEach(([status, label], i) => {
    const x = 48 + i * colW;
    g.strokeStyle = '#cfd5dc'; g.lineWidth = 4;
    if (i) { g.beginPath(); g.moveTo(x, top); g.lineTo(x, c.height - 40); g.stroke(); }
    g.fillStyle = { todo: '#3a4a5c', doing: '#2f7bd6', blocked: '#d64545', done: '#2e9b5a' }[status];
    g.font = 'bold 40px "Comic Sans MS", "Segoe Print", system-ui'; g.fillText(label, x + 22, top + 46);
    const cards = (projects || []).filter(p => p.status === status);
    let y = top + 72;
    for (const [n, p] of cards.entries()) {
      const room = c.height - 50 - y;
      if (room < 150 || (n === 4 && cards.length > 5)) { g.fillStyle = '#6a7686'; g.font = '28px system-ui'; g.fillText(`+${cards.length - n} more`, x + 24, y + 30); break; }
      const w = colW - 40, tilt = ((p.id * 37) % 7 - 3) * .006;
      g.save(); g.translate(x + 20 + w / 2, y); g.rotate(tilt); g.translate(-w / 2, 0);
      g.font = 'bold 34px system-ui, sans-serif';
      const title = wrap(g, p.title, w - 36, 2);
      g.font = '26px system-ui, sans-serif';
      const detail = p.blocker ? wrap(g, '⚠ ' + p.blocker, w - 36, 2) : p.next_step ? wrap(g, '→ ' + p.next_step, w - 36, 2) : wrap(g, p.summary, w - 36, 2);
      const h = 40 + title.length * 40 + detail.length * 32 + 44;
      g.shadowColor = '#0003'; g.shadowBlur = 10; g.shadowOffsetY = 4;
      g.fillStyle = NOTE[p.owner] || '#fff3a8'; g.fillRect(0, 0, w, h);
      g.shadowColor = 'transparent';
      g.fillStyle = '#d8d0c0'; g.fillRect(w / 2 - 40, -8, 80, 22);                                      // tape
      g.fillStyle = '#1d232b'; g.font = 'bold 34px system-ui, sans-serif';
      title.forEach((t, k) => g.fillText(t, 18, 48 + k * 40));
      g.fillStyle = p.blocker ? '#a32020' : '#3b4450'; g.font = '26px system-ui, sans-serif';
      detail.forEach((t, k) => g.fillText(t, 18, 48 + title.length * 40 + k * 32));
      g.fillStyle = '#5b6573'; g.font = 'bold 24px system-ui, sans-serif';
      g.fillText(p.owner.toUpperCase(), 18, h - 16);
      g.restore();
      y += h + 22;
    }
  });
}

export function makeWhiteboard() {
  const group = new THREE.Group(); group.name = 'whiteboard';
  const frame = mat('#9aa3ad', .35, { metalness: .4 }), brick = mat('#f8ce52', .4);
  const label = labelTexture(2048, 1264, drawBoard);
  label.texture.anisotropy = 8;
  const face = new THREE.Mesh(new THREE.PlaneGeometry(W, H), new THREE.MeshBasicMaterial({ map: label.texture, toneMapped: false }));
  face.position.set(0, BOTTOM + H / 2, .016); group.add(face);
  const back = new THREE.Mesh(new THREE.BoxGeometry(W + .06, H + .06, .03), frame); back.position.set(0, BOTTOM + H / 2, 0); group.add(back);
  // marker tray with a couple of brick-coloured markers
  const tray = new THREE.Mesh(new THREE.BoxGeometry(W * .6, .02, .07), frame); tray.position.set(0, BOTTOM - .02, .05); group.add(tray);
  for (const [x, color] of [[-.2, '#2f7bd6'], [-.08, '#d64545'], [.04, '#1d232b']]) {
    const pen = new THREE.Mesh(new THREE.CylinderGeometry(.008, .008, .12, 8), mat(color)); pen.rotation.z = Math.PI / 2; pen.position.set(x, BOTTOM - .002, .05); group.add(pen);
  }
  // legs with yellow brick feet and studs
  for (const s of [-1, 1]) {
    const leg = new THREE.Mesh(new THREE.CylinderGeometry(.018, .018, BOTTOM + H, 10), frame); leg.position.set(s * (W / 2 + .05), (BOTTOM + H) / 2, 0); group.add(leg);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(.08, .05, .5), brick); foot.position.set(s * (W / 2 + .05), .025, 0); group.add(foot);
    for (const z of [-.16, 0, .16]) {
      const stud = new THREE.Mesh(new THREE.CylinderGeometry(.016, .016, .014, 12), brick); stud.position.set(s * (W / 2 + .05), .057, z); group.add(stud);
    }
  }
  group.traverse(o => { o.frustumCulled = false; });
  label.redraw(null);
  return {
    group, face,
    setProjects(projects) { label.redraw(projects); },
    dispose() { group.removeFromParent(); group.traverse(o => { o.geometry?.dispose(); o.material?.dispose?.(); }); label.texture.dispose(); },
  };
}
