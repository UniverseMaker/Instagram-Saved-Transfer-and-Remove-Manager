const $ = (s) => document.querySelector(s);
const $$ = (s) => [...document.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let active = 'a';
let running = false;
let csvLoaded = false;
const accounts = { a: {}, b: {} };

// 목록 관리 상태
let list = null;        // { source: 'account'|'csv', key, username, rows, path }
let visible = [];       // 필터/정렬 적용된 rows
const selected = new Set();
let lastClicked = null;

// ---------- 공통 ----------
function addLog({ at, msg }) {
  const el = document.createElement('div');
  if (/⚠|실패|오류/.test(msg)) el.className = 'warn';
  el.innerHTML = `<span class="t">${esc(at)}</span>`;
  el.appendChild(document.createTextNode(msg));
  const box = $('#log');
  box.appendChild(el);
  box.scrollTop = box.scrollHeight;
}
const now = () => new Date().toLocaleTimeString();
const errLog = (e) => addLog({ at: now(), msg: '⚠ ' + String(e.message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '') });
const call = (channel, arg) => api.invoke(channel, arg).catch((e) => { errLog(e); return null; });

const acctName = (key) => {
  const a = accounts[key];
  return a.loggedIn ? `@${a.username || a.uid}` : `${key === 'a' ? '계정 A' : '계정 B'}(로그인 필요)`;
};

function opts() {
  const n = (id) => Number($(id).value);
  return {
    delayMin: Math.min(n('#delayMin'), n('#delayMax')),
    delayMax: Math.max(n('#delayMin'), n('#delayMax')),
    batchSize: Math.max(1, n('#batchSize')),
    breakMin: Math.max(0, n('#breakMin')),
    maxPerRun: Math.max(1, n('#maxPerRun')),
    oldestFirst: $('#oldestFirst').checked,
    mode: $('#mode').value,
  };
}

function setActive(key) {
  active = key;
  $$('.tab').forEach((t) => t.classList.toggle('active', t.dataset.key === key));
  $('#who').textContent = accounts[key].loggedIn ? acctName(key) : '';
}

function refreshButtons() {
  $$('.lockable').forEach((b) => { b.disabled = running; });
  $$('.needs-csv').forEach((b) => { b.disabled = running || !csvLoaded; });
  $$('.tab').forEach((t) => { t.disabled = running; });
  $$('.stop').forEach((b) => { b.disabled = !running; });
  $('.m-jobline').hidden = !running;
}

function updateAccountLabels() {
  for (const key of ['a', 'b']) {
    const el = $(`#st-${key}`);
    el.textContent = accounts[key].loggedIn ? acctName(key) : '로그인 필요';
    el.classList.toggle('ok', !!accounts[key].loggedIn);
    $(`[data-fetch="${key}"]`).textContent = `${acctName(key)} 목록 불러오기`;
    $(`#run-key option[value="${key}"]`).textContent = `${key === 'a' ? '계정 A' : '계정 B'} · ${acctName(key)}`;
  }
  $('#who').textContent = accounts[active].loggedIn ? acctName(active) : '';
  updateActionLabels();
}

function setJobText(text) { $$('.job-stat').forEach((e) => { e.textContent = text; }); }

// ---------- 메인 프로세스 이벤트 ----------
api.on('log', addLog);
api.on('active', setActive);
api.on('url', ({ key, url }) => { if (key === active && document.activeElement !== $('#url')) $('#url').value = url; });
api.on('status', (st) => { accounts[st.key] = st; updateAccountLabels(); });
api.on('manager', (open) => {
  document.body.classList.toggle('manager-open', open);
  $('#manager').hidden = !open;
});
api.on('job', ({ running: r, title }) => {
  running = r;
  if (r) {
    $('#job-title').textContent = title;
    $('.job-title-mirror').textContent = title;
    $('.bar-fill').style.width = '0';
    setJobText('시작 중…');
  } else {
    $('#job-title').textContent = '대기 중';
  }
  refreshButtons();
});
api.on('job-progress', (p) => {
  if (p.type === 'fetch') {
    setJobText(`${p.count}개 수집 (페이지 ${p.page})`);
    return;
  }
  const done = p.total - p.remaining;
  $('.bar-fill').style.width = p.total ? `${(done / p.total) * 100}%` : '0';
  const doneWord = p.action === 'save' ? '저장' : '해제';
  const skipWord = p.action === 'save' ? '이미 저장' : '저장 안 됨';
  setJobText(`${done}/${p.total} · ${doneWord} ${p.done} · ${skipWord} ${p.skipped} · 삭제된 글 ${p.not_found}` +
    (p.failed ? ` · 실패 ${p.failed}` : '') + (p.current ? `  ▶ ${p.current}` : ''));
});
api.on('countdown', ({ sec, label }) => { $$('.countdown').forEach((e) => { e.textContent = sec > 0 ? `${label} ${sec}초` : ''; }); });
api.on('csv-file', showCsvFile);

function showCsvFile({ path, summary }) {
  csvLoaded = true;
  $('#csv-name').textContent = path.split(/[\\/]/).pop();
  $('#csv-name').title = path;
  const s = summary.save, u = summary.unsave;
  $('#csv-stat').textContent = `${summary.total}개 · 저장 완료 ${s.total - s.remaining} · 해제 완료 ${u.total - u.remaining}`;
  refreshButtons();
}

// ---------- 패널 동작 ----------
$$('.tab').forEach((t) => t.addEventListener('click', () => {
  setActive(t.dataset.key);
  call('switch', t.dataset.key);
}));
$$('[data-nav]').forEach((b) => b.addEventListener('click', () => call('nav', { key: active, action: b.dataset.nav })));
$('#url').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') call('nav', { key: active, action: 'go', url: e.target.value.trim() });
});
$('#logout').addEventListener('click', () => {
  if (confirm(`${acctName(active)} 세션을 삭제(로그아웃)할까요?`)) call('logout', active);
});
$$('.stop').forEach((b) => b.addEventListener('click', () => call('stop')));
$('#clear-log').addEventListener('click', () => { $('#log').innerHTML = ''; });

$('#btn-export').addEventListener('click', () => call('export', active));
$('#btn-unsave-all').addEventListener('click', async () => {
  const res = await call('unsave-all', { key: active, opts: opts() });
  if (res) applyBatchResult(active, 'unsave', res);
});
$('#btn-load').addEventListener('click', async () => {
  const res = await call('load-csv');
  if (res) showCsvFile(res);
});
$('#btn-run-save').addEventListener('click', () => call('run-csv', { key: active, action: 'save', opts: opts() }));
$('#btn-run-unsave').addEventListener('click', async () => {
  const res = await call('run-csv', { key: active, action: 'unsave', opts: opts() });
  if (res) applyBatchResult(active, 'unsave', res);
});

$('#btn-manager').addEventListener('click', async () => {
  await call('manager', true);
  if (!list && !running) fetchList(active);
});

// ---------- 목록 관리 ----------
$('#m-close').addEventListener('click', () => call('manager', false));
$$('[data-fetch]').forEach((b) => b.addEventListener('click', () => fetchList(b.dataset.fetch)));
$('#m-open-csv').addEventListener('click', async () => {
  const res = await call('list-open-csv');
  if (res) setList({ source: 'csv', key: null, rows: res.rows, path: res.path });
});

async function fetchList(key) {
  const res = await call('list-fetch', key);
  if (res) setList({ source: 'account', key, username: res.username || res.uid, rows: res.rows, path: res.backupPath, complete: res.complete });
}

function setList(l) {
  list = l;
  list.rows.forEach((r, i) => {
    r.saved_index = r.saved_index === undefined || r.saved_index === '' ? i : Number(r.saved_index);
    if (!r.shortcode) r.shortcode = (String(r.url || '').match(/\/(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/) || [])[1] || '';
  });
  list.rows = list.rows.filter((r) => r.shortcode);
  selected.clear();
  lastClicked = null;
  if (l.key) $('#run-key').value = l.key;

  $('#m-title').textContent = l.source === 'account' ? `@${l.username} 저장됨` : 'CSV 목록';
  $('#m-source').textContent = l.path ? (l.source === 'account' ? `백업: ${l.path}` : l.path) : '';
  $('#m-source').title = l.path || '';

  const cols = new Set();
  list.rows.forEach((r) => String(r.collection_names || '').split('|').filter(Boolean).forEach((c) => cols.add(c)));
  $('#f-col').innerHTML = `<option value="">모든 컬렉션</option><option value="__none">(컬렉션 없음)</option>` +
    [...cols].sort().map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('');
  applyFilters();
}

function typeOf(r) {
  if (r.product_type === 'clips') return 'reel';
  return r.media_type || '';
}
const TYPE_LABEL = { reel: '릴스', video: '동영상', carousel: '여러 장' };

function applyFilters() {
  if (!list) return;
  const q = $('#f-q').value.trim().toLowerCase();
  const col = $('#f-col').value;
  const type = $('#f-type').value;
  const sort = $('#f-sort').value;
  visible = list.rows.filter((r) => {
    if (type && typeOf(r) !== type) return false;
    const names = String(r.collection_names || '').split('|').filter(Boolean);
    if (col === '__none' && names.length) return false;
    if (col && col !== '__none' && !names.includes(col)) return false;
    if (q) {
      const hay = `${r.caption} @${r.username} ${r.full_name} ${r.shortcode}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    return true;
  });
  const by = {
    saved_new: (a, b) => a.saved_index - b.saved_index,
    saved_old: (a, b) => b.saved_index - a.saved_index,
    taken_new: (a, b) => String(b.taken_at).localeCompare(String(a.taken_at)),
    taken_old: (a, b) => String(a.taken_at).localeCompare(String(b.taken_at)),
    user: (a, b) => String(a.username).localeCompare(String(b.username)),
  }[sort];
  visible.sort(by);
  renderGrid();
}

// 한 줄에 들어가는 카드 수 (창 너비에 따라 달라짐) — 맨 왼쪽 줄 선택 칸 포함해 계산
const CARD_MIN = 170, GRID_GAP = 10, ROW_GUTTER = 30;
let gridCols = 0;
let lastRow = null;

function calcCols() {
  const grid = $('#grid');
  const cs = getComputedStyle(grid);
  const inner = grid.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight) - ROW_GUTTER - GRID_GAP;
  return Math.max(1, Math.floor((inner + GRID_GAP) / (CARD_MIN + GRID_GAP)));
}

const rowCodes = (r) => visible.slice(r * gridCols, (r + 1) * gridCols).map((x) => x.shortcode);

function updateRowChecks() {
  $$('#grid .rowck').forEach((el) => {
    const codes = rowCodes(Number(el.dataset.row));
    const n = codes.filter((c) => selected.has(c)).length;
    el.classList.toggle('all', n > 0 && n === codes.length);
    el.classList.toggle('some', n > 0 && n < codes.length);
  });
}

function renderGrid() {
  const grid = $('#grid');
  gridCols = calcCols();
  grid.style.gridTemplateColumns = `${ROW_GUTTER}px repeat(${gridCols}, minmax(0, 1fr))`;
  if (!visible.length) {
    grid.innerHTML = `<div class="empty">${list && list.rows.length ? '조건에 맞는 항목이 없습니다.' : '저장된 게시물이 없습니다.'}</div>`;
    updateCount();
    return;
  }
  grid.innerHTML = visible.map((r, i) => {
    const rowHead = i % gridCols === 0
      ? `<div class="rowck" data-row="${i / gridCols}" title="이 줄 전체 선택/해제 (Shift+클릭: 여러 줄)"><span class="rck"></span></div>`
      : '';
    const t = typeOf(r);
    const cols = String(r.collection_names || '').split('|').filter(Boolean);
    return `${rowHead}<div class="item${selected.has(r.shortcode) ? ' sel' : ''}" data-code="${esc(r.shortcode)}">
      <div class="thumb">
        ${r.thumbnail_url ? `<img loading="lazy" referrerpolicy="no-referrer" src="${esc(r.thumbnail_url)}" alt="">` : ''}
        <div class="ph"${r.thumbnail_url ? ' hidden' : ''}>${esc(r.shortcode)}</div>
        <span class="ck"></span>
        ${TYPE_LABEL[t] ? `<span class="badge">${TYPE_LABEL[t]}</span>` : ''}
        <button class="open" data-open="${esc(r.url || `https://www.instagram.com/p/${r.shortcode}/`)}">열기 ↗</button>
      </div>
      <div class="meta">
        <span class="u">${r.username ? '@' + esc(r.username) : esc(r.shortcode)}</span>
        ${r.taken_at ? `<span class="d">${esc(String(r.taken_at).slice(0, 10))}</span>` : ''}
        ${r.caption ? `<span class="c">${esc(r.caption)}</span>` : ''}
        ${cols.length ? `<span class="cols">${cols.map((c) => `<span>${esc(c)}</span>`).join('')}</span>` : ''}
      </div>
    </div>`;
  }).join('');
  updateCount();
}

// 만료된 썸네일 URL(오래된 CSV) → shortcode 표시
$('#grid').addEventListener('error', (e) => {
  if (e.target.tagName !== 'IMG') return;
  e.target.hidden = true;
  const ph = e.target.parentElement.querySelector('.ph');
  if (ph) ph.hidden = false;
}, true);

// 창 크기가 바뀌어 한 줄 개수가 달라지면 다시 그림
new ResizeObserver(() => {
  if (list && visible.length && calcCols() !== gridCols) renderGrid();
}).observe($('#grid'));

$('#grid').addEventListener('click', (e) => {
  const rowEl = e.target.closest('.rowck');
  if (rowEl) {
    const row = Number(rowEl.dataset.row);
    const codes = rowCodes(row);
    const on = !codes.every((c) => selected.has(c));
    const [a, b] = e.shiftKey && lastRow !== null ? [Math.min(lastRow, row), Math.max(lastRow, row)] : [row, row];
    for (let r = a; r <= b; r++) rowCodes(r).forEach((c) => (on ? selected.add(c) : selected.delete(c)));
    lastRow = row;
    syncSelection();
    return;
  }
  const open = e.target.closest('[data-open]');
  if (open) { call('open-post', { key: $('#run-key').value, url: open.dataset.open }); return; }
  const item = e.target.closest('.item');
  if (!item) return;
  const code = item.dataset.code;
  if (e.shiftKey && lastClicked) {
    const codes = visible.map((r) => r.shortcode);
    const [i, j] = [codes.indexOf(lastClicked), codes.indexOf(code)].sort((x, y) => x - y);
    if (i >= 0) {
      const on = !selected.has(code);
      codes.slice(i, j + 1).forEach((c) => (on ? selected.add(c) : selected.delete(c)));
      syncSelection();
      lastClicked = code;
      return;
    }
  }
  selected.has(code) ? selected.delete(code) : selected.add(code);
  item.classList.toggle('sel', selected.has(code));
  lastClicked = code;
  updateCount();
});

function syncSelection() {
  $$('#grid .item').forEach((el) => el.classList.toggle('sel', selected.has(el.dataset.code)));
  updateCount();
}

function selectedRows() {
  return list ? list.rows.filter((r) => selected.has(r.shortcode)) : [];
}

function updateCount() {
  const total = list ? list.rows.length : 0;
  $('#m-count').textContent = list ? `선택 ${selected.size}개 · 표시 ${visible.length}개 · 전체 ${total}개` : '—';
  updateRowChecks();
  updateActionLabels();
}

function updateActionLabels() {
  const key = $('#run-key').value;
  const n = selected.size;
  $('#act-unsave').textContent = `${acctName(key)}에서 선택 ${n}개 저장 해제`;
  $('#act-save').textContent = `${acctName(key)}에 선택 ${n}개 저장`;
  $('#act-csv').textContent = `선택 ${n}개 CSV 저장`;
}

$('#sel-visible').addEventListener('click', () => { visible.forEach((r) => selected.add(r.shortcode)); syncSelection(); });
$('#sel-none').addEventListener('click', () => { selected.clear(); syncSelection(); });
$('#sel-invert').addEventListener('click', () => {
  visible.forEach((r) => (selected.has(r.shortcode) ? selected.delete(r.shortcode) : selected.add(r.shortcode)));
  syncSelection();
});
['#f-q', '#f-col', '#f-type', '#f-sort'].forEach((id) => $(id).addEventListener('input', applyFilters));
$('#run-key').addEventListener('change', updateActionLabels);

document.addEventListener('keydown', (e) => {
  if ($('#manager').hidden) return;
  const typing = ['INPUT', 'SELECT', 'TEXTAREA'].includes(document.activeElement.tagName);
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a' && !typing) {
    e.preventDefault();
    visible.forEach((r) => selected.add(r.shortcode));
    syncSelection();
  }
  if (e.key === 'Escape' && !typing) call('manager', false);
});

$('#act-csv').addEventListener('click', () => {
  const rows = selectedRows();
  if (!rows.length) return errLog('선택된 항목이 없습니다.');
  call('save-csv', { rows });
});

$('#act-save').addEventListener('click', async () => {
  const rows = selectedRows();
  if (!rows.length) return errLog('선택된 항목이 없습니다.');
  const key = $('#run-key').value;
  if (list.source === 'account' && list.key === key && !confirm('목록을 불러온 계정과 같은 계정입니다. 이미 저장된 상태라 대부분 건너뜁니다. 계속할까요?')) return;
  call('run-selection', { key, action: 'save', rows, opts: opts() });
});

$('#act-unsave').addEventListener('click', async () => {
  const rows = selectedRows();
  if (!rows.length) return errLog('선택된 항목이 없습니다.');
  const key = $('#run-key').value;
  const res = await call('run-selection', { key, action: 'unsave', rows, opts: opts() });
  if (res) applyBatchResult(key, 'unsave', res);
});

// 저장 해제 결과를 현재 목록에 반영 (같은 계정 목록일 때 해제된 항목 제거)
function applyBatchResult(key, action, res) {
  if (!list || action !== 'unsave' || list.source !== 'account' || list.key !== key || !res.statuses) return;
  const gone = new Set(Object.entries(res.statuses).filter(([, s]) => s === 'removed' || s === 'not_saved' || s === 'not_found').map(([c]) => c));
  if (!gone.size) return;
  list.rows = list.rows.filter((r) => !gone.has(r.shortcode));
  gone.forEach((c) => selected.delete(c));
  applyFilters();
}

setActive('a');
refreshButtons();
updateActionLabels();
