"""Onboard a new agent: a desk in the office, its own terminal, and a first briefing, ready to work in the current folder.

    python tools/onboard.py                       # pick a name, agent, voice and colours automatically
    python tools/onboard.py --name Nova --agent codex --persona "Dry wit, very thorough."
    python tools/onboard.py --dry-run             # show the plan, change nothing

With the office server running, the agent is hired live: its terminal starts at once in the project folder, its desk appears
in every open office (headset too), and once the agent's prompt is ready it is briefed and asked to read the project's
conventions. With the server stopped, workers.json and data/layout.json are updated instead and the agent starts with the
office next time.
"""
import argparse
import asyncio
import json
import math
import re
import shutil
import sys
from pathlib import Path

import aiohttp

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import workers as roster  # noqa: E402  (the office's own roster rules: fields, voices, validation)

LAYOUT_FILE = ROOT / 'data' / 'layout.json'
NAMES = ['Nova', 'Pixel', 'Juno', 'Rook', 'Echo', 'Mako', 'Sable', 'Orbit', 'Kit', 'Blaze', 'Indy', 'Vega', 'Wren', 'Zara']
# Bright brick colours for the torso, each with legs and hair that suit it.
LOOKS = [('#c91a09', '#2b3644', '#2a1a10'), ('#0055bf', '#1f2a36', '#e4cd9e'), ('#f2cd37', '#3a3a44', '#6b3e1f'),
         ('#7c3aed', '#242033', '#151515'), ('#e4007c', '#262a35', '#3b2a1e'), ('#00a3da', '#203040', '#f2f0ea'),
         ('#4b9f4a', '#27322a', '#151515'), ('#fe8a18', '#2b2f3a', '#7a4a26')]
PERSONAS = {
    'claude': 'Calm, methodical and friendly. New to the team and keen to learn how things are done here. Calls the user "boss".',
    'codex': 'Quick, practical and a little cheeky. New to the team and eager to ship something useful. Calls the user "boss".',
    'shell': 'A plain terminal. Says exactly what it ran and what came back. Calls the user "boss".',
}
# Things already standing in the room that a desk should keep clear of: x, z, radius in metres.
PROPS = [(1.1, -.75, .7, 'chess table'), (4.2, .35, .6, 'vending machine'), (-3.85, 2.3, .5, 'hologram'), (2.6, 3.2, .8, 'door')]


def room_bounds():
    """The walls of the virtual office, read from web/environment.js so the two never disagree."""
    text = (ROOT / 'web' / 'environment.js').read_text(encoding='utf-8')
    found = dict(re.findall(r'(minX|maxX|minZ|maxZ):\s*(-?[\d.]+)', text.split('export const ROOM', 1)[1].split('}', 1)[0]))
    return {k: float(v) for k, v in found.items()} if len(found) == 4 else {'minX': -4.6, 'maxX': 4.6, 'minZ': -4.4, 'maxZ': 3.2}


def default_spot(index, count):
    """Where the office puts a desk that has no saved spot (office.js addWorker): one row, 2.1 m apart."""
    return {'x': (index - (count - 1) / 2) * 2.1, 'z': -2.1, 'yaw': 0.0}


def current_spots(staff, layout):
    """Every existing desk's position, saved or default. Saving the defaults pins them, so adding a desk does not
    spread the others out (the default row is centred on the number of desks)."""
    desks = layout.get('desks', {}) if isinstance(layout, dict) else {}
    return {w['id']: desks.get(w['id']) or default_spot(i, len(staff)) for i, w in enumerate(staff)}


def footprint(spot):
    """The floor a desk and its chair take up, as (min x, max x, min z, max z). A desk is 1.5 x 0.75 m and its chair sits
    behind it (+z); a turned desk is treated as a 2.3 m square round its centre."""
    x, z, yaw = spot['x'], spot['z'], spot.get('yaw', 0.0)
    if abs(math.sin(yaw)) < .2:
        sign = 1 if math.cos(yaw) > 0 else -1
        z0, z1 = sorted((z - .375 * sign, z + 1.25 * sign))
        return x - .75, x + .75, z0, z1
    return x - 1.15, x + 1.15, z - 1.15, z + 1.15


def free_spot(taken):
    """A clear spot for a new desk, as near the back row (z = -2.1) and the middle of the room as the floor allows:
    its desk and chair keep 0.5 m from every other desk, 0.6 m from the walls and clear of the props."""
    room, gap = room_bounds(), .5
    others = [footprint(s) for s in taken]
    best = None
    for i in range(-40, 41):
        for k in range(-40, 41):
            spot = {'x': round(i * .1, 2), 'z': round(k * .1, 2), 'yaw': 0.0}
            x0, x1, z0, z1 = footprint(spot)
            if x0 < room['minX'] + .6 or x1 > room['maxX'] - .6 or z0 < room['minZ'] + .6 or z1 > room['maxZ'] - .6:
                continue
            if any(x0 < b1 + gap and b0 < x1 + gap and z0 < c1 + gap and c0 < z1 + gap for b0, b1, c0, c1 in others):
                continue
            # the nearest point of the footprint to each prop must leave the prop its radius plus room to pass
            if any(math.hypot(px - min(max(px, x0), x1), pz - min(max(pz, z0), z1)) < r + .5 for px, pz, r, _ in PROPS):
                continue
            score = abs(spot["z"] + 2.1) + .35 * abs(spot["x"]) + (.01 if spot["x"] < 0 else 0)   # ties go to the right
            if best is None or score < best[0]:
                best = (score, spot)
    if not best:
        raise SystemExit('No clear spot left for another desk. Use "Arrange desks" in the office to make room, then try again.')
    return best[1]


def plan_worker(args, staff, project):
    used_ids = {w['id'] for w in staff}
    used_names = {w['name'].lower() for w in staff}
    name = args.name or next((n for n in NAMES if n.lower() not in used_names and n.lower() not in used_ids), None)
    if not name:
        raise SystemExit('Every spare name is taken; pass one with --name.')
    worker_id = args.id or re.sub(r'[^a-z0-9-]+', '-', name.lower()).strip('-')[:24]
    if worker_id in used_ids:
        raise SystemExit(f'There is already a worker with id "{worker_id}". Pass a different --name or --id.')
    agent = args.agent
    if not agent:   # whichever installed agent the team has fewer of
        installed = [a for a in ('claude', 'codex') if shutil.which(a)]
        if not installed:
            raise SystemExit('Neither the claude nor the codex CLI is on PATH. Install one, or pass --agent shell.')
        agent = min(installed, key=lambda a: sum(w['agent'] == a for w in staff))
    elif agent != 'shell' and not shutil.which(agent):
        print(f'Warning: the {agent} CLI is not on PATH, so its terminal will not start until it is installed.')
    voices = [v for v in roster.VOICES if v not in {w.get('voice') for w in staff}] or roster.VOICES
    looks = [l for l in LOOKS if l[0].lower() not in {w.get('torso', '').lower() for w in staff}] or LOOKS
    torso, legs, hair = looks[0]
    worker = {'id': worker_id, 'name': name, 'agent': agent, 'project': str(project), 'voice': args.voice or voices[0],
              'torso': torso, 'legs': legs, 'hair': hair, 'args': [], 'persona': args.persona or PERSONAS[agent]}
    return roster.validate(worker)


def briefing(worker, staff):
    """The new agent's first message: who it is, who it works with, and to learn the project before touching anything."""
    names = [f"{w['name']} ({roster.AGENT_NAMES.get(w['agent'], w['agent'])})" for w in staff]
    team = ' and '.join([', '.join(names[:-1]), names[-1]] if len(names) > 1 else names) or 'nobody yet'
    folder = Path(worker['project'])
    guides = [n for n in ('AGENTS.md', 'CLAUDE.md', 'README.md') if (folder / n).exists()]
    read = ', '.join(guides) if guides else 'the main files'
    return (f"Welcome to the team, {worker['name']}. You are {worker['name']}, a new {roster.AGENT_NAMES.get(worker['agent'], worker['agent'])} "
            f"agent at your own desk in Brick Office, working in {folder}. Your colleagues {team} work in this same folder, so check "
            f"git status before editing and keep your changes to what your task needs. The boss gives you tasks by voice or at your desk. "
            f"Please read {read} now to learn how this project works and its conventions, then reply in two or three sentences: what "
            f"the project is, the one rule you think matters most here, and that you are ready for your first task. Do not change any files yet.")


# ---------------- with the office running: hire live ----------------
async def hire_live(base, worker, spots, intro, wait):
    async with aiohttp.ClientSession() as http:
        async with http.get(f'{base}/api/state') as r:
            state = await r.json()
        headers = {'X-Office-Token': state['token']}
        # Pin the existing desks and claim the new spot first, so the desk appears in the right place when the roster reloads.
        # The server replaces both lists with what it is sent, so the spare desks go back unchanged.
        layout = {'client': 'onboard', 'final': True, 'desks': spots, 'emptyDesks': (state.get('layout') or {}).get('emptyDesks', {})}
        async with http.post(f'{base}/api/layout', json=layout, headers=headers) as r:
            r.raise_for_status()
        async with http.post(f'{base}/api/workers', json=worker, headers=headers) as r:
            if r.status != 200:
                raise SystemExit(f'The office refused the new hire: {await r.text()}')
        print(f"  hired: {worker['name']}'s terminal is starting in {worker['project']}")
        if not intro:
            return
        # Wait until the agent's prompt is up (status "idle"), then type the briefing like a person would.
        print('  waiting for the agent to be ready', end='', flush=True)
        status, warned = '', False
        for _ in range(int(wait / 2)):
            await asyncio.sleep(2)
            async with http.get(f'{base}/api/state') as r:
                status = next((w.get('status') for w in (await r.json())['workers'] if w['id'] == worker['id']), '')
            if status == 'idle':
                break
            if status == 'approval' and not warned:
                print(f"\n  {worker['name']} is asking for approval (often a 'trust this folder' prompt): answer it at their desk.", end='', flush=True)
                warned = True
            print('.', end='', flush=True)
        print()
        if status != 'idle':
            print(f"  {worker['name']} is not ready yet (status: {status or 'unknown'}). Brief them yourself when they are:\n\n{intro}\n")
            return
        url = f"{base.replace('http', 'ws', 1)}/api/term?worker={worker['id']}&token={state['token']}"
        async with http.ws_connect(url) as ws:
            await ws.send_json({'type': 'input', 'data': ' '.join(intro.split())})
            await asyncio.sleep(.35)       # let the TUI absorb the paste before Enter
            await ws.send_json({'type': 'input', 'data': '\r'})
            await asyncio.sleep(.3)
        print(f"  briefed: {worker['name']} is reading the project and will report in at their desk.")


# ---------------- with the office stopped: write the files ----------------
def hire_offline(worker, spots, staff):
    roster.save([*staff, worker])
    layout = json.loads(LAYOUT_FILE.read_text(encoding='utf-8')) if LAYOUT_FILE.exists() else {}
    layout.setdefault('desks', {}).update(spots)
    LAYOUT_FILE.parent.mkdir(exist_ok=True)
    LAYOUT_FILE.write_text(json.dumps(layout), encoding='utf-8')
    print(f"  saved: {worker['name']} is in workers.json and their desk in data/layout.json. Start the office to meet them.")


async def office_running(base):
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=3)) as http:
            async with http.get(f'{base}/api/state') as r:
                return r.status == 200
    except (aiohttp.ClientError, asyncio.TimeoutError, OSError):
        return False


def main():
    parser = argparse.ArgumentParser(description='Onboard a new agent into Brick Office, working in the current folder.')
    parser.add_argument('--name', help='display name (default: a free one from a list)')
    parser.add_argument('--id', help='worker id, lowercase (default: from the name)')
    parser.add_argument('--agent', choices=['claude', 'codex', 'shell'], help='default: whichever installed agent the team has fewer of')
    parser.add_argument('--project', default='.', help='folder the agent works in (default: the current folder)')
    parser.add_argument('--voice', choices=roster.VOICES, help='voice on the voice line (default: one nobody else uses)')
    parser.add_argument('--persona', help='a sentence or two about how they talk and work')
    parser.add_argument('--port', type=int, default=8120, help='office server port (default 8120)')
    parser.add_argument('--no-intro', action='store_true', help='hire without sending the first briefing')
    parser.add_argument('--wait', type=int, default=120, help='seconds to wait for the agent to be ready for its briefing')
    parser.add_argument('--dry-run', action='store_true', help='show what would happen and change nothing')
    args = parser.parse_args()

    project = Path(args.project).resolve()
    if not project.is_dir():
        raise SystemExit(f'Not a folder: {project}')
    base = f'http://127.0.0.1:{args.port}'
    live = asyncio.run(office_running(base))
    if live:
        async def fetch():
            async with aiohttp.ClientSession() as http, http.get(f'{base}/api/state') as r:
                return await r.json()
        state = asyncio.run(fetch())
        staff, layout = state['workers'], state.get('layout') or {}
    else:
        staff = roster.load()
        layout = json.loads(LAYOUT_FILE.read_text(encoding='utf-8')) if LAYOUT_FILE.exists() else {}

    worker = plan_worker(args, staff, project)
    spots = current_spots(staff, layout)
    spots[worker['id']] = free_spot(list(spots.values()))
    intro = None if args.no_intro or worker['agent'] == 'shell' else briefing(worker, staff)   # a plain shell would run it as a command

    spot = spots[worker['id']]
    print(f"Onboarding {worker['name']} ({roster.AGENT_NAMES.get(worker['agent'], worker['agent'])})")
    print(f"  folder: {worker['project']}")
    print(f"  desk:   x {spot['x']:+.2f} m, z {spot['z']:+.2f} m   look: torso {worker['torso']}, voice {worker['voice']}")
    print(f"  office: {'running, hiring live' if live else 'not running, writing the config for next start'}")
    if args.dry_run:
        print('\nDry run, nothing changed.' + (f'\n\nBriefing:\n{intro}' if intro else ''))
        return
    if live:
        asyncio.run(hire_live(base, worker, spots, intro, args.wait))
    else:
        hire_offline(worker, spots, staff)
        if intro:
            print(f'\nBriefing to give them once they are at their desk:\n{intro}')


if __name__ == '__main__':
    main()
