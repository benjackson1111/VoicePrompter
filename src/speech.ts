import { state } from './state';
import { els } from './elements';
import { updateMicUI, updateHighlight, scrollToCurrent, advancePastSkipped, restartScript, navigateParagraphs } from './render';
import { dlog } from './debug';
import { showStatus } from './status';

// Script position consumed by the most recent match, so a repeated interim
// result can't re-consume it. -1 means nothing matched yet.
let lastMatchedIndex = -1;

// The exact run of spoken words we last acted on. Recognition emits a result
// while a phrase is still interim and again once it finalises, so the same
// audio arrives more than once. Without this the second pass runs against a
// cursor that has already moved past the right word, and matches the NEXT
// occurrence instead - which is what made a word repeated across nearby
// sentences drag you down the script.
let lastConsumedTail = '';

// Voice command arming to prevent duplicate triggers
let commandArmed = true;

// Arc / silent-fail detection (only meaningful for the very first start)
let isFirstStart = true;
let gotResultOnFirstStart = false;

// ── Engine lifecycle ─────────────────────────────────────────────────────
// `state.isListening` is the user's INTENT ("I want it listening"). The
// SpeechRecognition object is the ENGINE, which Safari stops, interrupts
// (e.g. when the camera grabs the mic) and occasionally wedges entirely.
//
// Upstream used one engine for the life of the page and treated most failures
// as either "stop for good" or "log and restart the same object instantly".
// A wedged engine then stayed wedged until the page was reloaded - which is
// why force-quitting Safari before every take was the only reliable fix.
// Here a failed engine is thrown away and replaced, with backoff, and the user
// is told if it can't be brought back.
let engineRunning = false;          // between start() and its end event
let runHadResult = false;
let runError: string | null = null;
let runStartedAt = 0;
let consecutiveFailures = 0;
let restartTimer: ReturnType<typeof setTimeout> | null = null;
let startWatchdog: ReturnType<typeof setTimeout> | null = null;

const MAX_FAILURES = 6;
const START_TIMEOUT_MS = 5000;

// Errors that mean "this browser/session can't do speech at all" are handled
// separately; these are the ones that are fine on a very first start.
const FIRST_START_OK = ['not-allowed', 'service-not-allowed', 'audio-capture', 'aborted', 'no-speech'];

function getCtor(): any {
    return (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
}

function voiceWanted(): boolean {
    return state.isListening && state.config.scrollingMode === 'voice';
}

function showBrowserWarning() {
    els.browserWarning.classList.remove('hidden');
}

function isAppleMobile(): boolean {
    return /iPad|iPhone|iPod/.test(navigator.userAgent)
        || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

function isIPadPWA(): boolean {
    const isIPad = navigator.userAgent.includes('iPad') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 2);
    const isPWA = (window.navigator as any).standalone === true || window.matchMedia('(display-mode: standalone)').matches;
    return isIPad && isPWA;
}

function clearTimers(): void {
    if (restartTimer) { clearTimeout(restartTimer); restartTimer = null; }
    if (startWatchdog) { clearTimeout(startWatchdog); startWatchdog = null; }
}

// Detach and kill the current engine. Its late events can no longer reach us.
function disposeRecognizer(): void {
    const rec = state.recognition;
    if (!rec) return;
    rec.onstart = null;
    rec.onaudiostart = null;
    rec.onresult = null;
    rec.onerror = null;
    rec.onend = null;
    try { rec.abort(); } catch { /* already stopped */ }
    state.recognition = null;
    engineRunning = false;
}

function createRecognizer(): boolean {
    const Ctor = getCtor();
    if (!Ctor) return false;
    disposeRecognizer();
    const rec = new Ctor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = state.selectedLanguage;
    rec.onstart = handleStart;
    rec.onaudiostart = handleAudioStart;
    rec.onresult = handleResult;
    rec.onerror = handleError;
    rec.onend = handleEnd;
    state.recognition = rec;
    dlog(`speech: new engine (${rec.lang})`);
    return true;
}

function engineStart(): void {
    if (!state.recognition && !createRecognizer()) return;
    runHadResult = false;
    runError = null;
    runStartedAt = Date.now();
    try {
        state.recognition.start();
        engineRunning = true;
    } catch (err: any) {
        // Safari throws InvalidStateError when it believes a previous session
        // is still running - the classic wedge. A fresh engine clears it.
        dlog(`speech: start() threw ${err?.name || err} - replacing engine`);
        if (!createRecognizer()) return;
        try {
            state.recognition.start();
            engineRunning = true;
        } catch (err2: any) {
            dlog(`speech: fresh engine also threw ${err2?.name || err2}`);
            consecutiveFailures++;
            scheduleRecovery();
            return;
        }
    }
    if (startWatchdog) clearTimeout(startWatchdog);
    startWatchdog = setTimeout(() => {
        startWatchdog = null;
        // start() returned but the engine never actually began - wedged.
        if (voiceWanted() && engineRunning) {
            dlog('speech: engine never started - replacing it');
            consecutiveFailures++;
            disposeRecognizer();
            scheduleRecovery();
        }
    }, START_TIMEOUT_MS);
}

function scheduleRestart(delayMs: number, fresh: boolean): void {
    if (restartTimer) clearTimeout(restartTimer);
    restartTimer = setTimeout(() => {
        restartTimer = null;
        if (!voiceWanted()) return;
        if (fresh) createRecognizer();
        engineStart();
    }, delayMs);
}

function scheduleRecovery(): void {
    if (consecutiveFailures > MAX_FAILURES) {
        hardStop('Lost the microphone and couldn\'t get it back. Tap the mic to try again.');
        return;
    }
    if (consecutiveFailures >= 2) {
        showStatus('Microphone dropped out - reconnecting...', 'warn', 2500);
    }
    const delay = Math.min(4000, 250 * 2 ** Math.max(0, consecutiveFailures - 1));
    dlog(`speech: recovering in ${delay}ms (failure ${consecutiveFailures})`);
    scheduleRestart(delay, true);
}

function hardStop(message: string | null): void {
    state.isListening = false;
    clearTimers();
    disposeRecognizer();
    updateMicUI(false);
    if (message) showStatus(message, 'error', 8000);
    dlog(`speech: stopped${message ? ' - ' + message : ''}`);
}

// Any sign of life means the engine is running. Previously only the 'start'
// event cleared the watchdog, so if Safari sent that late (or not at all) a
// WORKING engine was thrown away every 5s even while results were arriving.
function engineAlive(): void {
    if (startWatchdog) { clearTimeout(startWatchdog); startWatchdog = null; }
}

function handleStart(): void {
    engineAlive();
    dlog('speech: listening');
}

function handleAudioStart(): void {
    engineAlive();
    dlog('speech: mic audio flowing');
}

function handleError(e: any): void {
    const code: string = e?.error || 'unknown';
    runError = code;
    dlog(`speech: error "${code}"`);

    if (code === 'not-allowed' || code === 'service-not-allowed') {
        hardStop('Speech recognition is blocked for this site. Allow the microphone (and Speech Recognition) in your browser settings, then tap the mic.');
        return;
    }

    // Arc / silent-fail detection: an unusual error on the very first start
    // means this browser has the API but no working speech service.
    if (isFirstStart && !gotResultOnFirstStart && !FIRST_START_OK.includes(code)) {
        isFirstStart = false;
        showBrowserWarning();
        hardStop(null);
        return;
    }

    if (code === 'aborted' && isIPadPWA()) {
        // iPadOS blocks recognition inside Home Screen apps entirely.
        els.ipadPwaWarning.classList.remove('hidden');
        hardStop(null);
        return;
    }

    // Everything else ('aborted', 'audio-capture', 'network', ...) is handled
    // in handleEnd, which replaces the engine.
}

function handleEnd(): void {
    engineRunning = false;
    if (startWatchdog) { clearTimeout(startWatchdog); startWatchdog = null; }
    const ranFor = Date.now() - runStartedAt;
    dlog(`speech: ended after ${ranFor}ms (results: ${runHadResult ? 'yes' : 'no'}${runError ? ', error: ' + runError : ''})`);

    if (isFirstStart) {
        isFirstStart = false;
        // Arc / silent-fail detection: ended immediately with nothing at all.
        if (!gotResultOnFirstStart && !runError && ranFor < 1500) {
            showBrowserWarning();
            hardStop(null);
            return;
        }
    }

    if (!voiceWanted()) {
        if (!state.isListening) updateMicUI(false);
        return;
    }

    const failed = (runError !== null && runError !== 'no-speech') || (!runHadResult && ranFor < 1000);
    if (failed) {
        consecutiveFailures++;
        scheduleRecovery();
    } else {
        // Normal: Safari ends continuous sessions on its own every so often.
        scheduleRestart(150, false);
    }
}

function handleResult(event: any): void {
    if (isFirstStart) {
        gotResultOnFirstStart = true;
    }
    engineAlive();
    if (!runHadResult) {
        const last = event.results[event.results.length - 1]?.[0]?.transcript || '';
        dlog(`speech: hearing you - "${last.trim().split(/\s+/).slice(-6).join(' ')}"`);
    }
    runHadResult = true;
    consecutiveFailures = 0;


    let transcript = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
        transcript += event.results[i][0].transcript;
    }

    // --- Voice Commands (Mac-Style) ---
    if (state.config.voiceCommandsEnabled) {
        const cleanTokens = transcript.toLowerCase().replace(/[^\w\s]/g, '').split(/\s+/).filter(t => t.length > 0);
        if (cleanTokens.length >= 2) {
            const lastTwoWords = cleanTokens.slice(-2).join(' ');
            let commandMatched: string | null = null;
            
            if (lastTwoWords === 'go start') commandMatched = 'go start';
            else if (lastTwoWords === 'go finish') commandMatched = 'go finish';
            else if (lastTwoWords === 'go next') commandMatched = 'go next';
            else if (lastTwoWords === 'go back') commandMatched = 'go back';
            
            if (commandMatched) {
                const commandTokens = commandMatched.split(' ');
                // Conflict resolution: look around the current index (back 4, forward 10)
                const startIdx = Math.max(0, state.currentIndex - 4);
                const endIdx = Math.min(state.scriptWords.length, state.currentIndex + 10);
                const windowScript = state.scriptWords.slice(startIdx, endIdx).map(w => w.word.toLowerCase().replace(/[^\w\s]/g, ''));
                
                let conflict = false;
                for (let j = 0; j < Math.max(0, windowScript.length - 1); j++) {
                    if (windowScript[j] === commandTokens[0] && windowScript[j+1] === commandTokens[1]) {
                        conflict = true;
                        break;
                    }
                }
                
                if (!conflict) {
                    if (commandArmed) {
                        commandArmed = false;
                        console.log(`[VoiceCommand] TRIGGER: ${commandMatched}`);
                        if (commandMatched === 'go start') {
                            restartScript();
                        } else if (commandMatched === 'go finish') {
                            state.currentIndex = Math.max(0, state.scriptWords.length - 1);
                            updateHighlight();
                            scrollToCurrent();
                        } else if (commandMatched === 'go next') {
                            navigateParagraphs('forward', 1);
                        } else if (commandMatched === 'go back') {
                            navigateParagraphs('back', 1);
                        }
                        lastMatchedIndex = -1;
    lastConsumedTail = '';
                        return; // Stop processing to prevent the command from being read as script text
                    }
                } else {
                    commandArmed = true;
                }
            } else {
                commandArmed = true;
            }
        } else {
            commandArmed = true;
        }
    }

    // --- Word matching: uses all results (interim + final) for responsiveness ---
    const spokenWords = transcript.trim().toLowerCase().split(/\s+/);
    matchWords(spokenWords.slice(-5));
}

export function initSpeech(): void {
    if (!getCtor()) {
        // No API at all — Firefox, older browsers
        showBrowserWarning();
        return;
    }
    createRecognizer();

    // Safari kills recognition when the page is backgrounded (app switch,
    // screen lock, a call). Drop the dead engine on the way out and start a
    // fresh one on the way back, instead of leaving a zombie behind.
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            if (voiceWanted()) {
                clearTimers();
                disposeRecognizer();
                dlog('speech: paused (page hidden)');
            }
        } else if (voiceWanted() && !engineRunning && !restartTimer) {
            dlog('speech: resuming (page visible)');
            consecutiveFailures = 0;
            createRecognizer();
            engineStart();
        }
    });
}

export function startListening(): void {
    if (!getCtor()) return;
    state.isListening = true;
    lastMatchedIndex = -1;
    lastConsumedTail = '';
    consecutiveFailures = 0;
    clearTimers();
    updateMicUI(true);
    // Always a fresh engine when the user starts listening. Reusing the engine
    // from the previous script carried stale state from take to take on iOS -
    // force-quitting Safari between scripts was the only thing that cleared it.
    createRecognizer();
    engineStart();
}

export function stopListening(): void {
    state.isListening = false;
    lastMatchedIndex = -1;
    lastConsumedTail = '';
    clearTimers();
    if (state.recognition) {
        try {
            state.recognition.stop();
        } catch (error) {
            console.error('Failed to stop speech recognition:', error);
        }
    }
    updateMicUI(false);
}

// Run `fn` (which grabs the camera/mic) with speech recognition paused.
// Requesting the camera while recognition is live makes Safari abort
// recognition; upstream treated that abort as "stop listening for good".
//
// Afterwards, on most devices recognition is brought back automatically on a
// fresh engine. Not on iPhone/iPad: Ben's testing showed that once the camera
// has the mic, an automatic restart never hears anything, but tapping the mic
// AFTER the camera is on works every time. So there we stop listening and ask
// for that tap. The place in the script is kept.
export async function withRecognitionPaused<T>(fn: () => Promise<T>): Promise<T> {
    const wasListening = voiceWanted();
    if (wasListening) {
        clearTimers();
        disposeRecognizer();
        dlog('speech: paused while the camera starts');
    }
    try {
        return await fn();
    } finally {
        if (wasListening && voiceWanted()) {
            if (isAppleMobile()) {
                state.isListening = false;
                clearTimers();
                updateMicUI(false);
                showStatus('Camera is on - tap the mic to start listening again.', 'warn', 6000);
                dlog('speech: waiting for a mic tap (iOS needs it after the camera starts)');
            } else {
                // Let the new capture settle before speech asks for the mic.
                await new Promise(r => setTimeout(r, 300));
                if (voiceWanted() && !engineRunning) {
                    consecutiveFailures = 0;
                    createRecognizer();
                    engineStart();
                    dlog('speech: resumed after camera');
                }
            }
        }
    }
}

function cleanToken(w: string): string {
    return w.replace(/[^\p{L}\p{N}]/gu, "").toLowerCase();
}

// Previous script word that actually gets read aloud (skips bracketed notes).
function prevReadableIndex(pos: number): number {
    let p = pos - 1;
    while (p >= 0 && state.scriptWords[p].skip) p--;
    return p;
}

// How many of the most recently spoken words line up, in order, ending at
// script position `pos`. 0 means `pos` wasn't the last thing said. This is what
// tells two occurrences of the same word apart: "are right now" scores 3 at the
// intended "now" and 1 at every other "now" in the script.
function alignScore(pos: number, spoken: string[], max = 3): number {
    let score = 0;
    let sp = spoken.length - 1;
    let wp = pos;

    while (score < max && sp >= 0 && wp >= 0) {
        if (state.scriptWords[wp].clean !== spoken[sp]) break;
        score++;
        sp--;
        wp = prevReadableIndex(wp);
    }
    return score;
}

function matchWords(spokenWords: string[]) {
    if (state.currentIndex >= state.scriptWords.length) return;

    // Order matters here, so keep the sequence rather than building a Set.
    const spoken = spokenWords.map(cleanToken).filter(w => w.length > 0);
    if (spoken.length === 0) return;

    // Same audio as last time? We've already advanced on it; acting again would
    // hunt forward for a second copy of the same words.
    const tail = spoken.join(' ');
    if (tail === lastConsumedTail) return;
    lastConsumedTail = tail;

    const LOOKAHEAD = state.config.lookaheadWords;

    let bestPos = -1;
    let bestScore = 0;
    let scriptPtr = state.currentIndex;
    let validWordsChecked = 0;

    while (scriptPtr < state.scriptWords.length && validWordsChecked < LOOKAHEAD) {
        const scriptWordObj = state.scriptWords[scriptPtr];

        if (scriptWordObj.skip) {
            scriptPtr++;
            continue;
        }

        if (scriptPtr !== lastMatchedIndex) {
            const score = alignScore(scriptPtr, spoken);

            // A bare single-word match may only carry you to the very next
            // word. Landing anywhere further ahead needs a second word of
            // context — that's what stops a word repeated across nearby
            // sentences from dragging you down the script, and it also stops
            // a repeated interim result double-jumping.
            const allowed = score >= 2 || (score === 1 && validWordsChecked === 0);

            // Strictly greater, so an equal score keeps the NEAREST position.
            if (allowed && score > bestScore) {
                bestScore = score;
                bestPos = scriptPtr;
            }
        }

        scriptPtr++;
        validWordsChecked++;
    }

    if (bestPos < 0) return;

    lastMatchedIndex = bestPos;
    state.currentIndex = bestPos + 1;
    advancePastSkipped();
    updateHighlight();
    scrollToCurrent();
}
