// Opt-in diagnostics. Open the app with ?debug (e.g. /prompter/?debug) to get a
// small on-screen log of what the microphone, camera and speech engine are
// doing. Safari's failures are mostly silent, so this is how we see them.

export const DEBUG = new URLSearchParams(location.search).has('debug');

const lines: string[] = [];
let panel: HTMLPreElement | null = null;

function stamp(): string {
    const t = new Date();
    const p = (n: number, w = 2) => String(n).padStart(w, '0');
    return `${p(t.getMinutes())}:${p(t.getSeconds())}.${p(t.getMilliseconds(), 3)}`;
}

export function dlog(message: string): void {
    const line = `${stamp()} ${message}`;
    console.log('[prompter]', line);
    if (!DEBUG) return;

    lines.push(line);
    if (lines.length > 40) lines.shift();

    if (!panel) {
        panel = document.createElement('pre');
        panel.id = 'debugLog';
        Object.assign(panel.style, {
            position: 'fixed', left: '8px', bottom: '8px', zIndex: '20000',
            maxWidth: 'calc(100vw - 16px)', maxHeight: '40vh', overflow: 'hidden',
            margin: '0', padding: '6px 8px', borderRadius: '6px',
            background: 'rgba(0,0,0,.82)', color: '#27e0ff',
            font: '11px/1.35 ui-monospace, Menlo, monospace',
            whiteSpace: 'pre-wrap', pointerEvents: 'none'
        });
        document.body.appendChild(panel);
    }
    panel.textContent = lines.join('\n');
}

export function exposeForDebug(parts: Record<string, unknown>): void {
    if (!DEBUG) return;
    const w = window as any;
    w.__prompter = { ...(w.__prompter || {}), ...parts };
}
