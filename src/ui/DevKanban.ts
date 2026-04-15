/**
 * DevKanban — "Working on..." overlay for the title screen.
 * Parses TASKS.md (imported at build time via Vite ?raw) and renders
 * a visual kanban board showing development progress per work stream.
 *
 * Features:
 * - Horizontal scrollable columns (one per stream)
 * - Auto-minimized completed tasks (collapsed by default)
 * - Feature voting via Firebase (anonymous, one vote per user per feature)
 * - Suggestion box for community feature requests
 */

import { UI, COLORS, FONT, BORDER } from './UITheme';
import tasksRaw from '../../TASKS.md?raw';

// ── Data types ────────────────────────────────────────────────

interface TaskItem {
  text: string;
  description?: string; // detail text after " — " dash, shown on expand
  status: 'done' | 'active' | 'open';
  hash: string; // deterministic hash for Firebase vote key
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
  I: '#e91e63',  // pink
};

// ── Simple hash for task text → Firebase key ─────────────────

function taskHash(text: string): string {
  let h = 0;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) - h + text.charCodeAt(i)) | 0;
  }
  return 'task_' + Math.abs(h).toString(36);
}

// ── Firebase vote helpers (lazy-loaded) ──────────────────────

let _firebaseReady = false;
let _dbRef: any = null;
let _votesCache: Record<string, number> = {};
let _myVotes: Set<string> = new Set();

// Load votes user has already cast from localStorage
function loadMyVotes(): void {
  try {
    const stored = localStorage.getItem('cubitopia_feature_votes');
    if (stored) _myVotes = new Set(JSON.parse(stored));
  } catch (err) {
    console.debug('[DevKanban] Failed to load votes from localStorage:', err);
  }
}

function saveMyVotes(): void {
  try {
    localStorage.setItem('cubitopia_feature_votes', JSON.stringify([..._myVotes]));
  } catch (err) {
    console.debug('[DevKanban] Failed to save votes to localStorage:', err);
  }
}

async function ensureFirebase(): Promise<boolean> {
  if (_firebaseReady) return true;
  try {
    const { initFirebase, getDb } = await import('../network/FirebaseConfig');
    initFirebase();
    const { ref } = await import('firebase/database');
    _dbRef = { getDb, ref };
    _firebaseReady = true;
    return true;
  } catch (err) {
    console.debug('[DevKanban] Firebase unavailable (offline or uninitialized):', err);
    return false;
  }
}

async function loadVotes(): Promise<Record<string, number>> {
  if (!await ensureFirebase()) return {};
  try {
    const { get, ref } = await import('firebase/database');
    const snap = await get(ref(_dbRef.getDb(), 'feature-votes'));
    if (snap.exists()) {
      _votesCache = snap.val() as Record<string, number>;
    }
  } catch (err) {
    console.debug('[DevKanban] Failed to load votes (offline):', err);
  }
  return _votesCache;
}

async function castVote(hash: string): Promise<number> {
  if (_myVotes.has(hash)) return _votesCache[hash] ?? 0;

  _myVotes.add(hash);
  saveMyVotes();

  const newCount = (_votesCache[hash] ?? 0) + 1;
  _votesCache[hash] = newCount;

  if (await ensureFirebase()) {
    try {
      const { ref, set } = await import('firebase/database');
      await set(ref(_dbRef.getDb(), `feature-votes/${hash}`), newCount);
    } catch (err) {
      console.debug('[DevKanban] Failed to persist vote (offline):', err);
    }
  }
  return newCount;
}

async function submitSuggestion(text: string): Promise<boolean> {
  if (!await ensureFirebase()) return false;
  try {
    const { ref, push, set, serverTimestamp } = await import('firebase/database');
    const sugRef = push(ref(_dbRef.getDb(), 'feature-suggestions'));
    await set(sugRef, { text, timestamp: serverTimestamp() });
    return true;
  } catch (err) {
    console.debug('[DevKanban] Failed to submit suggestion:', err);
    return false;
  }
}

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
        const { title, description } = cleanTaskText(doneMatch[1]);
        if (!title.includes('STREAM COMPLETE')) {
          current.tasks.push({ text: title, description, status: 'done', hash: taskHash(title) });
        }
        continue;
      }
      const openMatch = line.match(/^- \[ \]\s+(.+)/);
      if (openMatch) {
        const { title, description } = cleanTaskText(openMatch[1]);
        if (!title.includes('STREAM COMPLETE')) {
          current.tasks.push({ text: title, description, status: 'open', hash: taskHash(title) });
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

function cleanTaskText(raw: string): { title: string; description?: string } {
  // Strip markdown bold, commit refs
  let text = raw.replace(/\*\*/g, '');
  // Strip commit refs from everywhere
  const commitIdx = text.indexOf(' (commit ');
  if (commitIdx > 0) text = text.substring(0, commitIdx);
  // Split at " — " dash: title before, description after
  const dashIdx = text.indexOf(' — ');
  if (dashIdx > 20) {
    const title = text.substring(0, dashIdx).trim();
    const description = text.substring(dashIdx + 3).trim();
    return { title, description: description || undefined };
  }
  return { title: text.trim() };
}

// ── Overlay Renderer ──────────────────────────────────────────

let _overlay: HTMLElement | null = null;

export function showDevKanban(): void {
  if (_overlay) return;

  loadMyVotes();
  const streams = parseTasksMd(tasksRaw);

  const overlay = document.createElement('div');
  overlay.style.cssText = `
    ${UI.overlay()};
    display: flex; flex-direction: column; align-items: stretch;
    z-index: 20001;
    animation: uiFadeIn 0.3s ease;
  `;

  // ── Header ──
  const header = document.createElement('div');
  header.style.cssText = `
    display: flex; align-items: center; justify-content: space-between;
    padding: 24px 28px 12px; flex-shrink: 0;
  `;

  const titleEl = document.createElement('div');
  titleEl.style.cssText = `
    font-size: 20px; font-weight: bold; color: ${COLORS.textPrimary};
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
    padding: 0 28px 12px; display: flex; align-items: center; gap: 16px; flex-shrink: 0;
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

  // ── Horizontal scrollable board ──
  const board = document.createElement('div');
  board.style.cssText = `
    display: flex; gap: 16px;
    padding: 8px 28px 16px;
    overflow-x: auto; overflow-y: hidden;
    flex: 1; align-items: flex-start;
    scroll-behavior: smooth;
    -webkit-overflow-scrolling: touch;
  `;

  // Enable horizontal scroll via mouse wheel
  board.addEventListener('wheel', (e) => {
    if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
      e.preventDefault();
      board.scrollLeft += e.deltaY;
    }
  }, { passive: false });

  // Map from task hash to vote count display elements (for async update)
  const voteDisplays = new Map<string, HTMLElement>();

  for (const stream of streams) {
    const col = document.createElement('div');
    col.style.cssText = `
      background: rgba(255,255,255,0.03);
      border: 1px solid ${stream.color}33;
      border-radius: ${BORDER.radius.lg};
      padding: 14px;
      min-width: 280px; max-width: 320px; width: 300px;
      flex-shrink: 0;
      max-height: calc(100vh - 180px);
      overflow-y: auto;
    `;

    // ── Stream header ──
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

    // ── Stream progress mini-bar ──
    const streamDone = stream.tasks.filter(t => t.status === 'done').length;
    const streamTotal = stream.tasks.length;
    const streamPct = streamTotal > 0 ? Math.round((streamDone / streamTotal) * 100) : 0;

    const miniBarWrap = document.createElement('div');
    miniBarWrap.style.cssText = `${UI.barWrap('4px')}; margin-bottom: 10px;`;
    const miniBarFill = document.createElement('div');
    miniBarFill.style.cssText = UI.barFill(stream.color, streamPct);
    miniBarWrap.appendChild(miniBarFill);
    col.appendChild(miniBarWrap);

    // ── Separate done vs open tasks ──
    const doneTsks = stream.tasks.filter(t => t.status === 'done');
    const openTsks = stream.tasks.filter(t => t.status !== 'done');

    // ── Open/active tasks (always shown, sorted by votes later) ──
    for (const task of openTsks) {
      const card = createTaskCard(task, stream.color, voteDisplays);
      col.appendChild(card);
    }

    // ── Completed tasks (collapsed by default) ──
    if (doneTsks.length > 0) {
      const collapseWrap = document.createElement('div');
      collapseWrap.style.cssText = 'margin-top: 8px;';

      const toggleBtn = document.createElement('button');
      toggleBtn.style.cssText = `
        background: rgba(46,204,113,0.08); border: 1px solid rgba(46,204,113,0.15);
        border-radius: ${BORDER.radius.sm}; padding: 6px 10px;
        font-size: 11px; color: #2ecc71; cursor: pointer;
        font-family: ${FONT.family}; width: 100%;
        display: flex; align-items: center; gap: 6px;
        transition: background 0.2s;
      `;
      toggleBtn.innerHTML = `<span style="font-size:10px;">&#9654;</span> ${doneTsks.length} completed`;

      const doneContainer = document.createElement('div');
      doneContainer.style.cssText = 'display: none; margin-top: 6px;';

      let expanded = false;
      toggleBtn.addEventListener('click', () => {
        expanded = !expanded;
        doneContainer.style.display = expanded ? 'block' : 'none';
        toggleBtn.innerHTML = `<span style="font-size:10px;">${expanded ? '&#9660;' : '&#9654;'}</span> ${doneTsks.length} completed`;
      });

      for (const task of doneTsks) {
        const card = document.createElement('div');
        const hasDesc = !!task.description;
        card.style.cssText = `
          background: rgba(46,204,113,0.06);
          border: 1px solid rgba(46,204,113,0.12);
          border-radius: ${BORDER.radius.sm};
          padding: 6px 8px; margin-bottom: 4px;
          font-size: 10px; line-height: 1.3;
          color: ${COLORS.textMuted}; opacity: 0.6;
          font-family: ${FONT.family};
          ${hasDesc ? 'cursor: pointer;' : ''}
          transition: opacity 0.15s;
        `;

        const titleRow = document.createElement('div');
        titleRow.style.cssText = 'display: flex; align-items: center; gap: 6px;';

        const dot = document.createElement('span');
        dot.style.cssText = `
          display: inline-block; width: 6px; height: 6px;
          border-radius: 50%; flex-shrink: 0;
          background: #2ecc71;
        `;
        titleRow.appendChild(dot);

        const textEl = document.createElement('span');
        textEl.style.cssText = 'text-decoration: line-through; flex: 1;';
        textEl.textContent = task.text;
        titleRow.appendChild(textEl);

        if (hasDesc) {
          const chevron = document.createElement('span');
          chevron.style.cssText = `
            font-size: 8px; flex-shrink: 0; color: ${COLORS.textDim};
            transition: transform 0.2s;
          `;
          chevron.textContent = '\u25B6'; // right triangle
          titleRow.appendChild(chevron);

          const descEl = document.createElement('div');
          descEl.style.cssText = `
            margin: 4px 0 0 12px; padding: 4px 6px;
            font-size: 9px; line-height: 1.4;
            color: ${COLORS.textDim}; text-decoration: none;
            border-left: 2px solid rgba(46,204,113,0.2);
            max-height: 0; overflow: hidden;
            transition: max-height 0.25s ease, padding 0.25s ease;
          `;
          descEl.textContent = task.description!;

          let descExpanded = false;
          card.addEventListener('click', (e) => {
            e.stopPropagation();
            descExpanded = !descExpanded;
            chevron.textContent = descExpanded ? '\u25BC' : '\u25B6'; // down or right
            card.style.opacity = descExpanded ? '0.85' : '0.6';
            if (descExpanded) {
              descEl.style.maxHeight = '200px';
              descEl.style.overflowY = 'auto';
              descEl.style.padding = '4px 6px';
            } else {
              descEl.style.maxHeight = '0';
              descEl.style.overflowY = 'hidden';
              descEl.style.padding = '0 6px';
            }
          });

          card.appendChild(titleRow);
          card.appendChild(descEl);
        } else {
          textEl.style.textDecoration = 'line-through';
          card.appendChild(titleRow);
        }

        doneContainer.appendChild(card);
      }

      collapseWrap.appendChild(toggleBtn);
      collapseWrap.appendChild(doneContainer);
      col.appendChild(collapseWrap);
    }

    // ── Empty state ──
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

  // ── Suggestion box (bottom bar) ──
  const suggestionBar = document.createElement('div');
  suggestionBar.style.cssText = `
    display: flex; align-items: center; gap: 12px;
    padding: 12px 28px; flex-shrink: 0;
    border-top: 1px solid rgba(255,255,255,0.08);
    background: rgba(0,0,0,0.3);
  `;

  const suggestionInput = document.createElement('input');
  suggestionInput.type = 'text';
  suggestionInput.placeholder = 'Suggest a feature...';
  suggestionInput.maxLength = 200;
  suggestionInput.style.cssText = `
    flex: 1; background: rgba(255,255,255,0.06);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: ${BORDER.radius.sm};
    padding: 8px 12px; font-size: 13px;
    color: ${COLORS.textPrimary};
    font-family: ${FONT.family};
    outline: none;
  `;

  const submitBtn = document.createElement('button');
  submitBtn.style.cssText = `
    ${UI.button('#3498db')};
    font-size: 12px; padding: 8px 20px; letter-spacing: 1px;
  `;
  submitBtn.textContent = 'SUBMIT';

  const feedbackEl = document.createElement('span');
  feedbackEl.style.cssText = `
    font-size: 12px; color: #2ecc71;
    font-family: ${FONT.family};
    opacity: 0; transition: opacity 0.3s;
  `;
  feedbackEl.textContent = 'Thanks!';

  submitBtn.addEventListener('click', async () => {
    const text = suggestionInput.value.trim();
    if (!text) return;
    submitBtn.textContent = '...';
    const ok = await submitSuggestion(text);
    submitBtn.textContent = 'SUBMIT';
    if (ok) {
      suggestionInput.value = '';
      feedbackEl.style.opacity = '1';
      setTimeout(() => { feedbackEl.style.opacity = '0'; }, 2000);
    }
  });

  // Submit on Enter
  suggestionInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitBtn.click();
  });

  suggestionBar.appendChild(suggestionInput);
  suggestionBar.appendChild(submitBtn);
  suggestionBar.appendChild(feedbackEl);
  overlay.appendChild(suggestionBar);

  // ── Keyboard close ──
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') hideDevKanban();
  };
  document.addEventListener('keydown', onKey);
  (overlay as any)._keyHandler = onKey;

  document.body.appendChild(overlay);
  _overlay = overlay;

  // ── Async: load votes from Firebase and update displays ──
  loadVotes().then(votes => {
    for (const [hash, el] of voteDisplays) {
      const count = votes[hash] ?? 0;
      if (count > 0) el.textContent = String(count);
    }
  });
}

// ── Task card builder ──

function createTaskCard(
  task: TaskItem,
  streamColor: string,
  voteDisplays: Map<string, HTMLElement>,
): HTMLElement {
  const card = document.createElement('div');
  card.style.cssText = `
    background: rgba(255,255,255,0.04);
    border: 1px solid rgba(255,255,255,0.08);
    border-radius: ${BORDER.radius.sm};
    padding: 8px 10px; margin-bottom: 6px;
    display: flex; align-items: flex-start; gap: 8px;
    font-size: 11px; line-height: 1.4;
    color: ${COLORS.textSecondary};
    font-family: ${FONT.family};
  `;

  // Status dot
  const dot = document.createElement('span');
  dot.style.cssText = `
    display: inline-block; width: 8px; height: 8px;
    border-radius: 50%; flex-shrink: 0; margin-top: 3px;
    background: ${task.status === 'active' ? streamColor : '#555'};
    ${task.status === 'active' ? `box-shadow: 0 0 4px ${streamColor}66;` : ''}
  `;
  card.appendChild(dot);

  // Task text
  const textEl = document.createElement('span');
  textEl.style.cssText = 'flex: 1;';
  textEl.textContent = task.text;
  card.appendChild(textEl);

  // Vote button + count
  const voteWrap = document.createElement('div');
  voteWrap.style.cssText = `
    display: flex; flex-direction: column; align-items: center;
    gap: 2px; flex-shrink: 0; min-width: 28px;
  `;

  const voteBtn = document.createElement('button');
  const alreadyVoted = _myVotes.has(task.hash);
  voteBtn.style.cssText = `
    background: none; border: none; cursor: ${alreadyVoted ? 'default' : 'pointer'};
    font-size: 14px; padding: 0; line-height: 1;
    opacity: ${alreadyVoted ? '1' : '0.5'};
    transition: opacity 0.2s, transform 0.15s;
    color: ${alreadyVoted ? '#FFD700' : '#888'};
  `;
  voteBtn.textContent = '\u25B2'; // ▲
  voteBtn.title = alreadyVoted ? 'Already voted' : 'Upvote this feature';

  const voteCount = document.createElement('span');
  voteCount.style.cssText = `
    font-size: 10px; color: ${COLORS.textMuted};
    font-family: ${FONT.family};
  `;
  voteCount.textContent = '';
  voteDisplays.set(task.hash, voteCount);

  if (!alreadyVoted) {
    voteBtn.addEventListener('mouseenter', () => { voteBtn.style.opacity = '1'; });
    voteBtn.addEventListener('mouseleave', () => { voteBtn.style.opacity = '0.5'; });
    voteBtn.addEventListener('click', async () => {
      voteBtn.style.transform = 'scale(1.3)';
      setTimeout(() => { voteBtn.style.transform = 'scale(1)'; }, 150);

      const count = await castVote(task.hash);
      voteCount.textContent = String(count);
      voteBtn.style.color = '#FFD700';
      voteBtn.style.opacity = '1';
      voteBtn.style.cursor = 'default';
      voteBtn.title = 'Already voted';
    });
  }

  voteWrap.appendChild(voteBtn);
  voteWrap.appendChild(voteCount);
  card.appendChild(voteWrap);

  return card;
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
