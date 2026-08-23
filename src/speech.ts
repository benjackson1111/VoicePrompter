import { state } from './state';
import { els } from './elements';
import { updateMicUI, updateHighlight, scrollToCurrent, advancePastSkipped, restartScript, navigateParagraphs } from './render';

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

// Track which result indices we already processed for commands
// to prevent re-firing when the recognition engine revisits finalized results

let speechBlocked = false;

// Voice command arming to prevent duplicate triggers
let commandArmed = true;

// Arc / silent-fail detection
let isFirstStart = true;
let gotResultOnFirstStart = false;

function showBrowserWarning() {
    els.browserWarning.classList.remove('hidden');
}

export function initSpeech(): void {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

    if (!SpeechRecognition) {
        // No API at all — Firefox, older browsers
        showBrowserWarning();
        return;
    }

    state.recognition = new SpeechRecognition();
    state.recognition.continuous = true;
    state.recognition.interimResults = true;
    state.recognition.lang = state.selectedLanguage;

    state.recognition.onresult = (event: any) => {
        // Mark that we got real results on first start (rules out Arc silent fail)
        if (isFirstStart) {
            gotResultOnFirstStart = true;
        }

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
    };

    state.recognition.onerror = (e: any) => {
        console.log('error:', e.error, e.message);

        // Arc / silent-fail detection: error fires immediately on first start with no results
        if (isFirstStart && !gotResultOnFirstStart) {
            isFirstStart = false;
            if (e.error === 'not-allowed' || e.error === 'service-not-allowed' || e.error === 'audio-capture' || e.error === 'aborted') {
                // These are legitimate errors that don't mean the browser lacks support
                // 'aborted' happens on Safari iOS when the permission dialog interrupts the first recognition start
            } else {
                showBrowserWarning();
            }
            state.isListening = false;
            updateMicUI(false);
            return;
        }

        if (e.error === 'aborted') {
            speechBlocked = true;

            // Modern iPad detection
            const isIPad = navigator.userAgent.includes('iPad') || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 2);
            const isPWA = (window.navigator as any).standalone === true || window.matchMedia('(display-mode: standalone)').matches;

            if (isIPad && isPWA) {
                els.ipadPwaWarning.classList.remove('hidden');
            }

            state.isListening = false;
            updateMicUI(false);
            return;
        }
    };

    state.recognition.onend = () => {
        console.log('ended');

        // Arc / silent-fail detection: ended immediately on first start with no results and no error
        if (isFirstStart && !gotResultOnFirstStart) {
            isFirstStart = false;
            showBrowserWarning();
            state.isListening = false;
            updateMicUI(false);
            return;
        }
        isFirstStart = false;

        if (speechBlocked) return;
        if (state.isListening) {

            try {
                state.recognition.start();
            } catch (error) {
                console.error('Failed to restart speech recognition:', error);
            }
        } else {
            updateMicUI(false);
        }
    };
}

export function startListening(): void {
    if (!state.recognition) return;
    state.isListening = true;
    lastMatchedIndex = -1;
    lastConsumedTail = '';

    speechBlocked = false;
    try {
        state.recognition.start();
        updateMicUI(true);
    } catch (error) {
        console.error('Failed to start speech recognition:', error);
        state.isListening = false;
        updateMicUI(false);
    }
}

export function stopListening(): void {
    if (!state.recognition) return;
    state.isListening = false;
    lastMatchedIndex = -1;
    lastConsumedTail = '';

    try {
        state.recognition.stop();
        updateMicUI(false);
    } catch (error) {
        console.error('Failed to stop speech recognition:', error);
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
