// TEMPORARY: remote logging to debug iOS uploads. Remove once fixed.
export function debugLog(...parts: unknown[]) {
  const msg = parts.map((p) => (typeof p === 'string' ? p : JSON.stringify(p))).join(' ')
  fetch('/__debug-log', { method: 'POST', body: msg }).catch(() => {})
}

debugLog('loaded', { ua: navigator.userAgent, secure: window.isSecureContext })
window.addEventListener('error', (e) => debugLog('window error', e.message))
window.addEventListener('unhandledrejection', (e) => debugLog('rejection', String(e.reason)))
for (const type of ['touchend', 'click', 'change', 'input']) {
  document.addEventListener(type, (e) => debugLog('doc', type, (e.target as Element)?.tagName), true)
}
