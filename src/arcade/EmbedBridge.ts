// ============================================
// CUBITOPIA - Host app bridge (Legion app WebView contract)
// ============================================
// Messages to the host (JSON strings via window.ReactNativeWebView.postMessage):
//   {type:'ready'}  once the arcade menu is interactive
//   {type:'exit'}   when the player taps "Exit to Legion"
// The host can call window.__cubPause(true|false) — the app pauses the game
// when it is backgrounded.
// ============================================

type HostMessage = { type: 'ready' } | { type: 'exit' };

interface RNWebView { postMessage(data: string): void }

function host(): RNWebView | null {
  const w = window as unknown as { ReactNativeWebView?: RNWebView };
  return w.ReactNativeWebView && typeof w.ReactNativeWebView.postMessage === 'function'
    ? w.ReactNativeWebView : null;
}

export function postToHost(msg: HostMessage): void {
  const h = host();
  if (!h) return;
  try { h.postMessage(JSON.stringify(msg)); } catch { /* host gone */ }
}

let readySent = false;
/** Fire {type:'ready'} exactly once per page load. */
export function notifyReady(): void {
  if (readySent) return;
  readySent = true;
  postToHost({ type: 'ready' });
}

export function notifyExit(): void {
  postToHost({ type: 'exit' });
}

/** Install window.__cubPause(paused). The handler receives a boolean (default true). */
export function installPauseHook(handler: (paused: boolean) => void): void {
  (window as unknown as { __cubPause: (p?: boolean) => void }).__cubPause = (p?: boolean) => {
    handler(p === undefined ? true : !!p);
  };
}
