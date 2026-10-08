// The clinic's video channel: every client is one short video, filmed on a chunky brick phone on a ring-light tripod
// across the table. Cracks are the content: the bigger and longer the crack (more pops), the more views, and doing it
// well multiplies it (pressure in the green, a steady hold before the push, on his breath out, a relaxed client, a
// streak without hurting anyone). Hurting him, or a long stretch with nothing happening, loses viewers. When the
// session ends (or the next client comes in) the video posts: views become followers, followers become bookings.
// The business is kept in this browser (localStorage) between sessions. The app, the channel and the commenters are
// made up: no real platform's name or look.
import * as THREE from 'three';

const KEY = 'massage-channel';
const RATE = 90;                                  // dollars a booking
const TIERS = [[0, 'Garage clinic'], [1e3, 'Local favourite'], [1e4, 'Rising star'], [1e5, 'Trending clinic'], [1e6, 'Viral empire']];
const USERS = ['stiffneck_sam', 'backpain_barb', 'gran_on_skates', 'deskjockey88', 'crunchfan', 'tightshoulders', 'chiro_curious', 'the_real_kev',
  'posture_police', 'sore_since_2019', 'pop_collector', 'yoga_dad', 'night_shift_nurse', 'couch_potato_pete', 'bubblewrap_bex', 'gym_rat_gia',
  'hunched_harry', 'lumbar_lou', 'asmr_anna', 'forklift_frank', 'tired_teacher', 'gamer_neck_gus', 'spine_tingler', 'mum_of_four'];
const SAYS = {
  start: ['first!', 'here for the cracks', 'notifications on', 'yesss new video', 'who else is here for the sounds', 'ok I have snacks'],
  crack: ['THAT SOUND', 'my back cracked watching this', 'bubble wrap but human', 'book me in NOW', 'I felt that in my soul', 'again again again',
    'the way he melted', 'replayed it 40 times', 'how is that so satisfying', 'my spine is jealous', 'that was clean'],
  mega: ['LEGENDARY', 'that was like ten pops', 'my speakers!!', 'this is going viral', 'clip it clip it', 'okay I need an appointment',
    'he went from 30 to 20 years old', 'popcorn noises', 'STOP that was insane'],
  neck: ['NOT THE NECK', 'the neck ones always get me', 'crunchy!!', 'I flinched so hard', 'my neck clicked in sympathy'],
  ouch: ['he said OW', 'umm is he okay??', 'gentler pls', 'unfollowed', 'that looked painful', 'not like this', 'yikes'],
  knot: ['the knot melted!', 'so satisfying', 'oddly calming', 'look at him relax'],
  laugh: ['the giggle lmao', 'he is SO ticklish', 'not the feet hahaha', 'cutest laugh'],
  boring: ['when is the crack', 'skip to the crack', 'zzz', 'do the back already', 'is this a massage channel now?'],
  combo: ['COMBO', 'chain cracking!!', 'he cannot be stopped', 'pop pop pop pop'],
};
const pick = list => list[Math.floor(Math.random() * list.length)];
export const fmt = n => n < 1e3 ? `${Math.round(n)}` : n < 1e6 ? `${(n / 1e3).toFixed(n < 1e4 ? 1 : 0)}K` : `${(n / 1e6).toFixed(n < 1e7 ? 2 : 1)}M`;
const money = n => `$${Math.round(n).toLocaleString('en-US')}`;

export function createChannel({ ctx, root, plastic, roundBox, textures, chime }) {
  const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
  let biz = { followers: 0, views: 0, videos: 0, bookings: 0, revenue: 0, best: 0, bestCrack: 0 };
  try { biz = { ...biz, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(biz)); } catch {} };
  let time = 0, video = null, result = null, dirty = true, nextDraw = 0;
  const hearts = [], comments = [];

  // ---------- the phone on its tripod, across the table at the foot end, screen towards you ----------
  const rig = new THREE.Group(); rig.name = 'channel-phone'; rig.position.set(.8, 0, -.6); root.add(rig);
  rig.rotation.y = Math.atan2(-.8, 1.4);                                     // the screen looks at where you stand
  for (const a of [0, 2.1, 4.2]) {                                           // three splayed legs
    const leg = ctx.brick(.03, 1.05, .03, '#2b3644', { studs: false });
    leg.position.set(.13 * Math.sin(a), 0, .13 * Math.cos(a)); leg.rotation.set(.12 * Math.cos(a), 0, -.12 * Math.sin(a)); rig.add(leg);
  }
  const mast = ctx.brick(.04, .3, .04, '#2b3644', { studs: false }); mast.position.y = 1.02; rig.add(mast);
  const head = new THREE.Group(); head.position.y = 1.36; head.rotation.x = -.12; rig.add(head);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(.27, .022, 14, 56), new THREE.MeshStandardMaterial({ color: '#fffaf0', emissive: '#fff3d6', emissiveIntensity: .9, roughness: .4 }));
  head.add(ring);
  const body = new THREE.Mesh(roundBox(.25, .43, .035, .012), plastic('#e04f3d', .35)); head.add(body);
  for (const [x, y] of [[-.06, .2], [.06, .2]]) {                            // studs on top: it is a brick phone
    const stud = new THREE.Mesh(new THREE.CylinderGeometry(.022, .022, .018, 18), plastic('#e04f3d', .35)); stud.position.set(x, .223, 0); head.add(stud);
  }
  const W = 540, H = 960, canvas = document.createElement('canvas'); canvas.width = W; canvas.height = H;
  const tex = new THREE.CanvasTexture(canvas); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; textures.push(tex);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(.225, .4), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false })); screen.position.z = .021; head.add(screen);
  const recLight = new THREE.Mesh(new THREE.SphereGeometry(.012, 12, 8), new THREE.MeshBasicMaterial({ color: '#ff2a2a', toneMapped: false })); recLight.position.set(.1, .195, .022); head.add(recLight);

  // ---------- pop-ups over his back when something lands ----------
  const popups = [];
  function popup(at, lines, color) {
    const c = document.createElement('canvas'); c.width = 768; c.height = 300; const g = c.getContext('2d');
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
    lines.forEach(([text, size, fill], i) => {
      g.font = `900 ${size}px system-ui, sans-serif`; const y = 60 + i * 92 - (lines.length === 1 ? -50 : 0);
      g.lineWidth = size / 5; g.strokeStyle = '#1d232b'; g.strokeText(text, 384, y); g.fillStyle = fill || color; g.fillText(text, 384, y);
    });
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(.62, .62 * 300 / 768), new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, depthTest: false, toneMapped: false }));
    mesh.position.copy(at); mesh.renderOrder = 5; root.add(mesh);
    popups.push({ mesh, t0: time, y0: at.y }); if (popups.length > 4) dropPopup(popups[0]);
  }
  function dropPopup(p) { root.remove(p.mesh); p.mesh.geometry.dispose(); p.mesh.material.map.dispose(); p.mesh.material.dispose(); popups.splice(popups.indexOf(p), 1); }

  // ---------- the video ----------
  function comment(kind, n = 1) {
    for (let i = 0; i < n; i++) comments.push({ who: pick(USERS), text: pick(SAYS[kind]), t: time + i * .35, bad: kind === 'ouch' || kind === 'boring' });
    while (comments.length > 7) comments.shift();
    dirty = true;
  }
  function burst(n, color = '#ff4d6d') { for (let i = 0; i < n; i++) hearts.push({ x: W - 70 + (Math.random() - .5) * 60, y: H - 250, vx: (Math.random() - .5) * 50, vy: -160 - Math.random() * 140, life: 0, max: 1.4 + Math.random() * .8, s: 16 + Math.random() * 14, color }); }
  function start(name) {
    if (video) return;
    video = { name, t0: time, views: 0, shown: 0, likes: 0, hype: .4, combo: 0, best: 0, cracks: 0, pops: 0, ouches: 0, last: time, lastBoring: time, headline: null };
    result = null; comments.length = 0; comment('start', 2); dirty = true;
  }
  function gain(views) { video.views += views; video.likes += views * (.06 + .05 * Math.random()); video.last = time; dirty = true; }
  // a crack: { pops, big, neck, label, pressure, held, breath, relax (0..1), at (table space) }
  function crack(info) {
    if (!video || !info.pops) return;
    const { pops, big, neck, pressure, held, breath, relax = 0 } = info;
    if (!big) { gain(150 * pops); video.hype += .1; comment('crack'); return; }
    video.combo++; video.cracks++; video.pops += pops;
    const bonus = [], mult = (ok, x, name) => { if (ok) { bonus.push(name); return x; } return 1; };
    let m = mult(pressure, 1.3, 'PRESSURE') * mult(held, 1.25, 'STEADY') * mult(breath, 1.3, 'ON THE BREATH') * mult(neck, 1.2, 'NECK');
    m *= 1 + relax; if (relax > .5) bonus.push(`RELAXED x${(1 + relax).toFixed(1)}`);
    if (video.combo > 1) { m *= 1 + .25 * (video.combo - 1); bonus.push(`COMBO x${video.combo}`); }
    const views = Math.round(250 * pops ** 1.5 * m * (.9 + .2 * Math.random()));
    gain(views); video.hype += .3 + pops * .12; video.best = Math.max(video.best, views);
    biz.bestCrack = Math.max(biz.bestCrack, pops);
    const rating = pops >= 9 ? 'LEGENDARY CRACK' : pops >= 7 ? 'MEGA CRACK' : pops >= 5 ? 'BIG CRACK' : 'CRACK';
    const color = pops >= 9 ? '#ff4dff' : pops >= 7 ? '#ffd640' : pops >= 5 ? '#7cf0ff' : '#ffffff';
    video.headline = { rating, pops, views, bonus, label: info.label, color, t: time };
    popup(info.at.clone().add(V(0, .32, 0)), [[`${rating}!`, 92, color], [`+${fmt(views)} views  ·  ${pops} pops`, 58, '#ffffff'], [bonus.slice(0, 3).join('  ') || 'tip: relax him first', 40, '#b9f6ca']], color);
    burst(Math.min(40, 6 + pops * 3)); comment(pops >= 7 ? 'mega' : neck ? 'neck' : 'crack', pops >= 7 ? 3 : 2);
    if (video.combo === 3 || video.combo === 5) comment('combo');
    chime?.(pops >= 7 ? 'big' : 'small');
  }
  function ouch() {
    if (!video || time - (video.lastOuch ?? -9) < 1.5) return;
    video.lastOuch = time; video.ouches++; video.combo = 0; video.hype *= .4; dirty = true;
    comment('ouch', 2);
  }
  function event(kind) {
    if (!video) return;
    if (kind === 'knot') { gain(1500 + Math.random() * 800); video.hype += .25; burst(8, '#4caf50'); comment('knot'); }
    if (kind === 'laugh') { gain(900 + Math.random() * 600); video.hype += .2; burst(6, '#ffd640'); comment('laugh'); }
  }
  function post() {
    if (!video) return null;
    const v = video; video = null;
    if (!v.cracks && v.views < 500) { result = null; dirty = true; return null; }     // nothing worth posting
    const tail = v.views * (.4 + .25 * Math.min(4, v.cracks));                           // it keeps getting views after posting
    const views = Math.round(v.views + tail), care = Math.max(.3, 1 - .15 * v.ouches);
    const followers = Math.round(views / 200 * care), bookings = Math.max(v.cracks ? 1 : 0, Math.round((followers / 50 + v.cracks * .5) * care));
    const stars = views >= 150e3 ? 5 : views >= 60e3 ? 4 : views >= 20e3 ? 3 : views >= 5e3 ? 2 : 1;
    Object.assign(biz, { followers: biz.followers + followers, views: biz.views + views, videos: biz.videos + 1, bookings: biz.bookings + bookings,
      revenue: biz.revenue + bookings * RATE, best: Math.max(biz.best, views) });
    save();
    result = { name: v.name, views, followers, bookings, stars, viral: views >= 100e3, ouches: v.ouches, cracks: v.cracks, pops: v.pops, t: time, shown: v.views, from: v.views };
    chime?.('post'); dirty = true;
    return result;
  }

  // ---------- drawing the phone ----------
  function heart(g, x, y, s, color, a) {
    g.save(); g.globalAlpha = a; g.fillStyle = color; g.translate(x, y); g.scale(s / 16, s / 16);
    g.beginPath(); g.moveTo(0, 6); g.bezierCurveTo(-16, -6, -8, -18, 0, -9); g.bezierCurveTo(8, -18, 16, -6, 0, 6); g.fill(); g.restore();
  }
  function text(g, s, x, y, size, color, { weight = 800, align = 'left' } = {}) { g.font = `${weight} ${size}px system-ui, sans-serif`; g.fillStyle = color; g.textAlign = align; g.fillText(s, x, y); }
  function draw() {
    const g = canvas.getContext('2d'); g.textBaseline = 'middle';
    const bg = g.createLinearGradient(0, 0, 0, H); bg.addColorStop(0, '#1b1530'); bg.addColorStop(1, '#0d1118'); g.fillStyle = bg; g.fillRect(0, 0, W, H);
    text(g, 'CRACKCAM', 30, 44, 34, '#ffffff', { weight: 900 }); text(g, '@brickbackclinic', W - 30, 44, 24, '#9fb0c2', { align: 'right' });
    if (video) drawLive(g); else if (result && time - result.t < 14) drawResult(g); else drawProfile(g);
    for (const h of hearts) heart(g, h.x, h.y, h.s, h.color, Math.max(0, 1 - h.life / h.max));
    tex.needsUpdate = true;
  }
  function drawLive(g) {
    const v = video, secs = Math.floor(time - v.t0), blink = Math.floor(time * 2) % 2 === 0;
    g.fillStyle = blink ? '#ff2a2a' : '#7a1a1a'; g.beginPath(); g.arc(44, 100, 12, 0, Math.PI * 2); g.fill();
    text(g, `REC ${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}`, 66, 101, 30, '#ffffff');
    text(g, `${fmt(30 + v.hype * 900 + Math.sqrt(v.views) * 2)} watching`, W - 30, 101, 26, '#ffd640', { align: 'right' });
    text(g, `${fmt(v.shown)}`, W / 2, 210, 120, '#ffffff', { weight: 900, align: 'center' });
    text(g, 'VIEWS', W / 2, 288, 30, '#9fb0c2', { align: 'center' });
    heart(g, W / 2 - 70, 338, 22, '#ff4d6d', 1); text(g, fmt(v.likes), W / 2 - 40, 340, 32, '#ffffff');
    if (v.combo > 1) text(g, `COMBO x${v.combo}`, W - 30, 340, 32, '#7cf0ff', { weight: 900, align: 'right' });
    const hl = v.headline;
    if (hl && time - hl.t < 6) {
      g.fillStyle = 'rgba(255,255,255,.07)'; g.beginPath(); g.roundRect(24, 384, W - 48, 210, 24); g.fill();
      text(g, hl.rating, W / 2, 428, 52, hl.color, { weight: 900, align: 'center' });
      text(g, `${hl.label}  ·  ${hl.pops} pops  ·  +${fmt(hl.views)}`, W / 2, 482, 28, '#ffffff', { align: 'center' });
      hl.bonus.slice(0, 4).forEach((b, i) => text(g, `✓ ${b}`, 48 + (i % 2) * 240, 530 + Math.floor(i / 2) * 38, 24, '#b9f6ca'));
    } else {
      g.fillStyle = 'rgba(255,255,255,.05)'; g.beginPath(); g.roundRect(24, 384, W - 48, 210, 24); g.fill();
      text(g, 'BIG CRACKS = BIG VIEWS', W / 2, 424, 32, '#ffd640', { weight: 900, align: 'center' });
      ['Relax him first: knots and massage', 'Both hands in the green, hold steady', 'Then one quick push. More pops, more views'].forEach((l, i) => text(g, l, W / 2, 470 + i * 38, 24, '#c9d4df', { align: 'center' }));
    }
    let y = 640;
    for (const c of comments.filter(c => c.t <= time).slice(-6)) {
      text(g, c.who, 30, y, 22, c.bad ? '#ff8a80' : '#7cf0ff'); text(g, c.text, 30, y + 28, 26, '#ffffff', { weight: 600 }); y += 62;
    }
  }
  function drawResult(g) {
    const r = result;
    text(g, r.viral ? 'WENT VIRAL!' : 'POSTED!', W / 2, 150, r.viral ? 76 : 84, r.viral ? '#ff4dff' : '#4caf50', { weight: 900, align: 'center' });
    text(g, `${r.name}'s session`, W / 2, 222, 30, '#9fb0c2', { align: 'center' });
    text(g, '★★★★★'.slice(0, r.stars) + '☆☆☆☆☆'.slice(0, 5 - r.stars), W / 2, 290, 64, '#ffd640', { align: 'center' });
    const rows = [['Views', fmt(r.shown)], ['New followers', `+${fmt(r.followers)}`], ['New bookings', `+${r.bookings}`], ['Earned', money(r.bookings * RATE)],
      ['Cracks', `${r.cracks} (${r.pops} pops)`], ['Ouches', `${r.ouches}`]];
    rows.forEach(([k, v], i) => { text(g, k, 50, 390 + i * 70, 32, '#c9d4df', { weight: 600 }); text(g, v, W - 50, 390 + i * 70, 38, i === 5 && r.ouches ? '#ff8a80' : '#ffffff', { weight: 900, align: 'right' }); });
    text(g, r.ouches ? 'Every ouch cost you followers' : 'No ouches: full follower boost', W / 2, 840, 26, r.ouches ? '#ff8a80' : '#b9f6ca', { align: 'center' });
  }
  function drawProfile(g) {
    const tier = TIERS.filter(([n]) => biz.followers >= n).pop()[1], next = TIERS.find(([n]) => biz.followers < n);
    g.fillStyle = '#e04f3d'; g.beginPath(); g.arc(W / 2, 170, 70, 0, Math.PI * 2); g.fill();
    text(g, 'BBC', W / 2, 172, 52, '#ffffff', { weight: 900, align: 'center' });
    text(g, 'Brick Back Clinic', W / 2, 282, 42, '#ffffff', { weight: 900, align: 'center' });
    text(g, tier.toUpperCase(), W / 2, 330, 28, '#ffd640', { align: 'center' });
    const stats = [[fmt(biz.followers), 'followers'], [fmt(biz.views), 'views'], [`${biz.videos}`, 'videos']];
    stats.forEach(([n, l], i) => { const x = 95 + i * 175; text(g, n, x, 410, 44, '#ffffff', { weight: 900, align: 'center' }); text(g, l, x, 452, 22, '#9fb0c2', { align: 'center' }); });
    if (next) {
      const [n0] = TIERS.filter(([n]) => biz.followers >= n).pop(), f = (biz.followers - n0) / (next[0] - n0);
      g.fillStyle = '#2b3644'; g.fillRect(50, 500, W - 100, 18); g.fillStyle = '#ffd640'; g.fillRect(50, 500, (W - 100) * f, 18);
      text(g, `${fmt(next[0] - biz.followers)} followers to ${next[1]}`, W / 2, 545, 22, '#9fb0c2', { align: 'center' });
    }
    [['Bookings', `${biz.bookings}`], ['Revenue', money(biz.revenue)], ['Best video', `${fmt(biz.best)} views`], ['Longest crack', `${biz.bestCrack} pops`]]
      .forEach(([k, v], i) => { text(g, k, 50, 620 + i * 62, 30, '#c9d4df', { weight: 600 }); text(g, v, W - 50, 620 + i * 62, 34, '#ffffff', { weight: 900, align: 'right' }); });
    text(g, 'Next client starts the camera', W / 2, 900, 24, '#7cf0ff', { align: 'center' });
  }

  // ---------- every frame ----------
  const camPos = V();
  function update(dt, t, cam) {
    time = t;
    if (cam) cam.getWorldPosition(camPos);
    if (video) {
      const v = video, idle = time - v.last;
      v.hype = Math.max(0, v.hype * Math.pow(idle > 20 ? .9 : .96, dt));
      v.views += (30 + v.hype * 900) * .04 * dt;                         // people watching pass it on
      if (idle > 20 && time - v.lastBoring > 12) { v.lastBoring = time; comment('boring'); }
      const before = Math.round(v.shown / 50); v.shown += (v.views - v.shown) * Math.min(1, dt * 3); if (Math.round(v.shown / 50) !== before) dirty = true;
    }
    if (result && result.shown < result.views) { result.shown = Math.min(result.views, result.shown + (result.views - result.from) * dt / 2.5); dirty = true; }
    for (const h of hearts) { h.life += dt; h.x += h.vx * dt + Math.sin(h.life * 6 + h.s) * 30 * dt; h.y += h.vy * dt; }
    for (let i = hearts.length - 1; i >= 0; i--) if (hearts[i].life > hearts[i].max) hearts.splice(i, 1);
    if (hearts.length) dirty = true;
    if (video && Math.floor(time) !== Math.floor(time - dt)) dirty = true;          // the clock
    if (result && time - result.t > 14 && time - result.t < 14 + dt * 2) dirty = true;
    if (comments.some(c => c.t <= time && c.t > time - dt)) dirty = true;
    if (dirty && time >= nextDraw) { dirty = false; nextDraw = time + 1 / 15; draw(); }
    recLight.visible = !!video && Math.floor(time * 2) % 2 === 0;
    ring.material.emissiveIntensity = video ? .9 : .35;
    for (const p of [...popups]) {
      const age = time - p.t0; if (age > 2.4) { dropPopup(p); continue; }
      p.mesh.position.y = p.y0 + .12 * age; p.mesh.material.opacity = Math.min(1, (2.4 - age) * 2) * Math.min(1, age * 8);
      p.mesh.scale.setScalar(age < .15 ? .6 + age / .15 * .4 : 1);
      if (cam) p.mesh.lookAt(camPos);
    }
  }
  draw();
  ctx.onCleanup(() => { for (const p of [...popups]) dropPopup(p); });
  return { start, crack, ouch, event, post, update, recording: () => !!video, business: () => ({ ...biz }) };
}
