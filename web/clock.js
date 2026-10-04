// Large digital wall clock with a centred Quest battery tile.
import * as THREE from 'three';
import { labelTexture } from './furniture.js';

export function makeWallClock() {
  const group = new THREE.Group(); group.name = 'wall-clock';
  const red = new THREE.MeshStandardMaterial({ color: 0xd62b2b, emissive: 0x450800, roughness: .38 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x111820, roughness: .6 });
  const bezel = new THREE.Mesh(new THREE.BoxGeometry(1.12, .49, .055), red);
  bezel.position.z = .015; group.add(bezel);
  const inset = new THREE.Mesh(new THREE.BoxGeometry(1.055, .425, .012), dark);
  inset.position.z = .051; group.add(inset);
  for (const x of [-.52, -.26, 0, .26, .52]) for (const y of [-.225, .225]) {
    const stud = new THREE.Mesh(new THREE.CylinderGeometry(.013, .013, .012, 12), red);
    stud.rotation.x = Math.PI / 2; stud.position.set(x, y, .052); group.add(stud);
  }
  const display = labelTexture(1024, 400, (g, c, now) => {
    g.fillStyle = '#0f1620'; g.fillRect(0, 0, c.width, c.height);
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#f4f6f9'; g.font = 'bold 206px ui-monospace, Consolas, monospace';
    g.fillText(now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false }), 512, 156);
    g.fillStyle = '#e97575'; g.font = 'bold 62px system-ui, sans-serif';
    g.fillText(now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'short' }), 512, 324);
  });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(1.015, .396),
    new THREE.MeshBasicMaterial({ map: display.texture, toneMapped: false }));
  screen.position.z = .059; group.add(screen);
  const batteryLabel = labelTexture(384, 448, (g, c, battery) => {
    const { level, charging } = battery;
    const known = level !== null;
    const percent = known ? Math.round(level * 100) : null;
    const accent = !known ? '#8293a5' : charging ? '#72d5a0' : percent <= 20 ? '#f07761' : '#2b6fd6';
    g.clearRect(0, 0, c.width, c.height);
    g.fillStyle = '#0f1620'; g.beginPath(); g.roundRect(8, 8, 368, 432, 32); g.fill();
    g.strokeStyle = '#2b6fd6'; g.lineWidth = 8; g.stroke();
    g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillStyle = '#b8c4d2'; g.font = 'bold 42px system-ui, sans-serif'; g.fillText('QUEST', 192, 66);
    g.strokeStyle = '#e6edf5'; g.lineWidth = 12;
    g.beginPath(); g.roundRect(54, 112, 266, 128, 16); g.stroke();
    g.fillStyle = '#e6edf5'; g.fillRect(323, 151, 16, 50);
    if (known) { g.fillStyle = accent; g.fillRect(69, 127, 236 * level, 98); }
    else { g.fillStyle = '#8293a5'; g.font = 'bold 72px system-ui, sans-serif'; g.fillText('?', 187, 181); }
    g.fillStyle = accent; g.font = 'bold 88px ui-monospace, Consolas, monospace';
    g.fillText(known ? `${percent}%` : '—', 192, 324);
    g.fillStyle = '#b8c4d2'; g.font = 'bold 34px system-ui, sans-serif';
    g.fillText(!known ? 'UNAVAILABLE' : charging ? 'CHARGING' : percent <= 20 ? 'LOW BATTERY' : 'BATTERY', 192, 392);
  });
  const batteryMesh = new THREE.Mesh(new THREE.PlaneGeometry(.23, .23 * 448 / 384),
    new THREE.MeshBasicMaterial({ map: batteryLabel.texture, transparent: true, toneMapped: false }));
  batteryMesh.position.set(CLOCK_RADIUS + .18, -.015, .025); group.add(batteryMesh);
  let lastSecond = -1, lastBattery = '';
  return {
    group,
    update(date = new Date(), battery = null) {
      const second = Math.floor(date.getTime() / 1000);
      if (second !== lastSecond) { lastSecond = second; face.redraw(date); digital.redraw(date); }
      const level = battery?.level;
      // The standard permits this exact default when the browser cannot expose real battery data.
      const syntheticFull = level === 1 && battery?.charging === true && battery?.chargingTime === 0 && battery?.dischargingTime === Infinity;
      const reading = Number.isFinite(level) && level >= 0 && level <= 1 && !syntheticFull
        ? { level, charging: !!battery.charging } : { level: null, charging: false };
      const signature = `${reading.level}:${reading.charging}`;
      if (signature !== lastBattery) { lastBattery = signature; batteryLabel.redraw(reading); }
    },
  };
}
