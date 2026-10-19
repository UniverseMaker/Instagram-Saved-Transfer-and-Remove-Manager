const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, WebContentsView, session, ipcMain, dialog, shell } = require('electron');
const { HOME, isInstagramUrl, igApi } = require('./ig');
const { readCsvObjects } = require('./csv');
const { fetchSaved, writeSavedCsv } = require('./saved');
const { runBatch, previewCsv, ACTIONS, initApiStore } = require('./runner');

// 개발 실행(npm start)과 빌드된 exe가 같은 로그인 세션을 쓰도록 데이터 경로 고정
app.setPath('userData', path.join(app.getPath('appData'), 'insta-saved-migrator'));

// Instagram이 "Electron" UA를 다르게 취급하지 않도록 일반 Chrome UA로 보이게 함
const appToken = app.getName().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
app.userAgentFallback = app.userAgentFallback
  .replace(/\sElectron\/\S+/g, '')
  .replace(new RegExp(`\\s${appToken}\\/\\S+`, 'g'), '')
  .replace(/\sinsta-saved-migrator\/\S+/g, '');

const PANEL_WIDTH = 400;
// 파티션 이름은 이전 버전과 동일하게 유지 (기존 로그인 세션 보존)
const ACCOUNTS = {
  a: { partition: 'persist:ig-source', label: '계정 A' },
  b: { partition: 'persist:ig-target', label: '계정 B' },
};

let win;
const views = {};
const netLogs = {}; // key → (since) => 최근 POST 요청 목록
let active = 'a';
let managerOpen = false;
let job = null;
const userCache = {};
let csvFile = null; // "CSV로 실행" 대상 { path, rows }

function send(channel, payload) {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
}
const log = (msg) => send('log', { at: new Date().toLocaleTimeString(), msg });

function layout() {
  if (!win) return;
  const { width, height } = win.getContentBounds();
  for (const [key, v] of Object.entries(views)) {
    const show = key === active && !managerOpen;
    v.setBounds(show ? { x: PANEL_WIDTH, y: 0, width: Math.max(0, width - PANEL_WIDTH), height } : { x: 0, y: 0, width: 0, height: 0 });
  }
}

function createView(key) {
  const view = new WebContentsView({
    webPreferences: { partition: ACCOUNTS[key].partition, backgroundThrottling: false },
  });
  const wc = view.webContents;
  // 클릭 시 Instagram이 실제로 보내는 요청을 관찰해 API 주소를 학습하기 위한 기록
  // GraphQL 요청은 본문과 x-* 헤더까지 기록해 API 모드에서 같은 형식으로 재현한다 (쿠키는 기록하지 않음)
  const reqLog = [];
  const byId = new Map();
  const filter = { urls: ['https://www.instagram.com/*', 'https://i.instagram.com/*'] };
  wc.session.webRequest.onBeforeRequest(filter, (d, cb) => {
    if (d.method === 'POST') {
      let body = '';
      let friendly = '';
      try {
        body = (d.uploadData || []).map((u) => (u.bytes ? u.bytes.toString('utf8') : '')).join('');
        friendly = decodeURIComponent((body.match(/fb_api_req_friendly_name=([^&]+)/) || [])[1] || '');
      } catch {}
      const entry = { id: d.id, t: Date.now(), url: d.url, friendly, body: /graphql/.test(d.url) ? body : '', headers: {} };
      reqLog.push(entry);
      byId.set(d.id, entry);
      if (reqLog.length > 60) byId.delete(reqLog.shift().id);
    }
    cb({});
  });
  wc.session.webRequest.onBeforeSendHeaders(filter, (d, cb) => {
    const e = byId.get(d.id);
    if (e) {
      for (const [k, v] of Object.entries(d.requestHeaders || {})) {
        if (/^x-/i.test(k)) e.headers[k.toLowerCase()] = v;
      }
    }
    cb({ requestHeaders: d.requestHeaders });
  });
  netLogs[key] = (since) => reqLog.filter((r) => r.t >= since);
  wc.setWindowOpenHandler(({ url }) => {
    // 페이스북 로그인 등 팝업은 같은 세션의 창으로 허용, 그 외 링크는 기본 브라우저로
    if (/^https:\/\/([a-z0-9-]+\.)*(instagram|facebook)\.com\//.test(url)) return { action: 'allow' };
    shell.openExternal(url);
    return { action: 'deny' };
  });
  let t;
  const onNav = () => { clearTimeout(t); t = setTimeout(() => refreshStatus(key), 800); send('url', { key, url: wc.getURL() }); };
  wc.on('did-navigate', onNav);
  wc.on('did-navigate-in-page', onNav);
  wc.on('did-finish-load', onNav);
  win.contentView.addChildView(view);
  wc.loadURL(HOME);
  views[key] = view;
}

async function refreshStatus(key) {
  const ses = session.fromPartition(ACCOUNTS[key].partition);
  const cookies = await ses.cookies.get({ url: 'https://www.instagram.com' });
  const uid = cookies.find((c) => c.name === 'ds_user_id')?.value;
  const loggedIn = !!uid && cookies.some((c) => c.name === 'sessionid');
  let username = null;
  if (loggedIn) {
    username = userCache[uid] || null;
    const wc = views[key].webContents;
    if (!username && isInstagramUrl(wc.getURL()) && !(job && job.key === key)) {
      try {
        const r = await igApi(wc, `/api/v1/users/${uid}/info/`);
        username = r.json?.user?.username || null;
        if (!username) {
          const r2 = await igApi(wc, '/api/v1/accounts/edit/web_form_data/');
          username = r2.json?.form_data?.username || null;
        }
        if (username) userCache[uid] = username;
      } catch {}
    }
  }
  const status = { key, loggedIn, uid: loggedIn ? uid : null, username };
  send('status', status);
  return status;
}

function switchTo(key) {
  active = key;
  layout();
  send('active', key);
}

function setManager(open) {
  managerOpen = open;
  layout();
  send('manager', open);
}

function requireIdle() {
  if (job) throw new Error('이미 작업이 실행 중입니다.');
}

async function requireLogin(key) {
  const st = await refreshStatus(key);
  if (!st.loggedIn) throw new Error(`${ACCOUNTS[key].label}이(가) 로그인되어 있지 않습니다. 오른쪽 화면에서 먼저 로그인하세요.`);
  return st;
}

const who = (st) => '@' + (st.username || st.uid);

function stamp(withTime = true) {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  const day = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}`;
  return withTime ? `${day}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}` : day;
}

function workDir(sub) {
  const dir = path.join(app.getPath('documents'), 'InstaSavedMigrator', sub);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

async function withJob(key, type, title, fn) {
  requireIdle();
  job = { key, type, stopped: false };
  send('job', { running: true, type, title });
  try {
    return await fn(job);
  } finally {
    job = null;
    send('job', { running: false });
  }
}

async function confirmBox(message, detail, okLabel) {
  const { response } = await dialog.showMessageBox(win, {
    type: 'warning', buttons: ['취소', okLabel], defaultId: 0, cancelId: 0, noLink: true, message, detail,
  });
  return response === 1;
}

// 저장됨 목록 조회 + 백업 CSV 자동 저장
async function fetchList(key) {
  requireIdle();
  const st = await requireLogin(key);
  const backupPath = path.join(workDir('backup'), `saved_${st.username || st.uid}_${stamp()}.csv`);
  return withJob(key, 'fetch', `${who(st)} 저장됨 목록 불러오기`, async (j) => {
    log(`목록 불러오기 시작 (${who(st)})`);
    const res = await fetchSaved({
      wc: views[key].webContents, job: j, log,
      progress: (p) => send('job-progress', { type: 'fetch', ...p }),
      onPage: (rows) => writeSavedCsv(backupPath, rows),
    });
    if (res.rows.length) log(`${res.complete ? '✅' : '⏸ (일부만)'} ${res.rows.length}개 불러옴 · 백업: ${backupPath}`);
    else log(`저장된 게시물이 없거나 불러오지 못했습니다.`);
    return { key, username: st.username, uid: st.uid, rows: res.rows, complete: res.complete, backupPath: res.rows.length ? backupPath : null };
  });
}

// CSV 파일 기준으로 저장/해제 실행 (진행 상태는 CSV 옆 파일에 저장 → 이어하기 가능)
async function runCsv(key, action, opts, file) {
  requireIdle();
  const st = await requireLogin(key);
  const A = ACTIONS[action];
  if (action === 'unsave') {
    const ok = await confirmBox(
      `${who(st)} 계정에서 ${file.rows.length}개 게시물의 저장을 해제할까요?`,
      `대상 목록: ${file.path}\n\n저장 해제한 항목은 이 CSV로 다시 "저장"하면 복원할 수 있습니다.`,
      '저장 해제',
    );
    if (!ok) { log('저장 해제를 취소했습니다.'); return null; }
  }
  setManager(false);
  switchTo(key);
  return withJob(key, action, `${who(st)} · ${A.name}`, async (j) => {
    log(`[${A.name}] 시작 (${who(st)}) — ${path.basename(file.path)}`);
    const res = await runBatch({
      wc: views[key].webContents, csvPath: file.path, rows: file.rows, action, opts, job: j, log, net: netLogs[key],
      progress: (p) => send('job-progress', { type: 'batch', ...p }),
      countdown: (sec, label) => send('countdown', { sec, label }),
    });
    log(`${res.remaining === 0 ? '✅ 완료' : '⏸ 중단/일시정지'} [${A.name}] 처리 ${res.done}, 건너뜀 ${res.skipped}, 삭제된 게시물 ${res.not_found}, 남음 ${res.remaining}`);
    log(`결과 파일: ${res.resultFile}`);
    return res;
  });
}

// 선택 항목을 작업용 CSV로 저장한 뒤 실행 (중단 시 "CSV 불러오기"로 이 파일을 열면 이어서 가능)
async function runSelection(key, action, rows, opts) {
  if (!rows || !rows.length) throw new Error('선택된 항목이 없습니다.');
  const st = await requireLogin(key);
  const p = path.join(workDir('jobs'), `${action}_${st.username || st.uid}_${stamp()}.csv`);
  writeSavedCsv(p, rows);
  csvFile = { path: p, rows: readCsvObjects(p) };
  send('csv-file', { path: p, summary: previewCsv(csvFile.rows, p) });
  log(`작업 목록 저장: ${p}`);
  return runCsv(key, action, opts, csvFile);
}

function handle(channel, fn) {
  ipcMain.handle(channel, async (_e, arg) => fn(arg));
}

// ---------- IPC ----------
handle('switch', (key) => { switchTo(key); return refreshStatus(key); });
handle('status', (key) => refreshStatus(key));
handle('nav', ({ key, action, url }) => {
  const wc = views[key].webContents;
  if (action === 'back' && wc.navigationHistory.canGoBack()) wc.navigationHistory.goBack();
  else if (action === 'forward' && wc.navigationHistory.canGoForward()) wc.navigationHistory.goForward();
  else if (action === 'reload') wc.reload();
  else if (action === 'home') wc.loadURL(HOME);
  else if (action === 'go' && isInstagramUrl(url)) wc.loadURL(url);
});
handle('open-post', ({ key, url }) => {
  if (!isInstagramUrl(url)) return;
  setManager(false);
  switchTo(key);
  views[key].webContents.loadURL(url);
});
handle('logout', async (key) => {
  requireIdle();
  await session.fromPartition(ACCOUNTS[key].partition).clearStorageData();
  views[key].webContents.loadURL(HOME);
  return refreshStatus(key);
});
handle('stop', () => { if (job) { job.stopped = true; log('중지 요청됨 — 현재 단계가 끝나면 멈춥니다.'); } });
handle('reveal', (p) => shell.showItemInFolder(p));
handle('manager', (open) => setManager(!!open));

handle('export', async (key) => {
  const st = await requireLogin(key);
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: '저장됨 CSV 저장 위치',
    defaultPath: path.join(app.getPath('documents'), `instagram_saved_${st.username || st.uid}_${stamp(false)}.csv`),
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  });
  if (canceled || !filePath) return null;
  return withJob(key, 'fetch', `${who(st)} 내보내기`, async (j) => {
    log(`내보내기 시작 (${who(st)}) → ${filePath}`);
    const res = await fetchSaved({
      wc: views[key].webContents, job: j, log,
      progress: (p) => send('job-progress', { type: 'fetch', ...p }),
      onPage: (rows) => writeSavedCsv(filePath, rows),
    });
    writeSavedCsv(filePath, res.rows);
    log(`${res.complete ? '✅ 내보내기 완료' : '⏸ 내보내기 중단'}: ${res.rows.length}개 → ${filePath}`);
    return { count: res.rows.length, complete: res.complete, filePath };
  });
});

handle('list-fetch', (key) => fetchList(key));

handle('list-open-csv', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: '목록으로 볼 CSV 선택',
    defaultPath: app.getPath('documents'),
    filters: [{ name: 'CSV', extensions: ['csv'] }],
    properties: ['openFile'],
  });
  if (canceled || !filePaths.length) return null;
  return { path: filePaths[0], rows: readCsvObjects(filePaths[0]) };
});

handle('save-csv', async ({ rows, name }) => {
  const { canceled, filePath } = await dialog.showSaveDialog(win, {
    title: '선택 항목 CSV 저장',
    defaultPath: path.join(app.getPath('documents'), name || `instagram_saved_selection_${stamp()}.csv`),
    filters: [{ name: 'CSV', extensions: ['csv'] }],
  });
  if (canceled || !filePath) return null;
  writeSavedCsv(filePath, rows);
  log(`CSV 저장: ${rows.length}개 → ${filePath}`);
  return filePath;
});

handle('load-csv', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(win, {
    title: '실행할 CSV 선택',
    defaultPath: app.getPath('documents'),
    filters: [{ name: 'CSV', extensions: ['csv'] }],
    properties: ['openFile'],
  });
  if (canceled || !filePaths.length) return null;
  const p = filePaths[0];
  csvFile = { path: p, rows: readCsvObjects(p) };
  const summary = previewCsv(csvFile.rows, p);
  log(`CSV 불러옴: ${path.basename(p)} — ${summary.total}개 (저장 완료 ${summary.save.total - summary.save.remaining}, 해제 완료 ${summary.unsave.total - summary.unsave.remaining})`);
  return { path: p, summary };
});

handle('run-csv', ({ key, action, opts }) => {
  if (!csvFile) throw new Error('먼저 CSV를 불러오세요.');
  return runCsv(key, action, opts, csvFile);
});

handle('run-selection', ({ key, action, rows, opts }) => runSelection(key, action, rows, opts));

// 전체 저장 해제: 목록 조회(백업) → 확인 → 해제
handle('unsave-all', async ({ key, opts }) => {
  requireIdle();
  const st = await requireLogin(key);
  const ok = await confirmBox(
    `${who(st)} 계정의 저장됨을 전부 해제할까요?`,
    '먼저 전체 목록을 불러와 백업 CSV를 만든 뒤, 개수를 한 번 더 확인하고 진행합니다.',
    '목록 불러오기',
  );
  if (!ok) return null;
  const list = await fetchList(key);
  if (!list.rows.length) return null;
  if (!list.complete) {
    const go = await confirmBox('목록을 끝까지 불러오지 못했습니다.', `불러온 ${list.rows.length}개만 해제할까요?`, '불러온 것만 해제');
    if (!go) return null;
  }
  const p = path.join(workDir('jobs'), `unsave-all_${st.username || st.uid}_${stamp()}.csv`);
  writeSavedCsv(p, list.rows);
  csvFile = { path: p, rows: readCsvObjects(p) };
  send('csv-file', { path: p, summary: previewCsv(csvFile.rows, p) });
  return runCsv(key, 'unsave', opts, csvFile);
});

// ---------- App ----------
app.whenReady().then(() => {
  initApiStore(path.join(app.getPath('userData'), 'api-endpoints.json'));
  win = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 1000,
    minHeight: 640,
    title: 'Instagram 저장됨 관리 도구',
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js') },
  });
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname, 'ui', 'index.html'));
  createView('a');
  createView('b');
  layout();
  win.on('resize', layout);
  win.webContents.on('did-finish-load', () => {
    send('active', active);
    refreshStatus('a');
    refreshStatus('b');
  });
});

app.on('window-all-closed', () => app.quit());

process.on('unhandledRejection', (e) => console.error('unhandledRejection', e));
