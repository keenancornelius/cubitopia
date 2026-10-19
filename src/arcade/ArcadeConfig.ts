// ============================================
// CUBITOPIA - Arcade / embed configuration
// ============================================
// Read once at boot from the page URL:
//   ?mode=arena      → skip the full main menu, boot straight into the
//                      touch-friendly Arena arcade (menu → best-of-3 skirmish)
//   ?app=legion      → running inside the Legion mobile app WebView: hide
//                      external-link chrome, show "Exit to Legion", talk to
//                      the host via window.ReactNativeWebView.postMessage
// ============================================

const params = (() => {
  try { return new URLSearchParams(window.location.search); } catch { return new URLSearchParams(); }
})();

/** True when the page was opened as the Arena arcade (?mode=arena). */
export const ARCADE_ARENA = (params.get('mode') || '').toLowerCase() === 'arena';

/** True when embedded in the Legion app (?app=legion). */
export const EMBED_LEGION = (params.get('app') || '').toLowerCase() === 'legion';

/** Coarse pointer / touch-capable device (phones, tablets). */
export const IS_TOUCH_DEVICE = (() => {
  try {
    return window.matchMedia('(pointer: coarse)').matches || 'ontouchstart' in window || navigator.maxTouchPoints > 0;
  } catch { return false; }
})();

/** Phone/tablet-class GPU budget: smaller shadow map, no MSAA on high-DPR screens. */
export const LOW_POWER_RENDER = IS_TOUCH_DEVICE || ARCADE_ARENA;

/** Wins needed to take an arena match (best of 3). */
export const ARENA_WINS_TO_TAKE_MATCH = 2;

/**
 * Arena difficulty: the AI army's max HP multiplier. The arena AI path (squad
 * commander + AI unit behaviour, and red's spawn side) beat an un-commanded
 * player army ~75% of the time in headless tests; this levels the default so
 * player micro decides the round. 1 = no handicap.
 */
export const ARENA_AI_HEALTH = 0.85;
