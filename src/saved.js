// 로그인한 계정의 "저장됨" 목록 조회 / CSV 내보내기
const { igApi, rand, sleep } = require('./ig');
const { writeCsv } = require('./csv');

const COLUMNS = [
  'saved_index', 'shortcode', 'url', 'media_pk', 'username', 'full_name',
  'media_type', 'product_type', 'taken_at', 'caption', 'collection_ids', 'collection_names', 'thumbnail_url',
];
const MEDIA_TYPES = { 1: 'photo', 2: 'video', 8: 'carousel' };

async function fetchCollections(wc, job, log) {
  const map = new Map();
  let maxId = '';
  const types = encodeURIComponent('["ALL_MEDIA_AUTO_COLLECTION","MEDIA","AUDIO_AUTO_COLLECTION"]');
  for (let i = 0; i < 50 && !job.stopped; i++) {
    const r = await igApi(wc, `/api/v1/collections/list/?collection_types=${types}&include_public_only=0&get_cover_media_lists=false&max_id=${encodeURIComponent(maxId)}`);
    if (r.status !== 200 || !r.json) { log(`컬렉션 목록 조회 실패 (HTTP ${r.status}) — 컬렉션 정보 없이 진행합니다.`); break; }
    for (const c of r.json.items || []) {
      if (c.collection_type === 'ALL_MEDIA_AUTO_COLLECTION') continue;
      map.set(String(c.collection_id), c.collection_name);
    }
    if (!r.json.more_available || !r.json.next_max_id) break;
    maxId = r.json.next_max_id;
    await sleep(rand(800, 1600), job);
  }
  return map;
}

function thumbnailOf(media) {
  const src = media.image_versions2 ? media : media.carousel_media?.[0];
  const cands = src?.image_versions2?.candidates || [];
  if (!cands.length) return '';
  const fit = cands.filter((c) => c.width >= 240).sort((a, b) => a.width - b.width)[0];
  return (fit || cands[0]).url;
}

function toRow(media, index, collections) {
  const code = media.code;
  const isReel = media.product_type === 'clips';
  const colIds = (media.saved_collection_ids || []).map(String);
  return {
    saved_index: index,
    shortcode: code,
    url: `https://www.instagram.com/${isReel ? 'reel' : 'p'}/${code}/`,
    media_pk: media.pk ?? (media.id ? String(media.id).split('_')[0] : ''),
    username: media.user?.username ?? '',
    full_name: media.user?.full_name ?? '',
    media_type: MEDIA_TYPES[media.media_type] ?? media.media_type ?? '',
    product_type: media.product_type ?? '',
    taken_at: media.taken_at ? new Date(media.taken_at * 1000).toISOString() : '',
    caption: media.caption?.text ?? '',
    collection_ids: colIds.join('|'),
    collection_names: colIds.map((id) => collections.get(id) || '').filter(Boolean).join('|'),
    thumbnail_url: thumbnailOf(media),
  };
}

// 저장됨 전체를 페이지 단위로 수집. onPage(rows) 는 페이지마다 호출(중간 저장용)
async function fetchSaved({ wc, job, log, progress, onPage }) {
  log('컬렉션 목록 확인 중…');
  const collections = await fetchCollections(wc, job, log);
  if (collections.size) log(`컬렉션 ${collections.size}개: ${[...collections.values()].join(', ')}`);

  const rows = [];
  const seen = new Set();
  let maxId = '';
  let page = 0;
  let retries = 0;

  while (!job.stopped) {
    const path = '/api/v1/feed/saved/posts/' + (maxId ? `?max_id=${encodeURIComponent(maxId)}` : '');
    const r = await igApi(wc, path);

    if (r.status !== 200 || !r.json || r.json.status === 'fail') {
      const msg = r.json?.message || r.error || (r.text || '').slice(0, 200);
      if ((r.status === 429 || r.status === 0 || r.status >= 500) && retries < 4) {
        retries++;
        const wait = 60000 * retries;
        log(`HTTP ${r.status} — ${wait / 1000}초 후 재시도 (${retries}/4)`);
        if (!(await sleep(wait, job))) break;
        continue;
      }
      if (r.status === 401 || r.status === 403 || /login_required|checkpoint/i.test(msg)) {
        log(`⚠ 로그인/인증이 필요합니다 (HTTP ${r.status}: ${msg}). 오른쪽 화면에서 확인 후 다시 시도하세요.`);
      } else {
        log(`⚠ 요청 실패 (HTTP ${r.status}): ${msg}`);
      }
      job.error = true;
      break;
    }
    retries = 0;
    page++;

    let added = 0;
    for (const it of r.json.items || []) {
      const media = it.media || it;
      if (!media || !media.code || seen.has(media.code)) continue;
      seen.add(media.code);
      rows.push(toRow(media, rows.length, collections));
      added++;
    }
    if (onPage) onPage(rows);
    progress({ count: rows.length, page });
    log(`페이지 ${page}: +${added} (누적 ${rows.length})`);

    if (!r.json.more_available || !r.json.next_max_id) break;
    maxId = r.json.next_max_id;
    if (!(await sleep(rand(1500, 3500), job))) break;
  }
  return { rows, complete: !job.stopped && !job.error };
}

function writeSavedCsv(file, rows) {
  writeCsv(file, COLUMNS, rows);
}

module.exports = { fetchSaved, writeSavedCsv, COLUMNS };
