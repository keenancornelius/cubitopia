/**
 * DevKanban — "Working on..." overlay for the title screen.
 * Parses TASKS.md (imported at build time via Vite ?raw) and renders
 * a visual kanban board showing development progress per work stream.
 *
 * Read-only — scroll and close only.
 */

import { UI, COLORS, FONT, BORDER } from './UITheme';
import tasksRaw from '../../TASKS.md?raw';

// ── Data types ────────────────────────────────────────────────

interface TaskItem {
  text: string;
  status: 'done' | 'active' | 'open';
}

interface WorkStream {
  id: string;           // "A", "B", etc.
  title: string;        // "Combat & Unit AI"
  status: string;       // "[ACTIVE] — Session: combat-ai" or "OPEN"
  color: string;        // stream accent color
  tasks: TaskItem[];
}

// ── Stream colors (one per stream letter) ─────────────────────

const STREAM_COLORS: Record<string, string> = {
  A: '#e74c3c',  // red
  B: '#3498db',  // blue
  C: '#2ecc71',  // green
  D: '#f39c12',  // orange
  E: '#9b59b6',  // purple
  F: '#1abc9c',  // teal
  G: '#e67e22',  // dark orange
  H: '#34495e',  // steel
};

// ── Parser ────────────────────────────────────────────────────

function parseTasksMd(raw: string): WorkStream[] {
  const streams: WorkStream[] = [];
  const lines = raw.split('\n');

  let current: WorkStream | null = null;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Match "## Work Stream X: Title"
    const streamMatch = line.match(/^## Work Stream ([A-Z]):\s*(.+)/);
    if (streamMatch) {
      current = {
        id: streamMatch[1],
        title: streamMatch[2].trim(),
        status: '',
        color: STREAM_COLORS[streamMatch[1]] || '#888',
        tasks: [],
      };
      streams.push(current);
      continue;
    }

    // Match "**Status:** ..."
    if (current && line.match(/^\*\*Status:\*\*/)) {
      const statusText = line.replace(/^\*\*Status:\*\*\s*/, '').trim();
      current.status = statusText;
      continue;
    }

    // Match task lines: "- [x] ..." or "- [ ] ..."
    if (current) {
      const doneMatch = line.match(/^- \[x\]\s+(.+)/);
      if (doneMatch) {
        const text = cleanTaskText(doneMatch[1]);
        if (!text.includes('STREAM COMPLETE')) {
          current.tasks.push({ text, status: 'done' });
        }
        continue;
      }
      const openMatch = line.match(/^- \[ \]\s+(.+)/);
      if (openMatch) {
        const text = cleanTaskText(openMatch[1]);
        if (!text.includes('STREAM COMPLETE')) {
          current.tasks.push({ text, status: 'open' });
        }
        continue;
      }
    }

    // "## Recently Completed" or "## Cross-Stream" ends stream parsing
    if (line.startsWith('## Recently Completed') || line.startsWith('## Cross-Stream')) {
      current = null;
    }
  }

  return streams;
}

function cleanTaskText(raw: string): string {
  // Strip markdown bold, commit refs, long parenthetical details
  let text = raw.replace(/\*\*/g, '');
  // Truncate at " — " or " (commit " for brevity
  const dashIdx = text.indexOf(' — ');
  if (dashIdx > 20) text = text.substring(0, dashIdx);
  const commitIdx = text.indexOf(' (commit ');
  if (commitIdx > 0) text = text.substring(0, commitIdx);
  return text.trim();
}

// ── Overlay Renderer ──────────────────────────────────────────

let _overlay: HTMLElement | null = null;

export function showDevKanban(): void {
  if (_overlay) return;

  const streams = parseTasksMd(tasksRaw);

  const overlay = document.createElement('div');
  overlay.style.cssText = `
    ${UI.overlay()};
    display: flex; flex-direction: column; align-items: center;
    z-index: 20001; overflow-y: auto;
    animation: uiFadeIn 0.3s ease;
  `;

  // ── Header ──
  const header = document.createElement('div');
  header.style.cssText = `
    display: flex; align-items: center; justify-content: space-between;
    width: 100%; max-width: 1100px; padding: 32px 24px 16px;
    flex-shrink: 0;
  `;

  const titleEl = document.createElement('div');
  titleEl.style.cssText = `
    font-size: 22px; font-weight: bold; color: ${COLORS.textPrimary};
    letter-spacing: 3px; text-transform: uppercase;
    font-family: ${FONT.family};
  `;
  titleEl.textContent = 'DEVELOPMENT PROGRESS';
  header.appendChild(titleEl);

  const closeBtn = document.createElement('button');
  closeBtn.style.cssText = `
    ${UI.button('#555')};
    font-size: 14px; padding: 6px 16px; letter-spacing: 1px;
  `;
  closeBtn.textContent = 'CLOSE';
  closeBtn.addEventListener('click', () => hideDevKanban());
  header.appendChild(closeBtn);

  overlay.appendChild(header);

  // ── Summary stats ──
  const totalTasks = streams.reduce((s, st) => s + st.tasks.length, 0);
  const doneTasks = streams.reduce((s, st) => s + st.tasks.filter(t => t.status === 'done').length, 0);
  const pct = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

  const summaryEl = document.createElement('div');
  summaryEl.style.cssText = `
    width: 100%; max-width: 1100px; padding: 0 24px 16px;
    display: flex; align-items: center; gap: 16px; flex-shrink: 0;
  `;

  const progressBarWrap = document.createElement('div');
  progressBarWrap.style.cssText = `${UI.barWrap('10px')}; flex: 1;`;
  const progressBarFill = document.createElement('div');
  progressBarFill.style.cssText = UI.barFill('#2ecc71', pct);
  progressBarWrap.appendChild(progressBarFill);
  summaryEl.appendChild(progressBarWrap);

  const statsLabel = document.createElement('div');
  statsLabel.style.cssText = `
    font-size: 12px; color: ${COLORS.textSecondary};
    font-family: ${FONT.family}; white-space: nowrap;
  `;
  statsLabel.textContent = `${doneTasks} / ${totalTasks} tasks (${pct}%)`;
  summaryEl.appendChild(statsLabel);

  overlay.appendChild(summaryEl);

  // ── Stream columns container ──
  const board = document.createElement('div');
  board.style.cssText = `
    display: flex; flex-wrap: wrap; gap: 16px;
    width: 100%; max-width: 1100px; padding: 0 24px 32px;
    justify-content: center; align-items: flex-start;
  `;

  for (const stream of streams) {
    const col = document.createElement('div');
    col.style.cssText = `
      background: rgba(255,255,255,0.03);
      border: 1px solid ${stream.color}33;
      border-radius: ${BORDER.radius.lg};
      padding: 14px;
      width: 320px; min-width: 280px;
      flex-shrink: 0;
    `;

    // Stream header
    const colHeader = document.createElement('div');
    colHeader.style.cssText = `
      display: flex; align-items: center; gap: 8px;
      margin-bottom: 10px; padding-bottom: 8px;
      border-bottom: 1px solid ${stream.color}33;
    `;

    const badge = document.createElement('span');
    badge.style.cssText = `
      display: inline-flex; align-items: center; justify-content: center;
      width: 24px; height: 24px; border-radius: 4px;
      background: ${stream.color}; color: #000;
      font-size: 12px; font-weight: bold; font-family: ${FONT.family};
    `;
    badge.textContent = stream.id;
    colHeader.appendChild(badge);

    const colTitle = document.createElement('span');
    colTitle.style.cssText = `
      font-size: 13px; font-weight: bold; color: ${COLORS.textPrimary};
      font-family: ${FONT.family}; letter-spacing: 0.5px;
      flex: 1;
    `;
    colTitle.textContent = stream.title;
    colHeader.appendChild(colTitle);

    // Status badge
    const isActive = stream.status.includes('ACTIVE');
    const isDone = stream.status.includes('DONE');
    const statusBadge = document.createElement('span');
    statusBadge.style.cssText = `
      font-size: 9px; font-weight: bold; letter-spacing: 1px;
      padding: 2px 6px; border-radius: 3px;
      background: ${isActive ? stream.color + '33' : isDone ? '#2ecc7133' : '#88888833'};
      color: ${isActive ? stream.color : isDone ? '#2ecc71' : '#888'};
      text-transform: uppercase;
      font-family: ${FONT.family};
    `;
    statusBadge.textContent = isActive ? 'ACTIVE' : isDone ? 'DONE' : 'OPEN';
    colHeader.appendChild(statusBadge);

    col.appendChild(colHeader);

    // Stream progress mini-bar
    const streamDone = stream.tasks.filter(t => t.status === 'done').length;
    const streamTotal = stream.tasks.length;
    const streamPct = streamTotal > 0 ? Math.round((streamDone / streamTotal) * 100) : 0;

    const miniBarWrap = document.createElement('div');
    miniBarWrap.style.cssText = `${UI.barWrap('4px')}; margin-bottom: 10px;`;
    const miniBarFill = document.createElement('div');
    miniBarFill.style.cssText = UI.barFill(stream.color, streamPct);
    miniBarWrap.appendChild(miniBarFill);
    col.appendChild(miniBarWrap);

    // Task cards
    for (const task of stream.tasks) {
      const card = document.createElement('div');
      const isDoneTask = task.status === 'done';

      card.style.cssText = `
        background: ${isDoneTask ? 'rgba(46,204,113,0.06)' : 'rgba(255,255,255,0.04)'};
        border: 1px solid ${isDoneTask ? 'rgba(46,204,113,0.15)' : 'rgba(255,255,255,0.08)'};
        border-radius: ${BORDER.radius.sm};
        padding: 8px 10px;
        margin-bottom: 6px;
        display: flex; align-items: flex-start; gap: 8px;
        font-size: 11px; line-height: 1.4;
        color: ${isDoneTask ? COLORS.textMuted : COLORS.textSecondary};
        font-family: ${FONT.family};
        ${isDoneTask ? 'text-decoration: line-through; opacity: 0.7;' : ''}
      `;

      // Status indicator dot
      const dot = document.createElement('span');
      dot.style.cssText = `
        display: inline-block; width: 8px; height: 8px;
        border-radius: 50%; flex-shrink: 0; margin-top: 3px;
        background: ${isDoneTask ? '#2ecc71' : task.status === 'active' ? stream.color : '#555'};
        ${!isDoneTask && task.status !== 'active' ? '' : `box-shadow: 0 0 4px ${isDoneTask ? '#2ecc7166' : stream.color + '66'};`}
      `;
      card.appendChild(dot);

      const textEl = document.createElement('span');
      textEl.textContent = task.text;
      card.appendChild(textEl);

      col.appendChild(card);
    }

    // Empty state
    if (stream.tasks.length === 0) {
      const empty = document.createElement('div');
      empty.style.cssText = `
        font-size: 11px; color: ${COLORS.textDim}; font-style: italic;
        padding: 12px; text-align: center;
        font-family: ${FONT.family};
      `;
      empty.textContent = 'No tasks defined yet';
      col.appendChild(empty);
    }

    board.appendChild(col);
  }

  overlay.appendChild(board);

  // ── Keyboard close ──
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') hideDevKanban();
  };
  document.addEventListener('keydown', onKey);
  (overlay as any)._keyHandler = onKey;

  document.body.appendChild(overlay);
  _overlay = overlay;
}

export function hideDevKanban(): void {
  if (!_overlay) return;
  const handler = (_overlay as any)._keyHandler;
  if (handler) document.removeEventListener('keydown', handler);
  _overlay.remove();
  _overlay = null;
}

export function isDevKanbanVisible(): boolean {
  return _overlay !== null;
}
