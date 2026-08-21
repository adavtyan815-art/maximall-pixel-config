# Claude Code Guide — Maximall Pixel Streaming Infrastructure (`maximall-pixel-config`)

---

## 1. Project Overview

`maximall-pixel-config` is the WebRTC signaling and frontend player infrastructure for Epic Games Pixel Streaming on AWS GPU instances (`g4dn.2xlarge` - NVIDIA Tesla T4, AMI `LinuxClientAMI`).

- **What it does**: Runs the Wilbur signaling server (`SignallingWebServer`), bridges WebRTC signaling between Unreal Engine 5 (`awsTutorial`) and web browsers, and serves the frontend player web application.
- **Deep Source of Truth**: Before making architectural, signaling, or frontend changes, Claude Code **must read** [`docs/MAXIMALL_PIXEL_CONFIG_GUIDE.md`](docs/MAXIMALL_PIXEL_CONFIG_GUIDE.md).

---

## 2. Essential Commands

```bash
# Full Workspace Build (Signalling, Frontend libs, Wilbur)
npm run build

# Build Development Frontend Player Bundle (Unminified with source maps in www/)
cd Frontend/implementations/typescript && npm run build:dev && cd ../../..

# Build Production Minified Frontend Player Bundle
cd Frontend/implementations/typescript && npm run build && cd ../../..

# Start Local Signaling Server for Testing
cd SignallingWebServer && npm start
```

---

## 3. Critical Invariants & Rules

1. **No Artificial Mouse Throttling**:
   - `MouseControllerHovering.ts` and `MouseControllerLocked.ts` must remain unthrottled. Never introduce artificial delays or `setTimeout` into mouse events.
2. **Inactivity Watchdog & Russian Modals**:
   - The player watchdog modal (*"Вы ещё здесь?"*) must remain in clean, professional Russian.
3. **Socket.io Event Contracts**:
   - `display-start`, `heartbeat`, `user-activity`, `instance-stopping`, and `player-disconnect` are hard contracts with `maximall-web`. Do not alter payloads or event names.
4. **Target Path on Linux**:
   - `SignallingWebServer/config.json` must retain `"http_root": "/home/ssm-user/web/SignallingWebServer/www"`.
5. **Source vs. Runtime Output**:
   - Edit source files in `Frontend/` and `Signalling/`.
   - Never manually edit compiled bundles in `SignallingWebServer/www/` — always regenerate them via Webpack build.

---

## 4. Change Verification Workflow

Always verify before committing:
1. Run full build: `npm run build`.
2. Build frontend player: `cd Frontend/implementations/typescript && npm run build:dev && cd ../../..`.
3. Verify that `SignallingWebServer/www/player.js` compiles cleanly without TypeScript or Webpack errors.
