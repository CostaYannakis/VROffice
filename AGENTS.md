# Brick Office: notes for coding agents

This repo is a mixed reality office (Quest 3, WebXR, three.js) served by `server.py`. The boss is usually **inside the office in the headset while you work**, so prefer changes that apply live.

## Adding things to the office live: mods

To make something appear in the office (a pot plant on a desk, a poster, a rug, a lamp, a sign, a hat on a worker, lighting), **write a mod**: one file in `web/mods/` for the Enterprise office, or in `web/mods/sandbox/` for the Sandbox office (an empty room the boss builds up from scratch; it is twice the office's width and depth: `SANDBOX_ROOM` in `web/environment.js` gives its walls, about x -9.2 to 9.2 and z -8.8 to 6.4, while `ROOM` is the Enterprise office). **Which office is the boss in right now?** Read `.office-mode` in the repo root (`sandbox` or `enterprise`); tasks from the office also end with a note saying so. A mod in the wrong folder is invisible to the boss. Saving it makes it appear in every open office, in the headset too, within about a second. No refresh, no server restart. Editing the file rebuilds it; deleting the file removes it. Use one file per thing, named for what it is (`pot-plant.js`, `party-hat.js`). Files starting with `_` are ignored.

```js
// web/mods/desk-lamp.js
export default function (ctx) {
  const { THREE } = ctx;
  const lamp = ctx.brick(.08, .04, .08, '#2b2e35');                  // brick base, studs on top
  ctx.add(lamp, { desk: 'clyde', onDesk: true, at: [-.6, 0, -.25] }); // back-left corner of Clyde's desk
  ctx.onFrame((dt, t) => { /* animate */ });                          // optional
  return () => { /* optional cleanup */ };
}
```

`ctx`:
- `THREE` — three.js. Units are metres; the floor is y = 0.
- `add(object, { desk, onDesk, at, rotateY })` — place an object. Without `desk` it goes in office space (the boss starts near x = 0, z = 0 facing -z; desks are around z = -2). With `desk: '<worker id>'` it is relative to that desk: x across the desk (-0.75 to 0.75), z towards the chair (+) or the monitor (-). `onDesk: true` puts y = 0 on the desk top (desk is 1.5 × 0.75 m, 0.74 m high; the monitor and keyboard sit around x = 0).
- `attach(workerId, 'head' | 'torso' | 'left' | 'right', object, { at })` — fix something to a worker's body (hats, badges, held items). Figures are cartoon people about 1.75 m tall, facing +z. Head: a big egg-shaped head from about 0 to 0.53 m above the head pivot (hair to 0.56 m), 0.5 m wide and 0.5 m deep, face on the front (z ≈ 0.24 m); a hat sits at `at: [0, .52, 0]`. Torso: the top runs from the torso pivot to about 0.55 m above it, front at z ≈ 0.17 m; an ID badge is clipped on the wearer's left chest.
- `onFrame(fn(dt, t))`, `onCleanup(fn)`, `notice(text)`.
- `workers` / `worker(id)` — `{ id, name, status, task }`. Ids: `clyde`, `dex`.
- `brick(w, h, d, color)`, `material(color, options)`, `label(text, { width })` — toy-brick building blocks.
- `DESK`, `office`, `scene` for anything more advanced.

Everything you add through `ctx` is cleaned up automatically on reload. A mod that throws shows its error in the office and leaves the rest running. Keep the brick look: chunky shapes, bright plastic colours, studs. The workers are simple cartoon people (big round head, drawn face, round hands); don't make anything that copies a real brand's characters, figures or logos.

**The Sandbox starts fresh** (unless `OFFICE_SANDBOX_FRESH=0` is set in `.env`, which keeps the build). Each time the boss opens it (a page load or switching into Sandbox, unless another page is already in there), the server saves everything in `web/mods/sandbox/` and empties the folder: in a git checkout it is committed to the `sandbox-saves` branch under `saves/<date_time>/` (without checking it out); otherwise it is copied to `data/sandbox-saves/<date_time>/`. `web/mods/sandbox/` is git-ignored: don't commit sandbox mods to the working branch. To bring a build back: `git ls-tree --name-only sandbox-saves:saves` to list saves, then `git show sandbox-saves:saves/<stamp>/<file>.js > web/mods/sandbox/<file>.js` (or copy it back from `data/sandbox-saves/<stamp>/`).

## Git: stay on the current branch

The office serves this folder's working tree live, so the headset shows whatever is checked out. **Never switch, create-and-checkout or reset branches here** unless the boss asks: it makes their office change under them (mods vanish or reappear). Commit to the branch that is checked out.

## Other live edits

The headset page is split in two. `web/shell.js` is permanent: it owns the renderer, the passthrough session and the frame loop. `web/office.js` (with everything it imports) is the office app running inside it.

- Saving `office.js`, `voice.js` or `termview.js` swaps in a fresh copy of the whole office **without leaving passthrough**: the old copy tears down (sockets, timers, listeners, scene) and hands over the session, its place in the room, the voice line and audio. If the new `office.js` fails to load (syntax error), the running office stays and the error shows in the office. Anything `office.js` starts must be undone in `disposeApp()`: register it with `later(fn)`.
- Saving `avatar.js`, `janitor.js`, `arthur.js`, `furniture.js`, `whiteboard.js`, `dog.js`, `blaster.js`, `flyers.js`, `hands.js`, `room.js`, `clock.js`, `sfx.js`, `mods.js` or `style.css` hot-swaps just that part.
- Only `office.html` and `shell.js` need a real page reload (that does end passthrough; avoid changing them).
- Import three.js as `'three'`, never by path, or a second copy of three.js loads.
- Server changes (`server.py`, `access.py`, `terminals.py`) need `restart-office.ps1`, which keeps the Quest link and pairing but restarts the worker terminals (including yours), so tell the boss before running it. `workers.py` reloads by itself at the next voice connection.
