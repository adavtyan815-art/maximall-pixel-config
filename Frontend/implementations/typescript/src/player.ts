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
    style.textContent = 'html.lmb-down:not(.planner-2d-active), html.lmb-down:not(.planner-2d-active) * { cursor: none !important; }';
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
    const params = new URLSearchParams(window.location.search);
    const backendUrl = params.get('backendUrl') || '';
    const instanceUuid = params.get('instanceUuid') || '';
    const hostToken = params.get('hostToken') || '';
    const deviceId = params.get('deviceId') || localStorage.getItem('deviceId') || '';

    // ── Inactivity config ──
    let idleMinutes = parseFloat(params.get('idleTimeoutMinutes') || '5');
    let idleMs = idleMinutes * 60 * 1000;

    let idleTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
    let countdownTimer: ReturnType<typeof setInterval> | null = null;
    let countdownSecs = 30;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let socket: any = null;

    // ── Idle warning modal refs ──────────────────────────────────────────
    const overlay = document.getElementById('idle-warning-overlay')!;
    const countdownEl = document.getElementById('idle-countdown')!;
    const stayBtn = document.getElementById('idle-warning-btn')!;

    function showIdleWarning(remainingSecs: number) {
        countdownSecs = remainingSecs;
        countdownEl.textContent = String(countdownSecs);
        overlay.classList.add('visible');

        if (countdownTimer) clearInterval(countdownTimer);
        countdownTimer = setInterval(() => {
            countdownSecs--;
            countdownEl.textContent = String(Math.max(0, countdownSecs));
            if (countdownSecs <= 0) {
                clearInterval(countdownTimer!);
                triggerRedirect();
            }
        }, 1000);
    }

    function hideIdleWarning() {
        overlay.classList.remove('visible');
        if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
        startIdleTimer();
    }

    function triggerRedirect() {
        console.warn('[IdleTimeout] Session timed out. Redirecting to home.');
        hideIdleWarning();
        stopIdleTimer();

        if (socket) {
            socket.emit('player-disconnect', { instanceUuid, hostToken });
            try { socket.disconnect(); } catch {}
        }

        sessionStorage.removeItem('assignedUuid');
        sessionStorage.removeItem('global_hostToken');

        setTimeout(() => {
            window.location.href = backendUrl || '/';
        }, 1500);
    }

    function startIdleTimer() {
        if (idleTimeoutTimer) clearTimeout(idleTimeoutTimer);
        console.log(`[IdleTimeout] Local idle timer started: ${idleMinutes} mins (${idleMs} ms)`);
        idleTimeoutTimer = setTimeout(() => {
            showIdleWarning(30);
        }, idleMs);
    }

    function stopIdleTimer() {
        if (idleTimeoutTimer) { clearTimeout(idleTimeoutTimer); idleTimeoutTimer = null; }
    }

    // ── 2. Report user activity & Reset local timer ───────────────────────
    let activityDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    let lastActivityReport = 0;
    const ACTIVITY_DEBOUNCE_MS = 30_000;

    function reportActivity() {
        // If warning is visible, background activities do NOT dismiss it
        if (overlay.classList.contains('visible')) return;

        // Reset local timer
        startIdleTimer();

        // Notify backend of activity
        if (socket) {
            const now = Date.now();
            if (now - lastActivityReport < ACTIVITY_DEBOUNCE_MS) return;
            lastActivityReport = now;
            socket.emit('user-activity', { instanceUuid, hostToken, deviceId });
        }
    }

    // Clicking anywhere on the screen/page while warning is visible resets warning and fires immediate socket report
    document.addEventListener('click', () => {
        if (overlay.classList.contains('visible')) {
            hideIdleWarning();
            if (socket) {
                const now = Date.now();
                lastActivityReport = now;
                socket.emit('user-activity', { instanceUuid, hostToken, deviceId });
            }
        }
    });

    // Listen to user input immediately on page load
    const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'touchstart', 'wheel'];
    ACTIVITY_EVENTS.forEach(evt => {
        document.addEventListener(evt, () => {
            if (activityDebounceTimer) return;
            activityDebounceTimer = setTimeout(() => {
                activityDebounceTimer = null;
                reportActivity();
            }, 500);
        }, { passive: true });
    });

    // Start local timer immediately on load
    startIdleTimer();

    // ── 3. Heartbeat & Socket setup ──
    const HEARTBEAT_INTERVAL_MS = 10_000;
    let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

    function startHeartbeat() {
        if (heartbeatInterval) return;
        heartbeatInterval = setInterval(() => {
            if (socket) {
                socket.emit('heartbeat', { instanceUuid, hostToken, deviceId });
            }
        }, HEARTBEAT_INTERVAL_MS);
    }

    function stopHeartbeat() {
        if (heartbeatInterval) { clearInterval(heartbeatInterval); heartbeatInterval = null; }
    }

    if (!backendUrl || !instanceUuid || !hostToken) {
        console.warn('[IdleTimeout] Missing backendUrl / instanceUuid / hostToken — back-channel disabled.');
        return;
    }

    // Dynamically load the Socket.io client from the backend origin
    const script = document.createElement('script');
    script.src = `${backendUrl}/socket.io/socket.io.js`;
    script.onload = () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const io: (url: string, opts?: any) => any = (window as any).io;
        if (typeof io !== 'function') {
            console.error('[IdleTimeout] window.io not found after script load.');
            return;
        }

        socket = io(backendUrl, {
            transports: ['websocket', 'polling'],
            withCredentials: true,
            reconnection: true,
            reconnectionDelay: 2000,
            reconnectionAttempts: 10,
        });

        socket.on('connect', () => {
            console.log('[IdleTimeout] Connected to maximall-web backend.');

            // Register this display session with the backend
            socket.emit('display-start', { instanceUuid, hostToken, deviceId });
            socket.emit('join-instance', instanceUuid);

            startHeartbeat();
        });

        socket.on('display-started', (data: { success: boolean; hostToken: string; idleTimeoutMinutes?: number }) => {
            console.log('[IdleTimeout] Display session verified by backend.');
            if (!params.has('idleTimeoutMinutes') && data && typeof data.idleTimeoutMinutes === 'number') {
                idleMinutes = data.idleTimeoutMinutes;
                idleMs = idleMinutes * 60 * 1000;
                console.log(`[IdleTimeout] Applying backend-configured timeout: ${idleMinutes} mins (${idleMs} ms)`);
                startIdleTimer();
            }
        });

        socket.on('disconnect', (reason: string) => {
            console.warn('[IdleTimeout] Disconnected from backend:', reason);
            stopHeartbeat();
        });

        socket.on('reconnect_failed', () => {
            console.error('[IdleTimeout] Reconnection failed after maximum attempts. Redirecting home.');
            triggerRedirect();
        });

        // Listen for backend-triggered warnings/timeouts/stops
        socket.on('idle-warning', (data: { remainingMs?: number }) => {
            const secs = Math.round((data?.remainingMs ?? 30_000) / 1000);
            console.warn('[IdleTimeout] Idle warning received — countdown:', secs, 's');
            showIdleWarning(secs);
        });

        socket.on('idle-timeout', () => {
            console.warn('[IdleTimeout] Session timed out. Redirecting to home.');
            triggerRedirect();
        });

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
    };
    script.onerror = () => console.error('[IdleTimeout] Failed to load socket.io client from', backendUrl);
    document.head.appendChild(script);

    // Send explicit disconnect when the tab closes / navigates away
    window.addEventListener('beforeunload', () => {
        if (socket) {
            socket.emit('player-disconnect', { instanceUuid, hostToken });
        }
        stopHeartbeat();
    });
})()
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
	stream.addResponseEventListener('PlannerMode', (rawData: string) => {
		if (rawData.includes('2D')) {
			document.documentElement.classList.add('planner-2d-active');
		} else {
			document.documentElement.classList.remove('planner-2d-active');
		}
	});

	const application = new Application({
		stream,
		onColorModeChanged: (isLightMode) => PixelStreamingApplicationStyles.setColorMode(isLightMode)
	});
	document.body.appendChild(application.rootElement);

	window.pixelStreaming = stream;
}
