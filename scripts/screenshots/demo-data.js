// 스크린샷용 데모 데이터 (실존 계정/게시물 아님)
const THEMES = [
  { user: 'foodie.seoul', name: 'Seoul Food Notes', emoji: '🍜', c: ['#ff9a8b', '#ff6a88'], col: '맛집', caps: ['을지로 노포 국수 맛집, 웨이팅 30분 각오', '성수동 브런치 카페 리스트 저장용', '집에서 만드는 마라탕 레시피'] },
  { user: 'wander.daily', name: 'Wander Daily', emoji: '✈️', c: ['#89f7fe', '#66a6ff'], col: '여행', caps: ['교토 3박 4일 동선 정리', 'Lisbon sunset spots you shouldn\'t miss', '제주 동쪽 드라이브 코스'] },
  { user: 'studio.lab', name: 'Studio Lab', emoji: '🎨', c: ['#c471f5', '#fa71cd'], col: '레퍼런스', caps: ['Poster grid system study #typography', '브랜딩 컬러 팔레트 레퍼런스', 'UI micro-interaction ideas'] },
  { user: 'cat.archive', name: 'Cat Archive', emoji: '🐱', c: ['#fddb92', '#f6a04d'], col: '', caps: ['오늘의 고양이 식빵 자세', 'When the cat owns the keyboard', '창가 햇살 고양이'] },
  { user: 'trail.notes', name: 'Trail Notes', emoji: '🏔️', c: ['#a1ffce', '#3fbf8f'], col: '여행', caps: ['설악산 공룡능선 후기', 'Ultralight packing list 2026', '북한산 야간 산행 코스'] },
  { user: 'film.roll', name: 'Film Roll', emoji: '📷', c: ['#e0c3fc', '#8ec5fc'], col: '레퍼런스', caps: ['Portra 400 color study', '필름 스캔 보정 프리셋 공유', 'Street photography in Seoul'] },
  { user: 'home.cafe', name: 'Home Cafe', emoji: '☕', c: ['#d4a373', '#9c6644'], col: '맛집', caps: ['홈카페 라떼아트 연습 기록', 'Cold brew ratio cheat sheet', '원두 보관법 정리'] },
  { user: 'code.daily', name: 'Code Daily', emoji: '💻', c: ['#434343', '#1f6feb'], col: '공부', caps: ['Git rebase vs merge 한 장 정리', 'CSS grid auto-fill vs auto-fit', 'Electron 앱 배포 체크리스트'] },
];

const TYPES = [
  { media_type: 'photo', product_type: 'feed' },
  { media_type: 'carousel', product_type: 'carousel_container' },
  { media_type: 'video', product_type: 'clips' },
  { media_type: 'photo', product_type: 'feed' },
  { media_type: 'video', product_type: 'feed' },
];

const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
let seed = 7;
const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const code = () => 'C' + Array.from({ length: 10 }, () => ABC[Math.floor(rnd() * 64)]).join('');

function thumb(t, i) {
  const angle = (i * 37) % 360;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="320">
    <defs><linearGradient id="g" gradientTransform="rotate(${angle} .5 .5)"><stop offset="0" stop-color="${t.c[0]}"/><stop offset="1" stop-color="${t.c[1]}"/></linearGradient></defs>
    <rect width="320" height="320" fill="url(#g)"/>
    <circle cx="${60 + (i * 53) % 200}" cy="${70 + (i * 29) % 180}" r="${40 + (i % 4) * 14}" fill="#fff" opacity=".14"/>
    <text x="160" y="190" font-size="110" text-anchor="middle" font-family="Segoe UI Emoji">${t.emoji}</text>
  </svg>`;
  return 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
}

function rows(n = 64) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = THEMES[(i * 3 + Math.floor(i / 8)) % THEMES.length];
    const ty = TYPES[i % TYPES.length];
    const d = new Date(Date.UTC(2026, 8 - Math.floor(i / 6), 28 - (i % 27)));
    const cols = [t.col, i % 11 === 0 ? '나중에 보기' : ''].filter(Boolean);
    out.push({
      saved_index: i,
      shortcode: code(),
      url: '',
      media_pk: String(3400000000000000000n + BigInt(i * 7919)),
      username: t.user,
      full_name: t.name,
      media_type: ty.media_type,
      product_type: ty.product_type,
      taken_at: d.toISOString(),
      caption: t.caps[i % t.caps.length] + (i % 2 ? ' #저장 #기록' : ''),
      collection_ids: '',
      collection_names: cols.join('|'),
      thumbnail_url: thumb(t, i),
    });
  }
  out.forEach((r) => { r.url = `https://www.instagram.com/${r.product_type === 'clips' ? 'reel' : 'p'}/${r.shortcode}/`; });
  return out;
}

module.exports = { rows, thumb, THEMES };
