// ============================================
// CUBITOPIA - Arcade UI (phone-first DOM layer for Arena mode)
// ============================================
// Arcade menu, in-match HUD (score, armies, big tap buttons), round banners,
// pause overlay and the final result screen. Pure DOM; all game actions are
// callbacks supplied by ArcadeController. Every hit target is >= 48 px and
// every edge respects env(safe-area-inset-*).
// ============================================

import { PixelTitle } from '../engine/PixelTitle';

export interface HudState {
  round: number;
  wins: [number, number];
  timeLeft: number;           // seconds left in the round
  alive: [number, number];    // living units: you, enemy
  hp: [number, number];       // HP fraction 0..1: you, enemy
  selected: number;
  selectedLabel: string;
  hasMages: boolean;
  lockedElement: string | null;
  stance: 'charge' | 'hold' | 'mixed' | null;
  attackMoveArmed: boolean;
}

export interface HudActions {
  onMenu(): void;
  onSelectAll(): void;
  onDeselect(): void;
  onAttackMove(): void;
  onStance(stance: 'charge' | 'hold'): void;
  onElement(el: string): void;
  onCenter(): void;
}

export interface MenuActions {
  onPlay(): void;
  onExit?: () => void;      // Exit to Legion (embedded only)
  onFullGame?: () => void;  // Standalone only: open the full game menu
}

const ELEMENTS: { id: string; icon: string; label: string; color: string }[] = [
  { id: 'fire', icon: '🔥', label: 'Fire', color: '#ff5a1f' },
  { id: 'water', icon: '💧', label: 'Water', color: '#3d8bff' },
  { id: 'lightning', icon: '⚡', label: 'Bolt', color: '#00d5ff' },
  { id: 'wind', icon: '🌪️', label: 'Wind', color: '#7dff8a' },
  { id: 'earth', icon: '🪨', label: 'Earth', color: '#b07cff' },
];

const HOW_TO: [string, string][] = [
  ['👆', '<b>Tap</b> a blue unit to select it'],
  ['📍', '<b>Tap ground</b> to move · <b>tap a red unit</b> to attack'],
  ['✋', '<b>Hold, then drag</b> to box-select · <b>double-tap</b> a unit for all of its type'],
  ['🤏', '<b>Drag</b> to pan · <b>pinch</b> to zoom · <b>twist</b> to rotate'],
  ['🏆', 'Wipe out the red army. <b>Best of 3 rounds.</b>'],
];

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, html?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

function btn(cls: string, html: string, onTap: () => void, label?: string): HTMLButtonElement {
  const b = el('button', 'cub-btn ' + cls, html);
  b.type = 'button';
  if (label) b.setAttribute('aria-label', label);
  b.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onTap(); });
  return b;
}

let cssInjected = false;
function injectCSS(): void {
  if (cssInjected) return;
  cssInjected = true;
  const style = document.createElement('style');
  style.id = 'cub-arcade-css';
  style.textContent = `
  :root {
    --cub-bg: #0b1020; --cub-panel: rgba(12,18,38,0.86); --cub-line: rgba(140,170,255,0.22);
    --cub-text: #eef2ff; --cub-dim: #9aa6c8; --cub-blue: #3d8bff; --cub-red: #ff4d4d;
    --cub-gold: #ffc940; --cub-green: #2fd27a;
    --sat: env(safe-area-inset-top, 0px); --sab: env(safe-area-inset-bottom, 0px);
    --sal: env(safe-area-inset-left, 0px); --sar: env(safe-area-inset-right, 0px);
  }
  /* Touch devices: no page scroll/bounce, no text selection, no callouts/zoom */
  html.cub-touch, html.cub-touch body {
    position: fixed; inset: 0; overflow: hidden; overscroll-behavior: none;
    touch-action: none; -webkit-user-select: none; user-select: none;
    -webkit-touch-callout: none; -webkit-tap-highlight-color: transparent;
    -webkit-text-size-adjust: 100%;
  }
  #game-canvas { touch-action: none; }
  /* Arcade: the desktop HUD is replaced wholesale by .cub-ui */
  body.cub-arcade > *:not(#game-canvas):not(.cub-ui):not(.cub-keep) { display: none !important; }

  .cub-ui { position: fixed; z-index: 30000; color: var(--cub-text);
    font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
    -webkit-user-select: none; user-select: none; }
  .cub-ui b { color: #fff; }
  .cub-btn { appearance: none; border: 1px solid var(--cub-line); background: var(--cub-panel);
    color: var(--cub-text); min-width: 48px; min-height: 48px; border-radius: 14px;
    font: 800 13px/1.1 system-ui, -apple-system, 'Segoe UI', sans-serif; letter-spacing: 1px;
    text-transform: uppercase; display: inline-flex; align-items: center; justify-content: center;
    gap: 6px; padding: 0 14px; cursor: pointer; touch-action: manipulation;
    box-shadow: 0 4px 14px rgba(0,0,0,0.35); backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); }
  .cub-btn:active { transform: scale(0.96); filter: brightness(1.2); }
  .cub-btn .ic { font-size: 18px; line-height: 1; }
  .cub-btn.on { background: var(--cub-gold); color: #1a1300; border-color: var(--cub-gold); }
  .cub-btn.primary { background: linear-gradient(180deg, #3ee08a, #1fae5d); color: #04210f; border: none;
    min-height: 60px; font-size: 20px; letter-spacing: 4px; border-radius: 18px; padding: 0 36px;
    box-shadow: 0 8px 28px rgba(47,210,122,0.35); }
  .cub-btn.ghost { background: rgba(255,255,255,0.06); }
  .cub-btn.exit { background: rgba(255,77,77,0.14); border-color: rgba(255,77,77,0.5); color: #ffd6d6; }
  .cub-btn[disabled] { opacity: 0.4; }

  /* ── Menu ── */
  .cub-menu { inset: 0; display: flex; align-items: center; justify-content: center;
    background: radial-gradient(120% 90% at 50% 20%, rgba(40,70,160,0.55), rgba(5,8,20,0.96) 70%);
    padding: calc(16px + var(--sat)) calc(16px + var(--sar)) calc(16px + var(--sab)) calc(16px + var(--sal)); }
  .cub-menu .card { width: min(520px, 100%); max-height: 100%; overflow-y: auto; touch-action: pan-y;
    display: flex; flex-direction: column; align-items: center; gap: 14px; text-align: center; }
  .cub-menu .title { width: min(460px, 92%); height: auto; image-rendering: pixelated; }
  .cub-menu .mode { font-weight: 900; font-size: 30px; letter-spacing: 10px; color: var(--cub-gold);
    text-shadow: 0 0 24px rgba(255,201,64,0.45); margin-top: -6px; }
  .cub-menu .tag { color: var(--cub-dim); font-size: 14px; letter-spacing: 1px; }
  .cub-menu .how { width: 100%; background: var(--cub-panel); border: 1px solid var(--cub-line);
    border-radius: 16px; padding: 6px 14px; text-align: left; }
  .cub-menu .how div { display: flex; gap: 12px; align-items: center; padding: 8px 0; font-size: 14px;
    color: #cdd6f4; line-height: 1.35; }
  .cub-menu .how div + div { border-top: 1px solid rgba(255,255,255,0.06); }
  .cub-menu .how span { font-size: 20px; width: 26px; text-align: center; flex: none; }
  .cub-menu .row { display: flex; gap: 10px; flex-wrap: wrap; justify-content: center; }
  @media (orientation: landscape) and (max-height: 560px) {
    .cub-menu .card { width: min(820px, 100%); display: grid; grid-template-columns: 1fr 1fr;
      align-items: center; column-gap: 22px; row-gap: 10px; }
    .cub-menu .brand { grid-column: 1; grid-row: 1 / span 3; display: flex; flex-direction: column; align-items: center; gap: 10px; }
    .cub-menu .how { grid-column: 2; grid-row: 1 / span 3; }
    .cub-menu .how div { padding: 5px 0; font-size: 13px; }
    .cub-menu .mode { font-size: 24px; }
  }

  /* ── HUD ── */
  .cub-hud-top { top: 0; left: 0; right: 0; pointer-events: none;
    padding: calc(8px + var(--sat)) calc(10px + var(--sar)) 0 calc(10px + var(--sal)); }
  .cub-hud-top .bar { display: flex; align-items: center; gap: 8px; }
  .cub-hud-top .bar > * { pointer-events: auto; }
  .cub-score { flex: 1; min-width: 0; background: var(--cub-panel); border: 1px solid var(--cub-line);
    border-radius: 14px; padding: 6px 10px; display: flex; flex-direction: column; gap: 5px;
    backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); pointer-events: none !important; }
  .cub-score .line { display: flex; align-items: center; justify-content: space-between; gap: 6px;
    font-weight: 800; font-size: 13px; letter-spacing: 1px; }
  .cub-score .you { color: #9cc4ff; } .cub-score .ai { color: #ff9c9c; }
  .cub-score .mid { color: var(--cub-gold); font-size: 12px; letter-spacing: 2px; white-space: nowrap; }
  .cub-score .pips { letter-spacing: 3px; }
  .cub-army { display: flex; height: 8px; border-radius: 6px; overflow: hidden; background: #222a40; }
  .cub-army i { display: block; height: 100%; transition: width 0.3s; }
  .cub-army .b { background: linear-gradient(90deg, #2a6fe0, #5aa2ff); }
  .cub-army .r { background: linear-gradient(90deg, #ff6b6b, #d93636); margin-left: auto; }

  .cub-hud-bot { left: 0; right: 0; bottom: 0; pointer-events: none;
    padding: 0 calc(10px + var(--sar)) calc(10px + var(--sab)) calc(10px + var(--sal));
    display: flex; flex-direction: column; gap: 8px; }
  .cub-hud-bot > * { pointer-events: auto; }
  .cub-sel { align-self: center; display: flex; align-items: center; gap: 8px; max-width: 100%;
    background: var(--cub-panel); border: 1px solid var(--cub-line); border-radius: 999px;
    padding: 4px 4px 4px 14px; font-size: 13px; font-weight: 700; min-height: 48px;
    backdrop-filter: blur(6px); -webkit-backdrop-filter: blur(6px); }
  .cub-sel .txt { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: #dbe4ff; }
  .cub-sel .cub-btn { min-width: 40px; min-height: 40px; border-radius: 999px; padding: 0; }
  .cub-sel.empty { padding-right: 14px; color: var(--cub-dim); }
  .cub-els { display: flex; justify-content: center; gap: 8px; }
  .cub-els .cub-btn { width: 52px; height: 52px; padding: 0; border-radius: 50%; font-size: 22px; }
  .cub-els .cub-btn.on { background: #fff; }
  .cub-acts { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
  .cub-acts .cub-btn { min-height: 56px; flex-direction: column; gap: 3px; font-size: 11px; padding: 0 4px; }
  .cub-acts .cub-btn .ic { font-size: 20px; }
  @media (orientation: landscape) and (max-height: 560px) {
    .cub-hud-top { right: auto; width: min(430px, 52vw); }
    .cub-hud-bot { top: calc(8px + var(--sat)); left: auto; width: 96px; flex-direction: column-reverse;
      justify-content: flex-start; padding-left: 0; }
    .cub-acts { grid-template-columns: 1fr; gap: 6px; }
    .cub-acts .cub-btn { min-height: 50px; }
    .cub-els { position: fixed; right: calc(116px + var(--sar)); bottom: calc(10px + var(--sab)); }
    .cub-els .cub-btn { width: 48px; height: 48px; }
    .cub-sel { position: fixed; left: calc(10px + var(--sal)); bottom: calc(10px + var(--sab)); max-width: 46vw; }
  }

  .cub-toast { left: 50%; top: calc(112px + var(--sat)); transform: translateX(-50%);
    background: var(--cub-panel); border: 1px solid var(--cub-line); border-radius: 12px;
    padding: 10px 16px; font-weight: 700; font-size: 14px; max-width: min(88vw, 420px); text-align: center;
    pointer-events: none; opacity: 0; transition: opacity 0.2s; }
  .cub-toast.show { opacity: 1; }
  @media (orientation: landscape) and (max-height: 560px) { .cub-toast { top: calc(84px + var(--sat)); } }

  .cub-banner { inset: 0; display: flex; flex-direction: column; align-items: center; justify-content: center;
    pointer-events: none; text-align: center; gap: 6px; background: rgba(5,8,20,0.35); }
  .cub-banner .big { font-weight: 900; font-size: clamp(40px, 12vw, 72px); letter-spacing: 6px;
    text-shadow: 0 0 30px currentColor; animation: cubPop 0.45s cubic-bezier(.2,1.6,.4,1); }
  .cub-banner .sub { font-weight: 700; font-size: 16px; letter-spacing: 3px; color: #dbe4ff; }
  @keyframes cubPop { from { transform: scale(0.4); opacity: 0; } to { transform: scale(1); opacity: 1; } }

  .cub-overlay { inset: 0; display: flex; align-items: center; justify-content: center;
    background: rgba(5,8,20,0.82); backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);
    padding: calc(16px + var(--sat)) calc(16px + var(--sar)) calc(16px + var(--sab)) calc(16px + var(--sal)); }
  .cub-overlay .card { width: min(420px, 100%); max-height: 100%; overflow-y: auto; touch-action: pan-y;
    display: flex; flex-direction: column; align-items: stretch; gap: 12px; text-align: center; }
  .cub-overlay h1 { margin: 0; font-size: clamp(40px, 13vw, 64px); font-weight: 900; letter-spacing: 6px;
    text-shadow: 0 0 30px currentColor; }
  .cub-overlay .sub { color: #dbe4ff; font-size: 15px; font-weight: 600; }
  .cub-stats { display: grid; grid-template-columns: repeat(3, 1fr); gap: 8px; }
  .cub-stats div { background: var(--cub-panel); border: 1px solid var(--cub-line); border-radius: 12px; padding: 10px 4px; }
  .cub-stats b { display: block; font-size: 22px; } .cub-stats span { font-size: 10px; letter-spacing: 2px; color: var(--cub-dim); }
  .cub-overlay .cub-btn { width: 100%; }
  @media (orientation: landscape) and (max-height: 560px) {
    .cub-overlay .card { width: min(640px, 100%); display: grid; grid-template-columns: 1fr 1fr; align-items: center; column-gap: 18px; }
    .cub-overlay .card > .head { grid-column: 1; grid-row: 1 / span 4; }
    .cub-overlay h1 { font-size: 46px; }
  }
  `;
  document.head.appendChild(style);
}

export class ArcadeUI {
  private menuEl: HTMLElement | null = null;
  private menuTitle: PixelTitle | null = null;
  private hudTop: HTMLElement | null = null;
  private hudBot: HTMLElement | null = null;
  private toastEl: HTMLElement | null = null;
  private toastTimer: number | null = null;
  private bannerEl: HTMLElement | null = null;
  private overlayEl: HTMLElement | null = null;
  private refs: Record<string, HTMLElement> = {};
  private lastHudKey = '';

  constructor(private embedded: boolean) {
    injectCSS();
  }

  /** Arcade body mode: hides the desktop HUD (call once). */
  enableArcadeBody(): void { document.body.classList.add('cub-arcade'); }

  /** Touch device: lock page scroll/zoom/selection. */
  enableTouchPage(): void {
    document.documentElement.classList.add('cub-touch');
  }

  // ── Menu ──────────────────────────────────────────────────

  showMenu(actions: MenuActions): HTMLElement {
    this.hideMenu();
    const m = el('div', 'cub-ui cub-menu');
    m.setAttribute('data-cub', 'menu');
    const card = el('div', 'card');
    const brand = el('div', 'brand');
    this.menuTitle = new PixelTitle();
    const t = this.menuTitle.getElement();
    t.className = 'title';
    t.style.cssText = '';
    brand.appendChild(t);
    brand.appendChild(el('div', 'mode', '⚔ ARENA ⚔'));
    brand.appendChild(el('div', 'tag', 'Army vs army voxel brawl · best of 3 rounds'));
    const row = el('div', 'row');
    const play = btn('primary', 'PLAY', () => actions.onPlay(), 'Play arena');
    play.setAttribute('data-cub', 'play');
    row.appendChild(play);
    brand.appendChild(row);
    const row2 = el('div', 'row');
    if (this.embedded && actions.onExit) {
      const ex = btn('exit', '← Exit to Legion', () => actions.onExit!(), 'Exit to Legion');
      ex.setAttribute('data-cub', 'exit');
      row2.appendChild(ex);
    } else if (!this.embedded && actions.onFullGame) {
      row2.appendChild(btn('ghost', 'Full game ›', () => actions.onFullGame!(), 'Open the full game'));
    }
    if (row2.childElementCount) brand.appendChild(row2);
    card.appendChild(brand);
    const how = el('div', 'how');
    for (const [ic, txt] of HOW_TO) how.appendChild(el('div', '', `<span>${ic}</span><p style="margin:0">${txt}</p>`));
    card.appendChild(how);
    m.appendChild(card);
    document.body.appendChild(m);
    this.menuEl = m;
    return m;
  }

  hideMenu(): void {
    this.menuTitle?.dispose();
    this.menuTitle = null;
    this.menuEl?.remove();
    this.menuEl = null;
  }

  get menuVisible(): boolean { return !!this.menuEl; }

  // ── HUD ───────────────────────────────────────────────────

  showHUD(a: HudActions): void {
    this.hideHUD();
    const top = el('div', 'cub-ui cub-hud-top');
    const bar = el('div', 'bar');
    const menuB = btn('', '<span class="ic">☰</span>', a.onMenu, 'Menu');
    menuB.setAttribute('data-cub', 'menu-btn');
    bar.appendChild(menuB);
    const score = el('div', 'cub-score');
    score.innerHTML = `
      <div class="line"><span class="you" data-r="you">YOU 13</span>
        <span class="mid" data-r="mid">ROUND 1 · 3:00</span>
        <span class="ai" data-r="ai">13 AI</span></div>
      <div class="cub-army"><i class="b" data-r="hpb" style="width:50%"></i><i class="r" data-r="hpr" style="width:50%"></i></div>
      <div class="line" style="font-size:11px"><span class="you pips" data-r="pipy">○○</span>
        <span style="color:var(--cub-dim);letter-spacing:2px;font-size:10px">BEST OF 3</span>
        <span class="ai pips" data-r="pipa">○○</span></div>`;
    bar.appendChild(score);
    const center = btn('', '<span class="ic">⌖</span>', a.onCenter, 'Center camera on your army');
    center.setAttribute('data-cub', 'center');
    bar.appendChild(center);
    top.appendChild(bar);

    const bot = el('div', 'cub-ui cub-hud-bot');
    const sel = el('div', 'cub-sel empty');
    sel.setAttribute('data-cub', 'sel');
    const selTxt = el('span', 'txt', 'Tap a blue unit to select');
    sel.appendChild(selTxt);
    const desel = btn('ghost', '✕', a.onDeselect, 'Clear selection');
    desel.setAttribute('data-cub', 'deselect');
    sel.appendChild(desel);
    bot.appendChild(sel);

    const els = el('div', 'cub-els');
    els.setAttribute('data-cub', 'elements');
    for (const e of ELEMENTS) {
      const b = btn('', e.icon, () => a.onElement(e.id), `Lock mages to ${e.label}`);
      b.dataset.el = e.id;
      b.style.borderColor = e.color;
      els.appendChild(b);
    }
    bot.appendChild(els);

    const acts = el('div', 'cub-acts');
    const mk = (id: string, ic: string, label: string, fn: () => void) => {
      const b = btn('', `<span class="ic">${ic}</span>${label}`, fn, label);
      b.setAttribute('data-cub', id);
      acts.appendChild(b);
      return b;
    };
    mk('all', '👥', 'Army', a.onSelectAll);
    mk('amove', '⚔️', 'Attack', a.onAttackMove);
    mk('charge', '🔥', 'Charge', () => a.onStance('charge'));
    mk('hold', '🛡️', 'Hold', () => a.onStance('hold'));
    bot.appendChild(acts);

    document.body.appendChild(top);
    document.body.appendChild(bot);
    this.hudTop = top; this.hudBot = bot;
    this.refs = {};
    for (const n of [...top.querySelectorAll<HTMLElement>('[data-r]')]) this.refs[n.dataset.r!] = n;
    this.refs.sel = sel; this.refs.selTxt = selTxt; this.refs.desel = desel; this.refs.els = els;
    this.refs.amove = acts.querySelector('[data-cub="amove"]')!;
    this.refs.charge = acts.querySelector('[data-cub="charge"]')!;
    this.refs.hold = acts.querySelector('[data-cub="hold"]')!;
    this.lastHudKey = '';
  }

  hideHUD(): void {
    this.hudTop?.remove(); this.hudBot?.remove();
    this.hudTop = this.hudBot = null;
  }

  updateHUD(s: HudState): void {
    if (!this.hudTop) return;
    const mm = Math.floor(Math.max(0, s.timeLeft) / 60);
    const ss = Math.floor(Math.max(0, s.timeLeft) % 60).toString().padStart(2, '0');
    const key = [s.round, s.wins.join(), mm, ss, s.alive.join(), s.hp.map(h => Math.round(h * 50)).join(),
      s.selected, s.selectedLabel, s.hasMages, s.lockedElement, s.stance, s.attackMoveArmed].join('|');
    if (key === this.lastHudKey) return;
    this.lastHudKey = key;
    const r = this.refs;
    r.you.textContent = `YOU ${s.alive[0]}`;
    r.ai.textContent = `${s.alive[1]} AI`;
    r.mid.textContent = `ROUND ${s.round} · ${mm}:${ss}`;
    r.mid.style.color = s.timeLeft <= 30 ? 'var(--cub-red)' : '';
    const tot = s.hp[0] + s.hp[1] || 1;
    r.hpb.style.width = `${(s.hp[0] / tot) * 100}%`;
    r.hpr.style.width = `${(s.hp[1] / tot) * 100}%`;
    const pips = (n: number) => '●'.repeat(n) + '○'.repeat(Math.max(0, 2 - n));
    r.pipy.textContent = pips(s.wins[0]);
    r.pipa.textContent = pips(s.wins[1]);
    r.sel.classList.toggle('empty', s.selected === 0);
    r.selTxt.textContent = s.selected === 0
      ? (s.attackMoveArmed ? 'Select units first' : 'Tap a blue unit to select')
      : (s.attackMoveArmed ? `Tap where ${s.selected} unit${s.selected === 1 ? '' : 's'} attack-move` : `${s.selected} selected · ${s.selectedLabel}`);
    r.desel.style.display = s.selected === 0 ? 'none' : '';
    r.els.style.display = s.hasMages ? '' : 'none';
    for (const b of [...r.els.children] as HTMLElement[]) b.classList.toggle('on', b.dataset.el === s.lockedElement);
    r.amove.classList.toggle('on', s.attackMoveArmed);
    r.charge.classList.toggle('on', s.selected > 0 && s.stance === 'charge');
    r.hold.classList.toggle('on', s.selected > 0 && s.stance === 'hold');
  }

  // ── Toast / banners / overlays ────────────────────────────

  toast(html: string, color = '#eef2ff', ms = 1800): void {
    if (!this.toastEl) {
      this.toastEl = el('div', 'cub-ui cub-toast');
      this.toastEl.setAttribute('data-cub', 'toast');
      document.body.appendChild(this.toastEl);
    }
    this.toastEl.innerHTML = html;
    this.toastEl.style.color = color;
    this.toastEl.style.borderColor = color + '66';
    this.toastEl.classList.add('show');
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toastEl?.classList.remove('show'), ms);
  }

  banner(big: string, sub: string, color: string, ms = 2200): void {
    this.bannerEl?.remove();
    const b = el('div', 'cub-ui cub-banner');
    b.setAttribute('data-cub', 'banner');
    b.innerHTML = `<div class="big" style="color:${color}">${big}</div><div class="sub">${sub}</div>`;
    document.body.appendChild(b);
    this.bannerEl = b;
    window.setTimeout(() => { if (this.bannerEl === b) { b.remove(); this.bannerEl = null; } }, ms);
  }

  clearBanner(): void { this.bannerEl?.remove(); this.bannerEl = null; }

  /** Generic centered overlay card. Returns the card for extra content. */
  private overlay(kind: string, head: string, buttons: { label: string; cls: string; id: string; fn: () => void }[], onBackdrop?: () => void): HTMLElement {
    this.hideOverlay();
    const o = el('div', 'cub-ui cub-overlay');
    o.setAttribute('data-cub', kind);
    const card = el('div', 'card');
    const h = el('div', 'head', head);
    card.appendChild(h);
    for (const b of buttons) {
      const bb = btn(b.cls, b.label, b.fn);
      bb.setAttribute('data-cub', b.id);
      card.appendChild(bb);
    }
    o.appendChild(card);
    if (onBackdrop) o.addEventListener('click', (e) => { if (e.target === o) onBackdrop(); });
    document.body.appendChild(o);
    this.overlayEl = o;
    return card;
  }

  hideOverlay(): void { this.overlayEl?.remove(); this.overlayEl = null; }
  get overlayKind(): string | null { return this.overlayEl?.getAttribute('data-cub') ?? null; }

  showPause(opts: { onResume(): void; onRestart(): void; onHow(): void; onExit?: () => void; onMainMenu?: () => void; external?: boolean }): void {
    const buttons = [
      { label: '▶ Resume', cls: 'primary', id: 'resume', fn: opts.onResume },
      { label: '↻ Restart match', cls: '', id: 'restart', fn: opts.onRestart },
      { label: '? How to play', cls: 'ghost', id: 'how', fn: opts.onHow },
    ];
    if (opts.onExit) buttons.push({ label: '← Exit to Legion', cls: 'exit', id: 'exit', fn: opts.onExit });
    else if (opts.onMainMenu) buttons.push({ label: 'Arena menu', cls: 'ghost', id: 'mainmenu', fn: opts.onMainMenu });
    const head = opts.external
      ? '<h1 style="color:#9cc4ff;font-size:44px">PAUSED</h1><div class="sub">Tap resume to jump back in</div>'
      : '<h1 style="color:#9cc4ff;font-size:44px">PAUSED</h1>';
    this.overlay('pause', head, buttons);
  }

  showHowTo(onBack: () => void): void {
    const head = `<h1 style="color:var(--cub-gold);font-size:30px">HOW TO PLAY</h1>
      <div class="how" style="text-align:left;background:var(--cub-panel);border:1px solid var(--cub-line);border-radius:16px;padding:4px 14px">
      ${HOW_TO.map(([i, t]) => `<div style="display:flex;gap:12px;align-items:center;padding:8px 0;font-size:14px;color:#cdd6f4"><span style="font-size:20px;width:26px;text-align:center">${i}</span><p style="margin:0">${t}</p></div>`).join('')}
      <div style="display:flex;gap:12px;align-items:center;padding:8px 0;font-size:14px;color:#cdd6f4"><span style="font-size:20px;width:26px;text-align:center">🔥</span><p style="margin:0"><b>Charge</b> hunts the nearest enemy · <b>Hold</b> defends where units stand · element buttons lock your mages' spells</p></div>
      </div>`;
    this.overlay('howto', head, [{ label: 'Got it', cls: 'primary', id: 'howto-back', fn: onBack }]);
  }

  showResult(opts: { victory: boolean; wins: [number, number]; kills: number; lost: number; seconds: number;
    onPlayAgain(): void; onExit?: () => void; onMenu?: () => void }): void {
    const color = opts.victory ? '#2fd27a' : '#ff4d4d';
    const m = Math.floor(opts.seconds / 60), s = Math.floor(opts.seconds % 60).toString().padStart(2, '0');
    const head = `<h1 style="color:${color}">${opts.victory ? 'VICTORY' : 'DEFEAT'}</h1>
      <div class="sub">${opts.victory ? 'The arena is yours.' : 'The red army holds the arena.'} <span style="white-space:nowrap">Rounds ${opts.wins[0]}&nbsp;–&nbsp;${opts.wins[1]}</span></div>
      <div class="cub-stats" style="margin-top:10px"><div><b style="color:#5aa2ff">${opts.kills}</b><span>KILLS</span></div>
      <div><b style="color:#ff7b7b">${opts.lost}</b><span>LOST</span></div><div><b style="color:var(--cub-gold)">${m}:${s}</b><span>TIME</span></div></div>`;
    const buttons = [{ label: '↻ Play again', cls: 'primary', id: 'again', fn: opts.onPlayAgain }];
    if (opts.onExit) buttons.push({ label: '← Exit to Legion', cls: 'exit', id: 'exit', fn: opts.onExit });
    if (opts.onMenu) buttons.push({ label: 'Arena menu', cls: 'ghost', id: 'mainmenu', fn: opts.onMenu });
    this.overlay('result', head, buttons);
  }
}
