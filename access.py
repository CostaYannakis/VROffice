"""Quest access over a Cloudflare Quick Tunnel, protected by a six-digit pairing code.

Adapted from dioarama/character/quest_access.py. Localhost (the PC) is always trusted;
anything arriving through the tunnel must pair first. Paired devices can drive real
terminals, so codes expire after two hours and cookies after eight.

The tunnel runs as its own process and the link, code and paired devices are kept in
data/access.json, so restarting the server keeps the same URL and the headset stays paired.
Only "Close link" (or ending cloudflared) takes them away.
"""
import asyncio
import contextlib
import ctypes
import json
import os
import re
import secrets
import subprocess
import time

from aiohttp import web

TOKEN_HEADER = 'X-Office-Token'


def _process_name(pid):
    """Executable name of a running process, or None when it has exited (Windows; elsewhere just 'alive')."""
    if not pid:
        return None
    if os.name != 'nt':
        try:
            os.kill(pid, 0)
            return 'cloudflared'
        except OSError:
            return None
    kernel = ctypes.windll.kernel32
    handle = kernel.OpenProcess(0x1000 | 0x00100000, False, int(pid))   # QUERY_LIMITED_INFORMATION | SYNCHRONIZE
    if not handle:
        return None
    try:
        code = ctypes.c_ulong()
        if not kernel.GetExitCodeProcess(handle, ctypes.byref(code)) or code.value != 259:   # STILL_ACTIVE
            return None
        size = ctypes.c_ulong(1024)
        buffer = ctypes.create_unicode_buffer(1024)
        if not kernel.QueryFullProcessImageNameW(handle, 0, buffer, ctypes.byref(size)):
            return None
        return os.path.basename(buffer.value).lower()
    finally:
        kernel.CloseHandle(handle)


class QuestAccess:
    def __init__(self, root, port, token):
        self.root, self.port, self.token = root, port, token
        self.host = self.code = self.pid = None
        self.code_until = 0
        self.sessions, self.attempts = {}, {}
        self.starting = False
        self.state_file = root / 'data/access.json'
        self.adopt()

    # ---- persistence: the tunnel outlives a server restart ----
    def tunnel_alive(self):
        return bool(self.pid) and (_process_name(self.pid) or '').startswith('cloudflared')

    def adopt(self):
        """Pick up the tunnel and pairings a previous run of the server left behind, if that tunnel is still up."""
        with contextlib.suppress(OSError, ValueError, TypeError):
            saved = json.loads(self.state_file.read_text(encoding='utf-8'))
            self.pid = saved.get('pid')
            if self.tunnel_alive() and saved.get('host'):
                now = time.time()
                self.host, self.code, self.code_until = saved['host'], saved.get('code'), saved.get('code_until', 0)
                self.sessions = {k: v for k, v in saved.get('sessions', {}).items() if v > now}
            else:
                self.pid = None

    def save(self):
        with contextlib.suppress(OSError):
            self.state_file.parent.mkdir(exist_ok=True)
            self.state_file.write_text(json.dumps({'pid': self.pid, 'host': self.host, 'code': self.code, 'code_until': self.code_until,
                                                   'sessions': self.sessions}), encoding='utf-8')

    def local(self, request):
        return request.host in (f'localhost:{self.port}', f'127.0.0.1:{self.port}') and not request.headers.get('CF-Ray')

    def authorized(self, request):
        return self.local(request) or self.sessions.get(request.cookies.get('office_pair', ''), 0) > time.time()

    @web.middleware
    async def middleware(self, request, handler):
        local = self.local(request)
        if not local and request.host != self.host:
            raise web.HTTPForbidden(text='Unknown host')
        origins = (f'http://localhost:{self.port}', f'http://127.0.0.1:{self.port}') if local else (f'https://{self.host}',)
        if request.headers.get('Origin') and request.headers['Origin'] not in origins:
            raise web.HTTPForbidden(text='Invalid origin')
        if request.path.startswith('/api/') and request.path != '/api/pair' and not self.authorized(request):
            raise web.HTTPUnauthorized(text='Pair this headset with the code on your PC.')
        if request.method != 'GET' and request.path != '/api/pair' and request.headers.get(TOKEN_HEADER) != self.token:
            raise web.HTTPForbidden(text='Invalid session token')
        result = await handler(request)
        result.headers['X-Content-Type-Options'] = 'nosniff'
        result.headers['Referrer-Policy'] = 'same-origin'
        result.headers['Permissions-Policy'] = 'xr-spatial-tracking=(self), microphone=(self)'
        if request.path.startswith('/api/'):
            result.headers['Cache-Control'] = 'no-store'
        return result

    def info(self):
        if self.pid and not self.tunnel_alive():         # cloudflared ended on its own
            self.pid = self.host = None; self.sessions = {}; self.save()
        return {'url': f'https://{self.host}/office.html' if self.host else None,
                'code': self.code if self.code_until > time.time() else None,
                'running': self.tunnel_alive(),
                'pairedDevices': sum(v > time.time() for v in self.sessions.values())}

    async def status(self, request):
        if not self.local(request):
            raise web.HTTPForbidden()
        return web.json_response(self.info())

    async def pair(self, request):
        if self.local(request):
            return web.json_response({'paired': True})
        identity = request.headers.get('CF-Connecting-IP', request.remote or 'unknown')
        now = time.time()
        self.attempts = {k: [t for t in v if now - t < 600] for k, v in self.attempts.items()}
        failed = self.attempts.get(identity, [])
        if len(failed) >= 5 or sum(len(v) for v in self.attempts.values()) > 50:
            raise web.HTTPTooManyRequests(text='Too many attempts. Wait ten minutes or renew the code on your PC.')
        given = str((await request.json()).get('code', '')).strip()
        if not self.code or now > self.code_until or not secrets.compare_digest(given, self.code):
            failed.append(now)
            self.attempts[identity] = failed
            raise web.HTTPUnauthorized(text='That code is not valid. Check the code shown on your PC.')
        cookie = secrets.token_urlsafe(32)
        self.sessions[cookie] = now + 8 * 3600
        self.save()
        result = web.json_response({'paired': True})
        result.set_cookie('office_pair', cookie, secure=True, httponly=True, samesite='Strict', max_age=8 * 3600, path='/')
        self.attempts.pop(identity, None)
        return result

    def renew(self):
        self.code = f'{secrets.randbelow(1000000):06d}'
        self.code_until = time.time() + 7200
        self.attempts = {}
        self.save()

    async def rotate(self, request):
        if not self.local(request):
            raise web.HTTPForbidden()
        self.renew()
        return web.json_response(self.info())

    async def start(self, request):
        if not self.local(request):
            raise web.HTTPForbidden()
        if self.starting:
            raise web.HTTPConflict(text='The link is starting. Please wait.')
        if self.tunnel_alive() and self.host:
            if not self.code or self.code_until < time.time():
                self.renew()
            return web.json_response(self.info())
        binary = self.root / 'tools/cloudflared.exe'
        if not binary.exists():
            raise web.HTTPServiceUnavailable(text='tools/cloudflared.exe is missing.')
        self.starting = True
        log_path = self.root / 'data/cloudflare.log'
        try:
            # Its own process group, logging to a file rather than a pipe, so it keeps running when the server restarts.
            log_path.parent.mkdir(exist_ok=True)
            with log_path.open('w', encoding='utf-8') as log:
                process = subprocess.Popen(
                    [str(binary), 'tunnel', '--no-autoupdate', '--protocol', 'http2', '--url', f'http://127.0.0.1:{self.port}'],
                    stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=log, close_fds=True,
                    **({'creationflags': 0x08000000 | 0x00000200} if os.name == 'nt' else {'start_new_session': True}))
            self.pid, self.host, self.sessions = process.pid, None, {}
            for _ in range(90):
                await asyncio.sleep(.5)
                match = re.search(r'https://([a-z0-9-]+\.trycloudflare\.com)', log_path.read_text(encoding='utf-8', errors='replace'))
                if match:
                    self.host = match.group(1)
                    self.renew()
                    return web.json_response(self.info())
                if process.poll() is not None:
                    break
            with contextlib.suppress(OSError):
                process.kill()
            self.pid = None
            self.save()
            raise web.HTTPServiceUnavailable(text='Cloudflare could not open the link. See data/cloudflare.log.')
        finally:
            self.starting = False

    async def stop(self, request):
        if not self.local(request):
            raise web.HTTPForbidden()
        if self.tunnel_alive():
            with contextlib.suppress(OSError, subprocess.SubprocessError):
                subprocess.run(['taskkill', '/F', '/PID', str(self.pid)] if os.name == 'nt' else ['kill', str(self.pid)], capture_output=True, timeout=10)
        self.pid = self.host = self.code = None
        self.sessions = {}
        self.save()
        return web.json_response(self.info())

    async def cleanup(self, app):
        # Deliberately leaves the tunnel running: a restarted server adopts it (see adopt), so the headset keeps its link.
        self.save()
