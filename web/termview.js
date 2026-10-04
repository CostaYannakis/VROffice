// Terminal screens from the server (pyte runs) drawn onto a canvas.
// Shared by the desktop dashboard and the monitors in the Quest office.

const PALETTE = {
  black: '#1e2329', red: '#e06c75', green: '#7bc96f', brown: '#e5c07b', blue: '#61afef',
  magenta: '#c678dd', cyan: '#56b6c2', white: '#d7dae0',
  brightblack: '#6b7380', brightred: '#ff7b86', brightgreen: '#98e08c', brightbrown: '#f2d58e',
  brightblue: '#82c3ff', brightmagenta: '#dc9cf0', brightcyan: '#7fd6e0', brightwhite: '#ffffff',
};
export const TERM_FG = '#d8dde6';
export const TERM_BG = '#0f141b';

function color(name, fallback) {
  if (!name || name === 'default') return fallback;
  if (name === 'rev-fg') return TERM_BG;
  if (name === 'rev-bg') return TERM_FG;
  return PALETTE[name] || (/^[0-9a-f]{6}$/i.test(name) ? '#' + name : fallback);
}

export class ScreenModel {
  constructor() { this.cols = 100; this.rows = 32; this.lines = []; this.cursor = [0, 0, false]; this.dirty = new Set(); this.version = 0; }
  apply(msg) {
    if (msg.full || msg.cols !== this.cols || msg.rows !== this.rows) {
      this.cols = msg.cols; this.rows = msg.rows; this.lines = Array.from({ length: this.rows }, () => []);
      for (let y = 0; y < this.rows; y++) this.dirty.add(y);
    }
    for (const [row, runs] of Object.entries(msg.lines)) { this.lines[+row] = runs; this.dirty.add(+row); }
    const [ox, oy] = this.cursor;
    this.cursor = msg.cursor; this.dirty.add(oy); this.dirty.add(msg.cursor[1]);
    if (ox !== msg.cursor[0]) this.dirty.add(msg.cursor[1]);
    this.version++;
  }
  text() {
    return this.lines.map(runs => runs.map(r => r[0]).join('').trimEnd()).join('\n').trimEnd();
  }
}

export class TerminalCanvas {
  constructor(model, { cell = [20, 38], font = 32, pad = 18, canvas } = {}) {
    this.model = model; this.cw = cell[0]; this.ch = cell[1]; this.pad = pad; this.fontSize = font;
    this.canvas = canvas || document.createElement('canvas');
    this.resize();
    this.showCursor = true; this.focused = false;
  }
  resize() {
    this.canvas.width = this.model.cols * this.cw + this.pad * 2;
    this.canvas.height = this.model.rows * this.ch + this.pad * 2;
    this.ctx = this.canvas.getContext('2d');
    this.ctx.fillStyle = TERM_BG; this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.ctx.textBaseline = 'middle';
    for (let y = 0; y < this.model.rows; y++) this.model.dirty.add(y);
    this.size = [this.model.cols, this.model.rows];
  }
  // Returns true when anything was redrawn.
  draw() {
    const m = this.model;
    if (this.size[0] !== m.cols || this.size[1] !== m.rows) this.resize();
    if (!m.dirty.size) return false;
    const { ctx, cw, ch, pad } = this;
    const fonts = [`${this.fontSize}px "Cascadia Mono", Consolas, "DejaVu Sans Mono", "Noto Sans Mono", monospace`,
                   `bold ${this.fontSize}px "Cascadia Mono", Consolas, "DejaVu Sans Mono", "Noto Sans Mono", monospace`];
    for (const y of m.dirty) {
      if (y < 0 || y >= m.rows) continue;
      const top = pad + y * ch;
      ctx.fillStyle = TERM_BG; ctx.fillRect(0, top, this.canvas.width, ch);
      let x = 0;
      for (const [text, fg, bg, flags] of m.lines[y] || []) {
        const chars = [...text];
        if (bg && bg !== 'default') { ctx.fillStyle = color(bg, TERM_BG); ctx.fillRect(pad + x * cw, top, chars.length * cw, ch); }
        ctx.font = fonts[flags & 1]; ctx.fillStyle = color(fg, TERM_FG);
        for (let i = 0; i < chars.length; i++) {
          const c = chars[i];
          if (c !== ' ') {
            if (c === '─' || c === '━') ctx.fillRect(pad + (x + i) * cw, top + ch / 2 - 1, cw, 2);     // seamless rules
            else if (c === '│') ctx.fillRect(pad + (x + i) * cw + cw / 2 - 1, top, 2, ch);
            else ctx.fillText(c, pad + (x + i) * cw, top + ch / 2 + 1);
          }
        }
        if (flags & 4) ctx.fillRect(pad + x * cw, top + ch - 4, chars.length * cw, 2);
        x += chars.length;
      }
      const [cx, cy, visible] = m.cursor;
      if (cy === y && visible && this.showCursor) {
        ctx.fillStyle = this.focused ? '#f8ce52' : '#f8ce5299';
        ctx.fillRect(pad + cx * cw, top + 4, cw, ch - 8);
      }
    }
    m.dirty.clear();
    return true;
  }
}

// Live connection to one worker's terminal.
export class TermClient {
  constructor(workerId, token, { onScreen, onWorker } = {}) {
    this.workerId = workerId; this.token = token; this.model = new ScreenModel();
    this.onScreen = onScreen || (() => {}); this.onWorker = onWorker || (() => {});
    this.closed = false; this.retry = 500; this.connect();
  }
  connect() {
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${location.host}/api/term?worker=${encodeURIComponent(this.workerId)}&token=${encodeURIComponent(this.token)}`);
    this.ws = ws;
    ws.onopen = () => { this.retry = 500; };
    ws.onmessage = e => {
      const msg = JSON.parse(e.data);
      if (msg.type === 'screen') { this.model.apply(msg); this.onScreen(this.model); }
      else if (msg.type === 'worker') this.onWorker(msg);
    };
    ws.onclose = () => {
      if (this.closed) return;
      setTimeout(() => this.connect(), this.retry); this.retry = Math.min(this.retry * 2, 8000);
    };
  }
  send(body) { if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(body)); }
  input(data) { this.send({ type: 'input', data }); }
  keys(keys) { this.send({ type: 'keys', keys }); }
  close() { this.closed = true; this.ws?.close(); }
}

// Translate a browser keydown into terminal bytes.
export function keyToSequence(e) {
  const map = { Enter: '\r', Backspace: '\x7f', Tab: e.shiftKey ? '\x1b[Z' : '\t', Escape: '\x1b',
    ArrowUp: '\x1b[A', ArrowDown: '\x1b[B', ArrowRight: '\x1b[C', ArrowLeft: '\x1b[D',
    Home: '\x1b[H', End: '\x1b[F', Delete: '\x1b[3~', PageUp: '\x1b[5~', PageDown: '\x1b[6~' };
  if (map[e.key]) return e.key === 'Enter' && e.shiftKey ? '\x1b\r' : map[e.key];
  if (e.ctrlKey && !e.altKey && e.key.length === 1) {
    const code = e.key.toUpperCase().charCodeAt(0);
    if (code >= 64 && code <= 95) return String.fromCharCode(code - 64);
  }
  if (e.altKey && e.key.length === 1) return '\x1b' + e.key;
  if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) return e.key;
  return null;
}
