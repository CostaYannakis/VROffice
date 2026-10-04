"""Offboard an agent: stop its terminal, take it off the roster and clear its desk from the office.

    python tools/offboard.py nova               # asks before doing anything
    python tools/offboard.py Nova --yes         # by name or id, no question
    python tools/offboard.py nova --forget      # also erase their memories, conversations and work log
    python tools/offboard.py --list             # who is on the team

With the office server running the agent leaves live: the terminal stops and the desk disappears from every open office.
With the server stopped, workers.json and data/layout.json are updated instead. Their project folder is never touched.
Memories, conversations and the work log are kept (stored by id in data/office.sqlite3), so re-hiring the same id with
tools/onboard.py brings them back, unless --forget is given.
"""
import argparse
import asyncio
import json
import sqlite3
import sys
from pathlib import Path

import aiohttp

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
import workers as roster  # noqa: E402

LAYOUT_FILE = ROOT / 'data' / 'layout.json'
DATABASE = ROOT / 'data' / 'office.sqlite3'


async def get_state(base):
    try:
        async with aiohttp.ClientSession(timeout=aiohttp.ClientTimeout(total=3)) as http:
            async with http.get(f'{base}/api/state') as r:
                return await r.json() if r.status == 200 else None
    except (aiohttp.ClientError, asyncio.TimeoutError, OSError):
        return None


def find(staff, who):
    who = who.lower()
    match = [w for w in staff if w['id'] == who or w['name'].lower() == who]
    if not match:
        raise SystemExit(f'No worker called "{who}". On the team: ' + ', '.join(f"{w['name']} ({w['id']})" for w in staff))
    return match[0]


def history(worker_id):
    """How much the office remembers about this worker."""
    if not DATABASE.exists():
        return {}
    with sqlite3.connect(DATABASE) as db:
        return {table: db.execute(f'SELECT COUNT(*) FROM {table} WHERE worker=?', (worker_id,)).fetchone()[0]
                for table in ('memories', 'messages', 'worklog')}


def forget(worker_id):
    with sqlite3.connect(DATABASE, timeout=10) as db:      # the server may hold the database too; wait for its lock
        for table in ('memories', 'messages', 'worklog'):
            db.execute(f'DELETE FROM {table} WHERE worker=?', (worker_id,))


async def leave_live(base, state, worker):
    headers = {'X-Office-Token': state['token']}
    layout = state.get('layout') or {}
    async with aiohttp.ClientSession() as http:
        async with http.delete(f"{base}/api/workers", params={'worker': worker['id']}, headers=headers) as r:
            if r.status != 200:
                raise SystemExit(f'The office would not remove {worker["name"]}: {await r.text()}')
        # Free the desk spot. The server replaces both lists with what it is sent, so send the rest back unchanged.
        desks = {k: v for k, v in (layout.get('desks') or {}).items() if k != worker['id']}
        body = {'client': 'offboard', 'final': True, 'desks': desks, 'emptyDesks': layout.get('emptyDesks', {})}
        async with http.post(f'{base}/api/layout', json=body, headers=headers) as r:
            r.raise_for_status()


def leave_offline(worker):
    roster.save([w for w in roster.load() if w['id'] != worker['id']])
    if LAYOUT_FILE.exists():
        layout = json.loads(LAYOUT_FILE.read_text(encoding='utf-8'))
        (layout.get('desks') or {}).pop(worker['id'], None)
        LAYOUT_FILE.write_text(json.dumps(layout), encoding='utf-8')


def main():
    parser = argparse.ArgumentParser(description='Remove an agent from Brick Office.')
    parser.add_argument('who', nargs='?', help="the worker's id or name")
    parser.add_argument('--yes', '-y', action='store_true', help='do not ask for confirmation')
    parser.add_argument('--forget', action='store_true', help='also erase their memories, conversations and work log')
    parser.add_argument('--list', action='store_true', help='list the team and exit')
    parser.add_argument('--port', type=int, default=8120, help='office server port (default 8120)')
    args = parser.parse_args()

    base = f'http://127.0.0.1:{args.port}'
    state = asyncio.run(get_state(base))
    staff = state['workers'] if state else roster.load()
    if args.list or not args.who:
        for w in staff:
            print(f"  {w['id']:<12} {w['name']:<12} {roster.AGENT_NAMES.get(w['agent'], w['agent']):<14} {w.get('status', 'office stopped'):<10} {w['project']}")
        if not args.who and not args.list:
            print('\nName someone to offboard: python tools/offboard.py <id or name>')
        return

    worker = find(staff, args.who)
    kept = history(worker['id'])
    print(f"Offboarding {worker['name']} ({worker['id']}, {roster.AGENT_NAMES.get(worker['agent'], worker['agent'])})")
    print(f"  terminal: {'stopped now (anything it is doing is interrupted)' if state else 'not running (office is stopped)'}")
    print(f"  desk:     removed from the office")
    print(f"  folder:   {worker['project']} is left as it is")
    if kept:
        summary = f"{kept['memories']} memories, {kept['messages']} messages, {kept['worklog']} tasks"
        print(f"  history:  {summary} {'ERASED' if args.forget else 'kept (re-hire the same id to restore)'}")
    if len(staff) == 1:
        print('  note:     this is the last worker; the office will be empty')
    if worker.get('status') == 'working':
        print(f"  warning:  {worker['name']} is in the middle of a task: {worker.get('task') or 'unknown'}")
    if not args.yes and input('\nGo ahead? [y/N] ').strip().lower() not in ('y', 'yes'):
        print('Cancelled, nothing changed.')
        return

    if state:
        asyncio.run(leave_live(base, state, worker))
    else:
        leave_offline(worker)
    if args.forget and kept:
        forget(worker['id'])
    print(f"Done. {worker['name']} has left the office" + (' and their history is erased.' if args.forget else '.'))


if __name__ == '__main__':
    main()
