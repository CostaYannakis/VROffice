"""Real terminals on this PC: one ConPTY per worker, rendered through a pyte screen.

The PTY reader runs on a thread; everything else (snapshots, status, broadcasts)
runs on the asyncio loop.
"""
import asyncio
import os
import re
import shutil
import threading
import time

import pyte
import winpty

COLS, ROWS = 100, 32

KEYS = {
    'enter': '\r', 'escape': '\x1b', 'esc': '\x1b', 'tab': '\t', 'shift-tab': '\x1b[Z',
    'up': '\x1b[A', 'down': '\x1b[B', 'right': '\x1b[C', 'left': '\x1b[D',
    'backspace': '\x7f', 'space': ' ', 'ctrl-c': '\x03', 'ctrl-d': '\x04',
    'y': 'y', 'n': 'n', '1': '1', '2': '2', '3': '3', '4': '4',
}

# Interactive agent prompts that wait on a human decision.
APPROVAL = re.compile(
    r'Do you want to (proceed|make this edit|create|run|allow)|Would you like to (run|make|apply|allow)'
    r'|trust this folder|Trust and continue|Allow (this|command)|Approve\b|\[y/n\]|\(y/n\)'
    r'|Enter to confirm|enter continue|enter to select',
    re.I)
# Private-marker CSI sequences pyte misreads: kitty keyboard (CSI > 1 u, CSI ? u) prints a literal "u",
# and xterm modifyOtherKeys (CSI > 4 ; 2 m) would be taken as SGR underline + dim.
KITTY = re.compile(r'\x1b\[[?<>=][0-9;]*[umq]')
WORKING = re.compile(r'esc to interrupt|ctrl\+c to interrupt', re.I)


def clean_env():
    """Workers get a fresh agent session, not this process's parent Claude session markers."""
    env = {k: v for k, v in os.environ.items()
           if not k.startswith('CLAUDE_CODE_') and k not in ('CLAUDECODE', 'CLAUDE_AGENT_SDK_VERSION')}
    env['TERM'] = 'xterm-256color'
    env['COLORTERM'] = 'truecolor'
    return env


def resolve_command(agent, command=None, args=()):
    if command:
        exe = shutil.which(command) or command
    else:
        exe = shutil.which({'claude': 'claude', 'codex': 'codex', 'shell': 'powershell'}[agent])
        if not exe:
            raise FileNotFoundError(f'{agent} is not on PATH')
    return [exe, *args]


class Terminal:
    def __init__(self, worker_id, agent, project, command=None, args=(), on_event=None):
        self.id = worker_id
        self.agent = agent
        self.project = project
        self.command = command
        self.args = list(args)
        self.on_event = on_event or (lambda *a: None)
        self.lock = threading.Lock()
        self.process = None
        self.subscribers = set()
        self.status = 'stopped'
        self.task = None            # the most recent task text given to the agent
        self.task_started = 0.0
        self.task_open = False      # a task is in flight and not yet reported done
        self.approval_since = 0.0   # when the current approval prompt appeared
        self.last_output = 0.0
        self.started = 0.0
        self.bytes = 0
        self.error = None
        self._new_screen()

    def _new_screen(self):
        with self.lock:
            self.screen = pyte.Screen(COLS, ROWS)
            self.stream = pyte.Stream(self.screen)
            self.version = 0

    # ---------- process ----------
    def start(self):
        if self.process and self.process.isalive():
            return
        self._new_screen()
        self.error = None
        try:
            if not os.path.isdir(self.project):
                raise FileNotFoundError(f'Project folder not found: {self.project}')
            argv = resolve_command(self.agent, self.command, self.args)
            self.process = winpty.PtyProcess.spawn(argv, cwd=self.project, env=clean_env(), dimensions=(ROWS, COLS))
        except Exception as e:  # shown on the monitor rather than crashing the office
            self.process = None
            self.error = str(e)
            self._set_status('exited')
            with self.lock:
                self.stream.feed(f'\x1b[31mCould not start {self.agent}: {e}\x1b[0m\r\n')
                self.version += 1
            return
        self.started = self.last_output = time.monotonic()
        self.task_open = False
        self._set_status('starting')
        threading.Thread(target=self._reader, args=(self.process,), daemon=True, name=f'pty-{self.id}').start()

    def _reader(self, process):
        while True:
            try:
                data = process.read(8192)
            except EOFError:
                break
            except Exception:
                if not process.isalive():
                    break
                time.sleep(.05)
                continue
            if data:
                with self.lock:
                    self.stream.feed(KITTY.sub('', data))
                    self.bytes += len(data)
                    self.version += 1
                self.last_output = time.monotonic()
        with self.lock:
            self.stream.feed('\r\n\x1b[33m[process exited - say "restart your terminal" or press R on the dashboard]\x1b[0m')
            self.version += 1

    def stop(self):
        if self.process:
            try:
                self.process.terminate(force=True)
            except Exception:
                pass
        self.process = None

    def restart(self):
        self.stop()
        self.start()

    @property
    def alive(self):
        return bool(self.process and self.process.isalive())

    # ---------- input ----------
    def write(self, data):
        if self.alive:
            self.process.write(data)

    async def type_task(self, text):
        """Type a task into the agent's prompt and submit it, like a person would."""
        text = ' '.join(str(text).split())[:4000]
        if not text:
            return False
        self.write(text)
        await asyncio.sleep(.35)    # let the TUI absorb a paste before Enter
        self.write('\r')
        self.task = text
        self.task_started = time.monotonic()
        self.task_open = True
        return True

    def press(self, keys):
        sent = []
        for key in keys:
            sequence = KEYS.get(str(key).lower().strip())
            if sequence is not None:
                self.write(sequence)
                sent.append(key)
        return sent

    # ---------- screen ----------
    def text(self, last=None):
        with self.lock:
            lines = [line.rstrip() for line in self.screen.display]
        while lines and not lines[-1]:
            lines.pop()
        if last:
            lines = lines[-last:]
        return '\n'.join(lines)

    def _runs(self, row):
        """One screen row as [[text, fg, bg, flags], ...] runs of equal style."""
        line = self.screen.buffer[row]
        runs = []
        for x in range(COLS):
            ch = line[x]
            fg, bg = ch.fg, ch.bg
            if ch.reverse:
                fg, bg = (bg if bg != 'default' else 'rev-fg'), (fg if fg != 'default' else 'rev-bg')
            flags = (1 if ch.bold else 0) | (2 if ch.italics else 0) | (4 if ch.underscore else 0)
            data = ch.data or ' '
            if runs and runs[-1][1] == fg and runs[-1][2] == bg and runs[-1][3] == flags:
                runs[-1][0] += data
            else:
                runs.append([data, fg, bg, flags])
        if runs and runs[-1][1] == 'default' and runs[-1][2] == 'default' and runs[-1][3] == 0:
            runs[-1][0] = runs[-1][0].rstrip()
            if not runs[-1][0]:
                runs.pop()
        return runs

    def snapshot(self, full=False):
        with self.lock:
            rows = range(ROWS) if full else sorted(self.screen.dirty)
            lines = {str(y): self._runs(y) for y in rows}
            self.screen.dirty.clear()
            cursor = [self.screen.cursor.x, self.screen.cursor.y, not self.screen.cursor.hidden]
        return {'type': 'screen', 'full': full, 'cols': COLS, 'rows': ROWS, 'lines': lines, 'cursor': cursor}

    def info(self):
        return {'id': self.id, 'status': self.status, 'agent': self.agent, 'project': self.project,
                'task': self.task, 'alive': self.alive, 'error': self.error}

    # ---------- status ----------
    def _set_status(self, status):
        if status == self.status:
            return
        previous, self.status = self.status, status
        if status == 'approval':
            self.approval_since = time.monotonic()
        self.on_event(self, 'status', previous=previous)
        if status == 'approval':
            self.on_event(self, 'approval')
        if previous == 'working' and status == 'idle' and self.task_open:
            self.task_open = False
            self.on_event(self, 'task_done')

    def _detect(self):
        if not self.alive:
            return 'exited' if self.started or self.error else 'stopped'
        now = time.monotonic()
        screen = self.text()
        if WORKING.search(screen):
            return 'working'
        if APPROVAL.search(screen):
            return 'approval'
        if now - self.last_output < 1.2 and (self.task_open or now - self.started < 6):
            return 'working' if self.task_open else 'starting'
        if self.task_open and now - self.task_started < 4:
            return 'working'    # the agent may take a moment to show its spinner
        return 'idle'

    async def pump(self):
        """Broadcast screen changes ~12 times a second and keep the status current."""
        seen = -1
        tick = 0
        while True:
            await asyncio.sleep(.08)
            tick += 1
            if self.version != seen and self.subscribers:
                seen = self.version
                await self.broadcast(self.snapshot())
            if tick % 5 == 0:
                self._set_status(self._detect())

    async def broadcast(self, message):
        for ws in list(self.subscribers):
            if ws.closed:
                self.subscribers.discard(ws)
                continue
            try:
                await ws.send_json(message)
            except Exception:
                self.subscribers.discard(ws)
