// Copyright Epic Games, Inc. All Rights Reserved.
import { StreamMessageController } from '../UeInstanceMessage/StreamMessageController';
import { InputCoordTranslator } from '../Util/InputCoordTranslator';
import { VideoPlayer } from '../VideoPlayer/VideoPlayer';
import type { ActiveKeys } from './InputClassesFactory';
import { MouseController } from './MouseController';

/**
 * A mouse controller that allows the mouse to freely float over the video document.
 */
export class MouseControllerHovering extends MouseController {
    videoElementParent: HTMLDivElement;
    private lastHoverX = 0;
    private lastHoverY = 0;
    private lastMovementX = 0;
    private lastMovementY = 0;
    private hoverThrottleTimer: any = null;

    onMouseUpListener: (event: MouseEvent) => void;
    onMouseDownListener: (event: MouseEvent) => void;
    onMouseDblClickListener: (event: MouseEvent) => void;
    onMouseWheelListener: (event: WheelEvent) => void;
    onMouseMoveListener: (event: MouseEvent) => void;
    onContextMenuListener: (event: MouseEvent) => void;

    // Document-level listeners that hide/show the cursor on LMB press/release.
    // These work independently of the video stream state, so cursor hiding is
    // testable on the "Waiting for streamer" screen before UE connects.
    private onDocMouseDownListener: (event: MouseEvent) => void;
    private onDocMouseUpListener: (event: MouseEvent) => void;

    constructor(
        streamMessageController: StreamMessageController,
        videoPlayer: VideoPlayer,
        coordinateConverter: InputCoordTranslator,
        activeKeys: ActiveKeys
    ) {
        super(streamMessageController, videoPlayer, coordinateConverter, activeKeys);
        this.videoElementParent = videoPlayer.getVideoParentElement() as HTMLDivElement;
        this.onMouseUpListener = this.onMouseUp.bind(this);
        this.onMouseDownListener = this.onMouseDown.bind(this);
        this.onMouseDblClickListener = this.onMouseDblClick.bind(this);
        this.onMouseWheelListener = this.onMouseWheel.bind(this);
        this.onMouseMoveListener = this.onMouseMove.bind(this);
        this.onContextMenuListener = this.onContextMenu.bind(this);

        // Cursor-only handlers wired to document so they fire on any click,
        // regardless of video readiness or which overlay element is on top.
        this.onDocMouseDownListener = (event: MouseEvent) => {
            if (event.button === 0) {
                document.body.style.cursor = 'none';
            }
        };
        this.onDocMouseUpListener = (event: MouseEvent) => {
            if (event.button === 0) {
                document.body.style.cursor = 'default';
            }
        };
    }

    override register(): void {
        super.register();

        // Register document-level cursor listeners (always active, stream-independent).
        document.addEventListener('mousedown', this.onDocMouseDownListener);
        document.addEventListener('mouseup', this.onDocMouseUpListener);

        this.videoElementParent.addEventListener('mousemove', this.onMouseMoveListener);
        this.videoElementParent.addEventListener('mousedown', this.onMouseDownListener);
        this.videoElementParent.addEventListener('mouseup', this.onMouseUpListener);
        this.videoElementParent.addEventListener('contextmenu', this.onContextMenuListener);
        this.videoElementParent.addEventListener('wheel', this.onMouseWheelListener);
        this.videoElementParent.addEventListener('dblclick', this.onMouseDblClickListener);
    }

    override unregister(): void {
        if (this.hoverThrottleTimer) {
            clearTimeout(this.hoverThrottleTimer);
            this.hoverThrottleTimer = null;
        }

        // Remove document-level cursor listeners.
        document.removeEventListener('mousedown', this.onDocMouseDownListener);
        document.removeEventListener('mouseup', this.onDocMouseUpListener);

        this.videoElementParent.removeEventListener('mousemove', this.onMouseMoveListener);
        this.videoElementParent.removeEventListener('mousedown', this.onMouseDownListener);
        this.videoElementParent.removeEventListener('mouseup', this.onMouseUpListener);
        this.videoElementParent.removeEventListener('contextmenu', this.onContextMenuListener);
        this.videoElementParent.removeEventListener('wheel', this.onMouseWheelListener);
        this.videoElementParent.removeEventListener('dblclick', this.onMouseDblClickListener);

        super.unregister();
    }

    private onMouseDown(event: MouseEvent) {
        if (!this.videoPlayer.isVideoReady()) {
            return;
        }
        const coord = this.coordinateConverter.translateUnsigned(event.offsetX, event.offsetY);
        this.streamMessageController.toStreamerHandlers.get('MouseDown')([event.button, coord.x, coord.y]);
        event.preventDefault();
    }

    private onMouseUp(event: MouseEvent) {
        if (!this.videoPlayer.isVideoReady()) {
            return;
        }
        const coord = this.coordinateConverter.translateUnsigned(event.offsetX, event.offsetY);
        this.streamMessageController.toStreamerHandlers.get('MouseUp')([event.button, coord.x, coord.y]);
        event.preventDefault();
    }

    private onContextMenu(event: MouseEvent) {
        if (!this.videoPlayer.isVideoReady()) {
            return;
        }
        event.preventDefault();
    }

    private onMouseMove(event: MouseEvent) {
        if (!this.videoPlayer.isVideoReady()) {
            return;
        }

        this.lastHoverX = event.offsetX;
        this.lastHoverY = event.offsetY;
        this.lastMovementX += event.movementX;
        this.lastMovementY += event.movementY;

        event.preventDefault();

        if (this.hoverThrottleTimer) {
            return;
        }

        this.hoverThrottleTimer = setTimeout(() => {
            this.flushHoverMouseMove();
        }, 16);
    }

    private flushHoverMouseMove() {
        this.hoverThrottleTimer = null;

        const coord = this.coordinateConverter.translateUnsigned(this.lastHoverX, this.lastHoverY);
        const delta = this.coordinateConverter.translateSigned(this.lastMovementX, this.lastMovementY);

        this.lastMovementX = 0;
        this.lastMovementY = 0;

        this.streamMessageController.toStreamerHandlers.get('MouseMove')([
            coord.x,
            coord.y,
            delta.x,
            delta.y
        ]);
    }

    private onMouseWheel(event: WheelEvent) {
        if (!this.videoPlayer.isVideoReady()) {
            return;
        }
        const coord = this.coordinateConverter.translateUnsigned(event.offsetX, event.offsetY);
        this.streamMessageController.toStreamerHandlers.get('MouseWheel')([
            event.wheelDelta,
            coord.x,
            coord.y
        ]);
        event.preventDefault();
    }

    private onMouseDblClick(event: MouseEvent) {
        if (!this.videoPlayer.isVideoReady()) {
            return;
        }
        const coord = this.coordinateConverter.translateUnsigned(event.offsetX, event.offsetY);
        this.streamMessageController.toStreamerHandlers.get('MouseDouble')([event.button, coord.x, coord.y]);
    }
}
