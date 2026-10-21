// CSV의 게시물을 하나씩 열어 저장(save) 또는 저장 해제(unsave)를 수행하는 공통 실행기
const fs = require('fs');
const { igApi, rand, sleep, shortcodeFromUrl } = require('./ig');
const { writeCsv } = require('./csv');

// 저장 아이콘의 aria-label (UI 언어별). 저장 안 됨 → OFF, 저장됨 → ON
const OFF = ['저장', 'Save', '保存'];
const ON = ['삭제', 'Remove', '저장 취소', 'Unsave', '削除', '保存済み'];

const ACTIONS = {
  save: {
    name: '저장',
    done: 'saved', skip: 'already_saved',
    progressSuffix: '.restore-progress.json', resultSuffix: '.restore-result.csv',
  },
  unsave: {
    name: '저장 해제',
    done: 'removed', skip: 'not_saved',
    progressSuffix: '.unsave-progress.json', resultSuffix: '.unsave-result.csv',
  },
};
const FATAL = new Set(['blocked', 'challenge', 'logged_out']);

// 게시물 페이지 상태 판별. scroll=true 이면 저장 버튼을 화면 중앙으로 스크롤
function probeScript(scroll) {
  return `(() => {
    const OFF = ${JSON.stringify(OFF)}, ON = ${JSON.stringify(ON)};
    const path = location.pathname;
    if (path.startsWith('/accounts/login') || (document.querySelector('input[name="username"]') && document.querySelector('input[name="password"]')))
      return { state: 'logged_out' };
    if (path.includes('/challenge') || path.startsWith('/accounts/suspended'))
      return { state: 'challenge' };
    const dialogs = [...document.querySelectorAll('[role="dialog"]')].map(d => d.innerText).join('\\n').trim();
    if (/Try Again Later|Action Blocked|We restrict certain activity|잠시 후 다시 시도|특정 활동을 제한|차단되었습니다/i.test(dialogs))
      return { state: 'blocked', message: dialogs.slice(0, 200) };
    const body = document.body ? document.body.innerText : '';
    if (/this page isn.t available|페이지를 사용할 수 없습니다|このページはご利用いただけません/i.test(body))
      return { state: 'not_found' };
    const root = document.querySelector('main') || document;
    const all = [...root.querySelectorAll('svg[aria-label]')];
    const svg = all.find(s => OFF.includes(s.getAttribute('aria-label')) || ON.includes(s.getAttribute('aria-label')));
    if (!svg) {
      const labels = [...new Set(all.map(s => s.getAttribute('aria-label')))].slice(0, 15);
      const errIcon = labels.some(l => ['오류', 'Error', 'エラー'].includes(l));
      if (errIcon || /문제가 발생했습니다|오류가 발생했습니다|Something went wrong|couldn.t load|불러올 수 없습니다/i.test(body))
        return { state: 'page_error', labels, message: body.replace(/\\s+/g, ' ').trim().slice(0, 120) };
      return { state: 'loading', labels };
    }
    const btn = svg.closest('[role="button"],button,a') || svg;
    if (${scroll}) btn.scrollIntoView({ block: 'center', inline: 'center' });
    const r = btn.getBoundingClientRect();
    return {
      state: ON.includes(svg.getAttribute('aria-label')) ? 'on' : 'off',
      x: r.left + r.width / 2, y: r.top + r.height / 2,
      dialog: dialogs.slice(0, 160),
    };
  })()`;
}

const JS_CLICK = `(() => {
  const L = ${JSON.stringify([...OFF, ...ON])};
  const root = document.querySelector('main') || document;
  const svg = [...root.querySelectorAll('svg[aria-label]')].find(s => L.includes(s.getAttribute('aria-label')));
  if (!svg) return false;
  (svg.closest('[role="button"],button,a') || svg).click();
  return true;
})()`;

const probe = (wc, scroll = false) => wc.executeJavaScript(probeScript(scroll), true);

async function waitFor(wc, job, timeoutMs, done) {
  const end = Date.now() + timeoutMs;
  let st = { state: 'loading' };
  while (Date.now() < end && !job.stopped) {
    try { st = await probe(wc); } catch { st = { state: 'loading' }; }
    if (done(st)) return st;
    await sleep(500, job);
  }
  return st;
}

async function realClick(wc, x, y) {
  x = Math.round(x); y = Math.round(y);
  wc.focus();
  wc.sendInputEvent({ type: 'mouseMove', x, y });
  await sleep(rand(60, 160));
  wc.sendInputEvent({ type: 'mouseDown', x, y, button: 'left', clickCount: 1 });
  await sleep(rand(50, 120));
  wc.sendInputEvent({ type: 'mouseUp', x, y, button: 'left', clickCount: 1 });
}

// 클릭 모드: 게시물 페이지에 들어가 실제 마우스 이벤트로 저장 버튼 토글
async function toggleByClick(wc, code, action, job, pk, net) {
  const A = ACTIONS[action];
  const want = action === 'save' ? 'on' : 'off';
  const reached = (s) => s.state === want || s.state === 'blocked';
  try { await wc.loadURL(`https://www.instagram.com/p/${code}/`); } catch { /* SPA 리다이렉트 시 ERR_ABORTED 무시 */ }

  let st = await waitFor(wc, job, 20000, (s) => s.state !== 'loading');
  if (st.state === 'page_error') {
    // 일시적인 오류 페이지일 수 있으니 잠시 기다렸다 새로고침
    await sleep(rand(8000, 15000), job);
    if (job.stopped) return { status: 'stopped' };
    wc.reload();
    st = await waitFor(wc, job, 20000, (s) => s.state !== 'loading');
  }
  if (job.stopped) return { status: 'stopped' };
  if (st.state === 'page_error') return { status: 'page_error', message: `인스타그램 오류 페이지 (${st.message || (st.labels || []).join(', ')})` };
  if (st.state === 'loading') return { status: 'failed', message: `저장 버튼을 찾지 못함 (아이콘: ${(st.labels || []).join(', ')})` };
  if (st.state === want) return { status: A.skip };
  if (st.state !== 'on' && st.state !== 'off') return { status: st.state, message: st.message };

  await sleep(rand(1200, 3000), job); // 사람처럼 잠깐 보고 누르기
  if (job.stopped) return { status: 'stopped' };
  await probe(wc, true);
  await sleep(rand(300, 600));
  st = await probe(wc);
  if (st.state === want) return { status: A.skip };
  if (st.state !== 'on' && st.state !== 'off') return { status: FATAL.has(st.state) ? st.state : 'failed', message: st.message };

  const clickedAt = Date.now();
  await realClick(wc, st.x, st.y);
  st = await waitFor(wc, job, 8000, reached);
  if (st.state === want) return { status: A.done, observed: net ? observe(net(clickedAt), pk || pkFromShortcode(code), action) : null };
  if (st.state === 'blocked') return { status: 'blocked', message: st.message };

  // 좌표 클릭이 안 먹힌 경우 DOM click 한 번 더 (단, 확인 대화상자가 떠 있으면 그대로 보고)
  if (st.dialog) return { status: 'failed', message: `클릭 후 대화상자: ${st.dialog}` };
  const jsClickedAt = Date.now();
  await wc.executeJavaScript(JS_CLICK, true).catch(() => false);
  st = await waitFor(wc, job, 6000, reached);
  if (st.state === want) return { status: A.done, message: 'DOM click fallback', observed: net ? observe(net(jsClickedAt), pk || pkFromShortcode(code), action) : null };
  if (st.state === 'blocked') return { status: 'blocked', message: st.message };
  return { status: 'failed', message: st.dialog ? `클릭 후 대화상자: ${st.dialog}` : '클릭 후 상태가 바뀌지 않음' };
}

// shortcode → media pk (shortcode 앞 11자리는 pk의 base64 표현)
function pkFromShortcode(code) {
  const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  let n = 0n;
  for (const ch of code.slice(0, 11)) {
    const i = ABC.indexOf(ch);
    if (i < 0) return null;
    n = n * 64n + BigInt(i);
  }
  return n.toString();
}

// ---------- API 모드 ----------
// 후보 주소를 차례로 시도하고, 클릭 모드에서 실제로 관찰된 주소가 있으면 그것을 우선 사용한다.
let storePath = null;
let learned = {};                // { save: '/api/v1/.../{pk}/save/', unsave: '...' }
const deadTemplates = new Set(); // 404로 확인된 주소 (앱 실행 동안)

function initApiStore(p) {
  storePath = p;
  try { learned = JSON.parse(fs.readFileSync(p, 'utf8')); } catch { learned = {}; }
}
function persistLearned() {
  if (storePath) { try { fs.writeFileSync(storePath, JSON.stringify(learned, null, 1), 'utf8'); } catch {} }
}

// ---- GraphQL 학습: 클릭 때 보낸 mutation 요청을 틀로 저장하고, 게시물 ID만 바꿔 재현 ----
const gqlKey = (action) => `graphql:${action}`;

function isActionMutation(friendly, action) {
  if (!/Mutation/i.test(friendly || '')) return false;
  return action === 'unsave' ? /unsave/i.test(friendly) : /save/i.test(friendly) && !/unsave/i.test(friendly);
}

// variables 안에서 게시물 pk가 들어 있는 위치(키 경로)를 찾는다
function findPkPath(obj, pk, path = []) {
  if (obj === null || obj === undefined) return null;
  if (typeof obj !== 'object') return String(obj) === pk ? path : null;
  for (const [k, v] of Object.entries(obj)) {
    const f = findPkPath(v, pk, [...path, k]);
    if (f) return f;
  }
  return null;
}

function setPath(obj, path, value) {
  let o = obj;
  for (let i = 0; i < path.length - 1; i++) o = o[path[i]];
  o[path[path.length - 1]] = value;
}

function buildGraphqlTemplate(r, pk) {
  const params = Object.fromEntries(new URLSearchParams(r.body || ''));
  let vars;
  try { vars = JSON.parse(params.variables || ''); } catch { return null; }
  const mediaPath = pk ? findPkPath(vars, pk) : null;
  if (!mediaPath) return null;
  const headers = { ...(r.headers || {}) };
  delete headers['x-csrftoken']; // 재현 시점의 쿠키 값으로 다시 넣음
  return { kind: 'graphql', url: new URL(r.url).pathname, friendly: r.friendly, docId: params.doc_id, params, mediaPath, headers };
}

// 클릭 직후 브라우저가 보낸 POST 요청에서 저장/해제 방식을 찾아 기억
function observe(reqs, pk, action) {
  for (const r of reqs) {
    let p;
    try { p = new URL(r.url).pathname; } catch { continue; }
    if (pk && p.includes(pk) && new RegExp(`/${action}/?$`).test(p)) {
      const template = p.replace(pk, '{pk}');
      const isNew = learned[action] !== template;
      learned[action] = template;
      deadTemplates.delete(template);
      if (isNew) persistLearned();
      return { template, isNew };
    }
  }
  const gql = reqs.filter((r) => /graphql/.test(r.url));
  const m = gql.find((r) => isActionMutation(r.friendly, action));
  if (m) {
    const tpl = buildGraphqlTemplate(m, pk);
    if (!tpl) return { graphql: `${m.friendly} (변수에서 게시물 ID를 찾지 못해 학습 불가)` };
    const prev = learned[action];
    const isNew = !prev || prev.kind !== 'graphql' || prev.docId !== tpl.docId || prev.params?.fb_dtsg !== tpl.params.fb_dtsg;
    learned[action] = tpl;
    deadTemplates.delete(gqlKey(action));
    persistLearned();
    return { graphqlLearned: tpl.friendly, isNew };
  }
  if (gql.length) return { graphql: [...new Set(gql.map((r) => r.friendly || r.url))].join(', ') };
  return reqs.length ? { other: reqs.map((r) => r.url.replace('https://www.instagram.com', '')).slice(0, 3).join(', ') } : null;
}

async function replayGraphql(wc, tpl, pk) {
  const vars = JSON.parse(tpl.params.variables);
  setPath(vars, tpl.mediaPath, pk);
  const form = { ...tpl.params, variables: JSON.stringify(vars) };
  const r = await igApi(wc, tpl.url, { method: 'POST', form, headers: tpl.headers });
  const j = r.json;
  const errs = j?.errors || (j?.error ? [{ message: j.errorSummary || j.errorDescription || String(j.error) }] : null);
  const msg = errs ? errs.map((e) => e.message || e.description || '').join('; ') : summarizeBody(r);
  if (r.status === 200 && j?.data && !errs) {
    const vals = Object.values(j.data);
    if (vals.length && vals.every((v) => v !== null)) return { ok: true };
  }
  if (r.status === 429 || /rate limit|try again later|spam|feedback_required/i.test(msg)) return { final: { status: 'blocked', message: msg } };
  if (r.status === 401 || /login_required|not logged in/i.test(msg)) return { final: { status: 'logged_out', message: msg } };
  if (/checkpoint|challenge/i.test(msg)) return { final: { status: 'challenge', message: msg } };
  if (/not found|unavailable|does not exist|deleted/i.test(msg)) return { final: { status: 'not_found', message: msg } };
  return { ok: false, message: `GraphQL HTTP ${r.status} ${String(msg).slice(0, 120)}` };
}

function summarizeBody(r) {
  if (r.json) return r.json.message || JSON.stringify(r.json).slice(0, 160);
  const t = (r.text || '').trim();
  if (t.startsWith('<')) return '(HTML 페이지 응답)';
  return t.slice(0, 160) || r.error || '';
}

async function toggleByApi(wc, code, pk, action) {
  pk = pk || pkFromShortcode(code);
  if (!pk) return { status: 'failed', message: 'media_pk 없음' };
  const tpl = learned[action];
  if (tpl && tpl.kind === 'graphql' && !deadTemplates.has(gqlKey(action))) {
    const g = await replayGraphql(wc, tpl, pk);
    if (g.ok) return { status: ACTIONS[action].done, message: `api GraphQL ${tpl.friendly}` };
    if (g.final) return g.final;
    deadTemplates.add(gqlKey(action)); // 토큰 만료 등 → 클릭으로 처리하며 다시 학습
    return { status: 'api_unsupported', message: g.message };
  }
  const rest = typeof tpl === 'string' ? tpl : null;
  const templates = [...new Set([rest, `/api/v1/web/save/{pk}/${action}/`, `/api/v1/media/{pk}/${action}/`].filter(Boolean))]
    .filter((t) => !deadTemplates.has(t));
  for (const t of templates) {
    const r = await igApi(wc, t.replace('{pk}', pk), { method: 'POST', form: {} });
    const msg = summarizeBody(r);
    if (r.status === 404 && !r.json) { deadTemplates.add(t); continue; } // 주소 자체가 없음
    if (r.status === 200 && r.json?.status === 'ok') return { status: ACTIONS[action].done, message: `api ${t}` };
    if (r.status === 429 || /feedback_required|spam|try again later/i.test(msg)) return { status: 'blocked', message: msg };
    if (r.status === 401 || /login_required/i.test(msg)) return { status: 'logged_out', message: msg };
    if (/checkpoint|challenge/i.test(msg)) return { status: 'challenge', message: msg };
    if (/media.*(not|deleted)|not found|does not exist/i.test(msg)) return { status: 'not_found', message: msg };
    return { status: 'failed', message: `HTTP ${r.status} ${msg} (${t})` };
  }
  return { status: 'api_unsupported' };
}

// ---------- CSV / 진행 상태 ----------
function progressPath(csvPath, action) { return csvPath.replace(/\.csv$/i, '') + ACTIONS[action].progressSuffix; }
function resultPath(csvPath, action) { return csvPath.replace(/\.csv$/i, '') + ACTIONS[action].resultSuffix; }

function loadProgress(csvPath, action) {
  try { return JSON.parse(fs.readFileSync(progressPath(csvPath, action), 'utf8')); } catch { return {}; }
}
function saveProgress(csvPath, action, state) {
  fs.writeFileSync(progressPath(csvPath, action), JSON.stringify(state, null, 1), 'utf8');
}

function buildItems(rows) {
  const items = [];
  const seen = new Set();
  rows.forEach((r, i) => {
    const code = (r.shortcode || r.code || shortcodeFromUrl(r.url) || '').trim();
    if (!code || seen.has(code)) return;
    seen.add(code);
    const idx = Number(r.saved_index);
    items.push({
      code,
      pk: String(r.media_pk || '').trim(),
      url: r.url || `https://www.instagram.com/p/${code}/`,
      order: r.saved_index !== undefined && r.saved_index !== '' && Number.isFinite(idx) ? idx : i,
    });
  });
  return items;
}

function summarize(items, state, action) {
  const A = ACTIONS[action];
  const c = { action, total: items.length, done: 0, skipped: 0, not_found: 0, failed: 0, remaining: 0 };
  for (const it of items) {
    const s = state[it.code]?.status;
    if (s === A.done) c.done++;
    else if (s === A.skip) c.skipped++;
    else if (s === 'not_found') c.not_found++;
    else { c.remaining++; if (s) c.failed++; }
  }
  return c;
}

function writeResult(csvPath, action, items, state) {
  const rows = items.map((it) => ({
    shortcode: it.code,
    url: it.url,
    status: state[it.code]?.status || 'pending',
    message: state[it.code]?.message || '',
    at: state[it.code]?.at || '',
  }));
  writeCsv(resultPath(csvPath, action), ['shortcode', 'url', 'status', 'message', 'at'], rows);
}

async function runBatch({ wc, csvPath, rows, action, opts, job, log, progress, countdown, net }) {
  const A = ACTIONS[action];
  const finals = new Set([A.done, A.skip, 'not_found']);
  const items = buildItems(rows);
  const state = loadProgress(csvPath, action);
  // 저장: saved_index 0 = 가장 최근. 오래된 것부터 저장해야 대상 계정에서도 같은 순서가 된다.
  const ordered = action === 'save'
    ? [...items].sort((a, b) => (opts.oldestFirst ? b.order - a.order : a.order - b.order))
    : items;
  const queue = ordered.filter((it) => !finals.has(state[it.code]?.status));

  progress(summarize(items, state, action));
  log(`[${A.name}] 대기 ${queue.length}개 / 전체 ${items.length}개 (모드: ${opts.mode === 'api' ? 'API' : '클릭'})`);

  let actions = 0;
  let consecutiveFail = 0;
  let consecutivePageError = 0;
  let mode = opts.mode;
  let apiFailures = 0;
  const seenObs = new Set();
  for (const it of queue) {
    if (job.stopped) break;
    if (actions >= opts.maxPerRun) { log(`이번 실행 최대치(${opts.maxPerRun}개) 도달 — 중단합니다. 같은 CSV로 다시 실행하면 이어서 진행됩니다.`); break; }

    progress({ ...summarize(items, state, action), current: it.code });
    let res;
    try {
      if (mode === 'api') {
        res = await toggleByApi(wc, it.code, it.pk, action);
        if (res.status === 'api_unsupported') {
          apiFailures++;
          log(res.message
            ? `⚠ API 요청 실패 (${res.message}) — 이 항목은 클릭으로 처리하고 요청 형식을 다시 학습합니다.`
            : '⚠ 사용 가능한 API 방식을 아직 모릅니다 — 클릭으로 처리하면서 실제 요청 형식을 학습합니다.');
          if (apiFailures >= 3) log('⚠ API 방식이 3번 실패해 이번 실행은 클릭 모드로만 진행합니다.');
          mode = 'click';
        }
      }
      if (mode === 'click') res = await toggleByClick(wc, it.code, action, job, it.pk, net);
    } catch (e) {
      res = { status: 'failed', message: String((e && e.message) || e) };
    }
    if (res.status === 'stopped') break;

    state[it.code] = { status: res.status, message: res.message || '', at: new Date().toISOString() };
    saveProgress(csvPath, action, state);
    progress(summarize(items, state, action));
    log(`${it.code}: ${res.status}${res.message ? ' — ' + res.message : ''}`);
    const o = res.observed;
    if (o) {
      const key = o.template || o.graphqlLearned || o.graphql || o.other;
      if (o.template && o.isNew) log(`🔎 API 주소 학습: POST ${o.template} — 다음부터 API 모드에서 사용합니다.`);
      else if (o.graphqlLearned && o.isNew) log(`🔎 API 방식 학습: GraphQL ${o.graphqlLearned} — 다음부터 API 모드에서 사용합니다.`);
      else if (!o.template && !o.graphqlLearned && !seenObs.has(key)) log(`🔎 관측된 요청: ${o.graphql ? 'GraphQL ' + o.graphql : o.other}`);
      seenObs.add(key);
      // API 모드로 시작했다가 클릭으로 내려왔으면, 방금 학습한 방식으로 복귀
      if (opts.mode === 'api' && mode === 'click' && (o.template || o.graphqlLearned) && apiFailures < 3) {
        mode = 'api';
        log('↩ 학습한 요청 형식으로 API 모드에 복귀합니다.');
      }
    }

    if (FATAL.has(res.status)) {
      log(res.status === 'blocked'
        ? '⚠ Instagram이 작업을 제한했습니다. 몇 시간~하루 쉬고 딜레이를 늘려 다시 시도하세요.'
        : '⚠ 로그인/본인확인이 필요합니다. 오른쪽 화면에서 처리한 뒤 다시 시작하세요.');
      job.error = true;
      break;
    }
    if (res.status === 'page_error') {
      if (++consecutivePageError >= 3) {
        log('⚠ 인스타그램이 게시물 페이지를 연속으로 불러오지 못합니다 — 짧은 시간에 많이 열어 일시적으로 제한된 것일 수 있습니다. 30분~몇 시간 쉬었다가 같은 CSV로 이어서 실행하세요. (이 항목들은 다음 실행 때 다시 시도합니다)');
        job.error = true;
        break;
      }
      if (!(await sleep(rand(30000, 60000), job, (s) => countdown(s, '오류 페이지 — 잠시 대기')))) break;
      continue;
    }
    consecutivePageError = 0;
    if (res.status === 'failed') {
      if (++consecutiveFail >= 3) { log('⚠ 연속 3회 실패 — 화면 상태를 확인하세요. 중단합니다.'); job.error = true; break; }
    } else consecutiveFail = 0;

    if (res.status === A.done) {
      actions++;
      if (actions % opts.batchSize === 0) {
        const ms = opts.breakMin * 60000 * rand(0.8, 1.2);
        log(`${actions}개 처리 — ${Math.round(ms / 60000)}분 휴식`);
        if (!(await sleep(ms, job, (s) => countdown(s, '휴식')))) break;
        continue;
      }
      if (!(await sleep(rand(opts.delayMin, opts.delayMax) * 1000, job, (s) => countdown(s, '다음 작업까지')))) break;
    } else if (!(await sleep(rand(2000, 4000), job, (s) => countdown(s, '다음 항목')))) break;
  }
  countdown(0, '');
  writeResult(csvPath, action, items, state);
  const sum = summarize(items, state, action);
  progress(sum);
  const statuses = Object.fromEntries(items.map((it) => [it.code, state[it.code]?.status || 'pending']));
  return { ...sum, statuses, resultFile: resultPath(csvPath, action) };
}

function previewCsv(rows, csvPath) {
  const items = buildItems(rows);
  return {
    total: items.length,
    save: summarize(items, loadProgress(csvPath, 'save'), 'save'),
    unsave: summarize(items, loadProgress(csvPath, 'unsave'), 'unsave'),
  };
}

module.exports = { runBatch, previewCsv, pkFromShortcode, ACTIONS, initApiStore };
