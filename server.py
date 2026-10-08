"""Brick Office server.

- One real ConPTY terminal per worker (Claude Code, Codex or PowerShell) in that worker's project.
- Terminal screens stream to the desktop dashboard and to the monitors on the Quest desks.
- One Gemini Live voice connection at a time, attached to the worker you are talking to (a Gemini API key, or Vertex AI
  with Google Application Default Credentials; with neither, everything but voice works).
  The voice model has tools to type tasks into its terminal, read the screen and press keys.
- The Quest reaches this PC through a paired Cloudflare Quick Tunnel (see access.py).

Credentials stay in this process: a Gemini API key or Google ADC for voice; Claude/Codex use their own logins.
"""
import asyncio
import contextlib
import datetime
import json
import math
import os
import re
import importlib
import secrets
import sqlite3
import subprocess
import sys
import time
from collections import defaultdict
from pathlib import Path

from aiohttp import web, WSMsgType
from google import genai
from google.genai import types
import google.auth
import google.auth.exceptions
from google.auth.transport.requests import Request

import workers as roster
from access import QuestAccess
from terminals import KEYS, Terminal

ROOT = Path(__file__).resolve().parent
WEB = ROOT / 'web'


def load_env():
    env_file = ROOT / '.env'
    if env_file.exists():
        for line in env_file.read_text(encoding='utf-8').splitlines():
            if '=' in line and not line.lstrip().startswith('#'):
                key, value = line.split('=', 1)
                os.environ.setdefault(key.strip(), value.strip().strip('"'))


load_env()
API_KEY = os.getenv('OFFICE_GEMINI_API_KEY') or os.getenv('GEMINI_API_KEY') or os.getenv('GOOGLE_API_KEY') or ''
PROJECT = os.getenv('OFFICE_GOOGLE_PROJECT', '')   # empty: the project of your Google Application Default Credentials
LOCATION = os.getenv('OFFICE_GOOGLE_LOCATION', 'us-central1')
MODEL = os.getenv('OFFICE_VOICE_MODEL', 'gemini-3.8-live')
PORT = int(os.getenv('OFFICE_PORT', '8120'))
SESSION_LIMIT = float(os.getenv('OFFICE_SESSION_USD', '1.0'))
DAILY_LIMIT = float(os.getenv('OFFICE_DAILY_USD', '5.0'))
SESSION_MINUTES = float(os.getenv('OFFICE_SESSION_MINUTES', '15'))
IDLE_SECONDS = float(os.getenv('OFFICE_IDLE_SECONDS', '120'))


def lasting_token():
    """The pages' API token is kept in data/, so an open headset session keeps working across a server restart."""
    path = ROOT / 'data' / 'session-token'
    with contextlib.suppress(OSError):
        if token := path.read_text(encoding='utf-8').strip():
            return token
    token = secrets.token_urlsafe(32)
    path.parent.mkdir(exist_ok=True)
    path.write_text(token, encoding='utf-8')
    return token


TOKEN = lasting_token()
APPROVING_KEYS = {'enter', 'y', '1', '2', '3', '4', 'space', 'tab'}
# The boss must have given a spoken (or typed) decision after the prompt appeared.
CONSENT = re.compile(r"\b(yes|yeah|yep|yup|sure|ok|okay|go ahead|approve|approved|do it|proceed|trust it|allow it|confirm|accept|skip|decline|cancel|choose|pick|select|option|press|first|second|third|one|two|three|four)\b", re.I)
PERFORM = ['dance', 'wave', 'celebrate', 'point', 'stand', 'sit', 'facepalm', 'shrug', 'bow']
PHYSICAL = {
    'slapped': 'The boss just slapped you{detail}. React instantly and briefly, in character.',
    'poked': 'The boss poked you. React briefly.',
    'patted': 'The boss gave you a friendly pat on the head. React briefly.',
    'blasted': 'The boss just zapped you with a toy laser blaster. React instantly and briefly, in character.',
    'lifted': 'The boss has grabbed you and lifted you off the ground. React briefly.',
    'dropped': 'The boss dropped you on the floor. Pick yourself up with a brief remark.',
    'thrown': 'The boss threw you across the room. React briefly and dramatically.',
    'led': 'The boss has taken your hand and is leading you around, perhaps to dance. Play along briefly.',
    'dance': 'The boss started an office dance party and you are dancing. Say something short and fun.',
    'approached': 'The boss has just walked up to your desk. Greet them in a few words, and mention anything important from your terminal, such as a finished task or a pending approval.',
}

(ROOT / 'data').mkdir(exist_ok=True)
LAYOUT_FILE = ROOT / 'data' / 'layout.json'


def load_layout():
    try:
        return json.loads(LAYOUT_FILE.read_text(encoding='utf-8'))
    except (OSError, ValueError):
        return {}


# Where the desks stand, shared by every open office page (desktop preview and headset) so a move shows up everywhere live.
desk_layout = load_layout()
db = sqlite3.connect(ROOT / 'data/office.sqlite3')
db.executescript('''
CREATE TABLE IF NOT EXISTS memories(id INTEGER PRIMARY KEY, worker TEXT, text TEXT, created TEXT, UNIQUE(worker, text));
CREATE TABLE IF NOT EXISTS messages(id INTEGER PRIMARY KEY, worker TEXT, role TEXT, text TEXT, created TEXT);
CREATE TABLE IF NOT EXISTS usage(id INTEGER PRIMARY KEY, day TEXT, usd REAL);
CREATE TABLE IF NOT EXISTS projects(
    id INTEGER PRIMARY KEY, title TEXT NOT NULL UNIQUE, status TEXT NOT NULL,
    owner TEXT NOT NULL, summary TEXT NOT NULL, next_step TEXT NOT NULL,
    blocker TEXT NOT NULL, updated_by TEXT NOT NULL, updated_at TEXT NOT NULL,
    version INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS board_meta(key TEXT PRIMARY KEY, value TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS worklog(id INTEGER PRIMARY KEY, worker TEXT, task TEXT, status TEXT, started TEXT, finished TEXT, outcome TEXT);''')
# Tasks still open from before a restart will never report back: their terminals were restarted.
db.execute("UPDATE worklog SET status='interrupted', finished=? WHERE status IN ('working','needs approval')", (datetime.datetime.now().isoformat(),))
db.commit()
if not db.execute("SELECT 1 FROM board_meta WHERE key='seeded'").fetchone():
    db.execute('''INSERT OR IGNORE INTO projects(title,status,owner,summary,next_step,blocker,updated_by,updated_at)
                  VALUES (?,?,?,?,?,?,?,?)''',
               ('Brick Office', 'doing', 'Both', 'Mixed reality office with live worker terminals.',
                '', '', 'System', datetime.datetime.now(datetime.timezone.utc).isoformat()))
    db.execute("INSERT INTO board_meta(key,value) VALUES ('seeded','1')")
    db.commit()

PROJECT_FIELDS = {'title': 100, 'summary': 500, 'next_step': 300, 'blocker': 300}
PROJECT_STATUSES = {'todo', 'doing', 'blocked', 'done'}
BASE_OWNERS = {'You', 'Both'}


def project_owners():
    """Who can own a card: you, any worker by name, or Both (shared)."""
    return BASE_OWNERS | {w['name'] for w in staff.values()}


def projects():
    db.row_factory = sqlite3.Row
    try:
        rows = db.execute('SELECT * FROM projects ORDER BY id').fetchall()
        return [dict(row) for row in rows]
    finally:
        db.row_factory = None


def project_values(body, existing=None):
    result = dict(existing or {})
    for field, limit in PROJECT_FIELDS.items():
        if field in body:
            value = str(body[field]).strip()
            if len(value) > limit:
                raise ValueError(f'{field.replace("_", " ").title()} must be {limit} characters or fewer.')
            result[field] = value
    if not result.get('title'):
        raise ValueError('Project title is required.')
    for field, allowed in (('status', PROJECT_STATUSES), ('owner', project_owners())):
        if field in body:
            result[field] = str(body[field])
        elif field not in result:
            result[field] = 'todo' if field == 'status' else 'Both'
        if result[field] not in allowed:
            raise ValueError(f'Invalid {field}.')
    for field in ('summary', 'next_step', 'blocker'):
        result.setdefault(field, '')
    return result


def save_project(body, actor, project_id=None, version=None):
    existing = None
    if project_id is not None:
        existing = next((p for p in projects() if p['id'] == project_id), None)
        if not existing:
            raise LookupError('Project not found.')
        if version is not None and existing['version'] != version:
            raise RuntimeError('This card changed elsewhere. Reload the board and try again.')
    values = project_values(body, existing)
    stamp = datetime.datetime.now(datetime.timezone.utc).isoformat()
    try:
        if existing:
            db.execute('''UPDATE projects SET title=?,status=?,owner=?,summary=?,next_step=?,blocker=?,
                          updated_by=?,updated_at=?,version=version+1 WHERE id=?''',
                       (values['title'], values['status'], values['owner'], values['summary'],
                        values['next_step'], values['blocker'], actor, stamp, project_id))
        else:
            cursor = db.execute('''INSERT INTO projects(title,status,owner,summary,next_step,blocker,updated_by,updated_at)
                                   VALUES (?,?,?,?,?,?,?,?)''',
                                (values['title'], values['status'], values['owner'], values['summary'],
                                 values['next_step'], values['blocker'], actor, stamp))
            project_id = cursor.lastrowid
        db.commit()
    except sqlite3.IntegrityError:
        raise ValueError('A project with that title already exists.')
    return next(p for p in projects() if p['id'] == project_id)

access = QuestAccess(ROOT, PORT, TOKEN)

def voice_client():
    """The Gemini client for the voice line and the Google credentials to refresh (None with an API key), or
    (None, None, reason) when neither an API key nor Application Default Credentials are set up."""
    if API_KEY:
        return genai.Client(api_key=API_KEY, http_options=types.HttpOptions(api_version='v1beta')), None, ''
    try:
        creds, adc_project = google.auth.default(scopes=['https://www.googleapis.com/auth/cloud-platform'])
    except google.auth.exceptions.DefaultCredentialsError:
        return None, None, ('Voice is off: put GEMINI_API_KEY=<your key> in the .env file next to server.py '
                            '(or log in with gcloud for Vertex AI), then restart the office.')
    return (genai.Client(vertexai=True, project=PROJECT or adc_project, location=LOCATION, credentials=creds,
                         http_options=types.HttpOptions(api_version='v1beta1')), creds, '')


client, credentials, VOICE_OFF = voice_client()

staff = {}          # id -> worker config
terms = {}          # id -> Terminal
pumps = {}          # id -> asyncio.Task
listeners = set()   # /api/events sockets
unreported = {}     # id -> note for the next voice connection
voice = {'ws': None, 'worker': None, 'notify': None}


class AuthRequest(Request):
    def __call__(self, *args, **kwargs):
        kwargs['timeout'] = 8
        return super().__call__(*args, **kwargs)


# ---------------- memory and usage ----------------
def memories(worker):
    return [dict(id=r[0], text=r[1]) for r in db.execute(
        'SELECT id,text FROM memories WHERE worker=? ORDER BY id DESC LIMIT 50', (worker,))]


def save_memory(worker, text):
    text = str(text).strip()[:400]
    if text:
        db.execute('INSERT OR IGNORE INTO memories(worker,text,created) VALUES (?,?,?)',
                   (worker, text, datetime.datetime.now().isoformat()))
        db.commit()
    return memories(worker)


def compile_memory_markdown():
    """Refresh a readable shared digest from explicitly saved memory points."""
    rows = db.execute(
        'SELECT worker,text,created FROM memories ORDER BY worker COLLATE NOCASE,id'
    ).fetchall()
    grouped = defaultdict(list)
    for worker_id, text, created in rows:
        grouped[worker_id].append((text, created))

    lines = [
        '# Shared Office Memory',
        '',
        '> Compiled from saved discussion points. Conversation transcripts are not included.',
        '',
        f'_Last compiled: {datetime.datetime.now().astimezone().isoformat(timespec="minutes")}_',
        '',
    ]
    if not rows:
        lines.extend(['_No saved discussion points yet._', ''])
    for worker_id, entries in grouped.items():
        worker = staff.get(worker_id, {})
        lines.extend([f'## {worker.get("name", worker_id)}', ''])
        for text, created in entries:
            date = created[:10] if created else ''
            lines.append(f'- {text}' + (f' _(saved {date})_' if date else ''))
        lines.append('')

    target = ROOT / 'data' / 'MEMORY.md'
    target.write_text('\n'.join(lines), encoding='utf-8')
    return target


def log_task(worker, task):
    db.execute('INSERT INTO worklog(worker,task,status,started) VALUES (?,?,?,?)',
               (worker, str(task).strip()[:500], 'working', datetime.datetime.now().isoformat()))
    db.commit()


def settle_task(worker, status, outcome=''):
    """Close (or mark) the worker's newest open task in the work log."""
    row = db.execute("SELECT id FROM worklog WHERE worker=? AND status IN ('working','needs approval') ORDER BY id DESC LIMIT 1", (worker,)).fetchone()
    if not row:
        return
    finished = datetime.datetime.now().isoformat() if status != 'needs approval' else None
    db.execute('UPDATE worklog SET status=?, finished=COALESCE(?, finished), outcome=? WHERE id=?', (status, finished, outcome[:600], row[0]))
    db.commit()


def ago(stamp):
    try:
        seconds = (datetime.datetime.now() - datetime.datetime.fromisoformat(stamp).replace(tzinfo=None)).total_seconds()
    except (TypeError, ValueError):
        return ''
    for limit, unit, size in ((90, 'just now', 0), (5400, 'min', 60), (129600, 'h', 3600)):
        if seconds < limit:
            return unit if not size else f'{round(seconds / size)} {unit} ago'
    return f'{round(seconds / 86400)} days ago'


def work_history(worker, limit=8):
    """The worker's recent tasks and how they ended: what they did, even across restarts and long gaps."""
    rows = db.execute('SELECT task,status,started,outcome FROM worklog WHERE worker=? ORDER BY id DESC LIMIT ?', (worker, limit)).fetchall()
    return '\n'.join(f'- {ago(started)} [{status}] {task}' + (f' -> {outcome}' if outcome else '') for task, status, started, outcome in reversed(rows))


def screen_outcome(text):
    """A short, speakable tail of the terminal: the last few non-empty lines."""
    lines = [l.strip() for l in text.splitlines() if l.strip() and not set(l.strip()) <= set('─━-=│|>_ ')]
    return ' / '.join(lines[-4:])[-400:]


def board_summary():
    cards = projects()
    if not cards:
        return ''
    return '\n'.join(f"- #{p['id']} {p['title']} [{p['status']}, {p['owner']}]" + (f" next: {p['next_step']}" if p['next_step'] else '')
                     + (f" BLOCKED: {p['blocker']}" if p['blocker'] else '') for p in cards[:20])


def conversation(worker, limit=14):
    """Recent exchanges worth remembering: greetings and cut-off fragments are dropped, repeats collapsed."""
    rows = db.execute('SELECT role,text,created FROM messages WHERE worker=? ORDER BY id DESC LIMIT 80', (worker,)).fetchall()
    kept, seen = [], set()
    for role, text, created in rows:
        words = text.split()
        key = (role, text.strip().lower())
        if key in seen or (role != 'user' and len(words) < 4) or (role == 'user' and len(words) < 2):
            continue
        if role != 'user' and re.match(r"(?i)^(good )?(morning|hello|hi|hey)[, !]", text) and len(words) < 18:
            continue
        seen.add(key)
        kept.append(f"[{ago(created)}] {'boss' if role == 'user' else 'you'}: {text.strip()}")
        if len(kept) >= limit:
            break
    return '\n'.join(reversed(kept))[-3500:], (rows[0][2] if rows else None)


def daily():
    return db.execute('SELECT COALESCE(SUM(usd),0) FROM usage WHERE day=?',
                      (datetime.date.today().isoformat(),)).fetchone()[0]


def recent(worker, limit=10):
    rows = db.execute('SELECT role,text FROM (SELECT * FROM messages WHERE worker=? ORDER BY id DESC LIMIT ?) ORDER BY id',
                      (worker, limit))
    return [dict(role=r[0], text=r[1]) for r in rows]


# ---------------- terminals ----------------
def terminal_event(term, kind, **info):
    """Called on the loop whenever a terminal changes state."""
    asyncio.get_running_loop().create_task(broadcast({'type': 'worker', **term.info()}))
    note = None
    if kind == 'task_done':
        note = f'Your terminal agent finished the task "{(term.task or "")[:200]}".'
        settle_task(term.id, 'done', screen_outcome(term.text(last=12)))
    elif kind == 'approval':
        note = 'Your terminal is waiting for an approval or trust decision.'
        settle_task(term.id, 'needs approval', screen_outcome(term.text(last=8)))
    if not note:
        return
    if voice['worker'] == term.id and voice['notify']:
        voice['notify'](note + ' Tell the boss briefly. Screen tail: ' + term.text(last=18)[-1500:])
    else:
        unreported[term.id] = note


def start_terminal(worker):
    old = terms.pop(worker['id'], None)
    if old:
        old.stop()
    if worker['id'] in pumps:
        pumps.pop(worker['id']).cancel()
    args = list(worker.get('args', []))
    if worker['agent'] == 'claude' and not worker.get('command') and Path(worker['project']).resolve() != ROOT and '--add-dir' not in args:
        args += ['--add-dir', str(MODS)]   # let a Claude Code agent working on another project write office mods
    term = Terminal(worker['id'], worker['agent'], worker['project'], worker.get('command'), args, terminal_event)
    if old:
        term.subscribers = old.subscribers
    terms[worker['id']] = term
    term.start()
    pumps[worker['id']] = asyncio.get_running_loop().create_task(term.pump())
    return term


async def broadcast(message):
    for ws in list(listeners):
        try:
            await ws.send_json(message)
        except Exception:
            listeners.discard(ws)


def worker_state(worker_id):
    term = terms.get(worker_id)
    return {**roster.public(staff[worker_id]), **(term.info() if term else {'status': 'stopped'})}


def office_state():
    return dict(token=TOKEN, workers=[worker_state(i) for i in staff], voices=roster.VOICES, model=MODEL,
                dailyUsd=daily(), sessionLimit=SESSION_LIMIT, dailyLimit=DAILY_LIMIT,
                voiceWorker=voice['worker'], keys=sorted(KEYS), perform=PERFORM, layout=desk_layout)


def requested_worker(request):
    worker_id = request.query.get('worker', '')
    if worker_id not in staff:
        raise web.HTTPNotFound(text='Unknown worker')
    return worker_id


# ---------------- HTTP API ----------------
async def get_state(request):
    return web.json_response(office_state())


async def projects_api(request):
    if request.method == 'GET':
        return web.json_response({'projects': projects()})
    try:
        card = save_project(await request.json(), 'You')
    except ValueError as error:
        raise web.HTTPBadRequest(text=str(error))
    await broadcast({'type': 'projects'})
    return web.json_response(card, status=201)


async def project_api(request):
    try:
        project_id = int(request.match_info['id'])
    except ValueError:
        raise web.HTTPBadRequest(text='Invalid project ID.')
    body = await request.json()
    try:
        version = int(body['version'])
    except (KeyError, ValueError, TypeError):
        raise web.HTTPBadRequest(text='Project version is required.')
    current = next((p for p in projects() if p['id'] == project_id), None)
    if not current:
        raise web.HTTPNotFound(text='Project not found.')
    if current['version'] != version:
        raise web.HTTPConflict(text='This card changed elsewhere. Reload the board and try again.')
    if request.method == 'DELETE':
        db.execute('DELETE FROM projects WHERE id=?', (project_id,))
        db.commit()
        card = {'deleted': project_id}
    else:
        try:
            card = save_project(body, 'You', project_id, version)
        except ValueError as error:
            raise web.HTTPBadRequest(text=str(error))
        except RuntimeError as error:
            raise web.HTTPConflict(text=str(error))
    await broadcast({'type': 'projects'})
    return web.json_response(card)


async def save_worker(request):
    body = await request.json()
    try:
        worker = roster.validate(body)
    except ValueError as e:
        raise web.HTTPBadRequest(text=str(e))
    previous = staff.get(worker['id'])
    staff[worker['id']] = worker
    roster.save(list(staff.values()))
    relaunch = not previous or any(previous.get(k) != worker.get(k) for k in ('agent', 'project', 'args', 'command'))
    if relaunch:
        start_terminal(worker)
    await broadcast({'type': 'roster'})
    return web.json_response(office_state())


async def delete_worker(request):
    worker_id = requested_worker(request)
    if voice['worker'] == worker_id and voice['ws']:
        await voice['ws'].close()
    terms.pop(worker_id).stop()
    pumps.pop(worker_id).cancel()
    staff.pop(worker_id)
    roster.save(list(staff.values()))
    await broadcast({'type': 'roster'})
    return web.json_response(office_state())


def desk_spots(raw):
    if not isinstance(raw, dict) or len(raw) > 64:
        raise ValueError('bad desk list')
    spots = {}
    for desk_id, spot in raw.items():
        x, z, yaw = (float(spot[k]) for k in ('x', 'z', 'yaw'))
        if not all(map(math.isfinite, (x, z, yaw))) or abs(x) > 50 or abs(z) > 50:
            raise ValueError('bad desk spot')
        spots[str(desk_id)[:64]] = {'x': x, 'z': z, 'yaw': yaw}
    return spots


# Desk moves: sent about ten times a second while a desk is being dragged (final=false), and once more on release (final=true).
# Every move is passed on to the other pages at once; only the final one is written to disk.
async def save_layout(request):
    body = await request.json()
    try:
        spots = {'desks': desk_spots(body.get('desks', {})), 'emptyDesks': desk_spots(body.get('emptyDesks', {}))}
    except (TypeError, ValueError, KeyError, AttributeError) as e:
        raise web.HTTPBadRequest(text=str(e))
    final = bool(body.get('final', True))
    desk_layout.update(spots)
    if final:
        LAYOUT_FILE.write_text(json.dumps(desk_layout), encoding='utf-8')
    await broadcast({'type': 'layout', 'client': str(body.get('client', ''))[:32], 'final': final, **spots})
    return web.json_response({'ok': True})


async def restart_terminal(request):
    worker_id = requested_worker(request)
    start_terminal(staff[worker_id])
    return web.json_response(worker_state(worker_id))


async def memory_api(request):
    if request.method == 'GET' and request.query.get('export') == 'markdown':
        target = compile_memory_markdown()
        return web.FileResponse(target, headers={'Content-Disposition': 'attachment; filename="MEMORY.md"'})
    if request.method == 'GET' and request.query.get('shared') == '1':
        return web.json_response({'memories': [
            {'worker': worker, 'text': text, 'created': created}
            for worker, text, created in db.execute(
                'SELECT worker,text,created FROM memories ORDER BY id DESC LIMIT 200'
            )
        ]})
    worker_id = requested_worker(request)
    if request.method == 'GET':
        return web.json_response({'memories': memories(worker_id), 'history': recent(worker_id, 30)})
    body = await request.json()
    if request.method == 'POST':
        save_memory(worker_id, body.get('text', ''))
        compile_memory_markdown()
    elif body.get('all'):
        db.execute('DELETE FROM memories WHERE worker=?', (worker_id,))
        db.execute('DELETE FROM messages WHERE worker=?', (worker_id,))
        db.commit()
        compile_memory_markdown()
    else:
        db.execute('DELETE FROM memories WHERE id=? AND worker=?', (int(body['id']), worker_id))
        db.commit()
        compile_memory_markdown()
    return web.json_response({'memories': memories(worker_id), 'history': recent(worker_id, 30)})


async def term_socket(request):
    """Live screen for one worker. Clients may type into it (the dashboard keyboard, VR key strip)."""
    worker_id = requested_worker(request)
    if request.query.get('token') != TOKEN:
        raise web.HTTPForbidden()
    ws = web.WebSocketResponse(heartbeat=20, max_msg_size=65536)
    await ws.prepare(request)
    term = terms[worker_id]
    await ws.send_json({'type': 'worker', **term.info()})
    await ws.send_json(term.snapshot(full=True))
    term.subscribers.add(ws)
    try:
        async for msg in ws:
            if msg.type != WSMsgType.TEXT:
                continue
            body = json.loads(msg.data)
            term = terms.get(worker_id)
            if not term:
                break
            if body.get('type') == 'input':
                term.write(str(body.get('data', ''))[:8000])
            elif body.get('type') == 'keys':
                term.press(body.get('keys', [])[:12])
            elif body.get('type') == 'refresh':
                await ws.send_json(term.snapshot(full=True))
    finally:
        if worker_id in terms:
            terms[worker_id].subscribers.discard(ws)
    return ws


async def events_socket(request):
    if request.query.get('token') != TOKEN:
        raise web.HTTPForbidden()
    ws = web.WebSocketResponse(heartbeat=20)
    await ws.prepare(request)
    listeners.add(ws)
    try:
        await ws.send_json({'type': 'state', **office_state()})
        async for _ in ws:
            pass
    finally:
        listeners.discard(ws)
    return ws


# ---------------- voice ----------------
def tool_declarations():
    keys = ['enter', 'escape', 'up', 'down', 'left', 'right', 'tab', 'shift-tab', 'space', 'backspace',
            'ctrl-c', 'y', 'n', '1', '2', '3', '4']
    return [types.Tool(function_declarations=[
        types.FunctionDeclaration(
            name='assign_task',
            description='Type a task or slash command into your terminal agent and submit it.',
            parameters={'type': 'OBJECT', 'properties': {'task': {'type': 'STRING', 'description': 'Complete instruction for the coding agent.'}}, 'required': ['task']}),
        types.FunctionDeclaration(
            name='read_terminal',
            description='Read the current terminal screen and status (working, idle, approval, exited).',
            parameters={'type': 'OBJECT', 'properties': {'lines': {'type': 'INTEGER', 'description': 'How many of the last lines to read, up to 32.'}}}),
        types.FunctionDeclaration(
            name='press_keys',
            description='Press keys in the terminal, e.g. to answer a menu. Approve prompts only with the boss\'s explicit consent.',
            parameters={'type': 'OBJECT', 'properties': {'keys': {'type': 'ARRAY', 'items': {'type': 'STRING', 'enum': keys}}}, 'required': ['keys']}),
        types.FunctionDeclaration(
            name='restart_terminal',
            description='Restart your terminal agent process. Use only when asked or if it has exited.',
            parameters={'type': 'OBJECT', 'properties': {}}),
        types.FunctionDeclaration(
            name='perform',
            description='Do a physical action with your body in the office.',
            parameters={'type': 'OBJECT', 'properties': {'action': {'type': 'STRING', 'enum': PERFORM}}, 'required': ['action']}),
        types.FunctionDeclaration(
            name='remember_memory',
            description='Save a fact the boss explicitly asked you to remember.',
            parameters={'type': 'OBJECT', 'properties': {'text': {'type': 'STRING'}}, 'required': ['text']}),
        types.FunctionDeclaration(
            name='recall_memory',
            description='Search saved memories for this worker. Use shared_memory to recall points saved by any worker.',
            parameters={'type': 'OBJECT', 'properties': {'query': {'type': 'STRING'}}, 'required': ['query']}),
        types.FunctionDeclaration(
            name='shared_memory',
            description='Read shared discussion points saved by all workers. Use this to recall decisions and context learned by other workers.',
            parameters={'type': 'OBJECT', 'properties': {'query': {'type': 'STRING'}}, 'required': ['query']}),
        types.FunctionDeclaration(
            name='list_projects',
            description='Read the shared project board, including project IDs, owners, status, updates and blockers.',
            parameters={'type': 'OBJECT', 'properties': {}}),
        types.FunctionDeclaration(
            name='add_project',
            description='Add a project card to the shared board when the boss asks you to track a new project.',
            parameters={'type': 'OBJECT', 'properties': {
                'title': {'type': 'STRING'}, 'owner': {'type': 'STRING', 'enum': sorted(project_owners())},
                'status': {'type': 'STRING', 'enum': sorted(PROJECT_STATUSES)},
                'summary': {'type': 'STRING'}, 'next_step': {'type': 'STRING'}, 'blocker': {'type': 'STRING'}},
                'required': ['title']}),
        types.FunctionDeclaration(
            name='update_project',
            description='Update a card on the shared project board. Call list_projects first to get its ID. Set only fields the boss specified or you can verify from your terminal.',
            parameters={'type': 'OBJECT', 'properties': {
                'project_id': {'type': 'INTEGER'}, 'title': {'type': 'STRING'},
                'owner': {'type': 'STRING', 'enum': sorted(project_owners())},
                'status': {'type': 'STRING', 'enum': sorted(PROJECT_STATUSES)},
                'summary': {'type': 'STRING'}, 'next_step': {'type': 'STRING'}, 'blocker': {'type': 'STRING'}},
                'required': ['project_id']}),
    ])]


ROSTER_FILE = ROOT / 'workers.py'
roster_stamp = ROSTER_FILE.stat().st_mtime_ns


def fresh_roster():
    """workers.py (personas, the voice prompt) is reloaded when it changes, so the next voice session uses it without a restart."""
    global roster_stamp
    with contextlib.suppress(OSError):
        stamp = ROSTER_FILE.stat().st_mtime_ns
        if stamp != roster_stamp:
            importlib.reload(roster)
            roster_stamp = stamp
            print('Reloaded workers.py', flush=True)


def live_config(worker_id):
    fresh_roster()
    worker = staff[worker_id]
    term = terms[worker_id]
    notes = '\n'.join(m['text'] for m in memories(worker_id))[:3000]
    history, last_spoke = conversation(worker_id)
    now = datetime.datetime.now()
    prompt = roster.instructions(worker, notes, history, term.text(last=20)[-2000:], term.status, unreported.pop(worker_id, None),
                                 work=work_history(worker_id), board=board_summary(), office_mode=office_mode['mode'],
                                 now=now.strftime('%A %d %B, %I:%M %p').replace(' 0', ' '), last_spoke=ago(last_spoke) if last_spoke else '')
    return types.LiveConnectConfig(
        response_modalities=['AUDIO'], system_instruction=prompt,
        speech_config=types.SpeechConfig(voice_config=types.VoiceConfig(prebuilt_voice_config=types.PrebuiltVoiceConfig(voice_name=worker['voice']))),
        input_audio_transcription=types.AudioTranscriptionConfig(), output_audio_transcription=types.AudioTranscriptionConfig(),
        realtime_input_config=types.RealtimeInputConfig(automatic_activity_detection=types.AutomaticActivityDetection(silence_duration_ms=550)),
        proactivity=types.ProactivityConfig(proactive_audio=True),
        context_window_compression=types.ContextWindowCompressionConfig(trigger_tokens=16000, sliding_window=types.SlidingWindow(target_tokens=8000)),
        tools=tool_declarations())


async def live(request):
    worker_id = requested_worker(request)
    if request.query.get('token') != TOKEN:
        raise web.HTTPForbidden()
    if daily() >= DAILY_LIMIT:
        raise web.HTTPTooManyRequests(text="Today's estimated voice spending limit has been reached.")
    if voice['ws'] and not voice['ws'].closed:   # the newest device/worker takes the single voice line
        with contextlib.suppress(Exception):
            await voice['ws'].send_json({'type': 'notice', 'text': 'Voice moved to another worker.'})
            await voice['ws'].close()
    ws = web.WebSocketResponse(max_msg_size=65536, heartbeat=20)
    await ws.prepare(request)
    voice.update(ws=ws, worker=worker_id)
    term = terms[worker_id]
    started = last_input = time.monotonic()
    state = dict(usd=0.0, recorded=0.0, audio_in=0, audio_out=0, user='', bot='', busy=False, sent_at=None, last_event=0.0)
    heard = []   # (monotonic time, text) of what the boss actually said or typed in this session
    pending = asyncio.Queue()

    async def event(kind, **kwargs):
        if not ws.closed:
            with contextlib.suppress(ConnectionResetError, RuntimeError):
                await ws.send_json(dict(type=kind, **kwargs))

    def account():
        delta = max(0, state['usd'] - state['recorded'])
        if delta:
            db.execute('INSERT INTO usage(day,usd) VALUES (?,?)', (datetime.date.today().isoformat(), delta))
            db.commit()
            state['recorded'] = state['usd']

    voice['notify'] = lambda note: pending.put_nowait(note)
    await broadcast({'type': 'voice', 'worker': worker_id})
    try:
        if not client:
            await event('error', text=VOICE_OFF)
            return ws
        if credentials and not credentials.valid:
            await event('notice', text='Checking Google credentials…')
            await asyncio.wait_for(asyncio.to_thread(credentials.refresh, AuthRequest()), timeout=30)
        async with client.aio.live.connect(model=MODEL, config=live_config(worker_id)) as session:
            await event('ready', worker=worker_id, model=MODEL)

            async def office_event(text):
                state['busy'] = True
                state['sent_at'] = time.monotonic()
                await session.send_client_content(
                    turns=types.Content(role='user', parts=[types.Part(text='[OFFICE EVENT; not the boss speaking] ' + text)]),
                    turn_complete=True)

            async def run_tool(call):
                args = call.args or {}
                term = terms[worker_id]
                if call.name == 'assign_task':
                    if not term.alive:
                        return {'ok': False, 'error': 'Your terminal process is not running. Offer to restart it.'}
                    if term.status == 'approval':
                        return {'ok': False, 'error': 'The terminal is waiting on an approval prompt. Ask the boss about it first.', 'screen': term.text(last=14)}
                    task = args.get('task', '')
                    in_office_repo = Path(staff[worker_id]['project']).resolve() == ROOT
                    if not task.lstrip().startswith('/') and (in_office_repo or re.search(r'\bmods?\b', task, re.I)):
                        task = f'{task} ({mode_note()})'   # the terminal agent never sees the voice prompt; tell it here (one line: a newline would submit early)
                    await term.type_task(task)
                    log_task(worker_id, args.get('task', ''))
                    await broadcast({'type': 'worker', **term.info()})
                    return {'ok': True, 'note': 'Task submitted. You will get an office event when it finishes or needs approval.'}
                if call.name == 'read_terminal':
                    lines = max(5, min(32, int(args.get('lines') or 24)))
                    return {'status': term.status, 'task': term.task, 'screen': term.text(last=lines)[-3000:]}
                if call.name == 'press_keys':
                    keys = [str(k).lower() for k in list(args.get('keys', []))[:8]]
                    if term.status == 'approval' and APPROVING_KEYS.intersection(keys):
                        # Approval needs the boss's own words, spoken after this prompt appeared.
                        said = ' '.join(text for when, text in heard if when >= term.approval_since - 1) + ' ' + state['user']   # include the sentence still being spoken
                        if not CONSENT.search(said):
                            return {'pressed': [], 'refused': 'The boss has not said yes since this prompt appeared. Nothing was pressed. Describe the prompt and wait for a spoken yes.'}
                    sent = term.press(keys)
                    await asyncio.sleep(.6)
                    return {'pressed': sent, 'screen': term.text(last=12)}
                if call.name == 'restart_terminal':
                    start_terminal(staff[worker_id])
                    return {'ok': True}
                if call.name == 'perform':
                    action = args.get('action')
                    if action in PERFORM:
                        await event('perform', worker=worker_id, action=action)
                        await broadcast({'type': 'perform', 'worker': worker_id, 'action': action})
                    return {'ok': action in PERFORM}
                if call.name == 'remember_memory':
                    return {'memories': save_memory(worker_id, args.get('text', ''))}
                if call.name == 'recall_memory':
                    words = str(args.get('query', '')).lower().split()
                    found = [m for m in memories(worker_id) if any(w in m['text'].lower() for w in words)]
                    return {'memories': found or memories(worker_id)[:10]}
                if call.name == 'shared_memory':
                    words = str(args.get('query', '')).lower().split()
                    rows = db.execute('SELECT worker,text FROM memories ORDER BY id DESC LIMIT 200').fetchall()
                    found = [{'worker': worker, 'text': text} for worker, text in rows
                             if not words or any(word in text.lower() for word in words)]
                    return {'memories': found[:30]}
                if call.name == 'list_projects':
                    return {'projects': projects()}
                if call.name in ('add_project', 'update_project'):
                    try:
                        project_id = int(args['project_id']) if call.name == 'update_project' else None
                        card = save_project(args, staff[worker_id]['name'], project_id)
                    except (ValueError, LookupError, KeyError) as error:
                        return {'ok': False, 'error': str(error)}
                    await broadcast({'type': 'projects'})
                    return {'ok': True, 'project': card}
                return {'error': 'unknown tool'}

            async def receive():
                nonlocal last_input
                while not ws.closed:
                    async for msg in session.receive():
                        if msg.tool_call:
                            responses = []
                            for call in msg.tool_call.function_calls:
                                try:
                                    result = await run_tool(call)
                                except Exception as e:
                                    result = {'error': str(e)[:300]}
                                await event('tool', name=call.name, args=dict(call.args or {}))
                                responses.append(types.FunctionResponse(id=call.id, name=call.name, response=result))
                            await session.send_tool_response(function_responses=responses)
                        content = msg.server_content
                        if content:
                            if content.interrupted:
                                await event('interrupted')
                            if content.input_transcription and content.input_transcription.text:
                                last_input = time.monotonic()
                                state['user'] += content.input_transcription.text
                                await event('transcript', role='user', text=state['user'])
                            if content.output_transcription and content.output_transcription.text:
                                state['bot'] += content.output_transcription.text
                                await event('transcript', role='worker', text=state['bot'])
                            if content.model_turn:
                                state['busy'] = True
                                for part in content.model_turn.parts:
                                    if part.inline_data and part.inline_data.data:
                                        state['audio_out'] += len(part.inline_data.data)
                                        if state['sent_at']:
                                            await event('latency', ms=round((time.monotonic() - state['sent_at']) * 1000))
                                            state['sent_at'] = None
                                        await ws.send_bytes(part.inline_data.data)
                            if content.turn_complete:
                                state['busy'] = False
                                last_input = time.monotonic()
                                now = datetime.datetime.now().isoformat()
                                if state['user'].strip():
                                    heard.append((time.monotonic(), state['user'].strip()))
                                for role, text in (('user', state['user']), ('worker', state['bot'])):
                                    if text.strip():
                                        db.execute('INSERT INTO messages(worker,role,text,created) VALUES (?,?,?,?)', (worker_id, role, text.strip(), now))
                                db.commit()
                                state['user'] = state['bot'] = ''
                                await event('turn_complete')
                        if msg.usage_metadata:
                            usage = msg.usage_metadata
                            # Conservative all-audio rates; app estimate, not a billing cap.
                            state['usd'] += (usage.prompt_token_count or 0) * 3 / 1e6 + (usage.response_token_count or 0) * 12 / 1e6
                        state['usd'] = max(state['usd'], state['audio_in'] / 32000 / 60 * .005 + state['audio_out'] / 48000 / 60 * .018)
                        account()
                        await event('usage', usd=round(state['usd'], 5), dailyUsd=round(daily(), 5))
                        if state['usd'] >= SESSION_LIMIT or daily() >= DAILY_LIMIT:
                            await event('notice', text='Estimated voice spending limit reached. Voice paused.')
                            await ws.close()
                            return

            async def deliver():
                """Terminal notifications become spoken reports when the model is free."""
                while not ws.closed:
                    note = await pending.get()
                    for _ in range(40):
                        if not state['busy']:
                            break
                        await asyncio.sleep(.5)
                    await office_event(note)

            async def watchdog():
                while not ws.closed:
                    await asyncio.sleep(2)
                    if time.monotonic() - started > SESSION_MINUTES * 60 or time.monotonic() - last_input > IDLE_SECONDS:
                        await event('notice', text='Voice line closed after its time or idle limit. Speak or walk up to reconnect.', reason='idle')
                        await ws.close()
                        return

            tasks = [asyncio.create_task(t()) for t in (receive, deliver, watchdog)]

            def failed(task):
                if not task.cancelled() and task.exception():
                    asyncio.create_task(event('error', text=str(task.exception())[:400]))
                    asyncio.create_task(ws.close())
            tasks[0].add_done_callback(failed)
            try:
                async for msg in ws:
                    if msg.type == WSMsgType.BINARY:
                        state['audio_in'] += len(msg.data)
                        await session.send_realtime_input(audio=types.Blob(data=msg.data, mime_type='audio/pcm;rate=16000'))
                    elif msg.type == WSMsgType.TEXT:
                        body = json.loads(msg.data)
                        kind = body.get('type')
                        if kind == 'text':
                            text = str(body.get('text', '')).strip()[:1500]
                            if text:
                                last_input = time.monotonic()
                                state['user'] = text
                                state['busy'] = True
                                state['sent_at'] = time.monotonic()
                                await event('transcript', role='user', text=text)
                                await session.send_client_content(turns=types.Content(role='user', parts=[types.Part(text=text)]), turn_complete=True)
                        elif kind == 'audio_pause':
                            await session.send_realtime_input(audio_stream_end=True)
                        elif kind == 'office_event':
                            name = body.get('event')
                            now = time.monotonic()
                            physical = name in ('slapped', 'blasted', 'thrown', 'dropped', 'lifted')
                            # Physical reactions may interrupt; ambient ones wait for a quiet moment.
                            if name in PHYSICAL and now - state['last_event'] > (2.5 if physical else 12) and (physical or not state['busy']):
                                state['last_event'] = now
                                strength = body.get('strength')
                                detail = ' hard' if isinstance(strength, (int, float)) and strength > 2.5 else ''
                                await office_event(PHYSICAL[name].format(detail=detail))
                        elif kind == 'disconnect':
                            break
            finally:
                for task in tasks:
                    task.cancel()
                await asyncio.gather(*tasks, return_exceptions=True)
    except Exception as e:
        await event('error', text=f'Voice connection failed: {str(e)[:400]}')
    finally:
        account()
        if voice['ws'] is ws:
            voice.update(ws=None, worker=None, notify=None)
            await broadcast({'type': 'voice', 'worker': None})
        await ws.close()
    return ws


# ---------------- static files ----------------
TYPES = {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.glb': 'model/gltf-binary',
         '.png': 'image/png', '.txt': 'text/plain', '.json': 'application/json'}


IMPORTS = re.compile(r"""(\b(?:from|import)\s*\(?\s*['"])(\.{1,2}/[\w./-]+\.js)(['"])""")


def module_version(path, seen=None):
    """Newest change in a web module and everything it imports, so an edit anywhere down the import graph gives a new URL."""
    seen = set() if seen is None else seen
    if path in seen or not path.is_file():
        return 0
    seen.add(path)
    stamp = path.stat().st_mtime_ns
    for match in IMPORTS.finditer(path.read_text(encoding='utf-8', errors='replace')):
        stamp = max(stamp, module_version((path.parent / match.group(2)).resolve(), seen))
    return stamp


def versioned_module(path):
    """Serve a module with its relative imports pinned to their current versions (./avatar.js -> ./avatar.js?v=...).
    The headset can then hot-swap a module by re-importing it, and get fresh copies of whatever it depends on."""
    text = path.read_text(encoding='utf-8', errors='replace')
    # Vendor files keep their plain URLs: three.js must load exactly once, whatever path imports it.
    return IMPORTS.sub(lambda m: m.group(0) if 'vendor/' in m.group(2) else
                       f'{m.group(1)}{m.group(2)}?v={module_version((path.parent / m.group(2)).resolve()):x}{m.group(3)}', text)


async def static(request):
    name = request.match_info.get('name') or ('index.html' if access.local(request) else 'office.html')
    if name == 'assets/rig.glb':
        path = ROOT / name
    else:
        path = (WEB / name).resolve()
        if WEB.resolve() not in path.parents or path.suffix not in TYPES:
            raise web.HTTPNotFound()
    if not path.is_file():
        raise web.HTTPNotFound()
    if path.suffix == '.js' and 'vendor' not in path.parts:
        stat = path.stat()   # the ETag is the file's own, so the page can tell exactly which module changed
        return web.Response(text=versioned_module(path), content_type='text/javascript',
                            headers={'Cache-Control': 'no-cache', 'ETag': f'"{stat.st_mtime_ns:x}-{stat.st_size:x}"'})
    response = web.FileResponse(path, headers={'Content-Type': TYPES[path.suffix], 'Cache-Control': 'no-cache'})
    return response


MODS = WEB / 'mods'
background = set()   # long-running tasks, kept referenced so they are not garbage collected


MOD_SETS = {'enterprise': MODS, 'sandbox': MODS / 'sandbox'}   # each office mode has its own mods folder
MODE_FILE = ROOT / '.office-mode'   # git-ignored; terminal agents read it to know which office the boss is in
office_mode = {'mode': (MODE_FILE.read_text(encoding='utf-8').strip() if MODE_FILE.exists() else '') or 'enterprise', 'headset_seen': 0.0}


def mode_note():
    """One line for the terminal agents: which office the boss is in and where office mods go (absolute paths, so it
    also works for agents whose project is not this repo)."""
    sandbox = office_mode['mode'] == 'sandbox'
    here, other = (SANDBOX, MODS) if sandbox else (MODS, SANDBOX)
    return (f"The boss is in the {'SANDBOX' if sandbox else 'ENTERPRISE'} office: any office mod goes in {here} (not {other}); "
            f"how to write one: {ROOT / 'AGENTS.md'}. Stay on the office repo's current git branch.")


async def mods_api(request):
    """The live mods for one office mode (?set=enterprise|sandbox), each with a version that changes whenever it (or
    anything it imports) changes. Names are relative to web/mods, so a sandbox mod is 'sandbox/lamp.js'."""
    folder = MOD_SETS.get(request.query.get('set', 'enterprise'), MODS)
    folder.mkdir(parents=True, exist_ok=True)
    return web.json_response({'mods': [{'name': p.relative_to(MODS).as_posix(), 'version': f'{module_version(p.resolve()):x}'}
                                       for p in sorted(folder.glob('*.js')) if not p.name.startswith(('_', '.'))]})


SANDBOX = MOD_SETS['sandbox']
SAVES_BRANCH = 'refs/heads/sandbox-saves'
sandbox_pages = {}   # page id -> when it last reported being in the sandbox


def git(*args, env=None, stdin=''):
    # bytes, not text: a text pipe on Windows turns \n into \r\n and git then ignores the paths
    return subprocess.run(['git', *args], cwd=ROOT, env=env, input=stdin.encode(), capture_output=True, check=True).stdout.decode().strip()


FOLDER_SAVES = ROOT / 'data' / 'sandbox-saves'   # used instead of the git branch when this is not a git checkout


def git_checkout():
    try:
        return git('rev-parse', '--is-inside-work-tree') == 'true'
    except (OSError, subprocess.CalledProcessError):   # git not installed, or not a repository
        return False


def save_sandbox():
    """Save everything in web/mods/sandbox, then empty the folder. In a git checkout the build is committed to the
    sandbox-saves branch (under saves/<time>/) without touching the checked-out branch or the real index; otherwise it
    is copied to data/sandbox-saves/<time>/. Returns where it went, or None if the sandbox was empty."""
    files = [p for p in sorted(SANDBOX.rglob('*')) if p.is_file() and p.name != '.gitkeep']
    if not files:
        return None
    stamp = datetime.datetime.now().strftime('%Y-%m-%d_%H%M%S')
    if not git_checkout():
        target = FOLDER_SAVES / stamp
        for p in files:
            (target / p.relative_to(SANDBOX)).parent.mkdir(parents=True, exist_ok=True)
            (target / p.relative_to(SANDBOX)).write_bytes(p.read_bytes())
        clear_sandbox(files)
        return f'data/sandbox-saves/{stamp}'
    index = ROOT / 'data' / 'sandbox-save.index'
    index.unlink(missing_ok=True)
    env = {**os.environ, 'GIT_INDEX_FILE': str(index)}
    try:
        parent = subprocess.run(['git', 'rev-parse', '--verify', '-q', SAVES_BRANCH], cwd=ROOT, capture_output=True).stdout.decode().strip()
        git('read-tree', *([parent] if parent else ['--empty']), env=env)
        names = [f'saves/{stamp}/{p.relative_to(SANDBOX).as_posix()}' for p in files]
        blobs = git('hash-object', '-w', '--no-filters', '--stdin-paths', stdin=''.join(f'{p}\n' for p in files)).split()
        git('update-index', '--add', '--index-info', env=env,
            stdin=''.join(f'100644 {blob}\t{name}\n' for blob, name in zip(blobs, names)))
        tree = git('write-tree', env=env)
        if set(git('ls-tree', '-r', '--name-only', tree, f'saves/{stamp}/').splitlines()) != set(names):
            raise OSError('the save did not hold every file, so nothing was cleared')
        commit = git('commit-tree', tree, *(['-p', parent] if parent else []), '-m', f'Sandbox build saved {stamp}')
        git('update-ref', SAVES_BRANCH, commit, *([parent] if parent else []))
    finally:
        index.unlink(missing_ok=True)
    clear_sandbox(files)
    return f'sandbox-saves:saves/{stamp}'


def clear_sandbox(files):
    for p in files:
        p.unlink()
    for d in sorted((d for d in SANDBOX.rglob('*') if d.is_dir()), reverse=True):
        with contextlib.suppress(OSError):
            d.rmdir()


async def sandbox_fresh(request):
    """A page has just opened the Sandbox: save the last build to the sandbox-saves branch and start from an empty room,
    unless another page (the headset, say) is already in the sandbox, so nobody's room is wiped under them."""
    page, now = str((await request.json()).get('page', ''))[:40], time.time()
    if os.getenv('OFFICE_SANDBOX_FRESH', '1').strip() == '0':   # .env: keep the build whenever the Sandbox is opened
        sandbox_pages[page] = now
        return web.json_response({'fresh': False, 'reason': 'keeping the last build (OFFICE_SANDBOX_FRESH=0)'})
    if any(other != page and now - seen < 45 for other, seen in sandbox_pages.items()):
        return web.json_response({'fresh': False, 'reason': 'someone is already in the sandbox'})
    sandbox_pages[page] = now
    try:
        saved = await asyncio.to_thread(save_sandbox)
    except (subprocess.CalledProcessError, OSError) as e:
        return web.json_response({'fresh': False, 'reason': f'could not save the last build: {(getattr(e, "stderr", b"") or b"").decode().strip() or e}'})
    return web.json_response({'fresh': True, 'saved': saved})


async def office_mode_api(request):
    """An office page reports its mode. A headset inside the office (inSession) decides; a page outside VR only counts
    when no headset has reported in the last minute, so a desktop preview in the other mode cannot override the boss."""
    body = await request.json()
    mode, now = body.get('mode'), time.time()
    if page := str(body.get('page', ''))[:40]:
        if mode == 'sandbox':
            sandbox_pages[page] = now
        else:
            sandbox_pages.pop(page, None)
    if mode in MOD_SETS and (body.get('inSession') or now - office_mode['headset_seen'] > 60):
        if body.get('inSession'):
            office_mode['headset_seen'] = now
        if mode != office_mode['mode']:
            office_mode['mode'] = mode
            with contextlib.suppress(OSError):
                MODE_FILE.write_text(mode, encoding='utf-8')
    return web.json_response({'mode': office_mode['mode']})


async def watch_web():
    """Tell every open office page the moment a web file changes, so live swaps and mods apply within a second."""
    def snapshot():
        files = {}
        for pattern in ('*.js', '*.css', '*.html', 'mods/*.js', 'mods/*/*.js'):
            for p in WEB.glob(pattern):
                with contextlib.suppress(OSError):
                    files[p] = p.stat().st_mtime_ns
        return files
    seen = snapshot()
    while True:
        await asyncio.sleep(.7)
        now = snapshot()
        if now != seen:
            changed = sorted(p.relative_to(WEB).as_posix() for p in set(now) | set(seen) if now.get(p) != seen.get(p))
            seen = now
            await broadcast({'type': 'code', 'files': changed})


async def restart_server(request):
    """Restart the server in place (PC only). The tunnel, pairing and page token survive, so the headset reconnects by itself.
    Worker terminals do restart: their Claude/Codex sessions start fresh."""
    if not access.local(request):
        raise web.HTTPForbidden()
    async def handover():
        await asyncio.sleep(.3)
        for term in terms.values():
            term.stop()
        access.save()
        logs = {'stdout': open(ROOT / 'data/server.log', 'a', encoding='utf-8'), 'stderr': open(ROOT / 'data/server-error.log', 'a', encoding='utf-8')}
        subprocess.Popen([sys.executable, str(Path(__file__).resolve())], cwd=str(ROOT), stdin=subprocess.DEVNULL, close_fds=True,
                         env={**os.environ, 'OFFICE_WAIT_FOR_PORT': '1', 'PYTHONIOENCODING': 'utf-8', 'PYTHONUNBUFFERED': '1'},
                         creationflags=0x08000000 if os.name == 'nt' else 0, **logs)
        os._exit(0)   # the new copy takes over the port as soon as this one is gone
    asyncio.create_task(handover())
    return web.json_response({'restarting': True})


async def on_startup(app):
    loop = asyncio.get_running_loop()
    default = loop.get_exception_handler()

    def quiet_resets(loop, context):   # Windows Proactor logs every browser that drops a socket
        if isinstance(context.get('exception'), ConnectionResetError):
            return
        if default:
            default(loop, context)
        else:
            loop.default_exception_handler(context)
    loop.set_exception_handler(quiet_resets)
    for worker in roster.load():
        try:
            staff[worker['id']] = roster.validate(worker)
        except ValueError as e:
            print(f"Skipping worker {worker.get('id')}: {e}", flush=True)
            continue
        start_terminal(staff[worker['id']])
    background.add(asyncio.create_task(watch_web()))


async def on_cleanup(app):
    for term in terms.values():
        term.stop()
    for task in pumps.values():
        task.cancel()


app = web.Application(middlewares=[access.middleware], client_max_size=64000)
app.router.add_get('/api/state', get_state)
app.router.add_get('/api/projects', projects_api)
app.router.add_post('/api/projects', projects_api)
app.router.add_patch('/api/projects/{id}', project_api)
app.router.add_delete('/api/projects/{id}', project_api)
app.router.add_post('/api/workers', save_worker)
app.router.add_delete('/api/workers', delete_worker)
app.router.add_post('/api/terminal/restart', restart_terminal)
app.router.add_post('/api/server/restart', restart_server)
app.router.add_get('/api/mods', mods_api)
app.router.add_post('/api/office-mode', office_mode_api)
app.router.add_post('/api/sandbox/fresh', sandbox_fresh)
app.router.add_post('/api/layout', save_layout)
app.router.add_route('*', '/api/memory', memory_api)
app.router.add_get('/api/term', term_socket)
app.router.add_get('/api/events', events_socket)
app.router.add_get('/api/live', live)
app.router.add_post('/api/pair', access.pair)
app.router.add_get('/api/quest/state', access.status)
app.router.add_post('/api/quest/start', access.start)
app.router.add_post('/api/quest/stop', access.stop)
app.router.add_post('/api/quest/renew', access.rotate)
app.on_startup.append(on_startup)
app.on_cleanup.append(on_cleanup)
app.on_cleanup.append(access.cleanup)
app.router.add_get('/{name:.*}', static)

if __name__ == '__main__':
    if VOICE_OFF:
        print(VOICE_OFF, flush=True)
    elif credentials:
        try:
            credentials.refresh(AuthRequest())   # authentication only; no model call
        except Exception:
            print('Google credential warm-up failed; voice will retry on connect.', flush=True)
    print(f'Brick Office on http://localhost:{PORT}', flush=True)
    if os.getenv('OFFICE_WAIT_FOR_PORT'):   # started by /api/server/restart: wait for the old copy to let go of the port
        import socket
        for _ in range(100):
            with socket.socket() as probe:
                if probe.connect_ex(('127.0.0.1', PORT)) != 0:
                    break
            time.sleep(.2)
    web.run_app(app, host='127.0.0.1', port=PORT, print=None)
