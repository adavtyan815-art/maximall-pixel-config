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
