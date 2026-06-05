// Copyright Epic Games, Inc. All Rights Reserved.

export * from '@epicgames-ps/lib-pixelstreamingfrontend-ue5.6';
export * from '@epicgames-ps/lib-pixelstreamingfrontend-ui-ue5.6';
import { Config, Flags, PixelStreaming, Logger, LogLevel } from '@epicgames-ps/lib-pixelstreamingfrontend-ue5.6';
import { Application, PixelStreamingApplicationStyle } from '@epicgames-ps/lib-pixelstreamingfrontend-ui-ue5.6';
const PixelStreamingApplicationStyles =
    new PixelStreamingApplicationStyle();
PixelStreamingApplicationStyles.applyStyleSheet();

// expose the pixel streaming object for hooking into. tests etc.
declare global {
    interface Window { pixelStreaming: PixelStreaming; }
}

// ─── Global cursor hide/show on LMB ──────────────────────────────────────────
// The JSS stylesheet (PixelStreamingApplicationStyles) injects rules like
//   .clickableState { cursor: pointer }
// Child elements with their own cursor rule always win over an inherited value
// set on body/html, so `body.style.cursor = 'none'` is silently overridden.
//
// Fix: inject a <style> block with `cursor: none !important` on EVERY element
// under an `html.lmb-down` sentinel class. !important beats inline styles AND
// any specificity in the JSS sheet.  Toggle the class on mousedown/mouseup.
(function installCursorHideStyle() {
    const style = document.createElement('style');
    style.id = 'lmb-cursor-hide';
    style.textContent = 'html.lmb-down, html.lmb-down * { cursor: none !important; }';
    document.head.appendChild(style);

    document.addEventListener('mousedown', (event: MouseEvent) => {
        if (event.button === 0) {
            document.documentElement.classList.add('lmb-down');
        }
    });
    // Listen on both document and window so we catch the release even if the
    // pointer was dragged outside the browser window.
    document.addEventListener('mouseup', (event: MouseEvent) => {
        if (event.button === 0) {
            document.documentElement.classList.remove('lmb-down');
        }
    });
    window.addEventListener('mouseup', (event: MouseEvent) => {
        if (event.button === 0) {
            document.documentElement.classList.remove('lmb-down');
        }
    });
})();
// ─────────────────────────────────────────────────────────────────────────────

// ─── maximall-web back-channel: Socket.io + Idle Timeout ─────────────────────
// The player page is served from the EC2 instance (port 8000) but needs to
// maintain a Socket.io connection back to maximall-web for:
//   1. display-start / heartbeat  (session keepalive)
//   2. user-activity              (idle timer reset)
//   3. idle-warning / idle-timeout (idle timeout UX)
//   4. instance-stopping          (graceful redirect when EC2 shuts down)
//
// All connection parameters are passed as URL search params by index.html:
//   ?backendUrl=…&instanceUuid=…&hostToken=…&deviceId=…
(function initBackendChannel() {
    const params   = new URLSearchParams(window.location.search);
    const backendUrl    = params.get('backendUrl') || '';
    const instanceUuid  = params.get('instanceUuid') || '';
    const hostToken     = params.get('hostToken') || '';
    const deviceId      = params.get('deviceId') || localStorage.getItem('deviceId') || '';

    if (!backendUrl || !instanceUuid || !hostToken) {
        console.warn('[IdleTimeout] Missing backendUrl / instanceUuid / hostToken — back-channel disabled.');
        return;
    }

    // ── 1. Dynamically load the Socket.io client from the backend origin ──
    //    (avoids bundling socket.io-client into the webpack bundle)
    const script = document.createElement('script');
    script.src = `${backendUrl}/socket.io/socket.io.js`;
    script.onload = () => onSocketIoReady(backendUrl, instanceUuid, hostToken, deviceId);
    script.onerror = () => console.error('[IdleTimeout] Failed to load socket.io client from', backendUrl);
    document.head.appendChild(script);
})();

function onSocketIoReady(
    backendUrl: string,
    instanceUuid: string,
    hostToken: string,
    deviceId: string
) {
    // io() is now available on window from the dynamically loaded script
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const io: (url: string, opts?: any) => any = (window as any).io;
    if (typeof io !== 'function') {
        console.error('[IdleTimeout] window.io not found after script load.');
        return;
    }

    const socket = io(backendUrl, {
        transports: ['websocket', 'polling'],
        withCredentials: true,
        reconnection: true,
        reconnectionDelay: 2000,
        reconnectionAttempts: 10,
    });

    // ── Idle warning modal refs ──────────────────────────────────────────
    const overlay      = document.getElementById('idle-warning-overlay')!;
    const countdownEl  = document.getElementById('idle-countdown')!;
    const stayBtn      = document.getElementById('idle-warning-btn')!;

    let countdownTimer: ReturnType<typeof setInterval> | null = null;
    let countdownSecs = 30;

    function showIdleWarning(remainingSecs: number) {
        countdownSecs = remainingSecs;
        countdownEl.textContent = String(countdownSecs);
        overlay.classList.add('visible');

        if (countdownTimer) clearInterval(countdownTimer);
        countdownTimer = setInterval(() => {
            countdownSecs--;
            countdownEl.textContent = String(Math.max(0, countdownSecs));
            if (countdownSecs <= 0) clearInterval(countdownTimer!);
        }, 1000);
    }

    function hideIdleWarning() {
        overlay.classList.remove('visible');
        if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    }

    // "I'm still here" button → report activity immediately and hide warning
    stayBtn.addEventListener('click', () => {
        hideIdleWarning();
        // Force direct activity emission bypassing the visibility check
        const now = Date.now();
        lastActivityReport = now;
        socket.emit('user-activity', { instanceUuid, hostToken, deviceId });
    });

    // ── 2. Report user activity ──────────────────────────────────────────
    // Debounce: fire at most once every 30 seconds so we don't spam the server.
    let activityDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    let lastActivityReport = 0;
    const ACTIVITY_DEBOUNCE_MS = 30_000;

    function reportActivity() {
        // If the warning modal is visible, ignore background interaction.
        // User must explicitly click the button to dismiss.
        if (overlay.classList.contains('visible')) return;

        const now = Date.now();
        if (now - lastActivityReport < ACTIVITY_DEBOUNCE_MS) return;
        lastActivityReport = now;
        socket.emit('user-activity', { instanceUuid, hostToken, deviceId });
    }

    const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'wheel'];
    ACTIVITY_EVENTS.forEach(evt => {
        document.addEventListener(evt, () => {
            // Use a small leading debounce so rapid events collapse to one call
            if (activityDebounceTimer) return;
            activityDebounceTimer = setTimeout(() => {
                activityDebounceTimer = null;
                reportActivity();
            }, 500);
        }, { passive: true });
    });

    // ── 3. Periodic heartbeat (every 10s) ────────────────────────────────
    const HEARTBEAT_INTERVAL_MS = 10_000;
    let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

    function startHeartbeat() {
        if (heartbeatInterval) return;
        heartbeatInterval = setInterval(() => {
            socket.emit('heartbeat', { instanceUuid, hostToken, deviceId });
        }, HEARTBEAT_INTERVAL_MS);
    }

    function stopHeartbeat() {
        if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
    }

    // ── 4. Socket events ─────────────────────────────────────────────────
    socket.on('connect', () => {
        console.log('[IdleTimeout] Connected to maximall-web backend.');

        // Register this display session with the backend
        socket.emit('display-start', { instanceUuid, hostToken, deviceId });
        socket.emit('join-instance', instanceUuid);

        startHeartbeat();
    });

    socket.on('disconnect', (reason: string) => {
        console.warn('[IdleTimeout] Disconnected from backend:', reason);
        stopHeartbeat();
    });

    // ── Backend: show warning countdown ─────────────────────────────────
    socket.on('idle-warning', (data: { remainingMs?: number }) => {
        const secs = Math.round((data?.remainingMs ?? 30_000) / 1000);
        console.warn('[IdleTimeout] Idle warning received — countdown:', secs, 's');
        showIdleWarning(secs);
    });

    // ── Backend: session timed out — redirect home ───────────────────────
    socket.on('idle-timeout', () => {
        console.warn('[IdleTimeout] Session timed out. Redirecting to home.');
        hideIdleWarning();
        stopHeartbeat();

        // Clear any stored session so index.html starts fresh
        sessionStorage.removeItem('assignedUuid');
        sessionStorage.removeItem('global_hostToken');

        // Give the user a brief moment to see what happened
        setTimeout(() => {
            window.location.href = new URLSearchParams(window.location.search).get('backendUrl') || '/';
        }, 1500);
    });

    // ── Backend: EC2 is shutting down — redirect home ────────────────────
    socket.on('instance-stopping', () => {
        console.warn('[IdleTimeout] Instance is stopping. Redirecting to home.');
        hideIdleWarning();
        stopHeartbeat();

        sessionStorage.removeItem('assignedUuid');
        sessionStorage.removeItem('global_hostToken');

        setTimeout(() => {
            window.location.href = new URLSearchParams(window.location.search).get('backendUrl') || '/';
        }, 2000);
    });

    // ── Send explicit disconnect when the tab closes / navigates away ────
    window.addEventListener('beforeunload', () => {
        socket.emit('player-disconnect', { instanceUuid, hostToken });
        stopHeartbeat();
    });
}
// ─────────────────────────────────────────────────────────────────────────────

document.body.onload = function() {
    Logger.InitLogging(LogLevel.Warning, true);

    // Remove any stale HoveringMouse=false URL parameter persisted from a previous
    // session (when the default was false). This ensures our new default of true
    // is honoured on first load after upgrading, rather than being overridden by
    // a stale URL param written by useUrlParams in a prior visit.
    const urlParams = new URLSearchParams(window.location.search);
    if (urlParams.has('HoveringMouse') && urlParams.get('HoveringMouse') === 'false') {
        urlParams.delete('HoveringMouse');
        const newSearch = urlParams.toString();
        window.history.replaceState(
            {},
            '',
            newSearch !== '' ? `${location.pathname}?${newSearch}` : location.pathname
        );
    }

	// Create a config object, forcing HoveringMouse on as the startup default.
	const config = new Config({
        useUrlParams: true,
        initialSettings: { [Flags.HoveringMouseMode]: true }
    });

	// Create the main Pixel Streaming object for interfacing with the web-API of Pixel Streaming
	const stream = new PixelStreaming(config);

	const application = new Application({
		stream,
		onColorModeChanged: (isLightMode) => PixelStreamingApplicationStyles.setColorMode(isLightMode)
	});
	document.body.appendChild(application.rootElement);

	window.pixelStreaming = stream;
}
