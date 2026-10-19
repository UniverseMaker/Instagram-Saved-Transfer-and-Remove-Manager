// Instagram 웹 페이지 컨텍스트 안에서 실행되는 헬퍼.
// 로그인된 내장 브라우저의 쿠키를 그대로 쓰기 위해 fetch를 페이지 안에서 실행한다.
const IG_APP_ID = '936619743392459'; // instagram.com 웹 클라이언트 공개 App ID
const HOME = 'https://www.instagram.com/';

function isInstagramUrl(url) {
  return /^https:\/\/(www\.)?instagram\.com\//.test(url || '');
}

async function ensureOnInstagram(wc) {
  if (!isInstagramUrl(wc.getURL())) await wc.loadURL(HOME);
}

async function igApi(wc, path, { method = 'GET', form = null } = {}) {
  await ensureOnInstagram(wc);
  const script = `(async () => {
    const m = document.cookie.match(/(?:^|; )csrftoken=([^;]+)/);
    const headers = { 'X-IG-App-ID': '${IG_APP_ID}', 'X-Requested-With': 'XMLHttpRequest' };
    if (m) headers['X-CSRFToken'] = decodeURIComponent(m[1]);
    const init = { method: ${JSON.stringify(method)}, credentials: 'include', headers };
    const form = ${JSON.stringify(form)};
    if (form) {
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
      init.body = new URLSearchParams(form).toString();
    }
    try {
      const r = await fetch(${JSON.stringify(path)}, init);
      return { status: r.status, url: r.url, text: await r.text() };
    } catch (e) {
      return { status: 0, error: String(e), text: '' };
    }
  })()`;
  const res = await wc.executeJavaScript(script, true);
  let json = null;
  try { json = JSON.parse(res.text); } catch {}
  return { ...res, json };
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

// job.stopped 가 true 가 되면 즉시 false 반환. onTick(남은초) 콜백으로 카운트다운 표시.
async function sleep(ms, job, onTick) {
  const end = Date.now() + ms;
  let lastSec = -1;
  while (Date.now() < end) {
    if (job && job.stopped) return false;
    const sec = Math.ceil((end - Date.now()) / 1000);
    if (onTick && sec !== lastSec) { lastSec = sec; onTick(sec); }
    await new Promise((r) => setTimeout(r, Math.min(250, Math.max(0, end - Date.now()))));
  }
  return !(job && job.stopped);
}

function shortcodeFromUrl(url) {
  const m = String(url || '').match(/instagram\.com\/(?:[^/]+\/)?(?:p|reel|reels|tv)\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

module.exports = { HOME, isInstagramUrl, ensureOnInstagram, igApi, rand, sleep, shortcodeFromUrl };
