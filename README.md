# Brick Office

A virtual office for Meta Quest 3 where your AI coding agents work at desks as life-size cartoon people: big round heads, simple drawn faces that talk and react, and an ID badge whose light shows when they're working or need you. Each agent drives a **real terminal on your PC**, running Claude Code or OpenAI Codex in a project folder, and its desk monitor shows that terminal live. Walk up to an agent and talk: it hands your request to its terminal, tells you when the work is done, and asks before approving anything.

The office can change while you stand in it. Ask an agent for "a pot plant on my desk" and it writes a small **live mod**; the plant appears within seconds, in the headset, with no reload. Almost every part of the office hot-swaps the same way, so you can rebuild the place from inside it.

https://github.com/CostaYannakis/VROffice

## What's in it

- **Two agents**, Clyde (Claude Code) and Dex (Codex), each at a desk with a live terminal monitor and a key pad.
- **Voice** (Gemini Live): talk to whoever you're looking at. They delegate to their terminal, read the screen back to you, and report finished work and approval prompts.
- **A walled virtual office**: floor, windows onto a skyline, ceiling lights, a project whiteboard, a wall clock and an office dog.
- **Getting around without walking**: thumbstick movement, snap turn and teleport with controllers; pinch at the floor to teleport with hand tracking.
- **Hands-on**: cartoon mitten hands, grab / lift / throw / slap / pat the agents, lead them by the hand, office party, two toy blasters in hip holsters and flying targets.
- **Live mods** (`web/mods/`): one small JS file per thing; saving it makes it appear in every open office within about a second.
- **Live code**: the headset page is a permanent shell (`web/shell.js`) running a swappable office (`web/office.js`). Editing the office's code swaps it in without leaving VR; a broken edit is rejected and the running office stays.
- **Memory**: agents remember recent conversations, their work log and the project board, and can save notes across sessions.
- **Passthrough mode** (optional): add `?passthrough` to the office URL to place the office in your real room instead, fitted to your scanned walls.

## Two offices: Enterprise and Sandbox

Pick one on the office page (or switch any time from the wrist menu, without leaving VR); each device remembers its choice, and `?mode=sandbox` or `?mode=enterprise` on the URL overrides it.

- **Enterprise** is the full office for day-to-day work: the project whiteboard, wall clock, rug, the office dog, toy blasters and target drones, plus the mods in `web/mods/`.
- **Sandbox** is an empty room with your two agents at their desks and nothing else. Ask them to build whatever you want; sandbox mods live in `web/mods/sandbox/`, so they never clutter the Enterprise office (and the other way round). It starts empty each time you open it: the last build is saved first (to the `sandbox-saves` git branch, or to `data/sandbox-saves/` outside a git checkout), so you can bring any of it back.

The agents are told which office you're in, so "build me a lamp" lands in the right one.

## Requirements

- Windows 10/11 PC (terminals use ConPTY), Python 3.12+.
- [Claude Code](https://docs.claude.com/en/docs/claude-code) and/or [Codex CLI](https://github.com/openai/codex) installed and logged in.
- For the voice line, either a [Gemini API key](https://aistudio.google.com/apikey) (easiest) or a Google Cloud project with Vertex AI and Application Default Credentials (`gcloud auth application-default login`). Without either, everything works except voice.
- `tools/cloudflared.exe` ([Cloudflare Tunnel client](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)) for the private Quest link.
- Meta Quest 3 (Quest Browser). A desktop browser works as a preview.

## Start

1. `pip install -r requirements.txt` and put `cloudflared.exe` in `tools/`. For voice, copy `.env.example` to `.env` and set `GEMINI_API_KEY`.
2. Double-click `start-office.cmd`. The dashboard opens at http://localhost:8120. On first run `workers.json` is created with Clyde and Dex working in this folder; edit it or use **Hire a worker** on the dashboard to point them at your own projects.
3. The first time an agent opens a folder, Claude/Codex asks whether to trust it. Answer on the dashboard (click the screen, use arrows and Enter) or by voice.
4. **Quest:** click **Create Quest link** on the dashboard, open the link in Quest Browser and enter the six-digit code.
5. In the headset: **1 · Enable voice & microphone**, then **2 · Enter the office (VR)**.

Desktop preview without a headset: http://localhost:8120/office.html.

Optional `.env` in this folder (see `.env.example`): `GEMINI_API_KEY` (or `GOOGLE_API_KEY`), `OFFICE_PORT`, `OFFICE_GOOGLE_PROJECT` (Vertex AI; defaults to your ADC project), `OFFICE_GOOGLE_LOCATION`, `OFFICE_VOICE_MODEL`, `OFFICE_SESSION_USD`, `OFFICE_DAILY_USD`, `OFFICE_SESSION_MINUTES`, `OFFICE_IDLE_SECONDS`.

## Working with your agents

- **Talk:** look at an agent within about 3 m. After a moment they greet you. Only one agent holds the voice line at a time.
- **Give work:** "Clyde, add a dark mode toggle to the settings page." The agent types your request into its terminal.
- **Progress:** "How's it going?" makes them read their screen and summarise it. When the terminal finishes, they tell you; a ✓ and a chime appear at their desk.
- **Approvals:** permission prompts show a "!" over the agent. They describe the request and wait. **Approving keys are blocked on the server unless you said a decision word ("yes", "go ahead", "skip", "option two"…) after that prompt appeared**, so an agent cannot approve on its own.
- **Change the office:** "Dex, put a lamp on my desk." The agent asks its terminal to write a live mod (see `AGENTS.md`). This works for agents on other projects too: the task tells their terminal where the office's mods folder is, and Claude Code agents are given write access to it (`--add-dir`). A Codex agent asks you to approve the write, or add `"--add-dir", "<path to web/mods>"` to its `args` in `workers.json`.
- **Project board:** "Add a card for the login page, owner Clyde, doing." It shows on the office whiteboard and the dashboard.
- **Big screen:** wrist menu → BIG SCREEN floats the active agent's terminal in front of you.

### Hiring and letting agents go

From the folder you want the new agent to work in:

```
python C:\path\to\vroffice\tools\onboard.py               # name, agent, voice, colours and desk picked for you
python tools\onboard.py --name Nova --agent codex --persona "Dry wit, very thorough."
python tools\onboard.py --dry-run                         # show the plan only
```

With the office running, the agent starts in its own terminal in that folder, its desk appears in every open office at the first clear spot (near the back row), and once its prompt is ready it is briefed: who it is, who it works with, and to read `AGENTS.md`/`README.md` and report in before changing anything. With the office stopped, `workers.json` and `data/layout.json` are updated and it starts with the office.

```
python tools\offboard.py --list          # the team
python tools\offboard.py nova            # stop the terminal, remove the desk (asks first)
python tools\offboard.py nova --forget   # also erase their memories, conversations and work log
```

Offboarding never touches the agent's project folder, and keeps its history unless you pass `--forget`, so hiring the same id again brings it back.

## Controls

| Action | Controllers | Hand tracking |
| --- | --- | --- |
| Move | Left thumbstick (the way you look) | Teleport |
| Turn | Right thumbstick left/right (30° snap) | Wrist menu → TURN LEFT / TURN RIGHT |
| Teleport | Push the right stick forward to aim, release to jump | Pinch while pointing at the floor, release to jump |
| Wrist menu | Follows the left controller; aim the right ray and pull the trigger | Turn your left palm towards your face; poke with your right index finger |
| Grab / move | Grip button nearby, or aim and hold the trigger | Pinch or fist nearby, or pinch while aiming |
| Blasters | Grip at your hip to draw, trigger to fire, back to the hip to holster | Grab at your hip, curl your index finger or pinch to fire |
| Slap / pat / poke | Swing into them fast / touch gently | Same |

Desktop preview: drag an agent to lift or throw them, Shift-click to slap, double-click to talk, click pad keys.

## Making things appear: live mods

A mod is one file in `web/mods/` that default-exports a function receiving `ctx`:

```js
export default function (ctx) {
  const lamp = ctx.brick(.08, .04, .08, '#2b3644');
  ctx.add(lamp, { desk: 'clyde', onDesk: true, at: [-.6, 0, -.25] });
}
```

Save it and it appears; edit it and it is rebuilt; delete it and it goes away. `AGENTS.md` documents `ctx` (placement on desks, attaching things to agents, per-frame animation, brick and label helpers) and is what Claude Code and Codex read when you ask them to change the office.

## How it works

```
Quest Browser ──HTTPS/WSS (Cloudflare Quick Tunnel, pairing code)──┐
Dashboard (localhost) ─────────────────────────────────────────────┤
                                                                    ▼
                         server.py (aiohttp, 127.0.0.1:8120)
           ├─ terminals.py: ConPTY (pywinpty) per agent → pyte screen → /api/term
           ├─ /api/live: Gemini Live (API key or Vertex AI) ⇄ mic audio / voice audio
           │     tools: assign_task, read_terminal, press_keys (consent-gated), perform, memory, project board
           ├─ /api/mods + file watcher: live mods and module hot-swaps pushed to every open office
           └─ terminal events (working → idle, approval) → spoken reports

web/shell.js (permanent: renderer, XR session, frame loop)
  └─ web/office.js (swappable office) → avatar, furniture, environment, locomotion, hands, blasters, whiteboard, mods …
```

- The server serves each module with its imports pinned to their current versions, so re-importing a module picks up fresh copies of everything it depends on.
- `restart-office.ps1` restarts the server in place: the Quest link, pairing and page token survive, so a headset already in the office reconnects by itself (the agents' terminals do restart).
- Memory, transcripts, the work log, the project board and usage live in `data/office.sqlite3` (git-ignored).
- Spending: estimated, US$1 per voice session and US$5 per day by default. These are app estimates, not a billing cap.

## Security

This gives a headset control over real terminals on your PC, so treat it like remote access:

- The server binds to localhost only. The Quest link is a Cloudflare Quick Tunnel protected by a six-digit code (5 attempts per 10 minutes, code valid 2 hours, device cookie 8 hours). **Close link** on the dashboard revokes all Quest access.
- Terminal text passes through Cloudflare while the link is open, and terminal excerpts are sent to Google as voice context.
- Live mods are ordinary JavaScript running in the office page, written by your agents. Review what they write before sharing an office with anyone else.
- Agents use your normal Claude Code / Codex permission settings. Bypass flags make an agent run commands without asking anybody.

## Status

Tested in the desktop preview and an emulated Quest 3 (IWER). Not yet tuned on every physical headset: expect to adjust movement speed, grab distances and gesture thresholds after a real session. Contributions welcome.

## License

MIT. See `LICENSE`. The characters and brick style are original to this project and not affiliated with any toy brand.
