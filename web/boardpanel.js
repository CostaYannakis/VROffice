// Project board on the PC dashboard: the same cards as the whiteboard in the office. Add a project, change its status or owner,
// or remove it; every open office (and the headset whiteboard) redraws when the server broadcasts the change.
const $ = id => document.getElementById(id);
const STATUSES = [['todo', 'To do'], ['doing', 'Doing'], ['blocked', 'Blocked'], ['done', 'Done']];
let token = '', owners = ['You', 'Both'];

async function api(path, method = 'GET', body) {
  const r = await fetch(path, { method, headers: { 'Content-Type': 'application/json', 'X-Office-Token': token }, body: body && JSON.stringify(body) });
  if (!r.ok) throw Error(await r.text());
  return r.json();
}
const option = (value, text, selected) => Object.assign(document.createElement('option'), { value, textContent: text, selected });

async function render() {
  const { projects } = await api('/api/projects'), list = $('board');
  list.replaceChildren();
  for (const p of projects) {
    const card = document.createElement('div'); card.className = 'board-card';
    const title = document.createElement('b'); title.textContent = p.title;
    const detail = document.createElement('small'); detail.className = 'muted';
    detail.textContent = p.blocker ? `Blocked: ${p.blocker}` : p.next_step ? `Next: ${p.next_step}` : p.summary;
    const status = document.createElement('select'); STATUSES.forEach(([v, t]) => status.append(option(v, t, v === p.status)));
    const owner = document.createElement('select'); [...new Set([...owners, p.owner])].forEach(v => owner.append(option(v, v, v === p.owner)));
    const remove = Object.assign(document.createElement('button'), { textContent: '✕', className: 'ghost', title: 'Remove card' });
    const save = async body => { try { await api(`/api/projects/${p.id}`, 'PATCH', { ...body, version: p.version }); } catch (e) { $('boardError').textContent = e.message; } await render(); };
    status.onchange = () => save({ status: status.value });
    owner.onchange = () => save({ owner: owner.value });
    remove.onclick = async () => { if (!confirm(`Remove "${p.title}" from the board?`)) return; try { await api(`/api/projects/${p.id}`, 'DELETE', { version: p.version }); } catch (e) { $('boardError').textContent = e.message; } await render(); };
    const row = document.createElement('div'); row.className = 'row'; row.append(status, owner, remove);
    card.append(title, detail, row); list.append(card);
  }
  if (!projects.length) list.textContent = 'No projects yet.';
}

async function boot() {
  const state = await api('/api/state');
  token = state.token; owners = ['You', 'Both', ...state.workers.map(w => w.name)];
  $('boardAdd').onsubmit = async e => {
    e.preventDefault(); $('boardError').textContent = '';
    const title = $('boardTitle').value.trim(); if (!title) return;
    try { await api('/api/projects', 'POST', { title, status: 'todo', owner: 'Both' }); $('boardTitle').value = ''; } catch (error) { $('boardError').textContent = error.message; }
    await render();
  };
  const listen = () => {
    const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/api/events?token=${encodeURIComponent(token)}`);
    ws.onmessage = e => { if (JSON.parse(e.data).type === 'projects') render(); };
    ws.onclose = () => setTimeout(listen, 2000);
  };
  listen(); await render();
}
boot().catch(error => { $('boardError').textContent = error.message; });
