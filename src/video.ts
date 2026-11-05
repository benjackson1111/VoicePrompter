import { state } from './state';
import { els } from './elements';
import { scrollToCurrent } from './render';
import { withRecognitionPaused } from './speech';
import { dlog } from './debug';
import { showStatus } from './status';

function isMobileDevice(): boolean {
    return /iPad|iPhone|iPod|Android/i.test(navigator.userAgent)
        || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isAppleMobile(): boolean {
    return /iPad|iPhone|iPod/.test(navigator.userAgent)
        || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

// Phones and tablets should record the way they're being held. Desktop
// webcams are landscape-only, so they always get landscape.
function wantPortrait(): boolean {
    return isMobileDevice() && window.matchMedia('(orientation: portrait)').matches;
}

// Mirror the preview only for the front ('user') camera, like a selfie view.
// The rear camera should show a true (non-mirrored) image.
function applyCameraMirror(): void {
    els.videoPreview.style.transform =
        state.facingMode === 'user' ? 'scaleX(-1)' : 'none';
}

export function getMediaConstraints(portrait = wantPortrait()): MediaStreamConstraints {
    // Upstream always asked for 1280x720 - landscape - so a phone held upright
    // still got a widescreen frame.
    const videoConstraints: any = {
        width: { ideal: portrait ? 720 : 1280 },
        height: { ideal: portrait ? 1280 : 720 }
    };
    
    if (state.selectedVideoDeviceId) {
        videoConstraints.deviceId = state.selectedVideoDeviceId;
    } else {
        videoConstraints.facingMode = state.facingMode;
    }

    const audioConstraints: any = state.selectedAudioDeviceId
        ? { deviceId: state.selectedAudioDeviceId }
        : true;

    return {
        video: videoConstraints,
        audio: audioConstraints
    };
}

function streamIsPortrait(stream: MediaStream): boolean | null {
    const s = stream.getVideoTracks()[0]?.getSettings();
    if (!s || !s.width || !s.height) return null;
    return s.height > s.width;
}

function describeStream(stream: MediaStream, label: string): void {
    const v = stream.getVideoTracks()[0];
    const a = stream.getAudioTracks()[0];
    const vs = v?.getSettings();
    dlog(`camera: ${label} ${vs?.width}x${vs?.height} ${vs?.facingMode || ''} | ` +
        (a ? `mic ${a.readyState}${a.muted ? ' MUTED' : ''}` : 'no mic track'));
}

// Get a camera+mic stream whose frame matches how the device is held.
//
// iOS doesn't reliably honour the requested shape on the first request
// (turning the camera off and on again was fixing it by hand), and versions
// differ on whether width/height are read in the screen's frame or the
// sensor's. So check what actually came back, and if it's the wrong shape ask
// again - first the same way, then the other way round.
async function acquireStream(): Promise<MediaStream> {
    const portrait = wantPortrait();
    let stream = await navigator.mediaDevices.getUserMedia(getMediaConstraints(portrait));
    describeStream(stream, 'got');

    if (isMobileDevice() && !state.selectedVideoDeviceId) {
        for (const ask of [portrait, !portrait]) {
            if (streamIsPortrait(stream) !== !portrait) break;   // right shape (or unknown)
            dlog(`camera: wrong shape for a ${portrait ? 'portrait' : 'landscape'} device, asking again`);
            stream.getTracks().forEach(t => t.stop());
            stream = await navigator.mediaDevices.getUserMedia(getMediaConstraints(ask));
            describeStream(stream, 'retry');
        }
    }
    return stream;
}

// Make interruptions visible instead of silent.
function watchTracks(stream: MediaStream): void {
    stream.getAudioTracks().forEach(t => {
        t.onmute = () => {
            dlog('camera: mic track MUTED');
            if (state.isRecording) {
                showStatus('Something else took the microphone - this take may have no sound.', 'error', 6000);
            }
        };
        t.onunmute = () => dlog('camera: mic track unmuted');
        t.onended = () => dlog('camera: mic track ended');
    });
    stream.getVideoTracks().forEach(t => {
        // Not fired when we stop() the track ourselves - only when the system
        // takes the camera away (call, another app, lock screen).
        t.onended = () => {
            dlog('camera: video track ended by the system');
            if (state.mediaStream === stream && state.isVideoMode) {
                exitVideoMode();
                showStatus('The camera was interrupted. Tap the camera button to turn it back on.', 'warn', 6000);
            }
        };
    });
}

export function isVideoStreamLive(): boolean {
    return !!state.mediaStream?.getVideoTracks().some(t => t.readyState === 'live');
}

// Log the preview's frame size once frames arrive (for ?debug diagnosis only;
// nothing acts on it - iOS's numbers here don't match what's on screen).
function logPreviewShape(label: string): void {
    const v = els.videoPreview;
    const report = () => dlog(`camera: ${label} preview reports ${v.videoWidth}x${v.videoHeight}`);
    if (v.videoWidth) report();
    else v.addEventListener('loadedmetadata', report, { once: true });
}

export async function enterVideoMode(): Promise<void> {
    await startVideoMode(true);
}

async function startVideoMode(allowAutoToggle: boolean): Promise<void> {
    // A previous session may have left a stream running; release it first.
    if (state.mediaStream) {
        state.mediaStream.getTracks().forEach(track => track.stop());
        state.mediaStream = null;
    }
    try {
        // Always start on the front-facing camera unless a specific camera is chosen.
        if (!state.selectedVideoDeviceId) {
            state.facingMode = 'user';
        }
        const stream = await withRecognitionPaused(() => acquireStream());

        // The user may have left the prompter while the camera was starting.
        if (els.prompterContainer.classList.contains('hidden')) {
            stream.getTracks().forEach(t => t.stop());
            return;
        }
        watchTracks(stream);
        state.mediaStream = stream;
        state.isVideoMode = true;
        state.videoLayoutMode = 'split';

        // Attach while the preview is hidden, THEN show it. This order matters
        // on iPhone: attaching to an already-visible preview locked it into
        // landscape, even after turning the camera off and on again.
        els.videoPreview.srcObject = stream;
        els.videoPreview.muted = true;
        applyCameraMirror();
        await els.videoPreview.play();

        // Show video UI
        els.videoContainer.classList.remove('hidden');
        els.videoControls.classList.remove('hidden');

        // Apply split layout by default
        applyVideoLayout();
        logPreviewShape(allowAutoToggle ? 'first' : 'after auto off/on');

        setTimeout(() => {
            scrollToCurrent();
        }, 50);

        if (/Android/i.test(navigator.userAgent)) {
            els.androidVideoWarning.classList.remove('hidden');
        }

        (window as any).umami?.track('video-mode-enter');

        // iPhone: the first camera start shows a landscape preview, and turning
        // the camera off and on again fixes it. So do exactly that - the same
        // two functions the button runs, with a similar pause - once.
        if (allowAutoToggle && isAppleMobile() && !state.selectedVideoDeviceId) {
            await sleep(1500);
            const stillWanted = state.isVideoMode && state.mediaStream === stream
                && !state.isRecording && !els.prompterContainer.classList.contains('hidden');
            if (stillWanted) {
                dlog('camera: iPhone - turning the camera off and on again');
                exitVideoMode();
                await sleep(400);
                await startVideoMode(false);
            }
        }
    } catch (err) {
        hideVideoUI();
        console.error('Failed to access camera:', err);
        alert('Could not access your camera. Please allow camera and microphone permissions.');
    }
}

function hideVideoUI(): void {
    els.videoPreview.srcObject = null;
    els.videoContainer.classList.add('hidden');
    els.videoControls.classList.add('hidden');
    els.prompterContainer.classList.remove('video-mode-split', 'video-mode-overlay');
}

export async function flipCamera(): Promise<void> {
    if (!state.isVideoMode) return;
    // Swapping the camera mid-recording would invalidate the MediaRecorder's
    // stream, so block it while recording is in progress.
    if (state.isRecording) return;

    const previous = state.facingMode;
    state.facingMode = previous === 'user' ? 'environment' : 'user';

    // Clear custom device selection when manual flip button is pressed
    state.selectedVideoDeviceId = null;
    if (els.videoDeviceSelect) els.videoDeviceSelect.value = '';

    try {
        const stream = await withRecognitionPaused(() => acquireStream());
        watchTracks(stream);

        // Tear down the old stream only after the new one is acquired.
        if (state.mediaStream) {
            state.mediaStream.getTracks().forEach(track => track.stop());
        }
        state.mediaStream = stream;
        els.videoPreview.srcObject = stream;
        applyCameraMirror();
        await els.videoPreview.play();
        logPreviewShape('flipped');

        (window as any).umami?.track('video-flip-camera', { facing: state.facingMode });
    } catch (err) {
        // Device may not have the requested camera — revert.
        console.error('Failed to switch camera:', err);
        state.facingMode = previous;
        // Put the camera we still have back in the preview.
        if (state.mediaStream) {
            els.videoPreview.srcObject = state.mediaStream;
            applyCameraMirror();
            els.videoPreview.play().catch(() => {});
        }
        alert('Could not switch camera. This device may only have one camera.');
    }
}

export function exitVideoMode(): void {
    // Stop recording if active
    if (state.isRecording) {
        stopRecording();
    }

    // Stop all media tracks
    if (state.mediaStream) {
        state.mediaStream.getTracks().forEach(track => track.stop());
        state.mediaStream = null;
    }

    // Reset video element
    els.videoPreview.srcObject = null;

    // Hide video UI
    els.videoContainer.classList.add('hidden');
    els.videoControls.classList.add('hidden');

    // Remove layout classes
    els.prompterContainer.classList.remove('video-mode-split', 'video-mode-overlay');

    setTimeout(() => {
        scrollToCurrent();
    }, 50);

    state.isVideoMode = false;
    state.isRecording = false;
    state.mediaRecorder = null;
    state.recordedChunks = [];

    // Update button states
    els.videoRecordBtn.classList.remove('hidden');
    els.videoStopBtn.classList.add('hidden');
    els.videoRecordingIndicator.classList.add('hidden');
    const dock = document.getElementById('mainControlsDock');
    if (dock) { dock.style.opacity = ''; }

    (window as any).umami?.track('video-mode-exit');
}

export function toggleVideoLayout(): void {
    state.videoLayoutMode = state.videoLayoutMode === 'split' ? 'overlay' : 'split';
    applyVideoLayout();
    
    setTimeout(() => {
        scrollToCurrent();
    }, 50);

    (window as any).umami?.track('video-layout-toggle', { layout: state.videoLayoutMode });
}

function applyVideoLayout(): void {
    els.prompterContainer.classList.remove('video-mode-split', 'video-mode-overlay');

    if (state.videoLayoutMode === 'split') {
        els.prompterContainer.classList.add('video-mode-split');
        els.videoLayoutToggleBtn.textContent = '⬜ Overlay';
        els.videoLayoutToggleBtn.title = 'Switch to overlay mode';
        els.scrollContainer.style.backgroundColor = state.config.bgColor;
    } else {
        els.prompterContainer.classList.add('video-mode-overlay');
        els.videoLayoutToggleBtn.textContent = '⬜ Split';
        els.videoLayoutToggleBtn.title = 'Switch to split mode';
        els.scrollContainer.style.backgroundColor = '';
    }
}

export function startRecording(): void {
    if (!state.mediaStream) return;

    state.recordedChunks = [];

    // Prefer MP4 with H.264. Every entry here either names an audio codec or
    // leaves the choice to the browser. Upstream's second choice was
    // 'video/mp4;codecs=avc1' - video only - and since Safari can't do Opus in
    // MP4 (the first choice), that's what Safari ended up recording with.
    const mimeTypes = [
        'video/mp4;codecs=avc1,mp4a.40.2',   // H.264 + AAC (Safari)
        'video/mp4;codecs=avc1,opus',        // H.264 + Opus (Chrome)
        'video/mp4',
        'video/webm;codecs=vp9,opus',
        'video/webm;codecs=vp8,opus',
        'video/webm'
    ];

    let selectedMimeType = '';
    for (const mt of mimeTypes) {
        if (MediaRecorder.isTypeSupported(mt)) {
            selectedMimeType = mt;
            break;
        }
    }

    try {
        state.mediaRecorder = selectedMimeType
            ? new MediaRecorder(state.mediaStream, { mimeType: selectedMimeType })
            : new MediaRecorder(state.mediaStream);
    } catch (e) {
        state.mediaRecorder = new MediaRecorder(state.mediaStream);
    }

    const mic = state.mediaStream.getAudioTracks()[0];
    if (!mic) {
        showStatus('No microphone in this camera stream - the recording will be silent.', 'error', 6000);
    } else if (mic.readyState !== 'live' || mic.muted) {
        showStatus('The microphone is busy elsewhere - this take may have no sound.', 'error', 6000);
    }
    dlog(`rec: start as ${state.mediaRecorder.mimeType || selectedMimeType || 'browser default'} | ` +
        (mic ? `mic ${mic.readyState}${mic.muted ? ' MUTED' : ''}` : 'no mic track'));

    state.mediaRecorder.ondataavailable = (event: BlobEvent) => {
        if (event.data && event.data.size > 0) {
            state.recordedChunks.push(event.data);
        }
    };

    state.mediaRecorder.onstop = () => {
        downloadRecording();
    };

    state.mediaRecorder.start(1000); // Collect data every second
    state.isRecording = true;

    // Update UI
    els.videoRecordBtn.classList.add('hidden');
    els.videoStopBtn.classList.remove('hidden');
    els.videoRecordingIndicator.classList.remove('hidden');
    const dock = document.getElementById('mainControlsDock');
    if (dock) dock.style.opacity = (state.config.dockOpacity / 100).toString();

    (window as any).umami?.track('video-record-start');
}

export function stopRecording(): void {
    if (state.mediaRecorder && state.mediaRecorder.state !== 'inactive') {
        state.mediaRecorder.stop();
    }
    state.isRecording = false;

    // Update UI
    els.videoRecordBtn.classList.remove('hidden');
    els.videoStopBtn.classList.add('hidden');
    els.videoRecordingIndicator.classList.add('hidden');
    const dock = document.getElementById('mainControlsDock');
    if (dock) { dock.style.opacity = ''; }

    (window as any).umami?.track('video-record-stop');
}

function downloadRecording(): void {
    if (state.recordedChunks.length === 0) return;

    // Determine file extension from the actual mimeType used
    const actualMime = state.mediaRecorder?.mimeType || '';
    const isMP4 = actualMime.includes('mp4');
    const extension = isMP4 ? 'mp4' : 'webm';
    const blobType = isMP4 ? 'video/mp4' : 'video/webm';

    const blob = new Blob(state.recordedChunks, { type: blobType });
    dlog(`rec: saved ${(blob.size / 1048576).toFixed(1)} MB as ${actualMime || blobType}`);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');

    const now = new Date();
    const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;
    a.download = `biki-prompter-${timestamp}.${extension}`;

    a.href = url;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);

    // Cleanup
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    state.recordedChunks = [];
}
