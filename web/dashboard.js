import { TermClient, TerminalCanvas, keyToSequence } from './termview.js';
import { OfficeVoice } from './voice.js';

const $ = id => document.getElementById(id);
const STATUS = { working: 'Working', idle: 'Idle', approval: 'Needs you', starting: 'Starting', exited: 'Stopped', stopped: 'Stopped' };
let state, voice, events;
const desks = new Map();   // id -> { worker, client, view, card }

async function api(path, method = 'GET', body) {
  const response = await fetch(path, { method, headers: { 'Content-Type': 'application/json', 'X-Office-Token': state?.token || '' }, body: body && JSON.stringify(body) });
  if (!response.ok) throw Error(await response.text());
  return response.json();
}

async function boot() {
  state = await api('/api/state');
  voice = new OfficeVoice(state, onVoice);
  $('voiceSelect').replaceChildren(...state.voices.map(v => new Option(v, v)));
  render();
  listen();
  questState();
  setInterval(questState, 5000);
}

function listen() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  events = new WebSocket(`${protocol}//${location.host}/api/events?token=${encodeURIComponent(state.token)}`);
  events.onmessage = async e => {
    const msg = JSON.parse(e.data);
    if (msg.type === 'roster') { state = { ...state, ...(await api('/api/state')) }; render(); }
    if (msg.type === 'worker') updateWorker(msg);
    if (msg.type === 'voice') $('voiceState').textContent = msg.worker ? `Voice: ${nameOf(msg.worker)}` : 'Voice off';
  };
  events.onclose = () => setTimeout(listen, 2000);
}

const nameOf = id => state.workers.find(w => w.id === id)?.name || id;

function render() {
  const keep = new Set(state.workers.map(w => w.id));
  for (const [id, desk] of desks) if (!keep.has(id)) { desk.client.close(); desk.card.remove(); desks.delete(id); }
  for (const worker of state.workers) {
    let desk = desks.get(worker.id);
    if (!desk) desk = makeDesk(worker);
    desk.worker = worker;
    desk.card.querySelector('.name').textContent = worker.name;
    desk.card.querySelector('.agent').textContent = worker.agent;
    desk.card.querySelector('.project').textContent = worker.project;
    desk.card.style.setProperty('--torso', worker.torso);
    updateWorker(worker);
  }
}

function makeDesk(worker) {
  const card = document.createElement('article');
  card.className = 'desk';
  card.innerHTML = `<header><span class="swatch"></span><div><strong class="name"></strong> <span class="agent badge"></span><div class="project muted"></div></div><span class="status"></span></header>
    <div class="screen" tabindex="0" aria-label="Terminal, click to type"></div>
    <div class="task muted"></div>
    <footer><button data-act="talk">Talk</button><button data-act="esc">Esc</button><button data-act="enter">Enter</button><button data-act="restart">Restart</button><button data-act="edit" class="ghost">Edit</button></footer>`;
  $('floor').append(card);
  const screen = card.querySelector('.screen');
  const client = new TermClient(worker.id, state.token, { onWorker: updateWorker });
  const view = new TerminalCanvas(client.model, { cell: [10, 19], font: 16, pad: 8 });
  screen.append(view.canvas);
  const desk = { worker, client, view, card };
  desks.set(worker.id, desk);
  const loop = () => { if (!desks.has(worker.id)) return; view.draw(); requestAnimationFrame(loop); };
  loop();
  screen.addEventListener('focus', () => { view.focused = true; client.model.dirty.add(client.model.cursor[1]); });
  screen.addEventListener('blur', () => { view.focused = false; client.model.dirty.add(client.model.cursor[1]); });
  screen.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') return;   // let paste through
    const data = keyToSequence(e);
    if (data !== null) { e.preventDefault(); client.input(data); }
  });
  screen.addEventListener('paste', e => { e.preventDefault(); client.input(e.clipboardData.getData('text')); });
  card.querySelector('footer').addEventListener('click', async e => {
    const act = e.target.dataset.act; if (!act) return;
    if (act === 'talk') talkTo(worker.id);
    if (act === 'esc') client.keys(['escape']);
    if (act === 'enter') client.keys(['enter']);
    if (act === 'restart') await api(`/api/terminal/restart?worker=${worker.id}`, 'POST');
    if (act === 'edit') openEditor(desks.get(worker.id).worker);
  });
  return desk;
}

function updateWorker(info) {
  const desk = desks.get(info.id); if (!desk) return;
  Object.assign(desk.worker, info);
  const status = desk.card.querySelector('.status');
  status.textContent = STATUS[info.status] || info.status; status.dataset.status = info.status;
  desk.card.querySelector('.task').textContent = info.task ? `Last task: ${info.task}` : '';
}

// ---------- voice ----------
async function talkTo(id) {
  $('talkTarget').textContent = `Connecting to ${nameOf(id)}…`;
  try { await voice.connect(id); voice.mute(false); }
  catch (error) { $('talkTarget').textContent = error.message; }
}
function onVoice(msg) {
  if (msg.type === 'ready') $('talkTarget').innerHTML = `<b>${nameOf(msg.worker)}</b> is listening. Speak normally.`;
  if (msg.type === 'closed') $('talkTarget').textContent = 'Voice line closed.';
  if (msg.type === 'transcript') {
    const who = msg.role === 'user' ? 'You' : nameOf(msg.worker);
    let line = $('transcript').lastElementChild;
    if (!line || line.dataset.role !== msg.role || line.dataset.done) {
      line = document.createElement('p'); line.dataset.role = msg.role; $('transcript').append(line);
    }
    line.innerHTML = `<b></b> `; line.firstChild.textContent = who + ':'; line.append(msg.text);
    $('transcript').scrollTop = 1e9;
  }
  if (msg.type === 'turn_complete') for (const p of $('transcript').children) p.dataset.done = '1';
  if (msg.type === 'tool') {
    const p = document.createElement('p'); p.className = 'tool';
    p.textContent = `⚙ ${msg.name} ${msg.args?.task || msg.args?.keys?.join(' ') || msg.args?.action || ''}`; $('transcript').append(p);
  }
  if (msg.type === 'usage') $('usage').textContent = `US$${msg.dailyUsd.toFixed(2)} today`;
  if (msg.type === 'notice' || msg.type === 'error') $('talkTarget').textContent = msg.text;
  if (msg.type === 'mic') $('micToggle').textContent = msg.enabled ? 'Mute mic' : 'Unmute mic';
}
$('micToggle').onclick = () => voice.mute(voice.micEnabled);
$('hangUp').onclick = () => voice.stop();
$('say').onsubmit = e => { e.preventDefault(); const text = $('sayText').value.trim(); if (text && voice.ready) { voice.text(text); $('sayText').value = ''; } };

// ---------- Quest link ----------
async function questState() {
  try { showQuest(await api('/api/quest/state')); } catch {}
}
function showQuest(info) {
  $('questDetails').hidden = !info.url;
  $('questUrl').textContent = info.url || ''; $('questUrl').href = info.url || '#';
  $('questCode').textContent = info.code || 'expired';
  $('questStart').disabled = !!info.url;
  $('questStart').textContent = info.url ? 'Link is open' : 'Create Quest link';
}
async function questAction(name) {
  $('questNotice').textContent = name === 'start' ? 'Opening a Cloudflare link…' : '';
  try { showQuest(await api('/api/quest/' + name, 'POST')); $('questNotice').textContent = ''; }
  catch (error) { $('questNotice').textContent = error.message; }
}
$('questStart').onclick = () => questAction('start');
$('questRenew').onclick = () => questAction('renew');
$('questStop').onclick = () => questAction('stop');
$('questCopy').onclick = () => navigator.clipboard.writeText($('questUrl').href);

// ---------- hiring ----------
function openEditor(worker) {
  const form = $('workerForm');
  const value = worker || { id: '', name: '', agent: 'claude', project: '', voice: 'Puck', torso: '#2280ba', legs: '#283a52', hair: '#2a2018', persona: 'Friendly, focused and a little funny. Calls the user "boss".', args: [] };
  for (const el of form.elements) if (el.name && el.name in value) el.value = Array.isArray(value[el.name]) ? value[el.name].join(' ') : value[el.name];
  form.elements.id.readOnly = !!worker;
  $('editorTitle').textContent = worker ? `Edit ${worker.name}` : 'Hire a worker';
  $('fire').hidden = !worker; $('editorError').textContent = '';
  $('editor').showModal();
}
$('hire').onclick = () => openEditor(null);
$('saveWorker').onclick = async e => {
  e.preventDefault();
  const form = $('workerForm'); if (!form.reportValidity()) return;
  const data = Object.fromEntries(new FormData(form));
  data.args = data.args.split(' ').filter(Boolean);
  try { state = { ...state, ...(await api('/api/workers', 'POST', data)) }; render(); $('editor').close(); }
  catch (error) { $('editorError').textContent = error.message; }
};
$('fire').onclick = async () => {
  const id = $('workerForm').elements.id.value;
  try { state = { ...state, ...(await api(`/api/workers?worker=${id}`, 'DELETE')) }; render(); $('editor').close(); }
  catch (error) { $('editorError').textContent = error.message; }
};

boot().catch(error => { document.body.insertAdjacentHTML('afterbegin', `<p class="fatal">${error.message}</p>`); });
