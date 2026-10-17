'use strict';

// Layout (CSS px). Ink is stored in these same units, so strokes stay put if sizes change later.
const CELL_W = 128, CELL_H = 104, SIDE_W = 148, HEAD_H = 52, HEAD_H_EDIT = 84;
const ERASE_R = 7;
const NS = 'http://www.w3.org/2000/svg';

const $ = (s) => document.querySelector(s);
const grid = $('#grid');
const uid = () => Math.random().toString(36).slice(2, 10);
const pad = (n) => String(n).padStart(2, '0');
const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const todayISO = () => isoOf(new Date());
// Whole days from one ISO date to the next (noon avoids daylight-saving off-by-ones).
const daysBetween = (a, b) => Math.round((new Date(b + 'T12:00:00') - new Date(a + 'T12:00:00')) / 864e5);
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

let state;            // { rows:[{id}], cols:[{id,date}], ink:{ key: [[x,y,x,y,...], ...] } }
let tool = 'pen';
let editMode = false;
const undoStack = [];

// ---------- storage (IndexedDB, one record) ----------
const DB_NAME = 'workout-log', STORE = 'kv';
const dbReady = new Promise((res, rej) => {
  const r = indexedDB.open(DB_NAME, 1);
  r.onupgradeneeded = () => r.result.createObjectStore(STORE);
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});
async function readState() {
  const db = await dbReady;
  return new Promise((res, rej) => {
    const q = db.transaction(STORE).objectStore(STORE).get('state');
    q.onsuccess = () => res(q.result);
    q.onerror = () => rej(q.error);
  });
}
async function writeState() {
  const db = await dbReady;
  return new Promise((res, rej) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(state, 'state');
    tx.oncomplete = res;
    tx.onerror = () => rej(tx.error);
  });
}
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 300);
}
function flush() {
  clearTimeout(saveTimer);
  saveTimer = null;
  writeState().catch((e) => alert('Could not save: ' + e.message));
}
document.addEventListener('visibilitychange', () => { if (document.hidden && saveTimer) flush(); });

function freshState() {
  return {
    v: 1,
    rows: Array.from({ length: 6 }, () => ({ id: uid() })),
    cols: [{ id: uid(), date: todayISO() }],
    ink: {},
  };
}

// ---------- undo ----------
function pushUndo(entry) {
  undoStack.push(entry);
  if (undoStack.length > 200) undoStack.shift();
  $('#undo').disabled = false;
}
function pushStructUndo() {
  pushUndo({ full: structuredClone(state) });
}
function undo() {
  const u = undoStack.pop();
  if (u) {
    if (u.full) {
      state = u.full;
      render();
    } else {
      if (u.before.length) state.ink[u.key] = u.before; else delete state.ink[u.key];
      const svg = grid.querySelector(`svg[data-key="${u.key}"]`);
      if (svg) drawAll(svg);
    }
    save();
  }
  $('#undo').disabled = !undoStack.length;
}

// ---------- ink rendering ----------
function pathD(p) {
  if (p.length < 4) return '';
  let d = `M${p[0]} ${p[1]}`;
  if (p.length === 4) return d + `L${p[2]} ${p[3]}`;
  for (let i = 2; i < p.length - 2; i += 2) {
    const mx = (p[i] + p[i + 2]) / 2, my = (p[i + 1] + p[i + 3]) / 2;
    d += `Q${p[i]} ${p[i + 1]} ${mx.toFixed(1)} ${my.toFixed(1)}`;
  }
  return d + `L${p[p.length - 2]} ${p[p.length - 1]}`;
}
function pathEl(p) {
  const el = document.createElementNS(NS, 'path');
  el.setAttribute('d', pathD(p));
  return el;
}
function drawAll(svg) {
  svg.replaceChildren(...(state.ink[svg.dataset.key] || []).map(pathEl));
}
function makeInk(key, w, h) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
  svg.classList.add('ink');
  svg.dataset.key = key;
  svg.dataset.w = w;
  drawAll(svg);
  return svg;
}

// ---------- grid ----------
function sortCols() {
  state.cols.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}
function div(cls, parent) {
  const d = document.createElement('div');
  d.className = cls;
  parent.append(d);
  return d;
}
function btn(label, cls, onClick) {
  const b = document.createElement('button');
  b.textContent = label;
  if (cls) b.className = cls;
  b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  // keep pen/mouse presses on controls from starting a stroke underneath
  b.addEventListener('pointerdown', (e) => e.stopPropagation());
  return b;
}

function render() {
  const { rows, cols } = state;
  const today = todayISO();
  const frag = document.createDocumentFragment();
  grid.style.gridTemplateColumns = `${SIDE_W}px repeat(${cols.length}, ${CELL_W}px)`;
  grid.style.gridTemplateRows = `${editMode ? HEAD_H_EDIT : HEAD_H}px repeat(${rows.length}, ${CELL_H}px) auto`;

  div('corner', frag);
  let prevYear = null;
  cols.forEach((col, ci) => {
    const h = div('head' + (col.date === today ? ' today' : ''), frag);
    h.dataset.col = col.id;
    const gap = ci > 0 ? daysBetween(cols[ci - 1].date, col.date) : null;
    if (gap !== null && !editMode) div('gap', h).textContent = gap + 'd';
    const d = new Date(col.date + 'T12:00:00');
    const yr = d.getFullYear();
    const showYear = yr !== new Date().getFullYear() && yr !== prevYear;
    prevYear = yr;
    if (editMode) {
      const inp = document.createElement('input');
      inp.type = 'date';
      inp.value = col.date;
      inp.addEventListener('pointerdown', (e) => e.stopPropagation());
      inp.addEventListener('change', () => {
        if (!inp.value) return;
        pushStructUndo();
        col.date = inp.value;
        sortCols();
        render();
        save();
      });
      h.append(inp);
      const c = div('ctl', h);
      c.append(btn('✕ Delete day', 'del', () => deleteCol(col)));
    } else {
      div('dow', h).textContent = DOW[d.getDay()];
      div('date', h).textContent = `${MON[d.getMonth()]} ${d.getDate()}` + (showYear ? ` ’${String(yr).slice(2)}` : '');
    }
  });

  rows.forEach((row, i) => {
    const s = div('side', frag);
    s.append(makeInk('r:' + row.id, SIDE_W, CELL_H));
    if (editMode) {
      const c = div('ctl', s);
      c.append(
        btn('↑', '', () => moveRow(i, -1)),
        btn('↓', '', () => moveRow(i, 1)),
        btn('✕', 'del', () => deleteRow(row)),
      );
    }
    for (const col of cols) {
      const cell = div('cell' + (col.date === today ? ' today' : ''), frag);
      cell.append(makeInk(`c:${col.id}:${row.id}`, CELL_W, CELL_H));
    }
  });

  const add = div('add-row', frag);
  add.append(btn('+ Row', '', addRow));

  grid.replaceChildren(frag);
}

function scrollToCol(id, smooth) {
  const h = grid.querySelector(`.head[data-col="${id}"]`);
  if (h) h.scrollIntoView({ inline: 'end', block: 'nearest', behavior: smooth ? 'smooth' : 'auto' });
}

function addToday() {
  const t = todayISO();
  let col = state.cols.find((c) => c.date === t);
  if (!col) {
    pushStructUndo();
    col = { id: uid(), date: t };
    state.cols.push(col);
    sortCols();
    render();
    save();
  }
  scrollToCol(col.id, true);
}
function addRow() {
  pushStructUndo();
  state.rows.push({ id: uid() });
  render();
  save();
  grid.scrollTo({ top: grid.scrollHeight, behavior: 'smooth' });
}
function moveRow(i, dir) {
  const j = i + dir;
  if (j < 0 || j >= state.rows.length) return;
  pushStructUndo();
  [state.rows[i], state.rows[j]] = [state.rows[j], state.rows[i]];
  render();
  save();
}
function deleteRow(row) {
  if (!confirm('Delete this row and everything written in it? (Undo can bring it back.)')) return;
  pushStructUndo();
  state.rows = state.rows.filter((r) => r !== row);
  for (const k of Object.keys(state.ink)) {
    if (k === 'r:' + row.id || k.endsWith(':' + row.id)) delete state.ink[k];
  }
  render();
  save();
}
function deleteCol(col) {
  if (!confirm('Delete this day and everything written in it? (Undo can bring it back.)')) return;
  pushStructUndo();
  state.cols = state.cols.filter((c) => c !== col);
  for (const k of Object.keys(state.ink)) if (k.startsWith(`c:${col.id}:`)) delete state.ink[k];
  render();
  save();
}

// ---------- pencil input ----------
// Pencil (and mouse) draws; fingers scroll. iOS Safari reports Pencil touches as touchType "stylus":
// cancelling just those keeps the grid from scrolling under the pen while fingers still pan freely.
function hasStylus(e) {
  for (const t of e.touches) if (t.touchType === 'stylus') return true;
  return false;
}
grid.addEventListener('touchstart', (e) => { if (hasStylus(e)) e.preventDefault(); }, { passive: false });
grid.addEventListener('touchmove', (e) => { if (hasStylus(e)) e.preventDefault(); }, { passive: false });

// Two-finger tap toggles pen/eraser (web pages can't see the Pencil's own double-tap).
let twoTap = null;
grid.addEventListener('touchstart', (e) => {
  if (hasStylus(e)) return;
  if (e.touches.length === 2) {
    twoTap = { t: Date.now(), pts: [...e.touches].map((t) => [t.identifier, t.clientX, t.clientY]) };
  } else if (e.touches.length > 2) {
    twoTap = null;
  }
}, { passive: true });
grid.addEventListener('touchmove', (e) => {
  if (!twoTap) return;
  for (const t of e.touches) {
    const p = twoTap.pts.find((q) => q[0] === t.identifier);
    if (p && Math.hypot(t.clientX - p[1], t.clientY - p[2]) > 12) { twoTap = null; return; }
  }
}, { passive: true });
grid.addEventListener('touchend', (e) => {
  if (!twoTap || e.touches.length) return;
  if (Date.now() - twoTap.t < 350) setTool(tool === 'pen' ? 'eraser' : 'pen');
  twoTap = null;
});
grid.addEventListener('touchcancel', () => { twoTap = null; });

let active = null;

function localPoint(e) {
  const { r, sx } = active;
  return [Math.round((e.clientX - r.left) * sx * 10) / 10, Math.round((e.clientY - r.top) * sx * 10) / 10];
}
function segDist2(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len = dx * dx + dy * dy;
  let t = len ? ((px - ax) * dx + (py - ay) * dy) / len : 0;
  t = Math.max(0, Math.min(1, t));
  const x = ax + t * dx - px, y = ay + t * dy - py;
  return x * x + y * y;
}
function eraseAt(x, y) {
  const strokes = state.ink[active.key];
  if (!strokes) return;
  const r2 = ERASE_R * ERASE_R;
  const keep = strokes.filter((p) => {
    for (let i = 0; i < p.length - 2; i += 2) {
      if (segDist2(x, y, p[i], p[i + 1], p[i + 2], p[i + 3]) <= r2) return false;
    }
    return true;
  });
  if (keep.length !== strokes.length) {
    active.changed = true;
    if (keep.length) state.ink[active.key] = keep; else delete state.ink[active.key];
    drawAll(active.svg);
  }
}
function addPoints(e) {
  const evs = e.getCoalescedEvents ? e.getCoalescedEvents() : [];
  for (const ev of evs.length ? evs : [e]) {
    const [x, y] = localPoint(ev);
    if (tool === 'pen') {
      const p = active.pts;
      const n = p.length;
      if (n && Math.abs(p[n - 2] - x) < 0.3 && Math.abs(p[n - 1] - y) < 0.3) continue;
      p.push(x, y);
    } else {
      eraseAt(x, y);
    }
  }
  if (tool === 'pen') active.path.setAttribute('d', pathD(active.pts.length === 2 ? [...active.pts, ...active.pts] : active.pts));
}

grid.addEventListener('pointerdown', (e) => {
  if (e.pointerType === 'touch' || e.button > 0 || active) return;
  const svg = e.target.closest && e.target.closest('svg.ink');
  if (!svg) return;
  e.preventDefault();
  try { svg.setPointerCapture(e.pointerId); } catch (_) {}
  const r = svg.getBoundingClientRect();
  const key = svg.dataset.key;
  active = { svg, key, r, sx: +svg.dataset.w / r.width, id: e.pointerId, before: (state.ink[key] || []).slice() };
  if (tool === 'pen') {
    active.pts = [];
    active.path = pathEl([]);
    svg.append(active.path);
  }
  addPoints(e);
});
grid.addEventListener('pointermove', (e) => {
  if (!active || e.pointerId !== active.id) return;
  e.preventDefault();
  addPoints(e);
});
function endStroke(e) {
  if (!active || e.pointerId !== active.id) return;
  const a = active;
  active = null;
  if (tool === 'pen') {
    const p = a.pts;
    if (p.length >= 2) {
      if (p.length === 2) p.push(p[0] + 0.1, p[1]); // a dot
      (state.ink[a.key] ||= []).push(p);
      a.path.setAttribute('d', pathD(p));
      pushUndo({ key: a.key, before: a.before });
      save();
    } else {
      a.path.remove();
    }
  } else if (a.changed) {
    pushUndo({ key: a.key, before: a.before });
    save();
  }
}
grid.addEventListener('pointerup', endStroke);
grid.addEventListener('pointercancel', endStroke);

// ---------- toolbar ----------
function setTool(t) {
  tool = t;
  $('#pen').classList.toggle('on', t === 'pen');
  $('#eraser').classList.toggle('on', t === 'eraser');
  document.body.classList.toggle('erasing', t === 'eraser');
}
$('#pen').addEventListener('click', () => setTool('pen'));
$('#eraser').addEventListener('click', () => setTool('eraser'));
$('#undo').addEventListener('click', undo);
$('#today').addEventListener('click', addToday);
$('#edit').addEventListener('click', () => {
  editMode = !editMode;
  $('#edit').classList.toggle('on', editMode);
  $('#edit').textContent = editMode ? 'Done' : 'Edit';
  const x = grid.scrollLeft, y = grid.scrollTop;
  render();
  grid.scrollLeft = x;
  grid.scrollTop = y;
});

const pop = $('#menu-pop');
$('#menu').addEventListener('click', (e) => { e.stopPropagation(); pop.hidden = !pop.hidden; });
document.addEventListener('click', () => { pop.hidden = true; });

async function shareFile(blob, name) {
  const file = new File([blob], name, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); return; }
    catch (err) { if (err.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

function exportBackup() {
  flush();
  shareFile(new Blob([JSON.stringify(state)], { type: 'application/json' }), `workout-log-${todayISO()}.json`);
}
$('#export').addEventListener('click', exportBackup);

// The whole log as one PNG, always in the light "paper" colours.
// iOS Safari caps a canvas at ~16.7M pixels, so the scale drops for very long logs.
function renderImage() {
  const { rows, cols } = state;
  const W = SIDE_W + cols.length * CELL_W, H = HEAD_H + rows.length * CELL_H;
  const scale = Math.min(2, Math.sqrt(16e6 / (W * H)), 16000 / W, 16000 / H);
  const cv = document.createElement('canvas');
  cv.width = Math.floor(W * scale);
  cv.height = Math.floor(H * scale);
  const g = cv.getContext('2d');
  g.scale(scale, scale);
  g.fillStyle = '#fbf9f3'; g.fillRect(0, 0, W, H);
  g.fillStyle = '#f3efe4'; g.fillRect(0, 0, SIDE_W, H);
  g.fillStyle = '#efebe0'; g.fillRect(0, 0, W, HEAD_H);

  g.fillStyle = '#ddd7c8';
  cols.forEach((_, i) => g.fillRect(SIDE_W + (i + 1) * CELL_W - 1, 0, 1, H));
  rows.forEach((_, i) => g.fillRect(0, HEAD_H + (i + 1) * CELL_H - 1, W, 1));
  g.fillStyle = '#bdb5a1';
  g.fillRect(SIDE_W - 2, 0, 2, H);
  g.fillRect(0, HEAD_H - 1, W, 1);

  g.textAlign = 'center';
  let prevYear = null;
  cols.forEach((col, i) => {
    const d = new Date(col.date + 'T12:00:00');
    const x = SIDE_W + i * CELL_W + CELL_W / 2;
    const yr = d.getFullYear();
    g.fillStyle = '#857d6a';
    g.font = '12px -apple-system, system-ui, sans-serif';
    g.fillText(DOW[d.getDay()].toUpperCase() + (yr !== prevYear ? ` ${yr}` : ''), x, 22);
    prevYear = yr;
    g.fillStyle = '#1c2230';
    g.font = '600 15px -apple-system, system-ui, sans-serif';
    g.fillText(`${MON[d.getMonth()]} ${d.getDate()}`, x, 41);
  });
  // day gaps on the column borders
  g.font = '600 11px -apple-system, system-ui, sans-serif';
  g.textBaseline = 'middle';
  cols.forEach((col, i) => {
    if (!i) return;
    const label = daysBetween(cols[i - 1].date, col.date) + 'd';
    const x = SIDE_W + i * CELL_W, w = g.measureText(label).width + 12, y = HEAD_H / 2;
    g.fillStyle = '#efebe0';
    g.strokeStyle = '#bdb5a1';
    g.lineWidth = 1;
    g.beginPath();
    g.roundRect(x - w / 2, y - 9, w, 18, 9);
    g.fill();
    g.stroke();
    g.fillStyle = '#857d6a';
    g.fillText(label, x, y + 0.5);
  });
  g.textBaseline = 'alphabetic';

  g.strokeStyle = '#1c2230';
  g.lineWidth = 2.2;
  g.lineCap = g.lineJoin = 'round';
  const ink = (key, x, y) => {
    const strokes = state.ink[key];
    if (!strokes) return;
    g.save();
    g.beginPath();
    g.rect(x, y, key.startsWith('r:') ? SIDE_W - 2 : CELL_W - 1, CELL_H - 1);
    g.clip();
    g.translate(x, y);
    for (const p of strokes) g.stroke(new Path2D(pathD(p)));
    g.restore();
  };
  rows.forEach((row, r) => {
    const y = HEAD_H + r * CELL_H;
    ink('r:' + row.id, 0, y);
    cols.forEach((col, c) => ink(`c:${col.id}:${row.id}`, SIDE_W + c * CELL_W, y));
  });
  return cv;
}

function exportImage() {
  renderImage().toBlob((blob) => {
    if (blob) shareFile(blob, `workout-log-${todayISO()}.png`);
    else alert('Could not create the image.');
  }, 'image/png');
}
$('#export-img').addEventListener('click', exportImage);

const clearDlg = $('#clear-dlg');
$('#clear').addEventListener('click', () => clearDlg.showModal());
$('#clear-backup').addEventListener('click', exportBackup);
$('#clear-image').addEventListener('click', exportImage);
$('#clear-cancel').addEventListener('click', () => clearDlg.close());
$('#clear-go').addEventListener('click', () => {
  clearDlg.close();
  pushStructUndo(); // Undo can still bring it back until the app is closed
  state = freshState();
  render();
  flush();
});
$('#import').addEventListener('click', () => $('#file').click());
$('#file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const data = JSON.parse(await f.text());
    if (!Array.isArray(data.rows) || !Array.isArray(data.cols) || typeof data.ink !== 'object') throw new Error('Not a workout log backup');
    if (!confirm(`Replace everything with this backup (${data.cols.length} days, ${data.rows.length} rows)? Undo can bring the current log back.`)) return;
    pushStructUndo();
    state = data;
    sortCols();
    render();
    flush();
    const last = state.cols[state.cols.length - 1];
    if (last) scrollToCol(last.id);
  } catch (err) {
    alert('Could not import: ' + err.message);
  }
});

// ---------- start ----------
(async function init() {
  $('#undo').disabled = true;
  try {
    state = (await readState()) || freshState();
  } catch (e) {
    alert('Storage unavailable — changes will not be saved. ' + e.message);
    state = freshState();
  }
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  sortCols();
  render();
  const last = state.cols[state.cols.length - 1];
  if (last) scrollToCol(last.id);
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
