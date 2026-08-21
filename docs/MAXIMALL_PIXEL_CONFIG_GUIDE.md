# Maximall Pixel Config: Master Architecture & Runtime Source of Truth

> **Repository**: `https://github.com/adavtyan815-art/maximall-pixel-config.git`  
> **Primary Purpose**: Epic Games Pixel Streaming Infrastructure (Wilbur Signaling Server, Frontend Web Player, WebRTC Media Pipeline)  
> **Deployed Environment**: AWS EC2 GPU instances (`g4dn.2xlarge` - NVIDIA Tesla T4, AMI `LinuxClientAMI`)  
> **Runtime Baseline**: Reconciled and validated against verified AWS EC2 production deployment (`/home/ssm-user/web`).  

---

## Table of Contents
1. [System Overview & Purpose](#1-system-overview--purpose)
2. [Ecosystem Relationships & Contracts](#2-ecosystem-relationships--contracts)
3. [Signaling & Web Server Architecture](#3-signaling--web-server-architecture)
4. [Frontend Web Player Architecture (`Frontend/`)](#4-frontend-web-player-architecture-frontend)
5. [Data Channel Protocols & User Experience Features](#5-data-channel-protocols--user-experience-features)
6. [Repository Structure: Source vs. Runtime Outputs](#6-repository-structure-source-vs-runtime-outputs)
7. [Build & Packaging Pipeline](#7-build--packaging-pipeline)
8. [Protected Runtime Invariants (DO NOT BREAK THESE RULES)](#8-protected-runtime-invariants-do-not-break-these-rules)
9. [Deployment & Update Procedure on AWS EC2](#9-deployment--update-procedure-on-aws-ec2)
10. [Runtime Parity & Verification Standards](#10-runtime-parity--verification-standards)
11. [Testing Checklist After Modifications](#11-testing-checklist-after-modifications)
12. [Common Failure Modes & Troubleshooting](#12-common-failure-modes--troubleshooting)
13. [AI Agent Operating Rules](#13-ai-agent-operating-rules)

---

## 1. System Overview & Purpose

`maximall-pixel-config` contains the complete WebRTC signaling server, frontend web player application, and protocol libraries for streaming Unreal Engine 5 (`awsTutorial`) instances to browser clients with sub-second latency.

```mermaid
flowchart LR
    subgraph ClientBrowser [Browser Client]
        DOM[HTML5 Video Element]
        PlayerTS[player.ts / Socket.io Client]
    end

    subgraph BackendOrchestrator [maximall-web (Node.js/Express)]
        Proxy[WSS Reverse Proxy]
        Scaling[Pool Manager]
    end

    subgraph AWSEC2 [AWS EC2 GPU Instance (g4dn.2xlarge)]
        Wilbur[SignallingWebServer / Wilbur (Port 8000)]
        UE5[awsTutorial Linux App (NVENC)]
    end

    DOM <-->|WebRTC Media & DataChannel| UE5
    PlayerTS <-->|WSS Signaling via Reverse Proxy| Proxy
    Proxy <-->|Private IP TCP 8000| Wilbur
    Wilbur <-->|Localhost TCP 8888 (Cirrus)| UE5
    PlayerTS <-->|Socket.io Keepalive & Idle Timer| BackendOrchestrator
```

---

## 2. Ecosystem Relationships & Contracts

### 2.1 Relationship with `awsTutorial` (Unreal Engine 5)
- **Local Streamer Connection**: The packaged Unreal Engine application launches on the same EC2 instance and connects to Wilbur over localhost on TCP port `8888` via the Cirrus protocol.
- **Media Encoding**: Unreal Engine captures frames directly from the GPU and encodes H.264/H.265 video via NVIDIA NVENC.
- **Bidirectional Data Channel**: WebRTC data channels transmit input events (mouse, keyboard, touch) to UE5 and receive application responses (URL redirects, cursor changes).

### 2.2 Relationship with `maximall-web` (Orchestration Backend)
- **Intra-VPC Private-IP Proxy**: `maximall-web` reverse-proxies user browser traffic (`/instance/:uuid/ws`) directly to the GPU instance private IP on port `8000` (`http://172.31.x.x:8000/`).
- **Socket.io Control Channel**: `player.ts` connects back to `maximall-web`'s origin to exchange lifecycle events:
  - `display-start`: Registers the active display session with the orchestrator.
  - `heartbeat`: 10-second ping maintaining instance lease.
  - `user-activity`: Debounced notification that resets backend inactivity timers.
  - `instance-stopping`: Notification from backend instructing the player to redirect cleanly before EC2 shutdown.

---

## 3. Signaling & Web Server Architecture

### 3.1 Server Configuration (`SignallingWebServer/config.json`)
```json
{
  "log_folder": "logs",
  "log_level_console": "info",
  "log_level_file": "info",
  "streamer_port": "8888",
  "player_port": "8000",
  "sfu_port": "8889",
  "serve": true,
  "http_root": "/home/ssm-user/web/SignallingWebServer/www",
  "homepage": "player.html",
  "https": false,
  "https_port": 443,
  "ssl_key_path": "certificates/client-key.pem",
  "ssl_cert_path": "certificates/client-cert.pem",
  "https_redirect": true,
  "rest_api": false,
  "peer_options": "",
  "log_config": true,
  "stdin": false,
  "console_messages": "verbose"
}
```

### 3.2 Network Ports & Protocols:
| Port | Protocol | Purpose | Internal / External |
|---|---|---|---|
| **8000** | TCP / HTTP & WS | Player web assets & WebRTC signaling | Reverse-proxied by `maximall-web` |
| **8888** | TCP / WS | Local Unreal Engine Streamer connection | Localhost / Intra-instance only |
| **8889** | TCP / WS | SFU (Selective Forwarding Unit) port | Internal |
| **3478** | UDP / TCP | STUN / TURN NAT traversal (Coturn) | External / AWS Security Group |
| **49152–65535** | UDP | WebRTC SRTP/SRTCP media streams | External / AWS Security Group |

---

## 4. Frontend Web Player Architecture (`Frontend/`)

### 4.1 Key Implementation Details in `player.ts`:

1. **Global Cursor Sentinel Class (`lmb-down`)**:
   - Injects `<style id="lmb-cursor-hide">html.lmb-down, html.lmb-down * { cursor: none !important; }</style>`.
   - Toggles on `mousedown` (button 0) and removes on `mouseup` across `document` and `window`.
   - Guarantees mouse cursor is hidden during camera rotation even when hovering over clickable DOM elements.

2. **Socket.io Back-Channel & Heartbeat**:
   - Dynamically loads `${backendUrl}/socket.io/socket.io.js`.
   - Emits `display-start` on connect and sends `heartbeat` every 10 seconds.
   - Listens for `instance-stopping` to redirect users cleanly before AWS shutdown.

3. **Inactivity Watchdog & Russian Modal**:
   - Tracks user input events (`mousemove`, `mousedown`, `keydown`, `touchstart`, `wheel`) with 500ms debounce and 30s backend report throttling.
   - Displays modal when idle:
     - Header: *"Вы ещё здесь?"*
     - Body: *"Сессия закроется через <span id="idle-countdown">30</span> секунд из-за отсутствия активности."*
     - Button: *"Я здесь!"*

4. **Default Settings**:
   - Forces `HoveringMouseMode: true` at startup.
   - Cleans stale `HoveringMouse=false` query params from URL on load.

---

## 5. Data Channel Protocols & User Experience Features

- **Hovering Mouse Mode**: Users interact with 3D UI widgets without capturing mouse pointer lock.
- **Unthrottled Mouse Pipeline**: `MouseControllerHovering.ts` and `MouseControllerLocked.ts` transmit mouse events with zero artificial delay for crisp, immediate camera rotation.
- **URL Redirection**: Dispatched from UE5 PlayerController via data channel to open external web links in a new browser tab.

---

## 6. Repository Structure: Source vs. Runtime Outputs

```
maximall-pixel-config (Root)
├── Common/                                     [SOURCE] Shared TypeScript types & protobuf messages
├── Frontend/
│   ├── library/                                [SOURCE] Core WebRTC & PixelStreaming client library
│   │   └── src/Inputs/                         (MouseControllerHovering, MouseControllerLocked, etc.)
│   ├── ui-library/                             [SOURCE] UI components, controls, overlays, and styles
│   ├── implementations/
│   │   ├── typescript/                         [SOURCE] Primary Reference Frontend Player
│   │   │   ├── src/player.ts                   (Main player logic, Socket.io, Inactivity watchdog)
│   │   │   ├── src/player.html                 (HTML template for Webpack)
│   │   │   ├── webpack.base.js                 (Webpack base config)
│   │   │   ├── webpack.dev.js                  (Webpack dev bundle config)
│   │   │   └── webpack.prod.js                 (Webpack prod bundle config)
│   │   └── react/                              [SOURCE] React player wrapper
├── Signalling/                                 [SOURCE] Core signaling protocol implementation
├── SignallingWebServer/                        [RUNTIME SERVER]
│   ├── src/index.ts                            [SOURCE] Server entry point
│   ├── config.json                             [RUNTIME CONFIG] Server configuration
│   └── www/                                    [COMPILED RUNTIME OUTPUTS]
│       ├── player.html                         (Compiled HTML entrypoint)
│       ├── player.js                           (Compiled WebRTC player bundle ~2.4MB)
│       ├── showcase.html / showcase.js         (Showcase test player)
│       ├── stresstest.html / stresstest.js     (Stress testing tool)
│       ├── uiless.html / uiless.js             (Minimal UI-less player)
│       ├── pixel-connector.js                  (Legacy fallback connector)
│       ├── css/                                (showcase.css, stresstest.css)
│       └── images/                             (Favicons, test backgrounds)
└── docs/                                       [DOCUMENTATION]
    ├── CLAUDE.md                               (AI Agent operational guide)
    └── MAXIMALL_PIXEL_CONFIG_GUIDE.md          (THIS MASTER GUIDE)
```

---

## 7. Build & Packaging Pipeline

### Compilation Commands:
```bash
# 1. Full Workspace Build (Builds Common, Signalling, Frontend libs, and Wilbur)
npm run build

# 2. Build Reference Frontend Player (Development Bundle with Source Maps)
cd Frontend/implementations/typescript
npm run build:dev

# 3. Build Reference Frontend Player (Minified Production Bundle)
cd Frontend/implementations/typescript
npm run build
```

---

## 8. Protected Runtime Invariants (DO NOT BREAK THESE RULES)

> [!IMPORTANT]
> ### RUNTIME INTEGRITY RULES
> 1. **No Artificial Mouse Throttling**: Never introduce `setTimeout` or `requestAnimationFrame` throttles into `MouseControllerHovering.ts` or `MouseControllerLocked.ts`.
> 2. **Preserve Russian User Dialogs**: Inactivity modals and user alerts must remain in clean, professional Russian.
> 3. **Preserve Socket.io Event Names**: `display-start`, `heartbeat`, `user-activity`, `instance-stopping`, and `player-disconnect` are strictly bound to `maximall-web`.
> 4. **`http_root` Path on Linux**: `config.json` must specify `"http_root": "/home/ssm-user/web/SignallingWebServer/www"`.
> 5. **`HoveringMouse: true` Default**: The player must default to hovering mouse mode.

---

## 9. Deployment & Update Procedure on AWS EC2

1. **Log in to EC2 via AWS Systems Manager (SSM)**:
   ```bash
   sudo su - ssm-user
   cd /home/ssm-user/web
   ```
2. **Pull Verified Code from GitHub `main`**:
   ```bash
   git fetch origin main
   git reset --hard origin/main
   ```
3. **Build Frontend & Server**:
   ```bash
   npm run build
   cd Frontend/implementations/typescript && npm run build:dev && cd ../../..
   ```
4. **Restart Wilbur Signaling Service**:
   ```bash
   sudo systemctl restart wilbur.service
   sudo systemctl status wilbur.service
   ```

---

## 10. Runtime Parity & Verification Standards

- **Source & Configuration Parity**: Source code in `Frontend/`, `Signalling/`, `Common/`, and configuration in `SignallingWebServer/config.json` are verified matches with the proven AWS deployment.
- **Static Asset Parity**: Static files (`player.html`, `showcase.html`, `stresstest.html`, `uiless.html`, CSS, icons, and image assets) are byte-for-byte identical.
- **Bundle Non-Determinism**: Compiled Webpack JavaScript bundles (`player.js`, `showcase.js`, `stresstest.js`, `uiless.js`) may exhibit minor byte-level variance due to build timestamps and Webpack module ID ordering, while preserving 100% functional and behavioral parity.

---

## 11. Testing Checklist After Modifications

- [ ] `npm run build` completes with exit code 0.
- [ ] `npm run build:dev` in `Frontend/implementations/typescript` generates `SignallingWebServer/www/player.js`.
- [ ] `player.html` contains the Russian idle warning overlay.
- [ ] Mouse camera rotation is smooth and unthrottled.
- [ ] Socket.io connection to `maximall-web` emits `display-start` and regular heartbeats.

---

## 12. Common Failure Modes & Troubleshooting

1. **Black Screen on Connect**:
   - Verify Unreal Engine is running and connected to port `8888`.
   - Check Wilbur logs: `tail -f /home/ssm-user/web/SignallingWebServer/logs/wilbur.log`.
2. **Inactivity Modal Not Dismissing**:
   - Ensure user input events are firing on `document` and resetting `startIdleTimer()`.
3. **Mouse Pointer Stuck Hidden / Visible**:
   - Check `html.lmb-down` class toggling in DOM elements during `mousedown`/`mouseup`.

---

## 13. AI Agent Operating Rules

*(Mandatory instructions for Antigravity, Claude Code, and autonomous agents)*:
1. **Read `docs/CLAUDE.md` First**, followed by this master guide.
2. **Never commit modified compiled bundles without rebuilding from source**.
3. **Never push directly to `main` without validating that `npm run build` succeeds**.
4. **Preserve Russian user-facing text and Socket.io event contracts**.

---
*Document Version: 1.1.0 — Canonical Source of Truth for maximall-pixel-config*
