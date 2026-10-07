// A massage and chiropractic table with a life-like client lying face down, a towel round his waist. Work his back with
// your tracked hands (shown as realistic hands that rest on his skin) and he answers out loud and with his body.
// Massage: pressure, long strokes, kneading, thumb circles, knuckles, tapping loosen his muscles and knots. Knots he has
// told you about show as target rings on his skin, filling in as they melt.
// Adjustments, the focus: a few of his vertebrae (T1-T12, L1-L5) are stuck. Two palm prints on his skin mark the next
// one: both palms there either side of the spine, press in, then one quick push up towards his head (or straight down)
// and the level pops. A single heel of the hand beside the spine, timed to his breath out, still works too, and both
// palms swept down the back crack it level by level. His neck, both sides: hold his head or neck (one hand or both, the
// ghost hands show where) and give it a quick small twist. Tight muscles guard a joint (massage them first); too hard,
// too rough, too far: he tells you. A joint that has just gone will not go again soon.
// He remembers the session (what hurt, what cracked, what tickled) and his lines draw on it. The console by his head:
// VOICE mutes him (the bubble still shows his words); TALK lets you speak to him and he answers from his memory
// (/api/chat). The red button at the foot end brings in a new client. The board shows what is left, your pressure and
// his breathing. He speaks with a Gemini voice through the office (/api/tts), the browser's voice or a mumble. Body
// parts, skin and hands: massage-parts/.
import { roundBox, plastic, mitten } from '../../avatar.js';
import { skinMaps, skinMaterial } from './massage-parts/skin.js';
import { buildHead } from './massage-parts/head.js';
import { loft, armGeometry, calfGeometry, footParts } from './massage-parts/limbs.js';
import { loadHand, SkinnedHand, curledPose, JOINTS as HAND_JOINTS, CHAINS as HAND_CHAINS } from './massage-parts/hands.js';
import { SANDBOX_ROOM } from '../../environment.js';

const PAD = .74;                                   // table top (pad surface) height
const SKIN = '#d39f7e', HAIR = '#3a2a1e', FLUSH = '#d9725f';
// Back: u runs from the base of the neck (0) to the waist (1); n across it, -1 (his right) to 1 (his left, towards you).
const X0 = -.8, LEN = .54, U_LO = -.2, U_HI = 1.46, U_TOWEL = .93, HB = .075, EC = .75, ES = .85;
const TX0 = X0 + U_TOWEL * LEN, TX1 = .44, HIP_X = -.08, KNEE_X = .38;
// [u, half width, thickness] from the neck to below the glutes
const PROFILE = [[-.2, .012, .08], [-.16, .055, .115], [-.1, .085, .135], [-.04, .14, .155], [.02, .195, .168], [.08, .228, .175],
  [.14, .238, .178], [.22, .228, .185], [.36, .208, .19], [.52, .19, .18], [.7, .168, .165], [.86, .158, .158], [.98, .165, .165],
  [1.1, .182, .185], [1.24, .188, .2], [1.36, .175, .175], [1.46, .012, .1]];

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const gauss = (a, m, s) => Math.exp(-(((a - m) / s) ** 2));
const smooth = x => { x = clamp(x, 0, 1); return x * x * (3 - 2 * x); };
const band = (u, a, b, soft) => smooth((u - a) / soft) * smooth((b - u) / soft);
const rand = (a, b) => a + Math.random() * (b - a);

function profile(u) {
  const P = PROFILE; let i = 0;
  while (i < P.length - 2 && u > P[i + 1][0]) i++;
  const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)];
  const t = clamp((u - p1[0]) / (p2[0] - p1[0]), 0, 1);
  const cr = k => .5 * (2 * p1[k] + (p2[k] - p0[k]) * t + (2 * p0[k] - 5 * p1[k] + 4 * p2[k] - p3[k]) * t * t + (3 * p1[k] - p0[k] - 3 * p2[k] + p3[k]) * t * t * t);
  return [Math.max(.006, cr(1)), cr(2)];
}
// The spine, top to bottom: where each vertebra's spinous process sits along the back (u). Landmarks: the spine of the
// shoulder blade is level with T3, the bottom tip of the shoulder blade with T7, the last rib with T12, the top of the
// hip bone with L4.
const SEGMENTS = [...Array.from({ length: 12 }, (_, i) => ({ name: `T${i + 1}`, u: .05 + i * .051 })),
  ...Array.from({ length: 5 }, (_, i) => ({ name: `L${i + 1}`, u: .67 + i * .075 }))];
function segSay(seg) {
  const i = SEGMENTS.findIndex(s => s.name === seg.name);
  return i < 3 ? 'up between the tops of my shoulder blades' : i < 6 ? 'between my shoulder blades' : i < 8 ? 'level with the bottom of my shoulder blades'
    : i < 10 ? 'just below my shoulder blades' : i < 12 ? 'where my ribs end' : i < 15 ? 'my low back, just above the waist' : 'right down at my waist';
}
// Surface relief of the back muscles, in metres outwards.
function muscles(u, n) {
  const a = Math.abs(n); let d = 0;
  d -= .011 * gauss(n, 0, .075) * band(u, .02, 1.3, .06);                              // groove over the spine
  d += .005 * gauss(n, 0, .05) * gauss(u, .02, .035);                                   // C7, the knob at the base of the neck
  let knobs = 0; for (const v of SEGMENTS) knobs += gauss(u, v.u, .011);
  d += .0032 * gauss(n, 0, .028) * knobs * band(u, .02, 1.0, .03);                   // spinous processes, a string of bumps
  d += .013 * gauss(a, .17, .085) * band(u, .38, 1.15, .14);                            // erector spinae columns
  d += .010 * gauss(a, .4, .2) * gauss(u, -.02, .07);                                   // upper trapezius
  d += .010 * gauss(a, .52, .14) * gauss(u, .28, .11);                                  // shoulder blade (infraspinatus)
  d += .005 * gauss(a, .33, .03) * gauss(u, .28, .09);                                  // medial border of the blade
  d += .004 * gauss(u - .17 - .12 * (a - .35), 0, .025) * band(a, .32, .78, .05);       // spine of the scapula
  d -= .004 * gauss(a, .23, .06) * gauss(u, .26, .1);                                   // hollow over the rhomboids
  d += .016 * gauss(a, .93, .11) * gauss(u, .13, .075);                                 // deltoids
  d += .010 * gauss(a, .72, .16) * gauss(u, .5, .16);                                   // latissimus dorsi
  d -= .006 * gauss(a, .7, .1) * gauss(u, .9, .08);                                     // waist
  d += .012 * gauss(a, .45, .25) * gauss(u, 1.27, .1);                                  // glutes, under the towel
  return d;
}
// The resting top surface at (u, n): height and how much of it faces up (0 at the sides).
function restTop(u, n) {
  const T = profile(u)[1], c = Math.min(1, Math.abs(n)) ** (1 / EC), s = Math.sqrt(Math.max(0, 1 - c * c)) ** ES, w = s ** 1.2;
  return { y: HB + (T - HB) * s + muscles(u, n) * w, w };
}
// Highest point of the body (or the pad) at x, z: what the towel drapes over.
function bodyTop(x, z) {
  let y = 0;
  const u = (x - X0) / LEN;
  if (u > U_LO && u < U_HI) { const W = profile(u)[0]; if (Math.abs(z) < W) y = Math.max(y, restTop(u, z / W).y); }
  if (x > HIP_X - .05 && x < KNEE_X + .06) for (const s of [1, -1]) {
    const t = clamp((x - HIP_X) / (KNEE_X - HIP_X), 0, 1), r = lerp(.085, .062, t), dz = z - s * lerp(.095, .1, t);
    if (Math.abs(dz) < r) y = Math.max(y, r + Math.sqrt(r * r - dz * dz));
  }
  return y;
}

const ZONES = {
  neck: { u: -.1, n: 0, both: true, say: () => 'my neck' },
  traps: { u: .02, n: .42, say: s => `the top of my ${s} shoulder, up by the neck` },
  delt: { u: .13, n: .9, say: s => `my ${s} shoulder` },
  blade: { u: .29, n: .5, say: s => `under my ${s} shoulder blade` },
  mid: { u: .27, n: .19, both: true, say: () => 'right between my shoulder blades' },
  lat: { u: .55, n: .55, say: s => `the middle of my back, on the ${s}` },
  lower: { u: .8, n: .3, say: s => `my lower back, ${s} side` },
  flank: { u: .62, n: .9, loose: true, say: s => `my ${s} side` },
  spine: { u: .5, n: 0, both: true, loose: true, say: () => 'my spine' },
};
function zoneAt(u, n) {
  const a = Math.abs(n), side = n > 0 ? '.L' : '.R';
  let z;
  if (u < -.07) z = 'neck';
  else if (a < .06 && u > 0) z = 'spine';
  else if (u < .15) z = a > .74 ? 'delt' : 'traps';
  else if (u < .44) z = a > .8 ? (u < .24 ? 'delt' : 'flank') : a < .31 ? 'mid' : 'blade';
  else if (a > .8) z = 'flank';
  else z = u < .72 ? 'lat' : 'lower';
  return ZONES[z].both ? z : z + side;
}
const sideWord = key => key.endsWith('.L') ? 'left' : 'right';
const zoneSay = key => ZONES[key.split('.')[0]].say(sideWord(key));

const TECH = {
  glide: { label: 'Long strokes', zone: .9, knot: .45 },
  strokes: { label: 'Finger strokes', zone: .6, knot: .4 },
  kneading: { label: 'Kneading', zone: 1.25, knot: 1 },
  circles: { label: 'Palm circles', zone: 1, knot: 1.1 },
  thumbs: { label: 'Thumb circles', zone: 1, knot: 1.5 },
  thumbpress: { label: 'Thumb pressure', zone: .8, knot: 1.4 },
  pressing: { label: 'Holding pressure', zone: .8, knot: 1.2 },
  knuckles: { label: 'Knuckling', zone: 1.1, knot: 1.2 },
  tapping: { label: 'Tapping', zone: .6, knot: .3 },
  resting: { label: 'Resting hands', zone: .25, knot: .15 },
};
const PRESS_DEPTH = .045;                          // metres of push that read as pressure 1 (top of 'good'); was .03, too touchy
const pressureFit = p => p < .12 ? .15 : p < .3 ? .55 : p <= .95 ? 1 : p <= 1.3 ? .75 : 0;

const NAMES = ['Gus', 'Marty', 'Theo', 'Ray', 'Hugo', 'Sal'];
const STORIES = [
  { why: 'Quarter end. Twelve hour days hunched over spreadsheets. My mid back feels locked solid.', knots: ['traps.R', 'mid'], stuck: ['T5', 'T7', 'T9'] },
  { why: 'I helped my brother carry a sofa up four flights of stairs. He lives on the fourth floor. Of course he does.', knots: ['lower.R', 'lat.L'], stuck: ['T6', 'T11', 'L2'] },
  { why: "I bought a standing desk. I don't stand at it. I lean on it.", knots: ['traps.R', 'blade.L'], stuck: ['T4', 'T8', 'L1'] },
  { why: "I joined a beach volleyball league. I'm not good at beach volleyball.", knots: ['delt.R', 'blade.R'], stuck: ['T3', 'T6', 'T10'] },
  { why: 'Hotel pillow. Thin as a sandwich. Slept on it for a week.', knots: ['traps.L', 'mid'], stuck: ['T2', 'T5', 'T7'] },
];
const LINES = {
  found: ['Ooh. Oh, there. That is the spot.', "Yes! That one. That's the knot.", "Oh, right there. Don't move.", "That's it, that's the one that's been bugging me.", 'Oh! Another one. Right there.'],
  working: ['Mmm. Keep going.', "It's starting to give.", 'Ooh, it is loosening.', "Oh, that's good.", "Don't stop, it's nearly there."],
  released: ["Oh... it's gone. That knot's been there since March.", 'Whoa. I felt that let go.', "That's... wow. That's so much better.", 'I think that one just packed up and left.'],
  next: [k => `Now ${zoneSay(k)}, if you're taking requests.`, k => `Okay, next one: ${zoneSay(k)}.`, k => `While you're at it, ${zoneSay(k)} is really tight too.`],
  light: ["You can go firmer, I won't break.", 'Bit more pressure?', 'Are you... dusting me?'],
  ow: ['Ow! Easy, easy.', 'Ah! Too much!', 'Ow! I need that back for work.'],
  spine: ['Not on the spine! Either side of it.', "That's bone. The muscles are either side.", 'Ooh, not right on the spine, please.'],
  tickle: ['Haha, no! Ticklish there!', 'Hehe, stop, not the ribs!', 'Hahaha, that tickles!'],
  feet: ['Hey! Feet are off limits! Hahaha!', "Not the feet! I'm ticklish!"],
  towel: ['Whoa. Above the towel, please.', "Ahem. The towel's a boundary.", "Let's keep it above the towel, yeah?"],
  head: ["Ooh, a head rub? Didn't know that was included.", 'Scalp massage. Very fancy.'],
  arm: ["That's my arm. But sure, why not.", 'Arms are nice too.'],
  slap: ["Hey! I'm not a bongo.", 'Whoa! Easy there, Rocky.'],
  idle: [k => `Still there? ${cap(zoneSay(k))} isn't going to fix itself.`, "I'm not paying by the hour to lie here, you know.", 'Hands are allowed to touch, by the way.'],
  away: ['Hello? Did you just leave me here?', "I'll just... lie here, then."],
  back: ["Oh, you're back.", 'There you are.'],
  half: ['I can feel my shoulders dropping.', "I haven't been this relaxed since... ever."],
  done: ["That was incredible. Seriously. You've got a gift.", "I can't feel my problems any more. Or my legs. Is that normal?"],
  wake: ["Huh? I wasn't asleep.", 'Mm, wha... still here.'],
  praise: ["You've done this before.", "Oh, that's the stuff.", 'My shoulders are melting.', 'I could get used to this.', k => `Oh, ${zoneSay(k)} needed that.`],
  firm: ['Ooh, firm. Good firm, though.'],
  cueIn: ['Okay. Deep breath in...', 'Breathing in...'],
  cueOut: ['...and out.', 'And breathing out...'],
  crack: ['Ohhh. That was a big one.', 'Oh wow, I felt that go.', 'There it is. That has been stuck for weeks.', 'Oh yes. Like cracking my knuckles, but my whole back.'],
  little: ['Ooh, a little one.', 'Small pop. Still counts.'],
  nothing: ['Nothing there. That bit moves fine.', 'Nope. That is not the stiff bit.'],
  bone: ['Ow! Right on the bone. Go either side of it.', "That's the spine itself. Just beside it."],
  ribs: ['Careful, those are my ribs.', 'Ribs! Not the ribs.'],
  kidney: ['Ow! Kidneys! Too low and too far out.'],
  early: ["Wait, I wasn't breathing out yet. I tensed up.", 'Too early, I was still breathing in.'],
  guarded: ["I'm too tight there, nothing's moving. Loosen me up first.", 'My muscles are guarding it. Rub that area first.'],
  again: ["That one already went. It won't go again for a while."],
  force: ['Whoa! Too much force!', 'Easy! That was a shove, not an adjustment.'],
  lumbar: ['Gently on the lower back.'],
  slack: ['Mm, I can feel the pressure.', "Okay, you're on it."],
  lean: ["You're just leaning on me now. Quick little push up towards my head."],
  sweep: ['Whoa. The whole back just went. Like bubble wrap.', 'That was a zipper, top to bottom!'],
  neckHold: ['Okay. I trust you. Mostly.', "Mm. I'll let you take the weight of my head."],
  neckStretch: ['Mm, that is a stretch.', "Okay, that's about as far as it turns."],
  neckCrack: ['Ohhh, that was a crunchy one.', 'Whoa. I heard that in my ears.', 'Oh, my neck feels a mile long.', 'Oh wow. That was so satisfying.',
    'Ohhh... did you hear that? Pure bliss.'],
  neckTense: ["I'm still holding my neck. Rock my head gently side to side first.", "Not yet, I'm guarding. Slow little rocks, let me let go."],
  neckLetGo: ["Mmm... okay. I'm letting go. It's all yours.", 'Ohh, that rocking... my neck has gone all floppy.'],
  neckReady: ['Okay... breathing out...', "Mm. That's the end. Ready when you are."],
  neckOther: ['Now the other side.', "Do the other side, or I'll be lopsided."],
  neckFar: ["Ow! Too far! That's as far as it goes."],
  neckRough: ['Whoa, easy with my neck!'],
  neckGuard: ["My neck's too tight, I'm guarding. Loosen my shoulders first."],
  neckPoke: ['Careful with the neck. Hold it, then a quick little twist if you want to crack it.'],
  segNext: [seg => `Now ${segSay(seg)}. That's the other stiff bit.`, seg => `Next one: ${segSay(seg)}.`],
  neckAsk: ["Back's good. Now my neck, both sides. Just hold my head or neck and give it a quick little twist."],
  // lines that come from his memory of the session
  owAgain: [(k, n) => `Ow! That's ${times(n)} now on ${zoneSay(k)}!`, k => `Again? ${cap(zoneSay(k))} is still sore from last time!`, (k, n) => `Ow! ${cap(times(n))} on the same spot. Ease up!`],
  slapAgain: [n => `Hey! That's ${times(n)} you've slapped me.`, () => "Again with the slapping? I'm not a drum kit."],
  tickleAgain: [n => `Hahaha, stop! That's ${times(n)}! You know I'm ticklish there!`, () => "Hehe, you're doing that on purpose now!"],
  crackAtLast: [n => `Finally! After ${n} goes, there it is.`, () => 'Oh, at last! Worth the wait.'],
  wary: [() => "Careful, that's where you got me before.", k => `Gently on ${zoneSay(k)}. I still remember last time.`],
  backMid: [k => `There you are. You left me halfway through ${zoneSay(k)}.`],
  wakeDream: ["Mm... I dreamt you cracked my whole spine. Oh wait, you did."],
  tech: {
    kneading: ["Oh, the kneading. Like I'm bread dough.", 'Yes, squeeze it out.'],
    glide: ['Those long strokes are nice.', 'Mmm, smooth.'],
    circles: ['Ooh, the circles.'],
    thumbs: ['Little thumb circles. You know what you are doing.'],
    tapping: ['Ha, drum solo.', 'Ba dum tss.'],
    knuckles: ['Knuckles. Serious stuff.'],
    pressing: ['Just hold it there... yes.'],
  },
};
const cap = s => s[0].toUpperCase() + s.slice(1);
const numberWord = n => ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'][n] || String(n);
const times = n => n === 2 ? 'twice' : `${numberWord(n)} times`;
// What each reaction means, for his memory of the session ("they" is you, the therapist). Reactions that need more
// detail (which knot, which level, where it hurt) are remembered where they happen.
const MEMORY_OF = {
  spine: 'they pressed right on my spine', feet: 'they tickled my feet', towel: 'they went for under the towel', head: 'they gave me a head rub',
  arm: 'they rubbed my arm', light: 'they were barely pressing', away: 'they walked off and left me lying here', back: 'they came back',
  backMid: 'they came back', half: 'I got properly relaxed', wake: 'they woke me up', wakeDream: 'they woke me up', bone: 'they pushed right on the bone of my spine',
  ribs: 'they pushed on my ribs', kidney: 'they pushed on my kidneys, ow', early: 'they pushed before I breathed out',
  guarded: 'they tried a crack but my muscles were too tight', again: 'they tried to crack a joint that had already gone',
  force: 'they shoved my back far too hard; it hurt', lumbar: 'they were rough on my lower back', lean: 'they just leaned on me',
  sweep: 'they swept down my back and the whole spine popped like bubble wrap', nothing: 'they tried a crack where nothing was stuck',
  little: 'a joint gave a little pop', neckFar: 'they turned my neck too far; it hurt', neckRough: 'they twisted my neck far too roughly; it hurt',
  neckLetGo: 'they rocked my head till my neck let go', neckPoke: 'they prodded my neck', wary: 'they went firm on a spot that hurt before',
};
const FAILED_TRY = new Set(['guarded', 'early', 'nothing', 'force', 'bone', 'ribs', 'kidney', 'again', 'lean']);
// Each client has his own Gemini voice; STYLES tell the voice how to say a line, MOOD_OF which style each bank of lines uses.
const VOICE_OF = { Gus: 'Enceladus', Marty: 'Algenib', Theo: 'Achird', Ray: 'Charon', Hugo: 'Orus', Sal: 'Fenrir' };
const STYLES = {
  chat: 'Say in a relaxed, slightly muffled voice, like a man lying face down on a massage table',
  greet: 'Say in a friendly, slightly tired voice, like a man lying face down on a massage table chatting to his therapist',
  bliss: 'Say in a drowsy, blissed-out murmur, like a man getting a great massage',
  pain: 'Say with a sudden yelp of pain, wincing',
  laugh: 'Say while laughing helplessly, because it tickles',
  firm: 'Say firmly but good-naturedly',
  guide: 'Say casually, giving directions to his massage therapist',
  groggy: 'Say groggily, as if just woken up from a nap',
  breath: 'Say slowly and calmly, breathing deeply, like a patient being talked through it',
};
const MOOD_OF = new Map([['found', 'bliss'], ['working', 'bliss'], ['released', 'bliss'], ['next', 'chat'], ['light', 'chat'], ['ow', 'pain'],
  ['spine', 'firm'], ['tickle', 'laugh'], ['feet', 'laugh'], ['towel', 'firm'], ['head', 'bliss'], ['arm', 'chat'], ['slap', 'pain'], ['idle', 'chat'],
  ['away', 'chat'], ['back', 'chat'], ['half', 'bliss'], ['done', 'bliss'], ['wake', 'groggy'], ['praise', 'bliss'], ['firm', 'bliss'],
  ['cueIn', 'breath'], ['cueOut', 'breath'], ['crack', 'bliss'], ['little', 'chat'], ['nothing', 'chat'], ['bone', 'pain'], ['ribs', 'firm'], ['kidney', 'pain'],
  ['early', 'chat'], ['guarded', 'chat'], ['again', 'chat'], ['force', 'pain'], ['lumbar', 'firm'], ['slack', 'chat'], ['lean', 'guide'], ['sweep', 'bliss'],
  ['neckHold', 'chat'], ['neckStretch', 'chat'], ['neckCrack', 'bliss'], ['neckOther', 'guide'], ['neckFar', 'pain'], ['neckRough', 'pain'], ['neckGuard', 'chat'],
  ['neckPoke', 'firm'], ['segNext', 'chat'], ['neckAsk', 'chat'], ['neckTense', 'chat'], ['neckLetGo', 'bliss'], ['neckReady', 'breath'],
  ['owAgain', 'pain'], ['slapAgain', 'firm'], ['tickleAgain', 'laugh'], ['crackAtLast', 'bliss'], ['wary', 'firm'], ['backMid', 'chat'], ['wakeDream', 'groggy']]
  .map(([k, mood]) => [LINES[k], mood]).concat(Object.values(LINES.tech).map(list => [list, 'bliss'])));
const BANK_OF = new Map(Object.entries(LINES).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [v, k]));
const PREFETCH = ['cueIn', 'cueOut', 'crack', 'little', 'nothing', 'bone', 'early', 'guarded', 'force', 'slack', 'neckHold', 'neckStretch', 'neckCrack', 'neckOther', 'neckLetGo', 'neckReady', 'neckTense',
  'neckFar', 'neckRough', 'sweep', 'ow', 'slap', 'tickle', 'feet', 'towel', 'wake'];

function wrapLines(g, text, width) {
  const lines = []; let line = '';
  for (const word of String(text).split(/\s+/)) {
    const next = line ? line + ' ' + word : word;
    if (g.measureText(next).width > width && line) { lines.push(line); line = word; } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

export default function (ctx) {
  const { THREE } = ctx;
  const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
  const root = new THREE.Group(); root.name = 'massage-simulator';
  ctx.add(root, { at: [0, 0, -1.45] });
  const body = new THREE.Group(); body.position.y = PAD; root.add(body);
  const textures = [];
  const maps = skinMaps(512, 3); ctx.onCleanup(() => maps.dispose());     // pores, fine lines, mottling: see massage-parts/skin.js
  const skin = skinMaterial(maps, { color: SKIN });
  let disposed = false; ctx.onCleanup(() => { disposed = true; });

  // ---------- table ----------
  const pad = new THREE.Mesh(roundBox(1.9, .09, .72, .03), plastic('#2a9d96', .5)); pad.position.y = PAD - .045; root.add(pad);
  for (const x of [-.82, .82]) for (const z of [-.27, .27]) {
    const leg = ctx.brick(.09, PAD - .09, .09, '#f8ce52', { studs: false }); leg.position.set(x, 0, z); root.add(leg);
  }
  for (const z of [-.27, .27]) { const rail = ctx.brick(1.55, .06, .07, '#f8ce52'); rail.position.set(0, .16, z); root.add(rail); }
  const shelf = ctx.brick(1.5, .04, .47, '#e04f3d'); shelf.position.set(0, .2, 0); root.add(shelf);
  for (const [x, color] of [[-.5, '#ffffff'], [-.32, '#9fd8d3']]) {          // rolled towels on the shelf
    const roll = new THREE.Mesh(new THREE.CylinderGeometry(.055, .055, .36, 20), plastic(color, .9));
    roll.rotation.x = Math.PI / 2; roll.position.set(x, .3, 0); root.add(roll);
  }
  const oil = new THREE.Group(); oil.position.set(.45, .248, .05); root.add(oil);
  const bottle = new THREE.Mesh(new THREE.CylinderGeometry(.035, .035, .14, 18), plastic('#d9902b', .15)); bottle.position.y = .07; oil.add(bottle);
  const capTop = new THREE.Mesh(new THREE.CylinderGeometry(.015, .015, .04, 12), plastic('#2b3644', .4)); capTop.position.y = .16; oil.add(capTop);
  // face cradle at the head end: a padded horseshoe, open towards the body
  const cradle = new THREE.Mesh(new THREE.TorusGeometry(.085, .026, 12, 40, 1.6 * Math.PI), plastic('#2a9d96', .5));
  cradle.rotation.set(-Math.PI / 2, 0, .2 * Math.PI); cradle.position.set(-1.04, PAD - .035, 0); root.add(cradle);
  const arm = ctx.brick(.16, .03, .07, '#f8ce52', { studs: false }); arm.position.set(-1.0, PAD - .11, 0); root.add(arm);
  for (const z of [-.07, .07]) { const post = ctx.brick(.03, .06, .03, '#f8ce52', { studs: false }); post.position.set(-1.04, PAD - .085, z); root.add(post); }

  // ---------- the client's back: one lofted mesh, sculpted, that dents and flushes ----------
  const NU = 170, NV = 64, count = (NU + 1) * (NV + 1);
  const base = new Float32Array(count * 3), baseColor = new Float32Array(count * 3);
  const vu = new Float32Array(count), vn = new Float32Array(count), vtop = new Float32Array(count);
  const breathW = new Float32Array(count), trapW = new Float32Array(count), dent = new Float32Array(count), warmth = new Float32Array(count);
  const dragX = new Float32Array(count), dragZ = new Float32Array(count), uvs = new Float32Array(count * 2), oilAmt = new Float32Array(count);
  const sunColor = new THREE.Color('#b9775a');
  const skinColor = new THREE.Color(SKIN), flushColor = new THREE.Color(FLUSH);
  for (let i = 0; i <= NU; i++) {
    const u = U_LO + (U_HI - U_LO) * i / NU, [W, T] = profile(u);
    for (let j = 0; j <= NV; j++) {
      const k = i * (NV + 1) + j, th = -Math.PI / 2 + 2 * Math.PI * j / NV, co = Math.cos(th), si = Math.sin(th);
      const c = Math.sign(co) * Math.abs(co) ** EC, s = Math.sign(si) * Math.abs(si) ** ES;
      let y, w = 0, relief = 0;
      if (s >= 0) { w = s ** 1.2; relief = muscles(u, c) * w; y = HB + (T - HB) * s + relief; } else y = HB + HB * s;
      base.set([X0 + u * LEN, y - .004, W * c], k * 3);
      vu[k] = u; vn[k] = c; vtop[k] = w;
      breathW[k] = w * gauss(u, .4, .35); trapW[k] = w * gauss(Math.abs(c), .45, .25) * gauss(u, 0, .09);
      const shade = clamp(1 + relief * 5 - (s < 0 ? .08 : 0), .82, 1.06);    // hollows a touch darker
      // uneven colour like real skin: a little more sun on the shoulders, faint blotches
      const blotch = .5 + .5 * Math.sin(u * 7.1 + c * 3.3) * Math.sin(u * 2.3 - c * 5.1), sun = w * (.1 * gauss(u, .08, .16) + .07 * blotch);
      const tone = skinColor.clone().lerp(sunColor, sun);
      baseColor.set([tone.r * shade, tone.g * shade, tone.b * shade], k * 3);
      uvs.set([(X0 + u * LEN) / .12, (j / NV) * (4 * W + 2 * T) / .12], k * 2);
    }
  }
  const index = [];
  for (let i = 0; i < NU; i++) for (let j = 0; j < NV; j++) {
    const a = i * (NV + 1) + j, b = a + NV + 1; index.push(a, b, a + 1, b, b + 1, a + 1);
  }
  const torsoGeo = new THREE.BufferGeometry();
  torsoGeo.setAttribute('position', new THREE.BufferAttribute(base.slice(), 3));
  torsoGeo.setAttribute('color', new THREE.BufferAttribute(baseColor.slice(), 3));
  torsoGeo.setAttribute('uv', new THREE.BufferAttribute(uvs, 2)); torsoGeo.setAttribute('oil', new THREE.BufferAttribute(oilAmt, 1));
  torsoGeo.setIndex(index); torsoGeo.computeVertexNormals();
  const torsoMat = skinMaterial(maps, { color: '#ffffff', vertexColors: true, oil: true });      // worked skin glistens with oil
  const torso = new THREE.Mesh(torsoGeo, torsoMat); torso.frustumCulled = false; body.add(torso);
  const topVerts = Int32Array.from({ length: count }, (_, k) => k).filter(k => vtop[k] > .02);
  // Normals for the moving top of the back straight from the grid (much cheaper than computeVertexNormals every frame).
  const N = torsoGeo.attributes.normal.array, ring = NV + 1;
  function topNormals(P) {
    for (const k of topVerts) {
      const i = Math.floor(k / ring), j = k % ring;
      const a = Math.min(NU, i + 1) * ring + j, b = Math.max(0, i - 1) * ring + j;
      const c = i * ring + (j === NV ? 1 : j + 1), d = i * ring + (j === 0 ? NV - 1 : j - 1);
      const ux = P[a * 3] - P[b * 3], uy = P[a * 3 + 1] - P[b * 3 + 1], uz = P[a * 3 + 2] - P[b * 3 + 2];
      const vx = P[c * 3] - P[d * 3], vy = P[c * 3 + 1] - P[d * 3 + 1], vz = P[c * 3 + 2] - P[d * 3 + 2];
      let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx; const l = Math.hypot(nx, ny, nz) || 1;
      N[k * 3] = nx / l; N[k * 3 + 1] = ny / l; N[k * 3 + 2] = nz / l;
    }
    torsoGeo.attributes.normal.needsUpdate = true;
  }
  topNormals(torsoGeo.attributes.position.array);

  // ---------- the rest of him: neck, arms, hands, legs, feet, head (massage-parts/) ----------
  function segment(a, b, ra, rb, material = skin) {         // a tapered tube with round ends (thighs under the towel, toes)
    const group = new THREE.Group(), dir = b.clone().sub(a), len = dir.length();
    const tube = new THREE.Mesh(new THREE.CylinderGeometry(rb, ra, len, 22, 1, true), material);
    tube.position.copy(a).addScaledVector(dir, .5); tube.quaternion.setFromUnitVectors(V(0, 1, 0), dir.normalize()); group.add(tube);
    for (const [p, r] of [[a, ra], [b, rb]]) { const ball = new THREE.Mesh(new THREE.SphereGeometry(r, 22, 14), material); ball.position.copy(p); group.add(ball); }
    return group;
  }
  const ang = (a, m, w) => Math.exp(-((Math.atan2(Math.sin(a - m), Math.cos(a - m)) / w) ** 2));
  body.add(new THREE.Mesh(loft([V(-.78, .1, 0), V(-.87, .094, 0), V(-.965, .075, 0)], (t, a) => {     // neck: wider than deep, a groove at the nape
    const w = .064 - .012 * t, h = .056 - .008 * t;
    return 1 / Math.sqrt((Math.cos(a) / h) ** 2 + (Math.sin(a) / w) ** 2) - .005 * ang(a, 0, .25) * (1 - t) + .006 * (1 - t) * (ang(a, 1.1, .5) + ang(a, -1.1, .5));
  }, { along: 18, around: 32 }), skin));
  const armSegs = [], clientHands = [];
  for (const s of [1, -1]) {
    const S = V(-.71, .1, .2 * s), E = V(-.46, .046, .27 * s), Wr = V(-.22, .033, .29 * s);
    body.add(new THREE.Mesh(armGeometry(S, E, Wr, s), skin));
    armSegs.push([S, E, .05], [E, Wr, .04]);
    clientHands.push({ side: s, at: V(-.212, .024, .29 * s), centre: V(-.15, .03, .29 * s), hand: null, curl: -1 });
    body.add(segment(V(HIP_X, .085, .095 * s), V(KNEE_X, .062, .1 * s), .085, .062));      // thigh, under the towel
    body.add(new THREE.Mesh(calfGeometry(V(KNEE_X, .06, .1 * s), V(.56, .062, .1 * s), V(.77, .036, .095 * s), s), skin));
  }
  // His hands: the realistic hand models, palms up and relaxed. Lying face down with the palms up the forearms are
  // turned in, so the thumbs point towards his body.
  const PALM_UP = new THREE.Quaternion().setFromRotationMatrix(new THREE.Matrix4().makeBasis(V(0, 0, -1), V(0, -1, 0), V(-1, 0, 0)));
  function poseClientHand(rec, clench) {
    if (!rec.hand || Math.abs(clench - rec.curl) < .03) return;
    rec.curl = clench; const k = 1 + 1.6 * clench;
    rec.hand.setPose(curledPose(rec.hand.rest, { at: rec.at, wristQ: PALM_UP, curl: { thumb: [.1 * k, .15 * k, .15 * k], finger: [.12, .3 * k, .4 * k, .3 * k] } }));
  }
  for (const rec of clientHands) loadHand(rec.side > 0 ? 'left' : 'right').then(gltf => {
    if (disposed) return;
    rec.hand = new SkinnedHand(gltf, skin); body.add(rec.hand.root); poseClientHand(rec, 0);
  }).catch(error => {                                        // no model: a simple mitten instead
    console.warn('massage: hand model', error); if (disposed) return;
    const m = mitten(skin, rec.side, .095); m.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(V(0, 0, 1), V(1, 0, 0), V(0, 1, 0)));
    m.position.set(-.215, .034, .29 * rec.side); body.add(m);
  });
  // feet: lying on their tops, soles up, toes curling over the end of the table
  const feet = [], feetCentres = [];
  for (const s of [1, -1]) {
    const foot = new THREE.Group(); foot.position.set(.77, .036, .095 * s); body.add(foot);
    const { geometry, toes: toeList } = footParts(s);
    foot.add(new THREE.Mesh(geometry, skin));
    const toes = new THREE.Group(); toes.position.set(.168, -.014, 0); foot.add(toes);
    for (const { from, to, r } of toeList) toes.add(segment(from.clone().sub(toes.position), to.clone().sub(toes.position), r, r * .85));
    feet.push({ foot, toes }); feetCentres.push(V(.86, .036, .095 * s));
  }
  // head, face down in the cradle; it turns towards you to talk, and your hands turn it for a neck adjustment
  const headTurn = new THREE.Group(); headTurn.position.set(-1.0, .065, 0); body.add(headTurn);
  const headRest = headTurn.position.clone();
  const headBase = new THREE.Group(); headBase.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(V(0, 0, 1), V(-1, 0, 0), V(0, -1, 0)));
  headTurn.add(headBase);
  const head = buildHead(skin, { skin: SKIN, hair: HAIR }); headBase.add(head.group);
  for (const o of body.children) o.traverse(m => { m.frustumCulled = false; });
  const EXPRESSIONS = { calm: { smile: .12 }, bliss: { smile: .5 }, laugh: { smile: 1, open: .5 }, ouch: { wince: 1, open: .2 }, sleep: { open: .15 } };
  function setFace(kind, open = null) { const e = { ...(EXPRESSIONS[kind] || EXPRESSIONS.calm) }; if (open != null) e.open = open; head.setExpression(e); }
  setFace('calm');

  // ---------- towel: draped over hips and thighs, hanging over both sides ----------
  {
    const NX = 60, NZ = 46, HALF = .56, EDGE = .36;
    const raw = [], hf = [];
    for (let i = 0; i <= NX; i++) {
      raw.push([]); const x = lerp(TX0, TX1, i / NX);
      for (let j = 0; j <= NZ; j++) { const w = lerp(-HALF, HALF, j / NZ); raw[i].push(bodyTop(x, clamp(w, -EDGE, EDGE)) + .012); }
    }
    for (const r of raw) hf.push(r.slice());
    for (let it = 0; it < 50; it++) for (let i = 1; i < NX; i++) for (let j = 1; j < NZ; j++)    // let it bridge gaps like cloth
      hf[i][j] = Math.max(raw[i][j], (hf[i - 1][j] + hf[i + 1][j] + hf[i][j - 1] + hf[i][j + 1]) / 4 - .0015);
    const position = [], uv = [], idx = [];
    for (let i = 0; i <= NX; i++) for (let j = 0; j <= NZ; j++) {
      const x = lerp(TX0, TX1, i / NX), w = lerp(-HALF, HALF, j / NZ), a = Math.abs(w);
      let y = hf[i][j], z = w;
      if (a > EDGE) { const over = a - EDGE; z = Math.sign(w) * (EDGE + .012 + .02 * Math.min(1, over / .05)); y = hf[i][Math.round(lerp(0, NZ, (Math.sign(w) * EDGE + HALF) / (2 * HALF)))] - over * 1.05; }
      position.push(x, y, z); uv.push(i / NX, j / NZ);
      if (i < NX && j < NZ) { const k = i * (NZ + 1) + j; idx.push(k, k + 1, k + NZ + 1, k + 1, k + NZ + 2, k + NZ + 1); }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(position, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx); geo.computeVertexNormals();
    const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
    g.fillStyle = '#fbfaf6'; g.fillRect(0, 0, 256, 256);
    for (let k = 0; k < 2600; k++) { g.fillStyle = `rgba(160,150,140,${Math.random() * .12})`; g.fillRect(Math.random() * 256, Math.random() * 256, 2, 2); }   // terry loops
    g.fillStyle = '#2a9d96'; for (const x of [14, 230]) g.fillRect(x, 0, 12, 256);
    g.fillStyle = '#f8ce52'; for (const x of [30, 222]) g.fillRect(x, 0, 4, 256);
    const map = new THREE.CanvasTexture(c); map.colorSpace = THREE.SRGBColorSpace; textures.push(map);
    const towel = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map, roughness: .95, side: THREE.DoubleSide }));
    towel.frustumCulled = false; body.add(towel);
  }

  // ---------- speech bubble and status board ----------
  const bubbleCanvas = document.createElement('canvas'); bubbleCanvas.width = 512; bubbleCanvas.height = 220;
  const bubbleTex = new THREE.CanvasTexture(bubbleCanvas); bubbleTex.colorSpace = THREE.SRGBColorSpace; textures.push(bubbleTex);
  const bubble = new THREE.Mesh(new THREE.PlaneGeometry(.46, .46 * 220 / 512), new THREE.MeshBasicMaterial({ map: bubbleTex, transparent: true, toneMapped: false, side: THREE.DoubleSide, depthWrite: false }));
  bubble.visible = false; bubble.renderOrder = 3; root.add(bubble);
  let bubbleText = '';
  function drawBubble(text) {
    if (text === bubbleText) return; bubbleText = text;
    const g = bubbleCanvas.getContext('2d'); g.clearRect(0, 0, 512, 220);
    let size = 34, lines;
    for (; ; size -= 3) { g.font = `bold ${size}px system-ui, sans-serif`; lines = wrapLines(g, text, 460); if (lines.length * size * 1.18 <= 160 || size <= 22) break; }
    const step = size * 1.18, h = 26 + lines.length * step;
    g.fillStyle = '#ffffff'; g.strokeStyle = '#1d232b'; g.lineWidth = 6;
    g.beginPath(); g.roundRect(8, 8 + (180 - h), 496, h, 26); g.fill(); g.stroke();
    g.beginPath(); g.moveTo(236, 186); g.lineTo(256, 214); g.lineTo(278, 186); g.closePath(); g.fill(); g.stroke();
    g.fillRect(232, 180, 50, 8);
    g.fillStyle = '#1d232b'; g.textAlign = 'center'; g.textBaseline = 'middle';
    lines.forEach((l, i) => g.fillText(l, 256, 8 + (180 - h) + 13 + step * (i + .5)));
    bubbleTex.needsUpdate = true;
  }

  const boardCanvas = document.createElement('canvas'); boardCanvas.width = 1024; boardCanvas.height = 600;
  const boardTex = new THREE.CanvasTexture(boardCanvas); boardTex.colorSpace = THREE.SRGBColorSpace; boardTex.anisotropy = 4; textures.push(boardTex);
  const board = new THREE.Group(); board.position.set(0, 0, -.82); root.add(board);
  const post = ctx.brick(.1, 1.12, .1, '#2b3644'); board.add(post);
  const backing = new THREE.Mesh(roundBox(1.02, .62, .04, .015), plastic('#2b3644', .4)); backing.position.set(0, 1.45, -.03); board.add(backing);
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(.96, .5625), new THREE.MeshBasicMaterial({ map: boardTex, toneMapped: false })); screen.position.set(0, 1.45, -.005); board.add(screen);

  // new client button at the foot end, on your side
  const plinth = new THREE.Group(); plinth.position.set(1.22, 0, .42); root.add(plinth);
  plinth.add(ctx.brick(.16, .88, .16, '#2b3644', { studs: false }));
  const button = new THREE.Mesh(new THREE.CylinderGeometry(.055, .06, .04, 24), plastic('#e04f3d', .3)); button.position.y = .9; plinth.add(button);
  const sign = ctx.label('NEW CLIENT', { width: .26 }); sign.position.set(0, 1.03, 0); plinth.add(sign);
  let buttonDown = 0, buttonCool = 0;
  // the console at the head end, on your side. VOICE: green when he talks out loud, grey when muted (the bubble still
  // shows his words). TALK: blue while he is listening to you (see 'talking to him' below), grey when not.
  const voicePlinth = new THREE.Group(); voicePlinth.position.set(-1.3, 0, .42); root.add(voicePlinth);
  voicePlinth.add(ctx.brick(.4, .88, .16, '#2b3644', { studs: false }));
  const VOICE_COLOR = { on: new THREE.Color('#43b05c'), off: new THREE.Color('#7d8794') };
  const voiceButton = new THREE.Mesh(new THREE.CylinderGeometry(.055, .06, .04, 24), plastic('#43b05c', .3)); voiceButton.position.set(.1, .9, 0); voicePlinth.add(voiceButton);
  const voiceSigns = { on: ctx.label('VOICE ON', { width: .19 }), off: ctx.label('VOICE OFF', { width: .19, color: '#ffffff', background: '#5b6573' }) };
  for (const s of Object.values(voiceSigns)) { s.position.set(.1, 1.03, 0); voicePlinth.add(s); }
  const TALK_COLOR = { on: new THREE.Color('#3d7be0'), off: new THREE.Color('#7d8794') };
  const talkButton = new THREE.Mesh(new THREE.CylinderGeometry(.055, .06, .04, 24), plastic('#7d8794', .3)); talkButton.position.set(-.1, .9, 0); voicePlinth.add(talkButton);
  const talkSigns = { on: ctx.label('TALK ON', { width: .19, color: '#ffffff', background: '#3d7be0' }), off: ctx.label('TALK OFF', { width: .19, color: '#ffffff', background: '#5b6573' }) };
  for (const s of Object.values(talkSigns)) { s.position.set(-.1, 1.03, 0); voicePlinth.add(s); }
  let talkButtonDown = 0, talkTouched = false;
  function showTalkButton() { talkButton.material.color.copy(chat.on ? TALK_COLOR.on : TALK_COLOR.off); talkSigns.on.visible = chat.on; talkSigns.off.visible = !chat.on; }
  let voiceButtonDown = 0, voiceButtonCool = 0, voiceTouched = false, muted = false;
  try { muted = localStorage.getItem('massage-voice-muted') === '1'; } catch {}
  function showVoiceButton() {
    voiceButton.material.color.copy(muted ? VOICE_COLOR.off : VOICE_COLOR.on);
    voiceSigns.on.visible = !muted; voiceSigns.off.visible = muted;
  }
  showVoiceButton();

  // ---------- voice: browser speech when it works, a mumble when it does not, and synthesised vocal sounds ----------
  // Everything he says or sounds (speech, mumble, hums, sighs) goes through `out`; muting zeroes it. Joint cracks do not.
  const VOICE_GAIN = .7;
  let ac = null, out = null, panner = null, analyser = null, noiseBuf = null;
  function audio() {
    if (!ac) {
      try {
        ac = new AudioContext(); out = ac.createGain(); out.gain.value = muted ? 0 : VOICE_GAIN; panner = ac.createPanner();
        Object.assign(panner, { panningModel: 'HRTF', distanceModel: 'inverse', refDistance: 1, rolloffFactor: .7 });
        out.connect(panner).connect(ac.destination);
        analyser = ac.createAnalyser(); analyser.fftSize = 512; out.connect(analyser);
      } catch { ac = null; return null; }
    }
    if (ac.state === 'suspended') ac.resume().catch(() => {});
    return ac;
  }
  const VOWELS = {
    mm: [[250, 3, 3], [2000, 8, .1]], ah: [[730, 6, 3], [1090, 8, 2], [2440, 10, 1]], oh: [[570, 6, 3], [840, 8, 2], [2410, 10, .6]],
    eh: [[530, 6, 3], [1840, 8, 1.6], [2480, 10, 1]], ee: [[270, 6, 3], [2290, 10, 1.5], [3010, 10, .8]], oo: [[300, 6, 3], [870, 8, 1.4], [2240, 10, .4]],
    uh: [[640, 6, 3], [1190, 8, 1.6], [2390, 10, .6]],
  };
  function vowel(t0, dur, f0, formants, { gain = .3, glide = 0 } = {}) {
    const osc = ac.createOscillator(), env = ac.createGain(), vib = ac.createOscillator(), depth = ac.createGain();
    osc.type = 'sawtooth'; osc.frequency.setValueAtTime(f0, t0); osc.frequency.linearRampToValueAtTime(f0 * (1 + glide), t0 + dur);
    vib.frequency.value = 5.5; depth.gain.value = f0 * .02; vib.connect(depth).connect(osc.frequency);
    env.gain.setValueAtTime(0, t0); env.gain.linearRampToValueAtTime(gain, t0 + Math.min(.06, dur * .3));
    env.gain.setValueAtTime(gain, t0 + dur * .6); env.gain.exponentialRampToValueAtTime(.0008, t0 + dur);
    for (const [f, q, gn] of formants) { const bp = ac.createBiquadFilter(), fg = ac.createGain(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q; fg.gain.value = gn; osc.connect(bp).connect(fg).connect(env); }
    env.connect(out); osc.start(t0); osc.stop(t0 + dur + .05); vib.start(t0); vib.stop(t0 + dur + .05);
  }
  function noise(t0, dur, { type = 'bandpass', from = 900, to = 450, q = 1.2, gain = .3, attack = .25, am = 0 } = {}) {
    if (!noiseBuf) { noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
    const src = ac.createBufferSource(), filter = ac.createBiquadFilter(), env = ac.createGain();
    src.buffer = noiseBuf; src.loop = true; filter.type = type; filter.Q.value = q;
    filter.frequency.setValueAtTime(from, t0); filter.frequency.exponentialRampToValueAtTime(to, t0 + dur);
    env.gain.setValueAtTime(0, t0); env.gain.linearRampToValueAtTime(gain, t0 + attack); env.gain.exponentialRampToValueAtTime(.0008, t0 + dur);
    let last = filter.connect(env);
    if (am) {    // a rattle, for snoring
      const shaper = ac.createGain(), lfo = ac.createOscillator(), amount = ac.createGain();
      shaper.gain.value = .5; lfo.frequency.value = am; amount.gain.value = .5; lfo.connect(amount).connect(shaper.gain);
      last = last.connect(shaper); lfo.start(t0); lfo.stop(t0 + dur + .05);
    }
    src.connect(filter); last.connect(out); src.start(t0); src.stop(t0 + dur + .05);
  }
  const SOUNDS = {
    hum: t => vowel(t, 1.0, 104, VOWELS.mm, { gain: .6, glide: -.1 }),
    ahh: t => vowel(t, .9, 118, VOWELS.ah, { gain: .3, glide: -.28 }),
    ooh: t => vowel(t, .7, 128, VOWELS.oo, { gain: .4, glide: -.15 }),
    ow: t => { vowel(t, .14, 178, VOWELS.ah, { gain: .45, glide: .05 }); vowel(t + .12, .22, 168, VOWELS.oo, { gain: .4, glide: -.35 }); },
    giggle: t => { for (let k = 0; k < 6; k++) vowel(t + k * .13, .09, 165 + k * 9, k % 2 ? VOWELS.eh : VOWELS.uh, { gain: .32, glide: -.12 }); noise(t, .8, { from: 2500, to: 1500, gain: .05, attack: .05 }); },
    sigh: t => { noise(t, 1.3, { from: 1100, to: 420, gain: .32 }); vowel(t + .2, 1.0, 96, VOWELS.ah, { gain: .07, glide: -.2 }); },
    snore: t => { noise(t, 1.4, { type: 'lowpass', from: 380, to: 260, q: 2, gain: .5, attack: .5, am: 30 }); noise(t + 1.5, 1.0, { from: 700, to: 400, gain: .08, attack: .2 }); },
  };
  // A joint cavitating. Each pop is a 2-4 ms broadband snap, a short resonant knock (the 'pop' you feel in your teeth) and,
  // for the first pop or a back joint, a low thud through the table. A neck lets go as a quick rolling cascade with a
  // fine crunchy tail; the back as fewer, deeper pops. A short room reverb and a compressor make every crack land.
  let popPanner = null, popBus = null;
  function popChain() {
    if (popBus) return popBus;
    popPanner = ac.createPanner(); Object.assign(popPanner, { panningModel: 'HRTF', distanceModel: 'inverse', refDistance: .6, rolloffFactor: .8 });
    const comp = ac.createDynamicsCompressor();
    comp.threshold.value = -14; comp.knee.value = 8; comp.ratio.value = 5; comp.attack.value = .0005; comp.release.value = .12;
    const len = Math.floor(ac.sampleRate * .32), ir = ac.createBuffer(2, len, ac.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const d = ir.getChannelData(ch); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 4); }
    const room = ac.createConvolver(), wet = ac.createGain(); room.buffer = ir; wet.gain.value = .22;
    popBus = ac.createGain(); popBus.connect(comp); popBus.connect(room); room.connect(wet).connect(comp);
    comp.connect(popPanner).connect(ac.destination);
    return popBus;
  }
  function pop(t, amp, { pitch, q = 9, snap = 1, thud = 0 }) {
    const snapSrc = ac.createBufferSource(), hp = ac.createBiquadFilter(), snapEnv = ac.createGain();
    snapSrc.buffer = noiseBuf; hp.type = 'highpass'; hp.frequency.value = 2200;
    snapEnv.gain.setValueAtTime(amp * snap, t); snapEnv.gain.exponentialRampToValueAtTime(.0005, t + .0035);
    snapSrc.connect(hp).connect(snapEnv).connect(popBus); snapSrc.start(t, Math.random() * 1.5); snapSrc.stop(t + .01);
    const knock = ac.createBufferSource(), bp = ac.createBiquadFilter(), knockEnv = ac.createGain();
    knock.buffer = noiseBuf; bp.type = 'bandpass'; bp.frequency.value = pitch; bp.Q.value = q;
    knockEnv.gain.setValueAtTime(amp * 2.6, t); knockEnv.gain.exponentialRampToValueAtTime(.0005, t + .022);
    knock.connect(bp).connect(knockEnv).connect(popBus); knock.start(t, Math.random() * 1.5); knock.stop(t + .03);
    if (thud) {
      const osc = ac.createOscillator(), oscEnv = ac.createGain();
      osc.frequency.setValueAtTime(thud, t); osc.frequency.exponentialRampToValueAtTime(thud * .45, t + .06);
      oscEnv.gain.setValueAtTime(amp * .6, t); oscEnv.gain.exponentialRampToValueAtTime(.0005, t + .07);
      osc.connect(oscEnv).connect(popBus); osc.start(t); osc.stop(t + .08);
    }
  }
  function crackSound(at, pops, { neck = false, big = true } = {}) {
    if (!audio()) return;
    if (!noiseBuf) { noiseBuf = ac.createBuffer(1, ac.sampleRate * 2, ac.sampleRate); const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
    popChain(); popPanner.positionX.value = at.x; popPanner.positionY.value = at.y; popPanner.positionZ.value = at.z;
    let t = ac.currentTime + .01, amp = big ? .9 : .45;
    const base = neck ? rand(1500, 2100) : rand(700, 1000);          // every joint sounds a little different
    for (let i = 0; i < pops; i++) {
      pop(t, amp * rand(.75, 1), { pitch: base * rand(.85, 1.2), q: neck ? 10 : 7, snap: neck ? 1 : .7, thud: i === 0 || !neck ? (neck ? 160 : 110) : 0 });
      t += neck ? rand(.006, .024) * (1 + i * .15) : rand(.03, .07);  // a neck rolls off quickly, slowing as it goes
      amp *= neck ? rand(.7, .92) : rand(.8, .97);
    }
    if (big && neck) for (let i = 0; i < 10; i++) { t += rand(.003, .007); pop(t, .06 * rand(.5, 1), { pitch: base * rand(1.3, 2.2), q: 4, snap: .8 }); }   // the crunchy tail
  }
  const SOUND_TEXT = { hum: 'Mmmm...', ahh: 'Ahhh...', ooh: 'Ooh...', ow: 'Ow!', giggle: 'Hahaha!', sigh: 'Haaahh...', snore: 'Zzz...' };
  function sound(name) { if (!audio()) return; try { SOUNDS[name](ac.currentTime + .02); } catch (error) { console.warn('massage sound', error); } }
  function babble(text) {    // speech-like mumble when the browser has no voice: one syllable per few letters
    if (!audio()) return 1.2;
    const words = text.split(/\s+/), keys = Object.keys(VOWELS).filter(k => k !== 'mm'); let t = ac.currentTime + .03;
    words.forEach((word, wi) => {
      const syllables = Math.max(1, Math.round(word.replace(/[^a-z]/gi, '').length / 3));
      for (let s = 0; s < syllables; s++) {
        const dur = rand(.09, .14), fall = 1 - .15 * (wi / words.length), rise = /\?$/.test(text) && wi === words.length - 1 ? 1.25 : 1;
        vowel(t, dur, 112 * fall * rise * rand(.92, 1.08), VOWELS[keys[(word.charCodeAt(s % word.length) + s) % keys.length]], { gain: .26, glide: rand(-.08, .05) });
        t += dur + .015;
      }
      t += /[,.!?]$/.test(word) ? .16 : .05;
    });
    return t - ac.currentTime;
  }

  // Speech, best first: Gemini's voices through the office server (/api/tts, streamed, cached on disk and prefetched for
  // the lines that must come out instantly), then the browser's own voice, then a mumble. The bubble always shows the words.
  let ttsWorks = 'speechSynthesis' in window ? null : false, ttsPending = null, ttsVoice = null;
  function pickVoice() {
    const voices = window.speechSynthesis?.getVoices?.() || [], en = voices.filter(v => /^en/i.test(v.lang));
    return en.find(v => /\b(male|david|daniel|guy|george|ryan|mark|james|fred|alex|tom)\b/i.test(v.name) && !/female/i.test(v.name)) || en[0] || voices[0] || null;
  }
  const cloud = { ok: null, retryAt: 0, token: null, probing: false };     // ok: null unknown, true working, false not available
  const clips = new Map();                 // voice|mood|text -> AudioBuffer (or 'pending' while prefetching)
  let voiceSources = [], voiceNext = 0, voiceAbort = null, cloudLine = null, lineId = 0, voiceKind = 'none', pendingMood = null, pendingBank = null;
  const clipKey = (text, mood) => `${brain.voice}|${mood}|${text}`;
  async function officeToken(fresh = false) {
    if (!cloud.token || fresh) cloud.token = (await (await fetch('/api/state', { cache: 'no-store' })).json()).token;
    return cloud.token;
  }
  // POST a line; calls onChunk(Float32Array) as audio streams in, resolves to the whole line as an AudioBuffer.
  async function fetchLine(text, mood, { signal, onChunk } = {}) {
    const ask = async fresh => fetch('/api/tts', { method: 'POST', signal, headers: { 'Content-Type': 'application/json', 'X-Office-Token': await officeToken(fresh) },
      body: JSON.stringify({ text, style: STYLES[mood] || STYLES.chat, voice: brain.voice }) });
    let r = await ask(false);
    if (r.status === 403) r = await ask(true);
    if (r.status === 404 || r.status === 503 || r.status === 429) { cloud.ok = false; cloud.retryAt = time + (r.status === 404 ? 20 : 120); throw Error(`speech ${r.status}`); }
    if (!r.ok) throw Error(`speech ${r.status}`);
    cloud.ok = true;
    const reader = r.body.getReader(), parts = []; let carry = null, total = 0;
    for (;;) {
      const { done, value } = await reader.read(); if (done) break;
      let bytes = value;
      if (carry) { bytes = new Uint8Array(carry.length + value.length); bytes.set(carry); bytes.set(value, carry.length); carry = null; }
      if (bytes.length % 2) { carry = bytes.slice(-1); bytes = bytes.subarray(0, bytes.length - 1); }
      if (!bytes.length) continue;
      const pcm = new Int16Array(bytes.slice().buffer), samples = new Float32Array(pcm.length);
      for (let i = 0; i < pcm.length; i++) samples[i] = pcm[i] / 32768;
      parts.push(samples); total += samples.length; onChunk?.(samples);
    }
    if (!total) throw Error('speech came back empty');
    const buffer = ac.createBuffer(1, total, 24000); let at = 0;
    for (const part of parts) { buffer.copyToChannel(part, 0, at); at += part.length; }
    return buffer;
  }
  function playSamples(buffer) {             // queue audio after whatever of this line is already playing
    const src = ac.createBufferSource(); src.buffer = buffer; src.connect(out);
    const at = Math.max(ac.currentTime + .04, voiceNext); src.start(at); voiceNext = at + buffer.duration;
    voiceSources.push(src); src.onended = () => { voiceSources = voiceSources.filter(x => x !== src); };
    speakingUntil = Math.max(speakingUntil, time + (voiceNext - ac.currentTime) + .15); bubbleUntil = Math.max(bubbleUntil, speakingUntil + 1);
  }
  function stopVoice() {
    for (const src of voiceSources) { try { src.stop(); } catch {} }
    voiceSources = []; voiceNext = 0; cloudLine = null;
    voiceAbort?.abort(); voiceAbort = null;      // the server still finishes and caches the line
    if (ttsPending) { ttsPending = null; try { speechSynthesis.cancel(); } catch {} }
  }
  function cloudSay(text, mood, id, urgent) {
    const key = clipKey(text, mood), clip = clips.get(key);
    if (clip instanceof AudioBuffer) { voiceKind = 'gemini'; playSamples(clip); return true; }
    const abort = new AbortController(); voiceAbort = abort;
    const line = cloudLine = { id, text, heard: false, dropped: false, deadline: time + (urgent ? 2.5 : 7) };
    fetchLine(text, mood, { signal: abort.signal, onChunk: samples => {
      if (id !== lineId || line.dropped) return;
      const buffer = ac.createBuffer(1, samples.length, 24000); buffer.copyToChannel(samples, 0);
      line.heard = true; voiceKind = 'gemini'; playSamples(buffer);
    } }).then(buffer => { clips.set(key, buffer); trimClips(); if (cloudLine === line) cloudLine = null; })
      .catch(() => { if (id === lineId && !line.heard && !line.dropped) { cloudLine = null; localSay(text); } });
    return true;
  }
  function localSay(text) {
    if (muted) return true;
    if (ttsWorks !== false) {
      try {
        speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance(text); ttsVoice ||= pickVoice();
        if (ttsVoice) u.voice = ttsVoice;
        u.pitch = .85; u.rate = 1.02; u.volume = 1;
        const job = { u, text, started: false, deadline: time + 1.6 };
        u.onstart = () => { job.started = true; ttsWorks = true; voiceKind = 'browser'; };
        u.onend = u.onerror = () => { if (ttsPending === job) { speechDone = true; bubbleUntil = time + 1.2; ttsPending = null; } };
        ttsPending = job; speechSynthesis.speak(u);
        return true;
      } catch { ttsWorks = false; }
    }
    voiceKind = 'mumble';
    const length = babble(text); speakingUntil = time + length; bubbleUntil = time + length + 1.2;
    return true;
  }
  function trimClips() { while (clips.size > 120) clips.delete(clips.keys().next().value); }
  // Make the lines that have to land instantly (pain, tickles, the towel, the greeting) ready before they are needed.
  let prefetching = null;
  function prefetchClient() {
    const voice = brain.voice;
    const lines = [...greetLines(false), ...greetLines(true).slice(0, 1),
      ...PREFETCH.flatMap(k => LINES[k].filter(l => typeof l === 'string').map(l => [l, MOOD_OF.get(LINES[k])]))];
    const run = prefetching = {};
    (async () => {
      for (const [text, mood] of lines) {
        if (prefetching !== run || brain.voice !== voice || cloud.ok === false) return;
        const key = clipKey(text, mood); if (clips.has(key) || !audio()) continue;
        clips.set(key, 'pending');
        try { clips.set(key, await fetchLine(text, mood)); } catch { clips.delete(key); }
      }
    })();
  }
  async function probeCloud() {             // is /api/tts there? (not until the office server restarts with it)
    if (cloud.probing) return; cloud.probing = true;
    try {
      const r = await fetch('/api/tts', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Office-Token': await officeToken() }, body: '{"text":""}' });
      if (r.status === 400) { cloud.ok = null; prefetchClient(); boardDirty = true; }
      else { cloud.ok = false; cloud.retryAt = time + 20; }
    } catch { cloud.ok = false; cloud.retryAt = time + 20; } finally { cloud.probing = false; }
  }
  let voiceLevelData = null;
  function voiceLevel() {                   // 0..1 loudness of what he is saying, for the mouth
    if (!analyser) return 0;
    voiceLevelData ||= new Float32Array(analyser.fftSize); analyser.getFloatTimeDomainData(voiceLevelData);
    let sum = 0; for (const v of voiceLevelData) sum += v * v;
    return Math.min(1, Math.sqrt(sum / voiceLevelData.length) * 5);
  }

  // ---------- the client: what he feels, wants and says ----------
  const brain = {}; root.userData.brain = brain;     // for poking at from the console: officeDebug.scene.getObjectByName('massage-simulator')
  let time = 0, speakingUntil = 0, speechDone = true, bubbleUntil = 0, lastLine = new Map();
  const speaking = () => time < speakingUntil && !speechDone;
  function pick(list, ...args) {
    const key = list, prev = lastLine.get(key); let item;
    for (let tries = 0; tries < 5; tries++) { item = list[Math.floor(Math.random() * list.length)]; if (item !== prev || list.length < 2) break; }
    lastLine.set(key, item); pendingMood = MOOD_OF.get(list) || null; pendingBank = BANK_OF.get(list) || null;
    return typeof item === 'function' ? item(...args) : item;
  }
  // mood picks how the voice says it (see STYLES); it defaults to the mood of the LINES bank the text was picked from.
  function say(text, { urgent = false, sfx = null, mood = null } = {}) {
    mood = mood || pendingMood || 'chat'; pendingMood = null;
    const bank = pendingBank; pendingBank = null;
    if (bank && MEMORY_OF[bank]) remember(bank, MEMORY_OF[bank]);           // it happened, whether or not he gets to say so
    if (speaking() && !urgent) return false;
    if (sfx) sound(sfx);
    stopVoice();
    const id = ++lineId;
    brain.lastSpoke = time; speechDone = false;
    const said = brain.memory.said; said.push(text); if (said.length > 10) said.shift();
    const estimate = .6 + text.split(/\s+/).length * .34;
    speakingUntil = time + estimate * 1.8; bubbleUntil = speakingUntil; drawBubble(text);
    if (muted) { speakingUntil = time + estimate; bubbleUntil = speakingUntil + 1.2; return true; }    // read it in the bubble
    if (cloud.ok !== false && audio() && cloudSay(text, mood, id, urgent)) return true;
    return localSay(text);
  }
  function setMuted(on) {
    muted = on; showVoiceButton(); boardDirty = true;
    try { localStorage.setItem('massage-voice-muted', on ? '1' : '0'); } catch {}
    if (on) {                      // cut him off mid-sentence; the bubble keeps the words up
      stopVoice(); try { window.speechSynthesis?.cancel(); } catch {}
      if (speaking()) { speakingUntil = Math.min(speakingUntil, time + 1.5); bubbleUntil = Math.max(bubbleUntil, speakingUntil + 1.2); }
    }
    if (out) out.gain.setTargetAtTime(on ? 0 : VOICE_GAIN, ac.currentTime, .02);
    click(!on);
  }
  function click(up) {             // a soft click, so you know a button took (not through his voice, so you hear it either way)
    if (!audio()) return;
    const t = ac.currentTime + .01, osc = ac.createOscillator(), env = ac.createGain();
    osc.frequency.setValueAtTime(up ? 1200 : 900, t); osc.frequency.exponentialRampToValueAtTime(up ? 1600 : 600, t + .05);
    env.gain.setValueAtTime(.12, t); env.gain.exponentialRampToValueAtTime(.0005, t + .07);
    osc.connect(env).connect(ac.destination); osc.start(t); osc.stop(t + .08);
  }
  function vocal(name, hold = 1) { if (speaking()) return; sound(name); drawBubble(SOUND_TEXT[name]); bubbleUntil = Math.max(bubbleUntil, time + hold); }
  function queue(text, delay = 0, mood = null) { brain.queue.push({ text, at: time + delay, mood: mood || pendingMood }); pendingMood = null; pendingBank = null; }
  function known(key) { if (brain.tension[key] != null) brain.known.add(key); }

  // ---------- memory: what has happened in this session ----------
  // Everything notable goes in his memory with the time it happened: knots found and worked out, cracks, what hurt, what
  // tickled, what you said to him. His lines draw on it (it is the second time you have hurt that spot; it took you three
  // goes; you walked off halfway through a knot) and the voice chat sends it with every turn, so what he says to you
  // fits what actually happened. A new client starts with an empty memory.
  let visits = 0;
  function remember(kind, text, { zone = null } = {}) {
    const m = brain.memory;
    m.events.push({ at: time - m.start, kind, text }); if (m.events.length > 80) m.events.splice(0, m.events.length - 80);
    m.count[kind] = (m.count[kind] || 0) + 1;
    if (zone) { const z = m.zones[zone] ||= {}; z[kind] = (z[kind] || 0) + 1; }
    if (FAILED_TRY.has(kind)) m.tries++;
  }
  const tally = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  const clock = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  function moodNow() {
    return time < brain.ouchUntil ? 'Ouch!' : brain.phase === 'asleep' ? 'Asleep' : brain.relax < .3 ? 'Tense' : brain.relax < .55 ? 'Loosening up' : brain.relax < .8 ? 'Relaxed' : 'Blissed out';
  }
  function memoryText() {            // his memory, as he would tell it, for the voice chat
    const m = brain.memory, c = m.count;
    const pressure = !brain.pressure ? 'hands off me' : brain.pressure < .12 ? 'barely touching' : brain.pressure < .3 ? 'light' : brain.pressure <= .95 ? 'good' : brain.pressure <= 1.3 ? 'firm' : 'too hard';
    const knots = brain.knots.map(k => `${zoneSay(k.key)}: ${k.done ? 'worked out, feels great now' : k.found ? `found, about ${Math.round(100 * k.progress / k.need)}% worked out, still sore` : brain.known.has(k.key) ? 'I told them about it; not found yet' : 'not mentioned yet'}`);
    const stiff = brain.segments.filter(seg => seg.stuck).map(seg => `${seg.name} (${segSay(seg)}): ${seg.cracked ? 'cracked, much better' : seg.known ? 'still stuck; I told them' : 'still stuck; not mentioned yet'}`);
    const hurt = ['tooHard', 'force', 'bone', 'kidney', 'neckFar', 'neckRough', 'slap'].reduce((n, k) => n + (c[k] || 0), 0);
    return [`YOUR MEMORY OF THIS SESSION (it is now ${clock(time - m.start)} in)`,
      `Right now: you feel ${moodNow().toLowerCase()} (relaxation ${Math.round(brain.relax * 100)}%); their pressure is ${pressure}.` +
        (brain.phase === 'done' ? ' The session is finished; you are lying there blissed out.' : brain.phase === 'asleep' ? ' You had dozed off.' : brain.phase === 'waiting' ? ' You have only just lain down.' : ''),
      `Knots: ${knots.join('; ')}.`, `Stiff spine levels: ${stiff.join('; ')}.`,
      `Neck: left side ${brain.neck.L.cracked ? 'cracked' : 'not cracked yet'}, right side ${brain.neck.R.cracked ? 'cracked' : 'not cracked yet'}.`,
      `What you want next: ${wantNext()}.`,
      `So far: ${tally((c.crack || 0) + (c.neckCrack || 0), 'crack')}, ${tally(c.knotGone || 0, 'knot')} worked out, it hurt ${tally(hurt, 'time')}, ${tally(c.tickle || 0, 'tickle')}.`,
      'What happened, oldest first ("they" is the therapist):', ...m.events.slice(-45).map(e => `${clock(e.at)} ${e.text}`),
      `Things you said out loud recently: ${m.said.map(t => `"${t}"`).join(' ') || 'nothing yet'}`].join('\n');
  }
  function wantNext() {
    const k = focusKnot(), seg = focusSeg(), neck = neckLeft();
    if (k && (k.found || brain.known.has(k.key))) return `the knot ${zoneSay(k.key)} worked out`;
    if (seg) return `a crack at ${seg.name}, ${segSay(seg)} (both palms either side of the spine there, press in, quick push up towards your head)`;
    if (neck.length) return `your neck cracked on the ${neck.map(side => side === 'L' ? 'left' : 'right').join(' and ')} side (hold your head, quick small twist)`;
    return 'nothing; everything is done, you just want to lie here';
  }
  function recapLine() {             // one thing he remembers about the session, for the end
    const c = brain.memory.count, hurt = ['tooHard', 'force', 'bone', 'kidney', 'neckFar', 'neckRough'].reduce((n, k) => n + (c[k] || 0), 0);
    const cracks = (c.crack || 0) + (c.neckCrack || 0);
    if (c.slap) return "I'll forgive you for the slap. Eventually.";
    if (hurt >= 3) return `A few ouches along the way, but ${cracks ? 'those cracks made up for it' : 'worth it'}.`;
    if ((c.tickle || 0) >= 2) return 'Next time, maybe a bit less tickling.';
    if (cracks >= 4) return `${cap(numberWord(cracks))} cracks! I feel two inches taller.`;
    if ((c.youSaid || 0) >= 3) return 'And thanks for the chat. Better than the radio.';
    if (c.knotGone) return 'And those knots are finally gone.';
    return null;
  }

  function newClient(first = false) {
    const story = STORIES[Math.floor(Math.random() * STORIES.length)];
    let name = first ? 'Gus' : NAMES[Math.floor(Math.random() * NAMES.length)];
    if (!first && name === brain.name) name = NAMES[(NAMES.indexOf(name) + 1) % NAMES.length];
    const tension = {};
    for (const [z, info] of Object.entries(ZONES)) if (!info.loose) for (const key of info.both ? [z] : [z + '.L', z + '.R']) tension[key] = rand(.3, .45);
    const knots = story.knots.map(key => {
      const [z, s] = key.split('.'), info = ZONES[z], sign = s ? (s === 'L' ? 1 : -1) : Math.random() < .5 ? 1 : -1;
      const u = info.u + rand(-.035, .035), n = sign * (z === 'mid' ? rand(.16, .24) : info.n + rand(-.07, .07));
      tension[key] = rand(.8, .95);
      return { key, u, n, x: X0 + u * LEN, z: n * profile(u)[0], need: rand(7, 10), progress: 0, found: false, done: false };
    });
    Object.assign(brain, {
      name, voice: VOICE_OF[name] || 'Enceladus', story, tension, knots, known: new Set(), relax: .1, trust: 1, phase: 'waiting', queue: [], lastSpoke: -99, lastTouch: time,
      lastGuide: -99, lastPraise: time, lastLight: -99, lastPain: -99, lastSpine: -99, lastTickle: -99, lastFeet: -99, lastTowel: -99,
      lastHead: -99, lastArm: -99, lastSlap: -99, offKnot: 0, light: 0, tickle: 0, headTime: 0, nextKnotSound: 0, halfSaid: false,
      awayTime: 0, away: false, doneAt: 0, nextSnore: 0, techSaid: new Set(), techTime: 0, techLast: '',
      ouchUntil: 0, laughUntil: 0, blissUntil: 0, flinch: 0, squirm: 0, kick: 0, melt: 0, wiggle: 0, pressure: 0, techLabel: '—',
      segments: SEGMENTS.map(seg => ({ ...seg, x: X0 + seg.u * LEN, stuck: story.stuck.includes(seg.name), cracked: false, known: false, until: 0 })),
      neck: { L: { cracked: false, until: 0 }, R: { cracked: false, until: 0 } }, grip: null, headRot: 0, headSpin: 0, snap: 0, neckRelax: 0, neckLetGo: false, adj: { left: null, right: null },
      cue: null, sweep: null, push: null, pushCool: 0, hardTime: 0, jolt: 0, neckAsked: false, lastAdjust: -99, lastNeckLine: -99, lastSegGuide: -99, offSeg: 0, lastLean: -99, lastWary: -99,
    });
    brain.memory = { start: time, events: [], count: {}, zones: {}, said: [], chat: [], tries: 0 }; brain.visit = ++visits;
    Object.assign(chat, { chunks: [], pre: [], voiced: 0, speech: 0, quiet: 0, heard: '', heardAt: -99 });
    brain.queue.length = 0; dent.fill(0); warmth.fill(0); dragX.fill(0); dragZ.fill(0); twitches.length = 0;
    if (!first) { speechDone = true; speakingUntil = 0; stopVoice(); }
    if (cloud.ok !== false) prefetchClient();
    boardDirty = true;
  }
  const focusKnot = () => brain.knots.find(k => !k.done) || null;
  const focusSeg = () => brain.segments.find(seg => seg.stuck && !seg.cracked) || null;
  const neckLeft = () => ['L', 'R'].filter(side => !brain.neck[side].cracked);
  function greetLines(touched) {
    const seg = focusSeg() || brain.segments[6];
    return [[touched ? `Oh! Hi. Straight in, okay. I'm ${brain.name}.` : `Oh, hey. You must be the chiropractor today. I'm ${brain.name}.`, 'greet'],
      [brain.story.why, 'greet'], [`The stiffest bit is ${segSay(seg)}. It really needs a crack.`, 'greet'],
      ['Both hands on the middle of my back, either side of the spine. Press in, then one quick push up towards my head.', 'greet'],
      ['And do my neck after. Just hold it and give it a quick little twist. Both sides.', 'greet']];
  }
  function greet(touched) {
    if (brain.phase !== 'waiting') return;
    brain.phase = 'massage';
    remember('arrived', `I lay down and told them why I came in: ${brain.story.why}`);
    greetLines(touched).forEach(([text, mood], i) => queue(text, [0, .4, .4, .6, .6][i], mood));
    known(focusKnot().key); const seg = focusSeg(); if (seg) seg.known = true;
  }
  function guide(c, k) {
    const dx = k.x - c.x, dz = k.z - c.z, d = Math.hypot(dx, dz);
    if (Math.sign(k.z) !== Math.sign(c.z) && Math.abs(k.z) > .06 && Math.abs(c.z) > .04) return pick([`Other side. My ${k.z > 0 ? 'left' : 'right'}.`, 'Wrong side!', 'Mirror that. Other side.']);
    if (d > .22) return `Not there. It's ${zoneSay(k.key)}.`;
    if (d < .1) return pick(['Warmer... nearly.', 'Close. So close.', 'Almost there...']);
    if (Math.abs(dx) > Math.abs(Math.abs(k.z) - Math.abs(c.z))) return dx < 0 ? pick(['Bit higher, towards my neck.', 'Higher up.', 'Up a bit.']) : pick(['Lower down a bit.', 'Further down.', 'Down, towards my waist.']);
    return Math.abs(k.z) > Math.abs(c.z) ? pick(['Further out, towards my side.', 'More to the outside.']) : pick(['In closer to the spine.', 'More towards the middle.']);
  }

  // ---------- reading your hands ----------
  const TIPS = ['thumb-tip', 'index-finger-tip', 'middle-finger-tip', 'ring-finger-tip', 'pinky-finger-tip'];
  const PADS = ['index-finger-phalanx-intermediate', 'middle-finger-phalanx-intermediate', 'ring-finger-phalanx-intermediate'];
  const KNUCKLES = ['index-finger-phalanx-proximal', 'middle-finger-phalanx-proximal', 'ring-finger-phalanx-proximal'];
  const track = { left: { on: false, vx: 0, vz: 0, turn: 0, angle: null, curl: 0, curlVel: 0, taps: [], part: null, tech: 'resting', cand: 'resting', candT: 0 } };
  track.right = structuredClone(track.left);
  function samples(h) {
    const pts = [], add = (w, r, kind) => pts.push({ p: body.worldToLocal(w.clone()), r, kind });
    if (h.controller) { add(h.palm, .035, 'palm'); return pts; }
    const J = n => h.joints.get(n);
    add(h.palm.clone().addScaledVector(h.palmNormal, .014), .02, 'palm');
    add(J('wrist').clone().lerp(h.palm, .45).addScaledVector(h.palmNormal, .016), .02, 'palm');
    for (const n of TIPS) add(J(n), .009, n === 'thumb-tip' ? 'thumb' : 'tip');
    for (const n of PADS) add(J(n), .01, 'tip');
    if (h.fist) for (const n of KNUCKLES) add(J(n), .012, 'knuckle');
    return pts;
  }
  const segDist = (p, a, b) => { const ab = b.clone().sub(a), t = clamp(p.clone().sub(a).dot(ab) / ab.lengthSq(), 0, 1); return p.distanceTo(a.clone().addScaledVector(ab, t)); };
  const dynY = (u, n, w) => w * (brain.breath * gauss(u, .4, .35) + (n > 0 ? brain.hunchL : brain.hunchR) * gauss(Math.abs(n), .45, .25) * gauss(u, 0, .09));
  function hit({ p, r, kind }) {
    if (p.y < -.03 || p.y > .45) return null;
    const u = (p.x - X0) / LEN;
    if (u > U_LO + .02 && u < U_TOWEL) {
      const W = profile(u)[0];
      if (Math.abs(p.z) < W) {
        const n = p.z / W, top = restTop(u, n), depth = top.y + dynY(u, n, top.w) - (p.y - r);
        if (depth > 0 && depth < .14) return { part: 'torso', depth, u, n, x: p.x, z: p.z, kind, r };
        if (depth >= .14) return null;
      }
    }
    if (p.x > TX0 && p.x < TX1 && Math.abs(p.z) < .42 && p.y - r < bodyTop(p.x, clamp(p.z, -.36, .36)) + .02) return { part: 'towel' };
    if (p.distanceTo(headTurn.position) < .125 + r) return { part: 'head' };
    if (feetCentres.some(f => p.distanceTo(f) < .08 + r)) return { part: 'feet' };
    if (armSegs.some(([a, b, rad]) => segDist(p, a, b) < rad + r) || clientHands.some(m => p.distanceTo(m.centre) < .07 + r)) return { part: 'arm' };
    return null;
  }
  function readHand(h, st, dt) {
    const res = { part: null, depth: 0, pts: [], tips: false, palm: false, knuckle: false, thumb: false, onset: false, slap: false, hand: h };
    if (!h?.valid) { st.on = false; st.part = null; st.angle = null; return res; }
    let sx = 0, sz = 0, sw = 0, other = null;
    for (const s of samples(h)) {
      const k = hit(s); if (!k) continue;
      if (k.part !== 'torso') { other ||= k.part; continue; }
      res.pts.push(k); const w = k.depth + .002; sx += k.x * w; sz += k.z * w; sw += w;
      res.depth = Math.max(res.depth, k.depth); res[k.kind === 'tip' ? 'tips' : k.kind] = true;
      if (k.kind === 'palm' && (!res.heel || k.depth > res.heel.depth)) res.heel = k;    // the heel of the hand: the contact for an adjustment
    }
    if (sw) { res.part = 'torso'; res.x = sx / sw; res.z = sz / sw; res.u = (res.x - X0) / LEN; res.n = clamp(res.z / profile(res.u)[0], -1, 1); }
    else res.part = other;
    res.onset = res.part !== st.part && !!res.part; st.part = res.part;
    if (res.onset && h.velocity.y < -.55) { st.taps.push(time); if (h.velocity.y < -1.7) res.slap = true; }
    st.taps = st.taps.filter(x => time - x < 1.6);
    if (res.part === 'torso') {
      if (st.on) {
        st.vx = lerp(st.vx, (res.x - st.x) / dt, .25); st.vz = lerp(st.vz, (res.z - st.z) / dt, .25);
        const speed = Math.hypot(st.vx, st.vz);
        if (speed > .025) {
          const a = Math.atan2(st.vz, st.vx);
          if (st.angle != null) { const d = Math.atan2(Math.sin(a - st.angle), Math.cos(a - st.angle)); st.turn = lerp(st.turn, d / dt, .08); }
          st.angle = a;
        } else st.turn *= .95;
      } else { st.vx = st.vz = st.turn = 0; st.angle = null; }
      st.x = res.x; st.z = res.z; st.on = true;
    } else { st.on = false; st.vx = st.vz = 0; st.angle = null; }
    if (!h.controller) {
      const curl = ['index-finger-tip', 'middle-finger-tip', 'ring-finger-tip', 'pinky-finger-tip'].reduce((s, n) => s + h.joints.get(n).distanceTo(h.palm), 0) / 4;
      st.curlVel = lerp(st.curlVel, Math.abs(curl - st.curl) / dt, .12); st.curl = curl;
    }
    res.speed = Math.hypot(st.vx, st.vz); res.p = res.depth / PRESS_DEPTH;
    let tech = 'resting';
    if (st.taps.length >= 3) tech = 'tapping';
    else if (res.part === 'torso') {
      if (!h.controller && st.curlVel > .07 && (res.tips || res.palm)) tech = 'kneading';
      else if (res.knuckle) tech = 'knuckles';
      else if (Math.abs(st.turn) > 3 && res.speed > .02 && res.speed < .4) tech = res.palm ? 'circles' : 'thumbs';
      else if (res.speed > .09) tech = res.palm ? 'glide' : 'strokes';
      else if (res.p > .25) tech = res.palm ? 'pressing' : 'thumbpress';
    }
    if (tech !== st.cand) { st.cand = tech; st.candT = time; }
    if (time - st.candT > .25) st.tech = st.cand;
    res.tech = st.tech;
    return res;
  }

  // ---------- your hands, as you see them near the table ----------
  // The office draws each tracked hand as a mitten at the palm, and nothing stops a tracked hand at the skin, so pressing
  // in hid it inside his back. Near the table we draw jointed hands instead, each joint held on the dented skin (or on
  // the towel, head or feet) while your real hand goes deeper, tinted by pressure: green good, amber firm, red too hard.
  const CHAINS = [['wrist', 'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip'],
    ...['index', 'middle', 'ring', 'pinky'].map(f => ['wrist', ...['metacarpal', 'phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal', 'tip'].map(j => `${f}-finger-${j}`)])];
  const JOINT_NAMES = [...new Set(CHAINS.flat())];
  const jointRadius = n => n === 'wrist' ? .018 : n.endsWith('tip') ? .0078 : n.includes('distal') ? .0085 : n.includes('intermediate') ? .0093
    : n.includes('proximal') ? (n.startsWith('thumb') ? .0115 : .0102) : n.startsWith('thumb') ? .0125 : .0095;
  const BONES = CHAINS.flatMap(chain => chain.slice(1).map((n, i) => [chain[i], n])).filter(([a, b]) => !(a === 'wrist' && b.endsWith('metacarpal') && !b.startsWith('thumb')));
  const unitBall = new THREE.SphereGeometry(1, 14, 10), unitTube = new THREE.CylinderGeometry(1, 1, 1, 12, 1, true), unitBox = roundBox(1, 1, 1, .3);
  const PRESSURE_GLOW = { none: new THREE.Color(0, 0, 0), good: new THREE.Color('#2e9d4f'), firm: new THREE.Color('#f5a623'), hard: new THREE.Color('#e53935') };
  const shownHands = {};
  // A forearm from the wrist towards the elbow (its +y), oval across the hand (its x), into a rolled-up scrub sleeve.
  const sleeveMat = new THREE.MeshStandardMaterial({ color: '#2f4a63', roughness: .85 });
  function forearm(material) {
    const g = new THREE.Group();
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(.034, .0255, .22, 28, 6), material); arm.position.y = .1; arm.scale.x = 1.22; g.add(arm);
    const wristCap = new THREE.Mesh(new THREE.SphereGeometry(.0255, 20, 12), material); wristCap.scale.set(1.22, .6, 1); g.add(wristCap);
    const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(.047, .043, .1, 28, 1), sleeveMat); sleeve.position.y = .245; sleeve.scale.x = 1.12; g.add(sleeve);
    const roll = new THREE.Mesh(new THREE.TorusGeometry(.045, .009, 10, 28), sleeveMat); roll.rotation.x = Math.PI / 2; roll.position.y = .195; roll.scale.set(1.12, 1, 1); g.add(roll);
    g.traverse(o => { o.frustumCulled = false; }); return g;
  }
  const GLOW_OF = res => !res || res.part !== 'torso' ? 'none' : res.p > 1.3 ? 'hard' : 'none';   // the board shows pressure; the hand only flushes when it is too much
  for (const side of ['left', 'right']) {
    const material = skinMaterial(maps, { color: '#dcaa8a' });
    const joints = new THREE.InstancedMesh(unitBall, material, JOINT_NAMES.length), bones = new THREE.InstancedMesh(unitTube, material, BONES.length);
    const palm = new THREE.Mesh(unitBox, material), cuff = forearm(material);
    const group = new THREE.Group(); group.add(joints, bones, palm, cuff); group.visible = false; root.add(group);
    group.traverse(o => { o.frustumCulled = false; });
    shownHands[side] = { group, joints, bones, palm, cuff, material, at: new Map(JOINT_NAMES.map(n => [n, V()])) };
  }
  // How far a body-local point of radius r may sit before it would show through: push it back onto the surface.
  function onSurface(p, r) {
    const u = (p.x - X0) / LEN;
    if (u > U_LO + .02 && u < U_TOWEL) {
      const W = profile(u)[0];
      if (Math.abs(p.z) < W) {
        const n = p.z / W, top = restTop(u, n), skinY = top.y + dynY(u, n, top.w), depth = skinY - (p.y - r);
        if (depth > .028 && depth < .2) p.y += depth - .028;        // the skin gives about 3 cm, then the hand rests on it
        return;
      }
    }
    if (p.x > TX0 && p.x < TX1 && Math.abs(p.z) < .38) { const y = bodyTop(p.x, p.z) + .014 + r; if (p.y < y && p.y > y - .2) p.y = y; return; }
    const head = headTurn.position, d = p.distanceTo(head);
    if (d < .118 + r && d > 1e-4) { p.sub(head).multiplyScalar((.118 + r) / d).add(head); return; }
    for (const f of feetCentres) { const e = p.distanceTo(f); if (e < .05 + r && e > 1e-4) { p.sub(f).multiplyScalar((.05 + r) / e).add(f); return; } }
  }
  // Realistic hands for you: the hand models posed straight from the headset's joint poses (positions and turns), each
  // joint kept on his skin like the jointed hands below, which stand in while the models load or without joint poses.
  const userHands = {};
  for (const side of ['left', 'right']) loadHand(side).then(gltf => {
    if (disposed) return;
    const material = skinMaterial(maps, { color: '#dcaa8a' });
    const hand = new SkinnedHand(gltf, material); hand.root.visible = false; root.add(hand.root);
    hand.root.traverse(o => { o.frustumCulled = false; });
    const arm = forearm(material); arm.visible = false; root.add(arm);
    userHands[side] = { hand, material, arm, pose: new Map(HAND_JOINTS.map(n => [n, { p: V(), q: new THREE.Quaternion() }])), raw: new Map(HAND_JOINTS.map(n => [n, V()])) };
  }).catch(() => {});
  function jointPoses(side) {
    const xr = window.officeDebug?.renderer?.xr, frame = xr?.getFrame?.(), ref = xr?.getReferenceSpace?.(), session = xr?.getSession?.();
    if (!frame?.getJointPose || !ref || !session) return null;
    let source = null; for (const s of session.inputSources) if (s.hand && s.handedness === side) source = s;
    if (!source) return null;
    const out = [];
    for (const n of HAND_JOINTS) { const space = source.hand.get(n), pose = space && frame.getJointPose(space, ref); if (!pose) return null; out.push(pose.transform); }
    return out;
  }
  const rootQ = new THREE.Quaternion(), fixQ = new THREE.Quaternion(), d0 = V(), d1 = V();
  const ARM_TURN = new THREE.Quaternion().setFromAxisAngle(V(1, 0, 0), Math.PI / 2);     // the forearm's +y onto the wrist's +z
  function poseUserHand(u, transforms, res) {
    root.getWorldQuaternion(rootQ).invert();
    HAND_JOINTS.forEach((n, i) => {
      const t = transforms[i], raw = u.raw.get(n).set(t.position.x, t.position.y, t.position.z), j = u.pose.get(n);
      const p = body.worldToLocal(j.p.copy(raw)); onSurface(p, jointRadius(n)); root.worldToLocal(body.localToWorld(p));
      root.worldToLocal(raw);
      j.q.set(t.orientation.x, t.orientation.y, t.orientation.z, t.orientation.w).premultiply(rootQ);
    });
    for (const chain of HAND_CHAINS) for (let i = 1; i < chain.length - 1; i++) {   // keep each bone pointing at the next joint once lifted onto the skin
      const a = chain[i], b = chain[i + 1];
      d0.subVectors(u.raw.get(b), u.raw.get(a)); d1.subVectors(u.pose.get(b).p, u.pose.get(a).p);
      if (d0.lengthSq() < 1e-8 || d1.lengthSq() < 1e-8) continue;
      fixQ.setFromUnitVectors(d0.normalize(), d1.normalize()); u.pose.get(a).q.premultiply(fixQ);
    }
    u.hand.setPose(u.pose); u.hand.root.visible = true;
    const w = u.pose.get('wrist');                        // forearm: the wrist joint's +z points back towards the elbow
    u.arm.position.copy(w.p); u.arm.quaternion.copy(w.q).multiply(ARM_TURN); u.arm.visible = true;
    u.material.emissive.lerp(PRESSURE_GLOW[GLOW_OF(res)], .25); u.material.emissiveIntensity = .25;
  }
  const M4 = new THREE.Matrix4(), Q = new THREE.Quaternion(), UP = V(0, 1, 0), S3 = V(), D3 = V(), X3 = V(), Y3 = V(), Z3 = V();
  function drawHand(h, side, res) {
    const view = shownHands[side], rig = window.officeDebug?.hands, real = userHands[side];
    const near = h?.valid && !h.controller && (() => { const l = root.worldToLocal(h.palm.clone()); return Math.abs(l.x) < 1.7 && Math.abs(l.z) < 1.2 && l.y < 1.7; })();
    view.group.visible = false; if (real) { real.hand.root.visible = false; real.arm.visible = false; }
    if (!near) return;
    if (rig?.models?.[side]) rig.models[side].visible = false;          // our hand replaces the office mitten here
    if (rig?.tips?.[side]) rig.tips[side].visible = false;
    const transforms = real && jointPoses(side);
    if (transforms) { poseUserHand(real, transforms, res); return; }
    view.group.visible = true;
    for (const n of JOINT_NAMES) {                                       // world -> body (to rest on the skin) -> table space (to draw)
      const p = body.worldToLocal(view.at.get(n).copy(h.joints.get(n)));
      onSurface(p, jointRadius(n)); root.worldToLocal(body.localToWorld(p));
    }
    JOINT_NAMES.forEach((n, i) => view.joints.setMatrixAt(i, M4.compose(view.at.get(n), Q.identity(), S3.setScalar(jointRadius(n)))));
    BONES.forEach(([a, b], i) => {
      const A = view.at.get(a), B = view.at.get(b), r = Math.min(jointRadius(a), jointRadius(b)) * .95;
      D3.subVectors(B, A); const len = D3.length() || 1e-4;
      view.bones.setMatrixAt(i, M4.compose(S3.copy(A).addScaledVector(D3, .5), Q.setFromUnitVectors(UP, D3.divideScalar(len)), V(r, len, r)));
    });
    view.joints.instanceMatrix.needsUpdate = view.bones.instanceMatrix.needsUpdate = true;
    // palm: a soft slab from the wrist to the knuckles, across from index to little finger
    const J = n => view.at.get(n), wrist = J('wrist'), iK = J('index-finger-phalanx-proximal'), pK = J('pinky-finger-phalanx-proximal'), mK = J('middle-finger-phalanx-proximal');
    Y3.subVectors(mK, wrist); const length = Y3.length(); Y3.normalize();
    X3.subVectors(iK, pK); const width = X3.length() + .016; X3.addScaledVector(Y3, -X3.dot(Y3)).normalize();
    Z3.crossVectors(X3, Y3).normalize();
    view.palm.position.copy(wrist).lerp(mK, .55).add(S3.copy(iK).add(pK).multiplyScalar(.5).sub(mK).multiplyScalar(.5));
    view.palm.quaternion.setFromRotationMatrix(M4.makeBasis(X3, Y3, Z3)); view.palm.scale.set(width, length * .95, .026);
    view.cuff.position.copy(wrist); view.cuff.quaternion.setFromRotationMatrix(M4.makeBasis(X3, S3.copy(Y3).negate(), D3.crossVectors(X3, S3)));   // forearm back towards the elbow
    view.material.emissive.lerp(PRESSURE_GLOW[GLOW_OF(res)], .25); view.material.emissiveIntensity = .3;
  }

  // ---------- reactions ----------
  const twitches = [];
  function twitch(x, z, amp = .006) { twitches.push({ x, z, amp, t0: time }); if (twitches.length > 6) twitches.shift(); }
  function pain(level = 1) { brain.flinch = Math.max(brain.flinch, level); brain.ouchUntil = time + .9 + level * .4; }

  function work(res, dt) {
    const fit = pressureFit(res.p), T = TECH[res.tech], zone = zoneAt(res.u, res.n), eff = fit * T.zone;
    res.zone = zone; res.fit = fit; known(zone);
    if (brain.tension[zone] != null) brain.tension[zone] = Math.max(.05, brain.tension[zone] - dt * .03 * eff);
    brain.relax = Math.min(1, brain.relax + dt * .004 * eff * (1 - brain.relax));
    if (eff > .7) brain.blissUntil = time + .6;
    for (const k of brain.knots) {
      if (k.done) continue;
      let d = Infinity; for (const q of res.pts) d = Math.min(d, Math.hypot(q.x - k.x, q.z - k.z));
      if (d > .06) continue;
      res.knot = k;
      if (!k.found) {
        k.found = true; known(k.key); twitch(k.x, k.z, .008); brain.flinch = Math.max(brain.flinch, .35);
        remember('knotFound', `they found the knot ${zoneSay(k.key)}`, { zone: k.key });
        say(pick(LINES.found), { urgent: !speaking() || time - brain.lastSpoke > 2 }); brain.nextKnotSound = time + 3;
      }
      const gain = dt * fit * TECH[res.tech].knot * (d < .03 ? 1 : .6);
      k.progress += gain;
      brain.tension[k.key] = Math.max(brain.tension[k.key] - gain * .02, .3 + .55 * (1 - k.progress / k.need));
      if (gain > 0 && k.progress < k.need * .6 && Math.random() < dt * .7) twitch(k.x, k.z, .005);
      if (fit > .5 && time > brain.nextKnotSound) {
        brain.nextKnotSound = time + rand(2.6, 4.2);
        if (Math.random() < .3) say(pick(LINES.working)); else vocal(pick(['hum', 'ahh', 'ooh']));
        brain.wiggle = 1;
      }
      if (k.progress >= k.need) release(k);
    }
  }
  function release(k) {
    k.done = true; brain.tension[k.key] = .08; brain.relax = Math.min(1, brain.relax + .15); brain.melt = 1; brain.wiggle = 1.5;
    remember('knotGone', `they worked the knot ${zoneSay(k.key)} until it let go`, { zone: k.key });
    sound('sigh'); say(pick(LINES.released), { urgent: true });
    const next = focusKnot();
    if (next) { known(next.key); queue(pick(LINES.next, next.key), 1.5); }
    boardDirty = true;
  }

  // ---------- adjustments: the spine and the neck ----------
  const nearestSeg = x => brain.segments.reduce((b, seg) => Math.abs(seg.x - x) < Math.abs(b.x - x) ? seg : b);
  const exhaling = () => !!brain.cue && time > brain.cue.out + .3 && time < brain.cue.out + 2.6;   // the moment for the thrust
  const guarding = seg => Math.max(brain.tension[zoneAt(seg.u, .2)] ?? .3, brain.tension[zoneAt(seg.u, -.2)] ?? .3);
  // where on the back a hand is, for an adjustment: on the bony middle, on the transverse processes just beside it (right),
  // further out on the muscle, or on the ribs; over the kidneys low and wide.
  function placement(r, seg) {
    const lateral = Math.abs(r.z), i = brain.segments.indexOf(seg);
    if (lateral < .012) return 'bone';
    if (i >= 10 && i <= 13 && lateral > .05) return 'kidney';
    return lateral < .055 ? 'tp' : lateral < .1 ? 'muscle' : 'ribs';
  }
  function finished() {
    if (brain.phase !== 'massage' || focusSeg() || neckLeft().length) return;
    brain.phase = 'done'; brain.doneAt = time; brain.relax = Math.max(brain.relax, .85); queue(pick(LINES.done), 2); boardDirty = true;
    const recap = recapLine(); if (recap) queue(recap, 2.5, 'bliss');
    remember('done', 'we finished the session: everything is worked out');
  }
  function afterCrack() {
    const next = focusSeg();
    if (next) { if (!next.known) { next.known = true; queue(pick(LINES.segNext, next), 2.2); } }
    else if (neckLeft().length === 2 && !brain.neckAsked) { brain.neckAsked = true; queue(pick(LINES.neckAsk), 2.2); }
    finished(); boardDirty = true;
  }
  function crackSegment(seg, { bilateral = false, quiet = false, weak = false } = {}) {
    const big = seg.stuck && !seg.cracked, pops = big ? (weak ? 1 : 2 + (bilateral ? 2 : 1) + Math.floor(Math.random() * 2)) : Math.random() < (weak ? .2 : .35) ? 1 : 0;
    seg.until = time + 45; brain.lastAdjust = time;
    if (!pops) { if (!quiet) say(pick(LINES.nothing), { urgent: true }); return false; }
    crackSound(body.localToWorld(V(seg.x, .17, 0)), pops, { big });
    twitch(seg.x, 0, big ? .012 : .006); brain.jolt = big ? 1 : .4; brain.wiggle = 1;
    if (big && !weak) {
      seg.cracked = seg.known = true;
      for (const z of [zoneAt(seg.u, .2), zoneAt(seg.u, -.2)]) if (brain.tension[z] != null) brain.tension[z] = Math.max(.05, brain.tension[z] - .15);
      brain.relax = Math.min(1, brain.relax + .08); brain.melt = 1; brain.blissUntil = time + 3;
      const i = brain.segments.indexOf(seg);            // a stuck joint next door often lets go with it
      for (const j of [i - 1, i + 1]) { const nb = brain.segments[j]; if (nb?.stuck && !nb.cracked && Math.random() < .4) { nb.cracked = nb.known = true; nb.until = time + 45; } }
      const tries = brain.memory.tries; brain.memory.tries = 0;
      remember('crack', `they cracked ${seg.name}, ${segSay(seg)}; huge relief`);
      if (!quiet) { sound('sigh'); say(tries >= 2 ? pick(LINES.crackAtLast, tries) : pick(LINES.crack), { urgent: true }); }
      afterCrack();
    } else if (!quiet) say(pick(LINES.little), { urgent: true });
    return true;
  }
  function thrust(r, st, bilateral) {
    const seg = st.seg, where = placement(r.heel, seg), extra = r.heel.depth - st.depth, i = brain.segments.indexOf(seg);
    brain.techLabel = 'Thrust!'; boardDirty = true; brain.thrustAt = time;
    if (extra > .035 || r.p > 1.9) { pain(1); brain.jolt = 1; say(pick(LINES.force), { urgent: true, sfx: 'ow' }); return; }
    if (where === 'bone') { pain(.8); say(pick(LINES.bone), { urgent: true, sfx: 'ow' }); return; }
    if (where === 'kidney') { pain(.8); say(pick(LINES.kidney), { urgent: true, sfx: 'ow' }); return; }
    if (where === 'ribs') { if (r.p > 1.2) pain(.5); say(pick(LINES.ribs), { urgent: true }); return; }
    if (!exhaling()) { brain.flinch = Math.max(brain.flinch, .3); say(pick(LINES.early), { urgent: true }); return; }
    if (guarding(seg) > .62) { for (const z of [zoneAt(seg.u, .2), zoneAt(seg.u, -.2)]) known(z); say(pick(LINES.guarded), { urgent: true }); return; }
    if (seg.until > time) { say(pick(LINES.again), { urgent: true }); return; }
    if (i >= 12 && r.p > 1.3) { pain(.4); say(pick(LINES.lumbar), { urgent: true }); return; }
    crackSegment(seg, { bilateral, weak: where === 'muscle' });
  }
  // A palm resting on his back: pre-load (press and hold beside the spine), then a quick short push on his breath out.
  function adjustSpine(results, dt) {
    const sides = ['left', 'right'], loaded = [];
    for (const [k, r] of results.entries()) {
      const side = sides[k];
      let st = brain.adj[side];
      if (r.part !== 'torso' || !r.heel || r.heel.u < 0 || brain.sweep?.active) { brain.adj[side] = null; continue; }
      const c = r.heel, seg = nearestSeg(c.x), level = Math.abs(c.x - seg.x) < .022;
      if (!st) st = brain.adj[side] = { hold: 0, loaded: false, seg, depth: 0, since: time };
      if (!st.loaded) {
        if (level && placement(c, seg) !== 'ribs' && r.p >= .35 && r.p <= 1.2 && r.speed < .06) st.hold += dt; else { st.hold = 0; st.seg = seg; }
        if (st.hold > .5) {
          Object.assign(st, { loaded: true, seg, depth: c.depth, since: time }); seg.known = seg.known || seg.stuck;
          if (!brain.cue || time > brain.cue.out + 3) { brain.cue = { start: time, out: time + 1.8, saidOut: false }; say(pick(LINES.cueIn), { urgent: true }); }
          boardDirty = true;
        }
        continue;
      }
      if (Math.abs(c.x - st.seg.x) > .035) { brain.adj[side] = null; continue; }      // slid off the level
      brain.techLabel = 'Pre-load';
      if (r.hand.velocity.y < -.35 && c.depth - st.depth > .004) { loaded.push([r, st, side]); continue; }
      if (time - st.since > 7 && time - brain.lastLean > 12) { brain.lastLean = time; say(pick(LINES.lean)); brain.adj[side] = null; }
    }
    if (loaded.length) {
      const [r, st] = loaded[0], other = brain.adj[loaded[0][2] === 'left' ? 'right' : 'left'], otherR = results[loaded[0][2] === 'left' ? 1 : 0];
      const bilateral = !!other?.loaded && Math.abs(other.seg.x - st.seg.x) < .06 && Math.sign(otherR.heel?.z || 0) !== Math.sign(r.heel.z);
      thrust(r, st, bilateral);
      brain.adj.left = brain.adj.right = null; brain.cue = null;
    }
  }
  // Both palms either side of the spine, pressed in and swept down the back: it goes level by level.
  function sweepSpine(results) {
    const [a, b] = results, ok = a.part === 'torso' && b.part === 'torso' && a.palm && b.palm && Math.sign(a.z) !== Math.sign(b.z)
      && Math.abs(a.z) > .01 && Math.abs(a.z) < .08 && Math.abs(b.z) > .01 && Math.abs(b.z) < .08 && a.p > .3 && b.p > .3 && a.p < 1.5 && b.p < 1.5;
    const down = ok && track.left.vx > .1 && track.right.vx > .1 && Math.abs(a.x - b.x) < .06;
    const sw = brain.sweep;
    if (down) {
      const seg = nearestSeg((a.x + b.x) / 2), i = brain.segments.indexOf(seg);
      if (!sw?.active) brain.sweep = { active: true, last: i, count: 0, cracked: 0, start: time };
      else if (i > sw.last) {
        for (let j = sw.last + 1; j <= i; j++) {
          const sj = brain.segments[j]; if (sj.until > time || sj.u > U_TOWEL) continue;
          if (sj.stuck && !sj.cracked && guarding(sj) > .62) { sj.until = time + 3; continue; }
          if (crackSegment(sj, { quiet: true })) sw.cracked++;
          sw.count++;
        }
        sw.last = i;
      }
      brain.techLabel = 'Spinal sweep';
    } else if (sw?.active && !ok) {
      sw.active = false;
      if (sw.cracked >= 3) { sound('sigh'); brain.relax = Math.min(1, brain.relax + .1); brain.melt = 1; say(pick(LINES.sweep), { urgent: true }); }
      else if (sw.cracked) say(pick(LINES.little), { urgent: true });
      brain.sweep = null; afterCrack();
    }
  }
  // Two palms on the middle of his back, either side of the spine, pressed in; then one quick push up towards his head
  // (or a quick push straight down): the thoracic levels under your hands let go, the stiff one nearest first.
  const bodyQ = new THREE.Quaternion();
  const localVel = h => h.velocity.clone().applyQuaternion(body.getWorldQuaternion(bodyQ).invert());    // in his frame: -x is towards his head
  function pushCrack(results, dt) {
    const [a, b] = results;
    const on = r => r.part === 'torso' && (r.palm || r.heel) && r.u > .03 && r.u < .82 && Math.abs(r.z) < .15;
    const ok = on(a) && on(b) && Math.abs(a.x - b.x) < .16 && a.p > .22 && b.p > .22;
    let st = brain.push;
    if (!ok) { if (st && time - st.seen > .3) brain.push = null; return !!brain.push; }
    const x = (a.x + b.x) / 2, depth = (a.depth + b.depth) / 2;
    if (!st) st = brain.push = { since: time, seen: time, x, depth, armed: false };
    st.seen = time;
    const va = localVel(a.hand), vb = localVel(b.hand), up = -(va.x + vb.x) / 2, down = -(va.y + vb.y) / 2;
    if (Math.abs(up) < .12 && Math.abs(down) < .12) { st.x = lerp(st.x, x, .3); st.depth = lerp(st.depth, depth, .3); }   // settled: the start of the push
    if (time - st.since < .3) return true;                        // let the hands settle in first
    if (!st.armed) { st.armed = true; boardDirty = true; }
    brain.techLabel = 'Two-hand push';
    if (time < brain.pushCool) return true;
    const pushedUp = up > .3 && st.x - x > .008, pushedDown = down > .3 && depth - st.depth > .006;
    if (!pushedUp && !pushedDown) return true;
    brain.pushCool = time + 1.2; brain.thrustAt = time; brain.cue = null; boardDirty = true;
    const at = st.x; st.x = x; st.depth = depth;
    if (Math.max(a.p, b.p) > 2.1 || up > 2.6 || down > 2.6) { pain(1); brain.jolt = 1; say(pick(LINES.force), { urgent: true, sfx: 'ow' }); return true; }
    const near = brain.segments.filter(seg => seg.u <= U_TOWEL && Math.abs(seg.x - at) < .07);         // about two levels either way
    const seg = near.filter(s => s.stuck && !s.cracked && s.until <= time).sort((s, t) => Math.abs(s.x - at) - Math.abs(t.x - at))[0] || nearestSeg(at);
    if (seg.stuck && !seg.cracked && guarding(seg) > .75) { for (const z of [zoneAt(seg.u, .2), zoneAt(seg.u, -.2)]) known(z); say(pick(LINES.guarded), { urgent: true }); return true; }
    if (seg.until > time) { say(pick(LINES.again), { urgent: true }); return true; }
    crackSegment(seg, { bilateral: true });
    return true;
  }
  // The neck. Take hold of his head or neck, one hand or both (a light grip is enough), and give a quick small twist:
  // 10-30 degrees in a fraction of a second. The twist is read from how your hands turn about his neck; the head turns
  // with them (as far as he lets it: about 55 degrees guarded, 85 relaxed, the end soft) and snaps a little further when
  // the joint goes. Slow gentle rocking still relaxes him first, for a bigger release.
  const neckBase = V(X0 - .1 * LEN, restTop(-.1, 0).y, 0);
  function headHold(h) {
    if (!h?.valid || h.controller) return false;
    // the palm on his neck or head, or fingers round his head (fingertips alone near the neck are hands on his upper back)
    const palm = body.worldToLocal(h.palm.clone());
    if (palm.distanceTo(headTurn.position) < .17 || segDist(palm, neckBase, headTurn.position) < .09) return true;
    return ['middle-finger-tip', 'thumb-tip', 'index-finger-phalanx-intermediate', 'ring-finger-tip'].some(n => body.worldToLocal(h.joints.get(n).clone()).distanceTo(headTurn.position) < .14);
  }
  const handM = new THREE.Matrix4(), hx = V(), hy = V(), hz = V();
  function handQuat(h) {            // the hand's orientation in his frame, from its joints
    const J = n => body.worldToLocal(h.joints.get(n).clone());
    const w = J('wrist'), m = J('middle-finger-phalanx-proximal'), i = J('index-finger-phalanx-proximal'), p = J('pinky-finger-phalanx-proximal');
    hy.subVectors(m, w).normalize(); hx.subVectors(i, p); hx.addScaledVector(hy, -hx.dot(hy)).normalize(); hz.crossVectors(hx, hy);
    return new THREE.Quaternion().setFromRotationMatrix(handM.makeBasis(hx, hy, hz));
  }
  const wrapAngle = x => Math.atan2(Math.sin(x), Math.cos(x));
  function twistAboutNeck(q0, q) {  // how far a hand has turned since q0 about his neck's long axis (x)
    const d = q.clone().multiply(q0.clone().invert());
    return wrapAngle(2 * Math.atan2(d.x, d.w));
  }
  function neckEase() {          // 0 guarding .. 1 floppy: how far he has let go of his neck, and how loose his shoulders are
    const traps = Math.max(brain.tension['traps.L'] ?? .3, brain.tension['traps.R'] ?? .3);
    return clamp(.6 * brain.neckRelax + .4 * (1 - traps), 0, 1);
  }
  function adjustNeck(H, dt, results) {
    const holds = ['left', 'right'].filter(side => headHold(H[side]));
    if (!holds.length) {
      if (brain.grip && time - brain.grip.seen > .25) { brain.grip = null; boardDirty = true; }
      if (!brain.grip) brain.neckRelax = Math.max(0, brain.neckRelax - dt * .03);        // he slowly tenses up again
      for (const r of results) if (r.part === 'torso' && r.u < -.05 && r.p > .6 && time - brain.lastNeckLine > 15) { brain.lastNeckLine = time; say(pick(LINES.neckPoke)); }
      return;
    }
    let g = brain.grip;
    if (!g) {
      g = brain.grip = { since: time, seen: time, rot0: brain.headRot, hands: '', q0: {}, base: 0, angle: 0, hist: [], cool: 0, spin: 0 };
      brain.neckRelax = Math.max(brain.neckRelax, .35 * brain.relax);                   // a good massage has already done some of it
      if (time - brain.lastNeckLine > 20) { brain.lastNeckLine = time; say(pick(LINES.neckHold)); }
      boardDirty = true;
    }
    g.seen = time;
    const hands = holds.join();
    if (g.hands !== hands) {        // a hand took hold or let go: carry on from where the head is
      g.hands = hands; g.base = g.angle; g.q0 = {};
      for (const side of holds) g.q0[side] = handQuat(H[side]);
    }
    const prevAngle = g.angle;
    g.angle = g.base + holds.reduce((sum, side) => sum + twistAboutNeck(g.q0[side], handQuat(H[side])), 0) / holds.length;
    g.spin = lerp(g.spin, (g.angle - prevAngle) / Math.max(dt, 1e-3), .5);
    g.hist.push([time, g.angle]); while (time - g.hist[0][0] > .35) g.hist.shift();
    const speed = Math.abs(g.spin), wanted = g.rot0 + g.angle;
    const ease = neckEase(), limit = .95 + .55 * ease;
    // soft end of range: past 80% of his limit the head lags your hands and never quite reaches the limit
    const k = limit * .8, m = Math.abs(wanted), shown = Math.sign(wanted) * (m < k ? m : k + (limit - k) * (1 - Math.exp(-(m - k) / (limit - k))));
    const prev = brain.headRot;
    brain.headRot = lerp(brain.headRot, shown, Math.min(1, dt * 20));
    brain.headSpin = lerp(brain.headSpin, (brain.headRot - prev) / Math.max(dt, 1e-3), .5);
    // relaxing him: slow, gentle rocking lets him go; just holding helps a little
    {
      const before = brain.neckRelax;
      if (speed > .08 && speed < 1.1) brain.neckRelax += dt * .22 * (1 - brain.neckRelax);
      else if (speed <= .08) brain.neckRelax += dt * .05 * (1 - brain.neckRelax);
      brain.neckRelax = clamp(brain.neckRelax, 0, 1);
      if (Math.round(before * 20) !== Math.round(brain.neckRelax * 20)) boardDirty = true;
      if (!brain.neckLetGo && brain.neckRelax > .75) {
        brain.neckLetGo = true; brain.melt = 1; brain.relax = Math.min(1, brain.relax + .05); brain.blissUntil = time + 2.5;
        sound('sigh'); say(pick(LINES.neckLetGo), { urgent: true });
      }
    }
    const settled = time - g.since > .3;
    brain.techLabel = !settled ? 'Neck: hold' : 'Neck: quick twist';
    if (time < g.cool || !settled) return;
    if (m > Math.min(1.62, limit + .45)) {                       // your hands went well past where he lets it go
      const dir = Math.sign(wanted) || 1;
      pain(1); brain.neckRelax = Math.max(0, brain.neckRelax - .3); brain.headRot = dir * limit * .8;
      g.rot0 = brain.headRot; g.base = g.angle = 0; g.q0 = {}; for (const side of holds) g.q0[side] = handQuat(H[side]);
      g.hist = []; g.cool = time + 1.5;
      say(pick(LINES.neckFar), { urgent: true, sfx: 'ow' }); boardDirty = true; return;
    }
    const swing = g.angle - g.hist[0][1], amplitude = Math.abs(swing);
    if (amplitude < .17 || speed < 1.8) return;                   // not a twist yet: a thrust is ~10-30 degrees in a fraction of a second
    const dir = Math.sign(swing), sideKey = dir < 0 ? 'L' : 'R', side = brain.neck[sideKey];     // the side you twist towards
    g.cool = time + 1; g.hist = [];
    if (amplitude > .95 || speed > 12) { pain(1); brain.jolt = .8; brain.neckRelax = Math.max(0, brain.neckRelax - .35); say(pick(LINES.neckRough), { urgent: true, sfx: 'ow' }); return; }
    if (side.until > time) { say(pick(LINES.again), { urgent: true }); return; }
    side.until = time + 45; brain.lastAdjust = time;
    const big = !side.cracked, loose = brain.neckRelax > .5 ? 2 : 0;    // a relaxed neck lets go with more
    crackSound(headTurn.localToWorld(V(.09, 0, 0)), big ? 3 + loose + Math.floor(Math.random() * 4) : 1 + Math.floor(Math.random() * 2), { neck: true, big });
    brain.snap = dir * (big ? .11 : .05); brain.jolt = big ? .7 : .3;
    if (big) {
      side.cracked = true; brain.relax = Math.min(1, brain.relax + .06); brain.melt = 1; brain.blissUntil = time + 4;
      if (brain.tension[`traps.${sideKey}`] != null) brain.tension[`traps.${sideKey}`] = Math.max(.05, brain.tension[`traps.${sideKey}`] - .15);
      remember('neckCrack', `they cracked the ${sideKey === 'L' ? 'left' : 'right'} side of my neck`); brain.memory.tries = 0;
      setTimeout(() => sound('sigh'), 350); say(pick(LINES.neckCrack), { urgent: true });
      if (!brain.neck[sideKey === 'L' ? 'R' : 'L'].cracked) queue(pick(LINES.neckOther), 2.5);
      finished();
    } else say(pick(LINES.little), { urgent: true });
    boardDirty = true;
  }
  function guideSeg(c, seg) {
    const dx = seg.x - c.x, lateral = Math.abs(c.z);
    if (Math.abs(dx) > .12) return `Not there. It's ${segSay(seg)}.`;
    if (Math.abs(dx) > .022) return dx < 0 ? pick(['Higher, towards my neck.', 'Up a bit.', 'One or two higher.']) : pick(['Lower down a bit.', 'Down a bit.', 'One or two lower.']);
    if (lateral < .012) return pick(['That level, but just beside the spine, not on it.', 'Right level. Slide off the bone a little.']);
    if (lateral > .06) return pick(['Right level. Closer in to the spine.', 'Bit closer to the middle.']);
    return "That's the one. Both hands there, press in, then a quick push up.";
  }

  function think(results, dt, boss) {
    const touching = results.filter(r => r.part), torsoHits = results.filter(r => r.part === 'torso');
    if (touching.length) brain.lastTouch = time;
    if (brain.phase === 'asleep' && touching.length) { brain.phase = 'done'; brain.lastTouch = time; say(pick((brain.memory.count.crack || 0) + (brain.memory.count.neckCrack || 0) >= 2 ? LINES.wakeDream : LINES.wake), { urgent: true }); brain.flinch = .4; }
    if (brain.phase === 'waiting' && (touching.length || boss < 2.4)) greet(touching.length > 0);

    for (const r of touching) {
      if (r.slap && r.tech !== 'tapping' && time - brain.lastSlap > 4) {
        brain.lastSlap = time; pain(1); if (r.part === 'torso') twitch(r.x, r.z, .012);
        remember('slap', 'they slapped my back, hard'); const n = brain.memory.count.slap;
        say(n >= 2 ? pick(LINES.slapAgain, n) : pick(LINES.slap), { urgent: true, sfx: 'ow' }); continue;
      }
      if (r.part === 'towel' && r.onset && time - brain.lastTowel > 10) { brain.lastTowel = time; brain.flinch = Math.max(brain.flinch, .4); brain.trust = Math.max(0, brain.trust - .03); say(pick(LINES.towel), { urgent: true }); }
      if (r.part === 'feet' && r.onset && time - brain.lastFeet > 6) { brain.lastFeet = time; brain.kick = 1; brain.laughUntil = time + 1.6; sound('giggle'); say(pick(LINES.feet), { urgent: true }); }
      if (r.part === 'arm' && r.onset && time - brain.lastArm > 30 && Math.random() < .5) { brain.lastArm = time; say(pick(LINES.arm)); }
      if (r.part === 'head' && !brain.grip) {
        brain.headTime += dt;
        if (brain.headTime > .8 && time - brain.lastHead > 25) { brain.lastHead = time; brain.relax = Math.min(1, brain.relax + .03); say(pick(LINES.head)); }
      }
    }
    if (!touching.some(r => r.part === 'head')) brain.headTime = 0;

    adjustNeck(window.officeDebug?.hands?.hands || {}, dt, results);
    if (brain.phase !== 'waiting') {
      sweepSpine(results);
      if (!brain.sweep?.active && pushCrack(results, dt)) brain.adj.left = brain.adj.right = null;   // two hands pushing: not a one-hand pre-load
      else adjustSpine(results, dt);
    }
    const best = [...torsoHits].sort((a, b) => b.depth - a.depth)[0];
    brain.pressure = lerp(brain.pressure, best ? best.p : 0, .2);
    for (const r of torsoHits) work(r, dt);
    if (best) {
      const label = brain.adj.left?.loaded || brain.adj.right?.loaded || brain.sweep?.active || brain.push?.armed ? brain.techLabel : TECH[best.tech].label;
      if (label !== brain.techLabel) { brain.techLabel = label; boardDirty = true; }
      // too hard, the spine, the ribs
      brain.hardTime = best.p > 1.35 ? brain.hardTime + dt : 0;                  // a moment's spike is not a complaint: it has to stay too hard
      if (brain.hardTime > .35 && time - (brain.thrustAt ?? -9) > .8 && !brain.sweep?.active) {     // a thrust is a quick impulse, not leaning: judged on its own
        if (time - brain.lastPain > 2.5) { brain.lastPain = time; pain(1); twitch(best.x, best.z, .01); if (brain.tension[best.zone] != null) brain.tension[best.zone] = Math.min(1, brain.tension[best.zone] + .08); brain.trust = Math.max(0, brain.trust - .05); remember('tooHard', `they pressed too hard on ${zoneSay(best.zone)}; it hurt`, { zone: best.zone });
          const n = brain.memory.zones[best.zone].tooHard; say(n >= 2 ? pick(LINES.owAgain, best.zone, n) : pick(LINES.ow), { urgent: true, sfx: 'ow' }); }
      } else if (best.zone === 'spine' && best.p > .55 && !(brain.adj.left || brain.adj.right || brain.push) && time - (brain.thrustAt ?? -9) > 3) {
        if (time - brain.lastSpine > 9) { brain.lastSpine = time; pain(.5); say(pick(LINES.spine), { urgent: true }); }
      }
      if (best.zone.startsWith('flank') && best.p < .3 && best.speed > .08) {
        brain.tickle += dt;
        if (brain.tickle > .5 && time - brain.lastTickle > 7) { brain.lastTickle = time; brain.tickle = 0; brain.squirm = 1; brain.laughUntil = time + 1.8; sound('giggle'); remember('tickle', 'they tickled my side'); const n = brain.memory.count.tickle; say(n >= 3 ? pick(LINES.tickleAgain, n) : pick(LINES.tickle), { urgent: true }); }
      } else brain.tickle = Math.max(0, brain.tickle - dt);
      // he remembers where it hurt: going firm there again makes him wary
      if (best.p > .95 && brain.memory.zones[best.zone]?.tooHard && time - brain.lastWary > 25 && time - brain.lastPain > 6 && !speaking()) { brain.lastWary = time; say(pick(LINES.wary, best.zone)); }
      // pressure coaching
      if (best.fit <= .15 && best.tech !== 'tapping') brain.light += dt; else brain.light = 0;
      if (brain.light > 3.5 && time - brain.lastLight > 12) { brain.lastLight = time; say(pick(LINES.light)); }
      // steering you towards the knot he's thinking about
      const focus = focusKnot(), onKnot = torsoHits.some(r => r.knot), seg = focusSeg(), loading = brain.adj.left || brain.adj.right;
      if (seg && seg.known && brain.phase === 'massage' && !loading && !brain.sweep?.active) {
        const c = best.heel || best, there = Math.abs(c.x - seg.x) < .022 && placement(c, seg) === 'tp';
        brain.offSeg = there ? 0 : brain.offSeg + dt;
        if ((there || brain.offSeg > 3) && time - brain.lastGuide > 6 && !speaking()) { brain.lastGuide = time; say(guideSeg(c, seg), { mood: 'guide' }); }
      } else if (focus && !onKnot && brain.phase === 'massage') {
        brain.offKnot += dt;
        if (brain.offKnot > 3 && time - brain.lastGuide > 6 && !speaking()) { brain.lastGuide = time; say(guide(best, focus), { mood: 'guide' }); }
      } else brain.offKnot = 0;
      // noticing what you're doing well
      if (best.tech === brain.techLast) brain.techTime += dt; else { brain.techLast = best.tech; brain.techTime = 0; }
      if (!onKnot && best.fit >= .75 && !speaking() && time - brain.lastPraise > rand(11, 16) && time - brain.lastSpoke > 5) {
        brain.lastPraise = time;
        const techLines = LINES.tech[best.tech];
        if (techLines && brain.techTime > 2.5 && !brain.techSaid.has(best.tech)) { brain.techSaid.add(best.tech); remember('technique', `their ${TECH[best.tech].label.toLowerCase()} felt great`); say(pick(techLines)); }
        else if (best.p > .95) say(pick(LINES.firm));
        else if (Math.random() < .4) vocal(pick(['hum', 'ahh']));
        else say(pick(LINES.praise, brain.tension[best.zone] != null ? best.zone : focus?.key || 'traps.L'));
      }
    } else if (brain.techLabel !== '—' && !brain.grip) { brain.techLabel = '—'; boardDirty = true; }

    if (!brain.halfSaid && brain.relax > .5 && brain.phase === 'massage' && !speaking()) { brain.halfSaid = true; say(pick(LINES.half)); }
    // you wandered off, or stopped
    if (brain.phase === 'massage') {
      if (boss > 3.5) brain.awayTime += dt; else brain.awayTime = 0;
      if (brain.awayTime > 8 && !brain.away) { brain.away = true; say(pick(LINES.away)); }
      if (brain.away && boss < 2) { brain.away = false; const k = focusKnot(); say(k?.found ? pick(LINES.backMid, k.key) : pick(LINES.back)); }
      if (!touching.length && boss < 2.6 && time - brain.lastTouch > 15 && time - brain.lastSpoke > 12) say(pick(LINES.idle, focusKnot()?.key || 'traps.L'));
    }
    if (brain.phase === 'done' && time - brain.lastTouch > 16 && time - brain.doneAt > 8 && !speaking() && !brain.queue.length) { brain.phase = 'asleep'; brain.nextSnore = time + 1; }
    if (brain.phase === 'asleep' && time > brain.nextSnore) { brain.nextSnore = time + 3.8; sound('snore'); drawBubble('Zzz...'); bubbleUntil = time + 2.6; }
    if (brain.cue && !brain.cue.saidOut && time >= brain.cue.out) { brain.cue.saidOut = true; say(pick(LINES.cueOut), { urgent: true }); }
    if (brain.cue && time > brain.cue.out + 6) brain.cue = null;
    if (brain.queue.length && !speaking() && time >= brain.queue[0].at) { const q = brain.queue.shift(); say(q.text, { mood: q.mood }); }
  }

  // ---------- the board ----------
  let boardDirty = true, boardNext = 0, contactsForBoard = [];
  function drawBoard() {
    const g = boardCanvas.getContext('2d'), Wd = 1024, Ht = 600;
    g.fillStyle = '#1d2530'; g.fillRect(0, 0, Wd, Ht);
    g.fillStyle = '#f8ce52'; g.fillRect(0, 0, Wd, 74);
    g.fillStyle = '#1d2530'; g.font = 'bold 44px system-ui, sans-serif'; g.textBaseline = 'middle'; g.fillText(`BACK CLINIC  ·  ${brain.name.toUpperCase()}`, 28, 39);
    g.textAlign = 'right'; g.font = 'bold 26px system-ui, sans-serif'; g.fillText(brain.phase === 'asleep' ? 'ASLEEP' : brain.phase === 'done' ? 'SESSION COMPLETE' : 'IN SESSION', Wd - 28, 39); g.textAlign = 'left';
    // what is left to do; the targets themselves are on his back
    {
      const X = 28; let y = 112;
      const head = (text, color = '#f8ce52') => { g.fillStyle = color; g.font = 'bold 24px system-ui, sans-serif'; g.fillText(text, X, y); y += 34; };
      const row = (mark, markColor, text) => {
        g.fillStyle = markColor; g.font = 'bold 24px system-ui, sans-serif'; g.fillText(mark, X, y);
        g.fillStyle = '#e6edf3'; g.font = '22px system-ui, sans-serif'; g.fillText(text, X + 34, y); y += 30;
      };
      head('TARGETS ARE ON HIS BACK', '#7cf0ff');
      g.fillStyle = '#9fb0c2'; g.font = '19px system-ui, sans-serif';
      ['Rings: knots. Work them till they go green.', 'Palms + arrow: press in, quick push up.', 'Hands at his neck: hold, quick twist.'].forEach(l => { g.fillText(l, X, y); y += 26; });
      y += 14; head('KNOTS');
      const knots = brain.knots.filter(k => brain.known.has(k.key) || k.found);
      if (!knots.length) row('·', '#9fb0c2', 'none mentioned yet');
      const his = t => t.replace(/my/g, 'his');
      for (const k of knots) row(k.done ? '✓' : '◎', k.done ? '#4caf50' : '#e53935', `${cap(his(zoneSay(k.key))).slice(0, 34)}${k.done ? '' : k.found ? `  ${Math.round(100 * k.progress / k.need)}%` : ''}`);
      y += 10; head('SPINE');
      const stiff = brain.segments.filter(seg => seg.stuck && (seg.known || seg.cracked));
      if (!stiff.length) row('·', '#9fb0c2', 'he will tell you where');
      for (const seg of stiff) row(seg.cracked ? '✓' : '▬', seg.cracked ? '#4caf50' : '#f5a623', `${seg.name}, ${his(segSay(seg))}`.slice(0, 40));
      y += 10; head('NECK');
      row(brain.neck.L.cracked ? '✓' : '·', brain.neck.L.cracked ? '#4caf50' : '#9fb0c2', `left side${brain.neck.L.cracked ? ' done' : ''}`);
      row(brain.neck.R.cracked ? '✓' : '·', brain.neck.R.cracked ? '#4caf50' : '#9fb0c2', `right side${brain.neck.R.cracked ? ' done' : ''}`);
    }
    // stats
    const X = 470, bar = (y, label, value, color, text) => {
      g.fillStyle = '#9fb0c2'; g.font = 'bold 22px system-ui, sans-serif'; g.fillText(label, X, y);
      g.fillStyle = '#2b3644'; g.fillRect(X, y + 18, 520, 26); g.fillStyle = color; g.fillRect(X, y + 18, 520 * clamp(value, 0, 1), 26);
      if (text) { g.fillStyle = '#ffffff'; g.font = 'bold 20px system-ui, sans-serif'; g.fillText(text, X + 10, y + 32); }
    };
    g.fillStyle = '#c9d4df'; g.font = 'italic 22px system-ui, sans-serif';
    wrapLines(g, `"${brain.story.why}"`, 520).slice(0, 2).forEach((l, i) => g.fillText(l, X, 108 + i * 28));
    bar(180, 'RELAXATION', brain.relax, '#4caf50', `${Math.round(brain.relax * 100)}%`);
    const stuck = brain.segments.filter(seg => seg.stuck), freed = stuck.filter(seg => seg.cracked).length;
    g.fillStyle = '#9fb0c2'; g.font = 'bold 22px system-ui, sans-serif'; g.fillText('SPINE', X, 250);
    g.fillStyle = '#ffffff'; g.fillText(`${freed} / ${stuck.length} stiff levels freed`, X + 90, 250);
    g.fillStyle = '#9fb0c2'; g.fillText('NECK', X, 282);
    g.fillStyle = '#ffffff'; g.fillText(`left ${brain.neck.L.cracked ? '✓' : '–'}   right ${brain.neck.R.cracked ? '✓' : '–'}`, X + 90, 282);
    if (brain.grip && !brain.cue) { g.fillStyle = brain.neckRelax > .75 ? '#4caf50' : '#f5a623'; g.fillText(`NECK ${brain.neckRelax > .75 ? 'RELAXED' : 'GUARDING'} ${Math.round(brain.neckRelax * 100)}%`, X + 300, 282); }
    const breathing = !brain.cue ? '' : time < brain.cue.out ? 'BREATHING IN' : exhaling() ? 'BREATHING OUT · NOW' : 'BREATHING OUT';
    if (breathing) { g.fillStyle = exhaling() ? '#4caf50' : '#7cf0ff'; g.font = 'bold 22px system-ui, sans-serif'; g.fillText(breathing, X + 300, 282); }
    // pressure gauge: light / good / firm / too hard
    g.fillStyle = '#9fb0c2'; g.fillText('PRESSURE', X, 308);
    const P = 1.6, seg = [[0, .3, '#5b6b7d', 'LIGHT'], [.3, .95, '#4caf50', 'GOOD'], [.95, 1.3, '#f5a623', 'FIRM'], [1.3, P, '#e53935', 'TOO HARD']];
    for (const [a, b, color, name] of seg) {
      g.fillStyle = color; g.fillRect(X + 520 * a / P, 326, 520 * (b - a) / P - 3, 26);
      g.fillStyle = '#1d2530'; g.font = 'bold 16px system-ui, sans-serif'; g.fillText(name, X + 520 * a / P + 6, 340);
    }
    const needle = X + 520 * clamp(brain.pressure, 0, P) / P; g.fillStyle = '#ffffff'; g.fillRect(needle - 3, 318, 6, 42);
    g.fillStyle = '#9fb0c2'; g.font = 'bold 22px system-ui, sans-serif'; g.fillText('TECHNIQUE', X, 398);
    g.fillStyle = '#7cf0ff'; g.font = 'bold 34px system-ui, sans-serif'; g.fillText(brain.techLabel, X + 150, 398);
    const mood = moodNow();
    g.fillStyle = '#9fb0c2'; g.font = 'bold 22px system-ui, sans-serif'; g.fillText('MOOD', X, 446);
    g.fillStyle = '#ffffff'; g.font = 'bold 30px system-ui, sans-serif'; g.fillText(mood, X + 150, 446);
    g.fillStyle = '#8796a8'; g.font = '20px system-ui, sans-serif';
    g.fillStyle = '#8796a8'; g.font = 'bold 18px system-ui, sans-serif';
    g.fillText(`VOICE: ${muted ? 'OFF (press the button by his head to turn it on)' : voiceKind === 'browser' ? 'browser speech' : voiceKind === 'mumble' ? 'mumble (no speech available)' : cloud.ok === false ? 'waiting for the office speech service' : `Gemini · ${brain.voice}`}`, X, 470);
    g.font = '20px system-ui, sans-serif';
    if (time - chat.heardAt < 10) {       // what he just heard you say
      g.fillStyle = '#7cf0ff'; g.font = 'bold 22px system-ui, sans-serif'; g.fillText('HE HEARD:', X, 500);
      g.fillStyle = '#ffffff'; g.font = 'italic 22px system-ui, sans-serif'; wrapLines(g, `"${chat.heard}"`, 520).slice(0, 2).forEach((l, i) => g.fillText(l, X, 530 + i * 28));
    } else ['Back crack: both palms on the middle of his back, press in, quick push up to his head',
      'Neck: hold his head or neck (one or both hands), quick small twist. Both sides.',
      chat.on ? `TALK: ${talkStatus()}. Just speak to him; he remembers the session.` : 'Press TALK by his head to chat with him. He remembers the session.'].forEach((l, i) => {
      g.fillStyle = i === 2 && chat.on ? '#7cf0ff' : '#8796a8'; g.fillText(l, X, 500 + i * 30);
    });
    boardTex.needsUpdate = true;
  }

  // ---------- talking to him: the TALK button, your voice and his answers ----------
  // With TALK on and you near the table, whatever you say is recorded from when you start speaking to a short pause,
  // sent to the office (/api/chat, Gemini) with who he is and his memory of the session, and he answers out loud in his
  // own voice. He does not listen while he is talking (or just after, so he never hears himself), while you are away from
  // the table, or while the office voice line to a worker is open (you are talking to them, not him).
  const CHAT_MOODS = ['chat', 'bliss', 'pain', 'laugh', 'firm', 'groggy', 'guide'];
  const chat = { on: false, state: 'off', shown: '', stream: null, src: null, node: null, sink: null, worklet: null, starting: false,
    chunks: [], pre: [], voiced: 0, speech: 0, quiet: 0, floor: .008, busy: false, available: null, retryAt: 0, deafUntil: 0, error: '', heard: '', heardAt: -99 };
  let bossNow = 99;
  function talkStatus() {
    if (!chat.on) return 'OFF';
    if (chat.error) return chat.error.toUpperCase();
    if (chat.available === false) return 'NEEDS AN OFFICE RESTART';
    return { starting: 'STARTING', listening: 'LISTENING', hearing: 'HEARING YOU', thinking: 'THINKING', his: 'HIS TURN', line: 'PAUSED: VOICE LINE ON', far: 'COME CLOSER' }[chat.state] || 'ON';
  }
  function setTalk(on) {
    chat.on = on; chat.error = ''; showTalkButton(); boardDirty = true; click(on);
    if (on) { chat.state = 'starting'; startMic(); probeChat(); } else { stopMic(); chat.chunks = []; chat.pre = []; chat.state = 'off'; }
  }
  async function startMic() {
    if (chat.stream || chat.starting || !audio()) return;
    chat.starting = true;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
      if (disposed || !chat.on) { stream.getTracks().forEach(t => t.stop()); return; }
      const src = ac.createMediaStreamSource(stream), sink = ac.createGain(); sink.gain.value = 0; sink.connect(ac.destination);
      let node = null;
      try {                          // the office's capture worklet: 16 kHz 16-bit chunks
        chat.worklet ||= ac.audioWorklet.addModule('/capture.js');
        await chat.worklet;
        node = new AudioWorkletNode(ac, 'capture');
        node.port.onmessage = e => { if (e.data instanceof ArrayBuffer) hearChunk(new Int16Array(e.data)); };
        node.port.postMessage(true);
      } catch {                      // no worklets: do the same on the main thread
        node = ac.createScriptProcessor(2048, 1, 1); const ratio = ac.sampleRate / 16000; let held = [], at = 0;
        node.onaudioprocess = e => {
          held.push(...e.inputBuffer.getChannelData(0)); const out = [];
          while (at + ratio <= held.length) { let sum = 0, n = 0; for (let i = Math.floor(at); i < Math.floor(at + ratio); i++) { sum += held[i]; n++; } out.push(clamp(Math.round(sum / n * 32767), -32768, 32767)); at += ratio; }
          const used = Math.floor(at); held.splice(0, used); at -= used;
          if (out.length) hearChunk(Int16Array.from(out));
        };
      }
      src.connect(node); node.connect(sink);
      Object.assign(chat, { stream, src, node, sink, state: 'listening' });
    } catch (error) {
      console.warn('massage chat: microphone', error);
      chat.error = /NotAllowed|denied/i.test(`${error?.name} ${error?.message}`) ? 'mic not allowed' : 'no microphone';
    } finally { chat.starting = false; boardDirty = true; }
  }
  function stopMic() {
    try { chat.node?.port?.postMessage(false); } catch {}
    for (const n of [chat.src, chat.node, chat.sink]) try { n?.disconnect(); } catch {}
    chat.stream?.getTracks().forEach(t => t.stop());
    Object.assign(chat, { stream: null, src: null, node: null, sink: null });
  }
  ctx.onCleanup(stopMic);
  function blocked() {               // why he is not listening right now, if he isn't
    if (speaking() || voiceSources.length || ttsPending || time < chat.deafUntil) return 'his';
    const line = window.officeDebug?.voice;
    if (line?.socket?.readyState === 1 && line.micEnabled) return 'line';
    if (bossNow > 3) return 'far';
    return '';
  }
  // A little voice-activity detector on 40 ms chunks: start when it is clearly louder than the room for 80 ms (keeping
  // the 320 ms before, so the first word is not clipped), stop after 0.9 s of quiet or 14 s in all.
  function hearChunk(pcm) {
    if (!chat.on || chat.available === false) return;
    let sum = 0; for (let i = 0; i < pcm.length; i++) { const v = pcm[i] / 32768; sum += v * v; }
    const rms = Math.sqrt(sum / pcm.length), dur = pcm.length / 16000;
    const why = blocked();
    if (why || chat.busy) { chat.state = why || 'thinking'; chat.chunks = []; chat.pre = []; chat.voiced = 0; return; }
    chat.floor = rms < chat.floor ? lerp(chat.floor, rms, .3) : lerp(chat.floor, rms, .01);
    const loud = rms > Math.max(.012, chat.floor * 2.8);
    if (!chat.chunks.length) {
      chat.state = 'listening'; chat.pre.push(pcm); if (chat.pre.length > 8) chat.pre.shift();
      chat.voiced = loud ? chat.voiced + dur : 0;
      if (chat.voiced >= .08) { chat.chunks = chat.pre; chat.pre = []; chat.speech = chat.voiced; chat.quiet = 0; chat.state = 'hearing'; boardDirty = true; }
      return;
    }
    chat.chunks.push(pcm);
    if (loud) { chat.speech += dur; chat.quiet = 0; } else chat.quiet += dur;
    const length = chat.chunks.length * dur;
    if (chat.quiet > .9 || length > 14) {
      const chunks = chat.chunks, speech = chat.speech;
      chat.chunks = []; chat.voiced = chat.speech = chat.quiet = 0; chat.state = 'listening';
      if (speech >= .3) sendTurn(chunks);
    }
  }
  function wavBase64(chunks) {       // 16 kHz mono 16-bit WAV, base64
    const n = chunks.reduce((s, c) => s + c.length, 0), bytes = new Uint8Array(44 + n * 2), v = new DataView(bytes.buffer);
    const str = (o, t) => { for (let i = 0; i < t.length; i++) bytes[o + i] = t.charCodeAt(i); };
    str(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); str(8, 'WAVE'); str(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, 16000, true); v.setUint32(28, 32000, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); str(36, 'data'); v.setUint32(40, n * 2, true);
    let o = 44; for (const c of chunks) for (let i = 0; i < c.length; i++, o += 2) v.setInt16(o, c[i], true);
    let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(bin);
  }
  function persona() {
    return `You are ${brain.name}, a man lying face down on a massage and chiropractic table with a towel round your waist, in a playful toy-brick office. ` +
      `The person talking to you is the therapist working on your back. Why you came in: "${brain.story.why}" ` +
      `Talk as ${brain.name}: casual, warm, a little cheeky, a bit muffled with your face in the face hole. Keep every reply to one or two short sentences, under 30 words. ` +
      'Your memory of this session is below and it is the truth about what has happened. Whenever it fits, refer back to it: what hurt, what cracked, what felt good, what is still tight, what they said earlier. ' +
      'Never claim anything happened that is not in your memory; if you do not remember something, say so. ' +
      'You can coach them: say where it is still tight. To crack your back they put both palms on the stiff level either side of your spine, press in, then a quick push up towards your head; ' +
      'for your neck they hold your head or neck and give it a quick small twist, each side. If they ask you to move or do something you cannot do lying face down, joke about it. Keep it friendly and PG.';
  }
  async function postChat(body) {
    const send = async fresh => fetch('/api/chat', { method: 'POST', body, headers: { 'Content-Type': 'application/json', 'X-Office-Token': await officeToken(fresh) } });
    let r = await send(false);
    if (r.status === 403) r = await send(true);
    return r;
  }
  async function probeChat() {        // is /api/chat there? (not until the office server restarts with it)
    try {
      const r = await postChat('{}');
      chat.available = r.status === 400 ? true : r.status === 404 ? false : chat.available;
    } catch { chat.available = null; }
    chat.retryAt = time + 30; boardDirty = true;
  }
  async function sendTurn(chunks) {
    const visit = brain.visit;
    chat.busy = true; chat.state = 'thinking'; boardDirty = true;
    if (!speaking()) { drawBubble('...'); bubbleUntil = Math.max(bubbleUntil, time + 8); }
    try {
      const r = await postChat(JSON.stringify({ persona: persona(), memory: memoryText(), history: brain.memory.chat.slice(-12), moods: CHAT_MOODS, audio: wavBase64(chunks) }));
      if (r.status === 404) { chat.available = false; chat.retryAt = time + 30; return; }
      if (!r.ok) throw Error(`chat ${r.status}: ${(await r.text()).slice(0, 160)}`);
      chat.available = true;
      const { heard = '', reply = '', mood = 'chat' } = await r.json();
      if (visit !== brain.visit || disposed) return;            // a new client came in meanwhile
      if (bubbleText === '...') bubbleUntil = time;
      if (!heard) return;
      chat.heard = heard; chat.heardAt = time; boardDirty = true;
      remember('youSaid', `they said to me: "${heard}"`); brain.memory.chat.push({ role: 'user', text: heard });
      if (!reply) return;
      brain.memory.chat.push({ role: 'character', text: reply }); if (brain.memory.chat.length > 24) brain.memory.chat.splice(0, 2);
      brain.queue = brain.queue.filter(q => time >= q.at - 1);   // he answers you before getting back to his own news
      say(reply, { urgent: true, mood: CHAT_MOODS.includes(mood) ? mood : 'chat' });
    } catch (error) {
      console.warn('massage chat', error);
      if (visit === brain.visit && bubbleText === '...') { drawBubble("Sorry, what was that? Face in the hole."); bubbleUntil = time + 3; }
    } finally { chat.busy = false; boardDirty = true; }
  }
  showTalkButton();
  root.userData.talk = { chat, setTalk, hearChunk, memoryText };      // for poking at from the console, like brain

  // ---------- targets and hand guides, drawn on his skin ----------
  // Knots he has told you about get a target ring (red, filling in as it melts, a green tick when it lets go). Stiff
  // vertebrae he has mentioned get an amber bar across the spine; the next one gets two palm prints either side of the
  // spine with an arrow towards his head (press in, push up). His neck gets two ghost hands and a twist arrow while a
  // side is left. Each mark fades while your hand is on it, so it never hides what you are doing.
  const MARK_LIFT = .0025;
  function skinHeight(x, z) {                  // body-local height of the top of his back at x, z, breathing included
    const u = clamp((x - X0) / LEN, U_LO + .03, U_TOWEL), W = profile(u)[0], n = clamp(z / W, -1, 1), top = restTop(u, n);
    return top.y + dynY(u, n, top.w);
  }
  function markCanvas(size, draw) {
    const c = document.createElement('canvas'); c.width = c.height = size; const g = c.getContext('2d');
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4; textures.push(tex);
    const redraw = (...args) => { g.clearRect(0, 0, size, size); draw(g, size, ...args); tex.needsUpdate = true; };
    return { tex, redraw };
  }
  // A patch of decal lying on his back: w along his length (x), d across (z), redrawn onto the skin as he breathes.
  // Canvas left is towards his head, canvas top is his left (your side).
  function skinMark(w, d, tex, segs = 12) {
    const geo = new THREE.PlaneGeometry(w, d, segs, segs);
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, toneMapped: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geo, mat); mesh.frustumCulled = false; mesh.renderOrder = 2; mesh.visible = false; body.add(mesh);
    const flat = Float32Array.from(geo.attributes.position.array);     // plane x, y -> his x, -z
    mesh.userData = { flat, cx: 0, cz: 0, w, d, fade: 0, want: 0 };
    return mesh;
  }
  function layOnSkin(mesh) {
    const { flat, cx, cz } = mesh.userData, P = mesh.geometry.attributes.position.array;
    for (let i = 0; i < P.length; i += 3) {
      const x = cx + flat[i], z = cz - flat[i + 1];
      P[i] = x; P[i + 1] = skinHeight(x, z) + MARK_LIFT; P[i + 2] = z;
    }
    mesh.geometry.attributes.position.needsUpdate = true;
  }
  // a hand print, fingers pointing left (towards his head), thumb towards the top or the bottom of the canvas
  function palmPrint(g, x, y, s, thumbUp, fill, line) {
    g.save(); g.translate(x, y); g.scale(s, thumbUp ? s : -s);
    g.fillStyle = fill; g.strokeStyle = line; g.lineWidth = 3 / s; g.lineJoin = 'round';
    g.beginPath(); g.roundRect(-10, -40, 100, 80, 34); g.fill(); g.stroke();                     // palm, heel on the right
    for (const [fy, len] of [[-28, 70], [-9, 80], [10, 76], [28, 60]]) { g.beginPath(); g.roundRect(-8 - len, fy - 9, len + 12, 18, 9); g.fill(); g.stroke(); }
    g.save(); g.translate(40, -36); g.rotate(-.75); g.beginPath(); g.roundRect(-10, -60, 20, 64, 10); g.fill(); g.stroke(); g.restore();   // thumb
    g.fillStyle = 'rgba(255,255,255,.55)'; g.beginPath(); g.ellipse(70, 0, 16, 26, 0, 0, Math.PI * 2); g.fill();                         // the heel: press here
    g.restore();
  }
  function arrowLeft(g, x0, x1, y, width, color) {
    g.fillStyle = color; g.beginPath();
    g.moveTo(x1, y - width / 2); g.lineTo(x0 + width * 1.4, y - width / 2); g.lineTo(x0 + width * 1.4, y - width * 1.3); g.lineTo(x0, y);
    g.lineTo(x0 + width * 1.4, y + width * 1.3); g.lineTo(x0 + width * 1.4, y + width / 2); g.lineTo(x1, y + width / 2); g.closePath(); g.fill();
  }

  // the back crack: two palms either side of the spine, heels on the stiff level, arrow towards his head
  const pushArt = markCanvas(512, g => {
    palmPrint(g, 250, 158, 1.4, true, 'rgba(124,240,255,.34)', 'rgba(255,255,255,.95)');     // heels 6 cm either side of the spine
    palmPrint(g, 250, 354, 1.4, false, 'rgba(124,240,255,.34)', 'rgba(255,255,255,.95)');
    arrowLeft(g, 30, 480, 256, 24, 'rgba(255,214,64,.95)');
    g.fillStyle = 'rgba(255,214,64,.95)'; g.font = 'bold 40px system-ui, sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.fillText('PUSH', 440, 60); g.fillText('UP', 440, 452);
  });
  const pushMark = skinMark(.32, .32, pushArt.tex); pushArt.redraw();
  const PUSH_HEEL = (250 + 70 * 1.4 - 256) / 512 * .32;   // how far the heels sit from the middle of the mark, towards his waist
  // stiff levels he has mentioned (not the one the palms are on): an amber bar across the spine; green flash when it goes
  const barArt = { amber: markCanvas(128, g => { g.fillStyle = 'rgba(245,166,35,.9)'; g.beginPath(); g.roundRect(44, 8, 40, 112, 18); g.fill(); g.strokeStyle = '#fff'; g.lineWidth = 6; g.stroke(); }),
    green: markCanvas(128, g => { g.strokeStyle = 'rgba(76,175,80,.95)'; g.lineWidth = 12; g.beginPath(); g.arc(64, 64, 48, 0, Math.PI * 2); g.stroke(); }) };
  barArt.amber.redraw(); barArt.green.redraw();
  const segMarks = new Map();       // segment name -> mark
  function segMark(seg) {
    let m = segMarks.get(seg.name);
    if (!m) { m = skinMark(.05, .1, barArt.amber.tex, 4); m.userData.cx = seg.x; m.userData.cz = 0; segMarks.set(seg.name, m); }
    return m;
  }
  // knots: a target ring per knot, filling as it melts
  const knotMarks = new Map();      // knot -> { mesh, art, drawn }
  function knotMark(k) {
    let rec = knotMarks.get(k);
    if (!rec) {
      const art = markCanvas(256, (g, S, progress, found, done) => {
        const c = S / 2;
        if (done) { g.strokeStyle = 'rgba(76,175,80,.95)'; g.lineWidth = 22; g.lineCap = 'round'; g.beginPath(); g.moveTo(70, 132); g.lineTo(110, 172); g.lineTo(190, 86); g.stroke(); return; }
        const col = progress < .5 ? '229,57,53' : progress < .85 ? '245,166,35' : '76,175,80';
        g.fillStyle = `rgba(${col},.22)`; g.beginPath(); g.arc(c, c, 100, 0, Math.PI * 2); g.fill();
        g.strokeStyle = `rgba(${col},.95)`; g.lineWidth = 12; for (const r of [100, 58]) { g.beginPath(); g.arc(c, c, r, 0, Math.PI * 2); g.stroke(); }
        g.fillStyle = `rgba(${col},.95)`; g.beginPath(); g.arc(c, c, 20, 0, Math.PI * 2); g.fill();
        if (found) { g.strokeStyle = 'rgba(255,255,255,.95)'; g.lineWidth = 14; g.beginPath(); g.arc(c, c, 80, -Math.PI / 2, -Math.PI / 2 + 2 * Math.PI * clamp(progress, 0, 1)); g.stroke(); }
      });
      const mesh = skinMark(.11, .11, art.tex, 8); mesh.userData.cx = k.x; mesh.userData.cz = k.z;
      rec = { mesh, art, drawn: '' }; knotMarks.set(k, rec);
    }
    return rec;
  }
  // the neck: two ghost hands, one either side of his head, and an arrow round the neck to show the twist
  const ghostArt = markCanvas(256, g => {
    g.save(); g.translate(128, 128); g.rotate(Math.PI / 2); g.translate(-128, -128);          // fingers up
    palmPrint(g, 112, 128, .95, true, 'rgba(124,240,255,.3)', 'rgba(255,255,255,.95)'); g.restore();
  });
  ghostArt.redraw();
  const neckGuide = new THREE.Group(); neckGuide.name = 'neck-guide'; neckGuide.visible = false; body.add(neckGuide);
  const ghostMat = new THREE.MeshBasicMaterial({ map: ghostArt.tex, transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide });
  for (const side of [1, -1]) {
    const ghost = new THREE.Mesh(new THREE.PlaneGeometry(.13, .13), ghostMat);
    ghost.position.set(headRest.x + .07, headRest.y + .05, side * .135); ghost.rotation.y = side < 0 ? Math.PI : 0;   // on the sides of his head and neck, palms in
    ghost.renderOrder = 2; neckGuide.add(ghost);
  }
  const twistMat = new THREE.MeshBasicMaterial({ color: '#ffd640', transparent: true, opacity: .9, depthWrite: false, toneMapped: false });
  {
    const R = .17, arc = 1.5;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(R, .008, 8, 48, arc), twistMat);
    ring.rotation.set(0, Math.PI / 2, Math.PI / 2 - arc / 2);               // round his neck's long axis, over the top
    const tips = new THREE.Group(); tips.add(ring);
    for (const end of [-1, 1]) {                                            // arrowheads at both ends: either way
      const a = Math.PI / 2 + end * arc / 2, cone = new THREE.Mesh(new THREE.ConeGeometry(.02, .045, 14), twistMat);
      cone.position.set(0, R * Math.sin(a), -R * Math.cos(a));
      cone.quaternion.setFromUnitVectors(V(0, 1, 0), V(0, end * Math.cos(a), end * Math.sin(a)));   // along the arc, outwards
      tips.add(cone);
    }
    tips.position.set(headRest.x + .1, headRest.y - .02, 0); neckGuide.add(tips);
  }
  // how much of each mark to show: fade under your hands, pulse to draw the eye
  function handNear(results, x, z, r) { return results.some(res => res.hand?.valid && (() => { const p = body.worldToLocal(res.hand.palm.clone()); return Math.hypot(p.x - x, p.z - z) < r && p.y < skinHeight(x, z) + .12; })()); }
  function showMark(mesh, want, dt) {
    const u = mesh.userData; u.fade = lerp(u.fade, want, Math.min(1, dt * 6));
    mesh.visible = u.fade > .02;
    if (mesh.visible) { mesh.material.opacity = u.fade; layOnSkin(mesh); }
  }
  function updateMarks(results, dt) {
    const pulse = .8 + .2 * Math.sin(time * 4), live = brain.phase !== 'waiting' && brain.phase !== 'asleep';
    // knots (a new client brings new knots: the old marks go)
    for (const [k, rec] of knotMarks) if (!brain.knots.includes(k)) { body.remove(rec.mesh); rec.mesh.geometry.dispose(); rec.mesh.material.dispose(); knotMarks.delete(k); }
    for (const k of brain.knots) {
      const rec = knotMark(k), show = live && (brain.known.has(k.key) || k.found);
      const key = k.done ? 'done' : `${k.found}|${Math.round(k.progress / k.need * 20)}`;
      if (key !== rec.drawn) { rec.drawn = key; rec.art.redraw(k.progress / k.need, k.found, k.done); if (k.done) rec.doneAt = time; }
      const want = !show ? 0 : k.done ? Math.max(0, 1 - (time - rec.doneAt) / 3) : (k.found ? 1 : pulse) * (handNear(results, k.x, k.z, .08) ? .3 : 1);
      showMark(rec.mesh, want, dt);
    }
    // the spine: palms on the next stiff level, amber bars on the others he has mentioned, a green ring as each goes
    const next = live ? focusSeg() : null;
    for (const seg of brain.segments) {
      if (seg.u > U_TOWEL) continue;
      const m = segMark(seg), justCracked = seg.cracked && time - (seg.crackedAt ?? -99) < 2.5;
      if (seg.cracked && seg.crackedAt == null) seg.crackedAt = time;
      m.material.map = justCracked ? barArt.green.tex : barArt.amber.tex;
      showMark(m, !live ? 0 : justCracked ? 1 - (time - seg.crackedAt) / 2.5 : seg.stuck && !seg.cracked && seg.known && seg !== next ? .9 : 0, dt);
    }
    const guideBack = next && next.known && !brain.push?.armed;
    if (next) { pushMark.userData.cx = next.x - PUSH_HEEL; pushMark.userData.cz = 0; }     // heels on the level, fingers up towards his head
    showMark(pushMark, guideBack ? pulse * (handNear(results, next.x - .04, 0, .14) ? .35 : 1) : 0, dt);
    // the neck, once his back is done (or as soon as you go for it), until both sides have gone
    const neckNow = live && neckLeft().length && (brain.neckAsked || !focusSeg() || brain.grip);
    const neckWant = !neckNow ? 0 : brain.grip ? .25 : pulse;
    neckGuide.userData.fade = lerp(neckGuide.userData.fade ?? 0, neckWant, Math.min(1, dt * 6));
    neckGuide.visible = neckGuide.userData.fade > .02;
    ghostMat.opacity = neckGuide.userData.fade; twistMat.opacity = .9 * neckGuide.userData.fade;
    if (neckGuide.visible) neckGuide.children[2].rotation.x = .25 * Math.sin(time * 2.2);    // the arrow rocks: twist
  }

  // ---------- keep pinches near the table from teleporting you ----------
  const guarded = new Set();
  function guardTeleport() {
    const loco = window.officeDebug?.locomotion;
    if (!loco || guarded.has(loco) || typeof loco.aimWithHand !== 'function') return;
    const original = loco.aimWithHand;
    loco.aimWithHand = function (h) {
      const p = root.worldToLocal(h.palm.clone());
      if (Math.abs(p.x) < 1.45 && Math.abs(p.z) < .85 && p.y < 1.4) return false;
      return original.call(this, h);
    };
    guarded.add(loco);
  }
  ctx.onCleanup(() => { for (const loco of guarded) delete loco.aimWithHand; });
  ctx.onCleanup(() => { try { window.speechSynthesis?.cancel(); } catch {} ac?.close().catch(() => {}); for (const t of textures) t.dispose(); });

  // ---------- every frame ----------
  const camPos = V(), camLocal = V(), headWorld = V(), tmp = V();
  let normalsTick = 0, colorsTick = 0, turn = 0, phase = 0, frames = 0;
  // Centre the table about 0.85 m ahead of your eyes, level, turned so its long side (the client's left) faces you,
  // and kept inside the Sandbox walls.
  let placed = false, placedInXR = false, xrTime = 0;
  function placeInFront(cam) {
    const office = root.parent; if (!office) return;
    office.updateWorldMatrix(true, false);
    const eye = office.worldToLocal(cam.getWorldPosition(V()));
    const fwd = cam.getWorldDirection(V()).transformDirection(office.matrixWorld.clone().invert()); fwd.y = 0;
    if (fwd.lengthSq() < 1e-4) fwd.set(0, 0, -1); fwd.normalize();
    const at = eye.addScaledVector(fwd, .85), R = SANDBOX_ROOM, margin = 1.45;
    root.position.set(clamp(at.x, R.minX + margin, R.maxX - margin), 0, clamp(at.z, R.minZ + margin, R.maxZ - margin));
    root.rotation.set(0, Math.atan2(-fwd.x, -fwd.z), 0);
  }
  brain.breath = 0; brain.hunchL = brain.hunchR = 0;
  newClient(true);
  ctx.onFrame(dt => {
    dt = Math.min(dt || .016, .05); time += dt; frames++;
    root.updateWorldMatrix(true, true);
    guardTeleport();
    const debug = window.officeDebug, cam = debug?.camera;
    if (cam) { cam.getWorldPosition(camPos); camLocal.copy(camPos); root.worldToLocal(camLocal); }
    // Spawn in front of wherever you are: once on load, and again once you have been in VR for a moment
    // (the mod can load on the flat page before you enter, and the office settles its place on the first XR frames).
    // It then stays put while you walk round it.
    const presenting = !!debug?.renderer?.xr?.isPresenting;
    xrTime = presenting ? xrTime + dt : 0;
    if (!presenting) placedInXR = false;            // each new VR session spawns it in front of you again
    if (cam && (!placed || (xrTime > .6 && !placedInXR))) { placeInFront(cam); placed = true; placedInXR = presenting; root.updateWorldMatrix(true, true); if (cam) { camLocal.copy(camPos); root.worldToLocal(camLocal); } }
    const boss = cam ? Math.hypot(camLocal.x, camLocal.z) : 99;

    // TTS that never starts (no voices in this browser): switch to the mumble for good
    if (ttsPending && !ttsPending.started && time > ttsPending.deadline) {
      const { text } = ttsPending; ttsPending = null;
      if (ttsWorks !== true) { ttsWorks = false; try { speechSynthesis.cancel(); } catch {} const length = babble(text); speakingUntil = time + length; bubbleUntil = time + length + 1.2; }
    }
    if (ttsPending?.started) speakingUntil = Math.max(speakingUntil, time + .3);
    // a Gemini line still being made: hold the floor until it starts, or give up on hearing it (it still gets cached)
    if (cloudLine && !cloudLine.heard) {
      if (time > cloudLine.deadline) { cloudLine.dropped = true; cloudLine = null; }
      else speakingUntil = Math.max(speakingUntil, time + .3);
    }
    if (cloud.ok === false && time > cloud.retryAt) { cloud.retryAt = time + 20; probeCloud(); }

    // hands
    const H = debug?.hands?.hands || {};
    const results = ['left', 'right'].map(side => readHand(H[side], track[side], dt));
    drawHand(H.left, 'left', results[0]); drawHand(H.right, 'right', results[1]);
    const onButton = (group, p) => { const l = group.worldToLocal(p.clone()); return Math.hypot(l.x, l.z) < .08 && l.y > .86 && l.y < .97; };
    let touchingVoice = false, touchingTalk = false;
    const onKey = (btn, p) => { const l = btn.parent.worldToLocal(p.clone()); return Math.hypot(l.x - btn.position.x, l.z - btn.position.z) < .07 && l.y > .86 && l.y < .97; };
    for (const h of Object.values(H)) {              // the buttons
      if (!h?.valid) continue;
      const pts = h.controller ? [h.palm] : [h.palm, h.joints.get('index-finger-tip'), h.joints.get('middle-finger-tip')];
      if (time >= buttonCool && pts.some(p => onButton(plinth, p))) {
        buttonCool = time + 2; buttonDown = 1; sound('ooh'); newClient(); drawBubble(`Hi! I'm ${brain.name}.`); bubbleUntil = time + 2;
      }
      if (pts.some(p => onKey(voiceButton, p))) touchingVoice = true;
      if (pts.some(p => onKey(talkButton, p))) touchingTalk = true;
    }
    if (touchingVoice && !voiceTouched && time >= voiceButtonCool) { voiceButtonCool = time + .4; voiceButtonDown = 1; setMuted(!muted); }   // once per press
    voiceTouched = touchingVoice;
    if (touchingTalk && !talkTouched) { talkButtonDown = 1; setTalk(!chat.on); }     // once per press
    talkTouched = touchingTalk;
    bossNow = boss;
    if (speaking() || voiceSources.length || ttsPending) chat.deafUntil = time + .5;
    if (chat.on && chat.available !== true && time > chat.retryAt) { chat.retryAt = time + 30; probeChat(); }
    if (chat.on && !chat.busy && !chat.starting) { const why = blocked(); if (why) chat.state = why; else if (chat.state !== 'hearing') chat.state = 'listening'; }
    if (talkStatus() !== chat.shown) { chat.shown = talkStatus(); boardDirty = true; }
    think(results, dt, boss);
    updateMarks(results, dt);
    contactsForBoard = results.filter(r => r.part === 'torso');

    // body: breathing, shoulders, flinches, squirms, head, feet and hands
    const asleep = brain.phase === 'asleep', avgTrap = s => brain.tension[`traps.${s}`];
    phase += dt * 2 * Math.PI * (asleep ? .17 : .27 - .09 * brain.relax);
    brain.breath = (asleep ? .009 : .004 + .006 * brain.relax) * (.5 + .5 * Math.sin(phase));
    if (brain.cue) { const c = time - brain.cue.start, out = brain.cue.out - brain.cue.start; brain.breath = c < out ? .013 * c / out : .013 * Math.max(0, 1 - (c - out) / 2.2); }   // a big breath in, then out, for the thrust
    brain.hunchL = lerp(brain.hunchL, .016 * avgTrap('L') + .006 * brain.flinch - .004 * brain.melt, dt * 3);
    brain.hunchR = lerp(brain.hunchR, .016 * avgTrap('R') + .006 * brain.flinch - .004 * brain.melt, dt * 3);
    for (const key of ['flinch', 'squirm', 'kick', 'melt', 'wiggle', 'jolt']) brain[key] = Math.max(0, brain[key] - dt * (key === 'melt' ? .3 : key === 'wiggle' ? .5 : key === 'jolt' ? 3 : 1.6));
    body.position.y = PAD + .012 * brain.flinch * brain.flinch - .009 * brain.jolt * Math.abs(Math.sin(brain.jolt * 9));   // a crack drops him into the table for a moment
    body.rotation.x = .028 * brain.squirm * Math.sin(time * 26);
    const laughing = time < brain.laughUntil, talking = speaking();
    const want = talking || laughing ? 1.1 : asleep ? .9 : time < brain.ouchUntil ? .45 : 0;
    if (brain.grip) {                                  // your hands have his head
      brain.snap *= Math.exp(-dt * 10);
      turn = -brain.headRot; headTurn.rotation.x = brain.headRot + brain.snap;
      headTurn.position.set(headRest.x, headRest.y + .05 + .015 * brain.flinch, headRest.z);
    } else {
      turn = lerp(turn, want, dt * 3.5); brain.headRot = -turn;
      headTurn.rotation.x = -turn; headTurn.position.set(headRest.x, headRest.y + .05 * Math.min(1, Math.abs(turn)) + .015 * brain.flinch, headRest.z);
    }
    headTurn.rotation.z = .12 * brain.flinch;
    for (const [i, { foot, toes }] of feet.entries()) {
      const s = i ? -1 : 1;
      foot.rotation.z = .35 * brain.flinch + .5 * brain.kick * Math.sin(time * 22 + i * 2) + .04 * Math.sin(time * .7 + i);
      toes.rotation.z = -(.25 * Math.min(1, brain.wiggle) * (.5 + .5 * Math.sin(time * 9 + i * 1.7)) + .3 * brain.flinch);
      foot.rotation.x = .05 * s * Math.sin(time * .5);
    }
    for (const rec of clientHands) poseClientHand(rec, clamp(brain.flinch + .3 * brain.squirm - .2 * brain.melt, 0, 1));   // fists on pain, open when he lets go
    // face
    const mouth = !talking ? null : ttsPending || muted ? .3 + .3 * Math.sin(time * 18) : clamp(voiceLevel() * 3, 0, 1);
    setFace(time < brain.ouchUntil ? 'ouch' : laughing ? 'laugh' : asleep ? 'sleep' : time < brain.blissUntil || brain.relax > .7 || (brain.grip && brain.neckRelax > .75) ? 'bliss' : 'calm', mouth);

    // skin: dents under your hands, dragged along with strokes, warmed where worked, twitches over knots
    const contacts = [];
    for (const r of results) if (r.part === 'torso') {
      const st = r.hand.handedness ? track[r.hand.handedness] : null, vx = st?.vx || 0, vz = st?.vz || 0;
      for (const q of r.pts) contacts.push({ x: q.x, z: q.z, r: q.r, depth: Math.min(q.depth, .034), dx: clamp(vx * .03, -.008, .008), dz: clamp(vz * .03, -.008, .008) });
    }
    const posAttr = torsoGeo.attributes.position, P = posAttr.array, colAttr = torsoGeo.attributes.color, C = colAttr.array;
    const kIn = Math.min(1, dt * 30), kOut = Math.min(1, dt * 9), active = contacts.length > 0;
    let moving = active;
    for (const k of topVerts) {
      const bx = base[k * 3], bz = base[k * 3 + 2];
      let target = 0, tx = 0, tz = 0, heat = 0;
      for (const c of contacts) {
        const ddx = bx - c.x, ddz = bz - c.z, R = c.r + .05, d2 = ddx * ddx + ddz * ddz;
        if (d2 >= R * R) continue;
        const f = (1 - d2 / (R * R)) ** 2;
        target = Math.max(target, c.depth * f * vtop[k]); tx += c.dx * f; tz += c.dz * f; heat += f;
      }
      dent[k] += (target - dent[k]) * (target > dent[k] ? kIn : kOut);
      dragX[k] += (tx - dragX[k]) * kOut; dragZ[k] += (tz - dragZ[k]) * kOut;
      if (dent[k] > .0003) moving = true;
      if (heat) warmth[k] = Math.min(1, warmth[k] + heat * dt * .18);
      let y = base[k * 3 + 1] + brain.breath * breathW[k] + (vn[k] > 0 ? brain.hunchL : brain.hunchR) * trapW[k] - dent[k];
      for (const tw of twitches) {
        const age = time - tw.t0; if (age > .6) continue;
        const ddx = bx - tw.x, ddz = bz - tw.z, d2 = ddx * ddx + ddz * ddz; if (d2 > .0036) continue;
        y += tw.amp * Math.exp(-age * 7) * Math.sin(age * 45) * (1 - d2 / .0036) * vtop[k]; moving = true;
      }
      P[k * 3] = bx + dragX[k]; P[k * 3 + 1] = y; P[k * 3 + 2] = bz + dragZ[k];
    }
    posAttr.needsUpdate = true;
    if (moving || ++normalsTick % 5 === 0) topNormals(P);
    if (active || ++colorsTick % 20 === 0) {
      const fade = active ? 1 : Math.pow(1 - .012, 20 * dt);
      for (const k of topVerts) {
        if (!active) warmth[k] *= fade;
        oilAmt[k] = Math.min(1, warmth[k] * 1.8);
        const w = warmth[k] * .4;
        for (let c = 0; c < 3; c++) C[k * 3 + c] = baseColor[k * 3 + c] * (1 - w) + (c === 0 ? flushColor.r : c === 1 ? flushColor.g : flushColor.b) * w;
      }
      colAttr.needsUpdate = true; torsoGeo.attributes.oil.needsUpdate = true;
    }

    // speech bubble over his head, facing you; the voice comes from his head
    headTurn.getWorldPosition(headWorld);
    bubble.visible = time < bubbleUntil;
    if (bubble.visible) { bubble.position.copy(root.worldToLocal(headWorld.clone())).add(tmp.set(.08, .36, .06)); if (cam) bubble.lookAt(camPos); }
    if (ac && cam) {
      const l = ac.listener, q = cam.getWorldQuaternion(new THREE.Quaternion()), fwd = V(0, 0, -1).applyQuaternion(q), up = V(0, 1, 0).applyQuaternion(q);
      if (l.positionX) { l.positionX.value = camPos.x; l.positionY.value = camPos.y; l.positionZ.value = camPos.z; l.forwardX.value = fwd.x; l.forwardY.value = fwd.y; l.forwardZ.value = fwd.z; l.upX.value = up.x; l.upY.value = up.y; l.upZ.value = up.z; }
      panner.positionX.value = headWorld.x; panner.positionY.value = headWorld.y; panner.positionZ.value = headWorld.z;
    }
    buttonDown = Math.max(0, buttonDown - dt * 4); button.position.y = .9 - .018 * buttonDown;
    voiceButtonDown = Math.max(0, voiceButtonDown - dt * 4); voiceButton.position.y = .9 - .018 * voiceButtonDown;
    talkButtonDown = Math.max(0, talkButtonDown - dt * 4); talkButton.position.y = .9 - .018 * talkButtonDown;
    if (time > boardNext && (boardDirty || contactsForBoard.length || frames % 30 === 0)) { boardNext = time + .12; boardDirty = false; drawBoard(); }
  });
}
