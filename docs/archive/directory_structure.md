# Project Directory Structure - maximall-pixel-config

This document details the folder structure and lists the purpose of each key file in the `maximall-pixel-config` repository.

---

## 1. Directory Tree Layout

```
maximall-pixel-config/
├── Common/                      # Shared Epic Games Pixel Streaming protocols & types
├── Extras/                      # Additional scripts and utility packages
├── Frontend/                    # Frontend library and application source files
│   ├── library/                 # Core JavaScript/TypeScript pixel streaming library
│   ├── ui-library/              # Reusable UI component wrappers
│   └── implementations/
│       └── typescript/          # Main client application implementation
│           ├── src/
│           │   ├── player.html  # Custom template with glassmorphic warning overlay
│           │   └── player.ts    # User activity tracking, heartbeats, and warning timers
│           └── webpack.config.js # Webpack bundle configuration
│
├── Matchmaker/                  # Node-based load balancer for directing clients to servers
├── SFU/                         # Selective Forwarding Unit for multi-cast streaming
├── Signalling/                  # Core signaling protocols layer
├── SignallingWebServer/         # Primary server package serving static files and WebRTC negotiation
│   ├── src/
│   │   └── index.ts             # Custom commander options and streamer disconnect webhook
│   └── www/                     # Web-accessible folder containing static assets
│       ├── player.html          # Built player template (copied/generated)
│       └── player.js            # Webpack bundled JavaScript logic (player.ts + libs)
│
├── docs/                        # Project technical documentation
│   ├── directory_structure.md   # This folder structure reference
│   └── pixel_streaming_infrastructure.md # Signaling and frontend architecture details
│
├── package.json                 # Lerna/Workspace root package configurations
├── eslint.config.mjs            # Code linter configurations
└── .gitignore                   # Files and patterns ignored by Git
```

---

## 2. Key File Summary

### A. Root Configuration Files
- **[package.json](file:///C:/Users/Admin/Desktop/Aleg/maximall-pixel-config/package.json)**: Sets up the npm workspaces for monorepo package resolution, mapping all sub-folders (`Common`, `Frontend/library`, `SignallingWebServer`, etc.) and defining compilation scripts.

### B. Core Custom Files
- **[SignallingWebServer/src/index.ts](file:///C:/Users/Admin/Desktop/Aleg/maximall-pixel-config/SignallingWebServer/src/index.ts)**: Configured with custom command line arguments (`--backend_url`, `--instance_uuid`, `--backend_secret`) and triggers an HTTP webhook call to `maximall-web` when the Unreal Engine streamer disconnects.
- **[Frontend/implementations/typescript/src/player.html](file:///C:/Users/Admin/Desktop/Aleg/maximall-pixel-config/Frontend/implementations/typescript/src/player.html)**: Custom HTML layout specifying a glassmorphic `#idle-warning-overlay` modal countdown display and the `#idle-warning-btn` ("Я здесь!") button.
- **[Frontend/implementations/typescript/src/player.ts](file:///C:/Users/Admin/Desktop/Aleg/maximall-pixel-config/Frontend/implementations/typescript/src/player.ts)**: Main entry point for browser logic, handling user event monitoring, heartbeats, overlay toggle states, and redirect flows.
