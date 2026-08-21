# Maximall Pixel Config: Master Architecture & Runtime Source of Truth

> **Repository**: `https://github.com/adavtyan815-art/maximall-pixel-config.git`  
> **Primary Purpose**: Epic Games Pixel Streaming Infrastructure (Wilbur Signaling Server, Frontend Web Player, WebRTC Media Pipeline)  
> **Deployed Environment**: AWS EC2 GPU instances (`g4dn.2xlarge` - NVIDIA Tesla T4, AMI `LinuxClientAMI`)  
> **Runtime Baseline**: Matched 100% against verified AWS EC2 production deployment.  

---

## 1. System Overview & Purpose

`maximall-pixel-config` contains the complete WebRTC signaling server, frontend web player application, and protocol libraries for streaming Unreal Engine 5 (`awsTutorial`) instances to browser clients with sub-second latency.

```mermaid
flowchart LR
    subgraph ClientBrowser [Browser Client]
        DOM[HTML5 / WebRTC Video Element]
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

### The Ecosystem Relationships:
1. **`awsTutorial` (Unreal Engine 5 Project)**:
   - Houses the C++ showroom and room constructor logic.
   - Encodes viewport frames via NVIDIA NVENC hardware encoder.
   - Connects locally to Wilbur on port 8888 as a Streamer using the Cirrus WebSocket protocol.
2. **`maximall-pixel-config` (This Repository)**:
   - Deployed at `/home/ssm-user/web/` on the AWS GPU instance AMI.
   - Runs `SignallingWebServer` (Wilbur) on port 8000.
   - Serves the compiled WebRTC frontend player (`player.html`, `player.js`).
   - Handles WebRTC SDP offer/answer exchanges and ICE candidates.
3. **`maximall-web` (Orchestration & Reverse Proxy)**:
   - Reverse-proxies user browser traffic to the GPU instance's private IP (`172.31.x.x:8000`).
   - Receives Socket.io heartbeats and user-activity pings from `player.ts`.
   - Controls instance lifecycle (Start, Stop, Prewarm, Recycle).

---

## 2. Signaling & Web Server Architecture

### 2.1 Configuration (`SignallingWebServer/config.json`)
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

### 2.2 Network Ports & Protocols:
| Port | Protocol | Purpose | Internal / External |
|---|---|---|---|
| **8000** | TCP / HTTP & WS | Player web assets & WebRTC signaling | Reverse-proxied by `maximall-web` |
| **8888** | TCP / WS | Local Unreal Engine Streamer connection | Localhost / Intra-instance only |
| **8889** | TCP / WS | SFU (Selective Forwarding Unit) port | Internal |
| **3478** | UDP / TCP | STUN / TURN NAT traversal (Coturn) | External / AWS Security Group |
| **49152–65535** | UDP | WebRTC SRTP/SRTCP media streams | External / AWS Security Group |

---

## 3. Frontend Web Player Architecture (`Frontend/`)

### 3.1 Key Runtime Features in `player.ts`:

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

## 4. Repository Structure: Source vs. Runtime Outputs

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
    ├── MAXIMALL_PIXEL_CONFIG_GUIDE.md          (THIS MASTER GUIDE)
    └── archive/                                (Historical reports)
```

---

## 5. Build & Packaging Pipeline

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

## 6. Protected Runtime Invariants (DO NOT BREAK THESE RULES)

> [!IMPORTANT]
> ### RUNTIME INTEGRITY RULES
> 1. **No Artificial Mouse Throttling**: Never introduce `setTimeout` or `requestAnimationFrame` throttles into `MouseControllerHovering.ts` or `MouseControllerLocked.ts`. Throttling creates severe mouse lag in 3D camera controls.
> 2. **Preserve Russian User Dialogs**: Inactivity modals and user alerts must remain in clean, professional Russian.
> 3. **Preserve Socket.io Event Names**: `display-start`, `heartbeat`, `user-activity`, `instance-stopping`, `player-disconnect` are strictly bound to `maximall-web`.
> 4. **`http_root` Path on Linux**: `config.json` must specify `"http_root": "/home/ssm-user/web/SignallingWebServer/www"` for production Linux AMI compatibility.
> 5. **`HoveringMouse: true` Default**: The player must default to hovering mouse mode so users can interact with UI widgets without capturing mouse pointer lock.

---

## 7. Deployment & Update Procedure on AWS EC2

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
*Document Version: 1.0.0 — Canonical Source of Truth for maximall-pixel-config*
