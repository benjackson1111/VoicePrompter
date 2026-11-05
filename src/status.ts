import { els } from './elements';

// Short, visible messages for things that used to fail silently (the mic
// dropping out, the camera being interrupted, permissions being blocked).

let hideTimer: ReturnType<typeof setTimeout> | null = null;

export function showStatus(message: string, tone: 'warn' | 'error' = 'warn', ms = 5000): void {
    const toast = els.statusToast;
    if (!toast) return;
    els.statusToastText.textContent = message;
    els.statusToastCard.style.borderColor = tone === 'error' ? 'rgba(255,47,149,.6)' : 'rgba(39,224,255,.4)';
    toast.classList.remove('hidden');
    if (hideTimer) clearTimeout(hideTimer);
    hideTimer = setTimeout(() => toast.classList.add('hidden'), ms);
}
