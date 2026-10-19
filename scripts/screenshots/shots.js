// README용 스크린샷 생성기 — 데모 데이터로 실제 UI를 띄워 docs/images/*.png 로 캡처한다.
// 실행: npm run screenshots
const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, nativeTheme } = require('electron');
const { rows } = require('./demo-data');

app.commandLine.appendSwitch('force-device-scale-factor', '1.5');

const ROOT = path.join(__dirname, '..', '..');
const OUT = path.join(ROOT, 'docs', 'images');
const UI = path.join(ROOT, 'src', 'ui', 'index.html');
const MOCK = path.join(__dirname, 'mock-browser.html');
const ICON = path.join(ROOT, 'build', 'icon.png');
const H = 1000;
const DATA = rows(64);

const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const T = (h, m, s) => `오후 ${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;

async function open(width, height, file) {
  const win = new BrowserWindow({
    width, height, useContentSize: true, show: true, frame: false, x: 0, y: 0,
    webPreferences: { preload: path.join(__dirname, 'demo-preload.js') },
  });
  for (let i = 0; ; i++) {
    try { await win.loadFile(file); break; } catch (e) { if (i >= 3) throw e; await wait(500); }
  }
  return win;
}
const js = (win, code) => win.webContents.executeJavaScript(code, true);
const fire = (win, ch, p) => js(win, `demo.fire(${JSON.stringify(ch)}, ${JSON.stringify(p)})`);

async function capture(win, name, rect) {
  await wait(900);
  let img;
  for (let i = 0; i < 8; i++) {
    win.show(); win.focus(); win.moveTop();
    win.webContents.invalidate();
    await wait(300);
    img = await win.webContents.capturePage(rect);
    if (!img.isEmpty()) break; // 창이 아직 그려지지 않았으면 다시 시도
    await wait(500);
  }
  if (img.isEmpty()) throw new Error(`capture failed: ${name}`);
  const file = path.join(OUT, `${name}.png`);
  fs.writeFileSync(file, img.toPNG());
  console.log('saved', path.relative(ROOT, file), img.getSize());
  return file;
}

async function accounts(win, active) {
  await fire(win, 'status', { key: 'a', loggedIn: true, uid: '1', username: 'old.account' });
  await fire(win, 'status', { key: 'b', loggedIn: true, uid: '2', username: 'new.account' });
  await fire(win, 'active', active);
}

async function logs(win, lines) {
  for (const [at, msg] of lines) await fire(win, 'log', { at, msg });
}

// ---------- 패널 장면 ----------
async function panelRestore() {
  const win = await open(400, H, UI);
  await accounts(win, 'b');
  await fire(win, 'url', { key: 'b', url: 'https://www.instagram.com/p/C7xQ2mLp9aK/' });
  await fire(win, 'csv-file', {
    path: 'C:\\Users\\me\\Documents\\instagram_saved_old.account_20261019.csv',
    summary: { total: 1001, save: { total: 1001, remaining: 615 }, unsave: { total: 1001, remaining: 1001 } },
  });
  await fire(win, 'job', { running: true, title: '@new.account · 저장' });
  await fire(win, 'job-progress', { type: 'batch', action: 'save', total: 1001, done: 372, skipped: 11, not_found: 3, failed: 0, remaining: 615, current: 'C7xQ2mLp9aK' });
  await fire(win, 'countdown', { sec: 23, label: '다음 작업까지' });
  await logs(win, [
    [T(3, 2, 11), '[저장] 시작 (@new.account) — instagram_saved_old.account_20261019.csv'],
    [T(3, 2, 11), '[저장] 대기 1001개 / 전체 1001개 (모드: 클릭)'],
    [T(3, 2, 19), 'C9kV0aLmQ2x: saved'],
    [T(3, 2, 47), 'C3pTt8ZcY1w: already_saved'],
    [T(3, 2, 52), 'C1a9QwErTy0: not_found'],
    [T(3, 3, 24), 'C5hJk2LmN0p: saved'],
    [T(3, 41, 2), '40개 처리 — 10분 휴식'],
    [T(3, 51, 40), 'C7xQ2mLp9aK: saved'],
  ]);
  return win;
}

async function panelUnsave() {
  const win = await open(400, H, UI);
  await accounts(win, 'a');
  await fire(win, 'url', { key: 'a', url: 'https://www.instagram.com/p/C2bN8xQwE4r/' });
  await fire(win, 'csv-file', {
    path: 'C:\\Users\\me\\Documents\\InstaSavedMigrator\\jobs\\unsave-all_old.account_20261019_141502.csv',
    summary: { total: 1001, save: { total: 1001, remaining: 1001 }, unsave: { total: 1001, remaining: 828 } },
  });
  await fire(win, 'job', { running: true, title: '@old.account · 저장 해제' });
  await fire(win, 'job-progress', { type: 'batch', action: 'unsave', total: 1001, done: 168, skipped: 2, not_found: 3, failed: 0, remaining: 828, current: 'C2bN8xQwE4r' });
  await fire(win, 'countdown', { sec: 17, label: '다음 작업까지' });
  await logs(win, [
    [T(2, 14, 2), '목록 불러오기 시작 (@old.account)'],
    [T(2, 15, 31), '✅ 1001개 불러옴 · 백업: C:\\Users\\me\\Documents\\InstaSavedMigrator\\backup\\saved_old.account_20261019_141502.csv'],
    [T(2, 15, 40), '[저장 해제] 대기 1001개 / 전체 1001개 (모드: 클릭)'],
    [T(2, 15, 52), 'DeTlxuOjxHg: removed'],
    [T(2, 16, 19), 'C8qLm2Zx0Vb: removed'],
    [T(2, 16, 25), 'C0wQe9RtY7u: not_saved'],
    [T(2, 16, 58), 'C3nB5vCx8Za: removed'],
    [T(2, 17, 31), 'C2bN8xQwE4r: removed'],
  ]);
  return win;
}

async function panelSafety() {
  const win = await open(400, H, UI);
  await accounts(win, 'b');
  await js(win, `document.querySelector('details').open = true`);
  await fire(win, 'csv-file', {
    path: 'C:\\Users\\me\\Documents\\instagram_saved_old.account_20261019.csv',
    summary: { total: 1001, save: { total: 1001, remaining: 412 }, unsave: { total: 1001, remaining: 1001 } },
  });
  await fire(win, 'job-progress', { type: 'batch', action: 'save', total: 1001, done: 571, skipped: 12, not_found: 6, failed: 0, remaining: 412 });
  await logs(win, [
    [T(9, 12, 40), 'C4mZx1Qp7Lk: saved'],
    [T(9, 13, 18), 'C6tR2yWq0Bn: blocked — Try Again Later'],
    [T(9, 13, 18), '⚠ Instagram이 작업을 제한했습니다. 몇 시간~하루 쉬고 딜레이를 늘려 다시 시도하세요.'],
    [T(9, 13, 18), '⏸ 중단/일시정지 [저장] 처리 571, 건너뜀 12, 삭제된 게시물 6, 남음 412'],
    [T(9, 13, 18), '결과 파일: C:\\Users\\me\\Documents\\instagram_saved_old.account_20261019.restore-result.csv'],
  ]);
  return win;
}

// ---------- 목록 관리 장면 ----------
async function manager(name, setup) {
  const win = await open(1400, H, UI);
  await accounts(win, 'a');
  await fire(win, 'manager', true);
  await js(win, `setList(${JSON.stringify({
    source: 'account', key: 'a', username: 'old.account', rows: DATA,
    path: 'C:\\Users\\me\\Documents\\InstaSavedMigrator\\backup\\saved_old.account_20261019_141502.csv', complete: true,
  })})`);
  await wait(300);
  if (setup) await js(win, setup);
  await capture(win, name);
  win.destroy();
}

// ---------- 히어로(패널 + 내장 브라우저) 합성 ----------
async function hero(theme, panelFile) {
  const mock = await open(1000, H, MOCK);
  if (theme === 'dark') await js(mock, `document.documentElement.classList.add('dark')`);
  const mockFile = await capture(mock, `_mock-${theme}`);
  mock.destroy();
  const dark = theme === 'dark';
  const html = `<!doctype html><html><body style="margin:0;background:transparent">
    <div style="width:1400px;border-radius:10px;overflow:hidden;box-shadow:0 0 0 1px ${dark ? '#333' : '#ccc'};font:13px 'Segoe UI','Malgun Gothic'">
      <div style="height:34px;display:flex;align-items:center;gap:8px;padding:0 12px;background:${dark ? '#202024' : '#f0f0f3'};color:${dark ? '#ddd' : '#222'}">
        <img src="file:///${ICON.replace(/\\/g, '/')}" style="width:18px;height:18px"> Instagram 저장됨 관리 도구
        <span style="flex:1"></span><span style="letter-spacing:18px;opacity:.6">— ☐ ✕</span>
      </div>
      <div style="display:flex;height:${H}px">
        <img src="file:///${panelFile.replace(/\\/g, '/')}" style="width:400px;height:${H}px">
        <img src="file:///${mockFile.replace(/\\/g, '/')}" style="width:1000px;height:${H}px">
      </div>
    </div></body></html>`;
  const tmp = path.join(OUT, `_hero-${theme}.html`);
  fs.writeFileSync(tmp, html);
  const win = new BrowserWindow({ width: 1400, height: H + 34, useContentSize: true, show: true, frame: false, transparent: true, x: 0, y: 0 });
  await win.loadFile(tmp);
  await capture(win, `hero-${theme}`);
  win.destroy();
  fs.unlinkSync(tmp);
  fs.unlinkSync(mockFile);
}

// 장면마다 창을 닫았다 여므로, 창이 0개가 되어도 앱이 종료되지 않게 함
app.on('window-all-closed', () => {});

app.whenReady().then(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  for (const theme of ['dark', 'light']) {
    nativeTheme.themeSource = theme;
    const p = await panelRestore();
    const panelFile = await capture(p, `panel-restore-${theme}`);
    p.destroy();
    await hero(theme, panelFile);
  }

  nativeTheme.themeSource = 'dark';
  let w = await panelUnsave(); await capture(w, 'panel-unsave'); w.destroy();
  w = await panelSafety(); await capture(w, 'panel-safety'); w.destroy();

  nativeTheme.themeSource = 'light';
  await manager('manager-grid', `
    [3, 4, 9, 15, 16, 22].forEach((i) => selected.add(visible[i].shortcode)); syncSelection();`);
  nativeTheme.themeSource = 'dark';
  await manager('manager-rows', `
    rowCodes(0).forEach((c) => selected.add(c));
    rowCodes(1).slice(0, 3).forEach((c) => selected.add(c));
    rowCodes(2).forEach((c) => selected.add(c));
    rowCodes(3).forEach((c) => selected.add(c));
    syncSelection();`);
  nativeTheme.themeSource = 'light';
  await manager('manager-filter', `
    document.querySelector('#f-col').value = '여행';
    document.querySelector('#f-type').value = '';
    applyFilters();
    visible.forEach((r) => selected.add(r.shortcode)); syncSelection();
    document.querySelector('#run-key').value = 'b'; updateActionLabels();`);
  nativeTheme.themeSource = 'dark';
  await manager('manager-fetching', `
    demo.fire('job', { running: true, title: '@old.account 저장됨 목록 불러오기' });
    demo.fire('job-progress', { type: 'fetch', count: 384, page: 18 });`);
  app.quit();
});
