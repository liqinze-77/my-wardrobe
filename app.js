/* ============================================================
   我的衣柜 · 本地优先的衣物管理与搭配工具
   数据全部保存在浏览器 IndexedDB 中，不联网、不上传
   ============================================================ */

/* ---------- 常量配置 ---------- */
const TYPES = ['上装', '下装', '连衣裙', '外套', '鞋', '包', '配饰'];
const SEASONS = ['春', '夏', '秋', '冬'];
const STYLES = ['日常', '通勤', '休闲', '运动', '甜美', '复古', '街头', '正式', '度假'];
const COLORS = [
  { name: '黑', hex: '#1c1c1e' }, { name: '白', hex: '#f5f5f3' },
  { name: '灰', hex: '#9a9a9d' }, { name: '米', hex: '#ded3bd' },
  { name: '棕', hex: '#8a6244' }, { name: '卡其', hex: '#c2ab84' },
  { name: '红', hex: '#c33b39' }, { name: '酒红', hex: '#7b2d3a' },
  { name: '粉', hex: '#e8a7b8' }, { name: '橙', hex: '#d97a3a' },
  { name: '黄', hex: '#e2bd43' }, { name: '绿', hex: '#5f8355' },
  { name: '军绿', hex: '#6b6f4e' }, { name: '蓝', hex: '#3f6ca8' },
  { name: '藏青', hex: '#2c3a56' }, { name: '紫', hex: '#7b5fa8' }
];
const TYPE_ICON = { 上装: '👕', 下装: '👖', 连衣裙: '👗', 外套: '🧥', 鞋: '👟', 包: '👜', 配饰: '💍' };
const SEASON_ICON = { 春: '🌸', 夏: '☀️', 秋: '🍂', 冬: '❄️' };

/* 自定义风格标签（存 meta store） */
let customStyles = [];

/* 全部风格 = 内置 + 自定义 */
const allStyles = () => [...STYLES, ...customStyles];

/* 颜色名 → hex：'#xxxxxx' 形式的自定义色直接用自身，其余查内置色板 */
function colorHex(name) {
  if (typeof name === 'string' && name.startsWith('#')) return name;
  const c = COLORS.find((x) => x.name === name);
  return c ? c.hex : '#cccccc';
}

/* 颜色的显示名：hex 形式统一显示为「自定义色」 */
function colorLabel(name) {
  return (typeof name === 'string' && name.startsWith('#')) ? '自定义色' : name;
}

/* 收集所有衣物里出现过的自定义色（hex），供色板展示 */
function collectCustomHexes(extra = []) {
  const set = new Set(extra.filter((c) => typeof c === 'string' && c.startsWith('#')));
  state.garments.forEach((g) => garmentColors(g).forEach((c) => {
    if (typeof c === 'string' && c.startsWith('#')) set.add(c);
  }));
  return [...set];
}

/* 统一取一件衣物的颜色数组（兼容旧版单色 color 字段） */
function garmentColors(g) {
  if (Array.isArray(g.colors) && g.colors.length) return g.colors;
  if (g.color) return [g.color];
  return [];
}

/* ---------- IndexedDB 封装 ---------- */
const DB_NAME = 'wardrobe-db';
const DB_VER = 2;
let db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = (e) => {
      const d = e.target.result;
      if (!d.objectStoreNames.contains('garments')) {
        const s = d.createObjectStore('garments', { keyPath: 'id' });
        s.createIndex('createdAt', 'createdAt');
      }
      if (!d.objectStoreNames.contains('outfits')) {
        const s = d.createObjectStore('outfits', { keyPath: 'id' });
        s.createIndex('createdAt', 'createdAt');
      }
      if (!d.objectStoreNames.contains('meta')) {
        d.createObjectStore('meta', { keyPath: 'key' });
      }
      if (!d.objectStoreNames.contains('me')) {
        d.createObjectStore('me', { keyPath: 'id' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(store, mode, fn) {
  return new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    const r = fn(s);
    if (r) r.onsuccess = () => { result = r.result; };
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
  });
}

const dbAll = (store) => tx(store, 'readonly', (s) => s.getAll());
const dbGet = (store, id) => tx(store, 'readonly', (s) => s.get(id));
const dbPut = (store, val) => tx(store, 'readwrite', (s) => s.put(val));
const dbDel = (store, id) => tx(store, 'readwrite', (s) => s.delete(id));
const dbClear = (store) => tx(store, 'readwrite', (s) => s.clear());

/* ---------- 全局状态 ---------- */
const state = {
  garments: [],
  outfits: [],
  mePhotos: [],
  filters: { search: '', type: '', color: '', season: '', style: '', location: '' },
  sort: 'new',
  editingId: null,
  photoBlobs: [],      // 当前表单的多张图（Blob）
  photoUrls: [],       // 对应的 objectURL
  photoOriginals: [],  // 抠图前的原图（用于恢复）
  mainPhotoIndex: 0,
  paletteFilter: '',
  // 画布元素：{gid, img(Image), x, y, scale, rot, flip, z, isMe}
  elements: [],
  selected: -1,
  canvasBg: '#ffffff',
  editingOutfitId: null,
  dragging: null
};

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => [...document.querySelectorAll(sel)];

/* ---------- 工具函数 ---------- */
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(t._timer);
  t._timer = setTimeout(() => { t.hidden = true; }, 2200);
}

function fmtDate(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
}

function isLight(hex) {
  const c = hex.replace('#', '');
  const r = parseInt(c.slice(0, 2), 16), g = parseInt(c.slice(2, 4), 16), b = parseInt(c.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) > 165;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

/* ---------- 图片处理 ---------- */
// 压缩图片：最长边限制在 max，输出 webp Blob
function fileToImage(file) {
  return new Promise((resolve, reject) => {
    if (window.createImageBitmap) {
      createImageBitmap(file).then(resolve).catch(reject);
      return;
    }
    // 兼容旧版 Safari：走 Image 解码
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('decode fail')); };
    img.src = url;
  });
}

async function compressImage(file, max = 900, quality = 0.82) {
  const bitmap = await fileToImage(file);
  let { width: w, height: h } = bitmap;
  const ratio = Math.min(1, max / Math.max(w, h));
  w = Math.round(w * ratio); h = Math.round(h * ratio);
  const cv = document.createElement('canvas');
  cv.width = w; cv.height = h;
  const ctx = cv.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();
  // webp 优先，不支持时退回 jpeg
  return new Promise((res) => {
    cv.toBlob((b) => res(b || file), cv.toDataURL('image/webp').startsWith('data:image/webp') ? 'image/webp' : 'image/jpeg', quality);
  });
}

/* Blob → ObjectURL，用 WeakMap 缓存，避免重复渲染时泄漏 */
const _urlCache = new WeakMap();
function blobUrl(blob) {
  if (!blob) return '';
  if (_urlCache.has(blob)) return _urlCache.get(blob);
  const u = URL.createObjectURL(blob);
  _urlCache.set(blob, u);
  return u;
}

/* ---------- 一键抠图（调用本地服务端模型） ---------- */
/* 静态托管（如 GitHub Pages）没有后端：先探测同源，再回退远程抠图服务 */
let _rmbgAvailable = null; // null=探测中 true=可用 false=不可用
let _rmbgBase = '';        // 抠图 API 基地址（空=同源）
const REMOTE_RMBG_BASE = ''; // EdgeOne 部署后的地址（如 https://my-wardrobe.xxx），供 GitHub Pages 镜像回退；EdgeOne 主入口无需填写
const REMOTE_RMBG_TOKEN = ''; // 魔搭访问令牌（modelscope.cn/my/myaccesstoken 获取，ms- 开头）；留空则不鉴权
function rmbgUrl(path) {
  let url = _rmbgBase + path;
  if (_rmbgBase && REMOTE_RMBG_TOKEN) url += (url.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(REMOTE_RMBG_TOKEN);
  return url;
}
const canRmbg = () => location.protocol !== 'file:' && navigator.onLine !== false && _rmbgAvailable !== false;

async function probeRmbg() {
  const candidates = ['', REMOTE_RMBG_BASE];
  for (const base of candidates) {
    try {
      _rmbgBase = base;
      const res = await fetch(rmbgUrl('/api/health'), { signal: AbortSignal.timeout(4000) });
      if (res.ok) { _rmbgAvailable = true; break; }
    } catch {}
  }
  if (_rmbgAvailable !== true) {
    _rmbgAvailable = false;
    document.querySelectorAll('#btnRmbg, [data-meop="rmbg"]').forEach((el) => {
      el.disabled = true;
      el.title = '抠图服务暂时不可用，请稍后重试或自托管部署';
    });
  }
}

function rmbgUnavailableMsg() {
  return '当前为静态托管版本（无后端），不支持在线 AI 抠图。\n请参照项目 README 自托管部署（支持 Render/Railway 一键部署），或使用其他图片工具抠图后上传。';
}

async function apiRemoveBg(blob) {
  const fd = new FormData();
  fd.append('file', blob, 'photo.webp');
  const res = await fetch(rmbgUrl('/api/rmbg'), { method: 'POST', body: fd });
  if (!res.ok) throw new Error('服务端抠图失败 ' + res.status);
  return await res.blob();
}

/* 生成搭配缩略图 */
function makeThumb(sourceCanvas, size = 420) {
  const cv = document.createElement('canvas');
  cv.width = size; cv.height = size;
  const ctx = cv.getContext('2d');
  ctx.drawImage(sourceCanvas, 0, 0, size, size);
  return new Promise((res) => cv.toBlob((b) => res(b), 'image/webp', 0.85));
}

/* ============================================================
   渲染：衣物列表
   ============================================================ */
function filteredGarments() {
  const f = state.filters;
  const kw = f.search.trim().toLowerCase();
  let list = state.garments.filter((g) => {
    if (f.type && g.type !== f.type) return false;
    // 颜色多选：只要包含所选颜色即命中
    if (f.color && !garmentColors(g).includes(f.color)) return false;
    if (f.season && !(g.seasons || []).includes(f.season)) return false;
    if (f.style && !(g.styles || []).includes(f.style)) return false;
    if (f.location && g.location !== f.location) return false;
    if (kw) {
      const hay = `${g.name} ${g.note || ''} ${g.location || ''} ${(g.styles || []).join(' ')}`.toLowerCase();
      if (!hay.includes(kw)) return false;
    }
    return true;
  });
  const s = state.sort;
  list.sort((a, b) => {
    if (s === 'old') return a.createdAt - b.createdAt;
    if (s === 'name') return (a.name || '').localeCompare(b.name || '', 'zh');
    if (s === 'wear') return (b.wearCount || 0) - (a.wearCount || 0);
    return b.createdAt - a.createdAt;
  });
  return list;
}

function renderStats() {
  const gs = state.garments;
  const locs = new Set(gs.map((g) => g.location).filter(Boolean));
  const byType = {};
  gs.forEach((g) => { byType[g.type] = (byType[g.type] || 0) + 1; });
  const topType = Object.entries(byType).sort((a, b) => b[1] - a[1])[0];
  $('#stats').innerHTML = `
    <div class="stat"><b>${gs.length}</b><span>件衣物</span></div>
    <div class="stat"><b>${locs.size}</b><span>个收纳处</span></div>
    <div class="stat"><b>${state.outfits.length}</b><span>套搭配</span></div>
    ${topType ? `<div class="stat"><b>${TYPE_ICON[topType[0]] || ''} ${topType[1]}</b><span>最多的 ${topType[0]}</span></div>` : ''}
  `;
}

function renderFilters() {
  const gs = state.garments;
  const countBy = (fn) => {
    const m = {};
    gs.forEach((g) => [].concat(fn(g) || []).filter(Boolean).forEach((k) => { m[k] = (m[k] || 0) + 1; }));
    return m;
  };
  const cType = countBy((g) => g.type);
  const cColor = countBy((g) => garmentColors(g));
  const cSeason = countBy((g) => g.seasons);
  const cStyle = countBy((g) => g.styles);
  const locs = [...new Set(gs.map((g) => g.location).filter(Boolean))];
  const f = state.filters;

  const line = (label, items, cur, key, render) => {
    const chips = items.map(([val, n, extra]) => {
      const on = cur === val ? ' on' : '';
      return `<button class="chip${on}" data-fkey="${key}" data-fval="${esc(val)}">${render ? render(val) : esc(val)}<span class="n">${n}</span></button>`;
    }).join('');
    return `<div class="filter-line"><span class="label">${label}</span>${chips}</div>`;
  };

  const typeItems = TYPES.filter((t) => cType[t]).map((t) => [t, cType[t], null]);
  // 颜色：内置色板 + 自定义色（hex），按数量显示
  const colorNames = [...new Set([...COLORS.map((c) => c.name), ...Object.keys(cColor)])];
  const colorItems = colorNames.filter((c) => cColor[c]).map((c) => [c, cColor[c], colorHex(c)]);
  const seasonItems = SEASONS.filter((s) => cSeason[s]).map((s) => [s, cSeason[s], null]);
  // 风格：内置 + 自定义，有使用的才显示
  const styleItems = allStyles().filter((s) => cStyle[s]).map((s) => [s, cStyle[s], null]);
  const locItems = locs.map((l) => [l, gs.filter((g) => g.location === l).length, null]);

  $('#filterGroup').innerHTML =
    (typeItems.length ? line('类型', typeItems, f.type, 'type', (v) => `${TYPE_ICON[v] || ''} ${v}`) : '') +
    (colorItems.length ? line('颜色', colorItems, f.color, 'color', (v) => `<i class="dot" style="background:${colorHex(v)}"></i>${esc(colorLabel(v))}`) : '') +
    (seasonItems.length ? line('季节', seasonItems, f.season, 'season', (v) => `${SEASON_ICON[v] || ''} ${v}`) : '') +
    (styleItems.length ? line('风格', styleItems, f.style, 'style') : '') +
    (locItems.length ? line('存放', locItems, f.location, 'location') : '');

  // 已选筛选提示
  const active = Object.entries(f).filter(([k, v]) => v && k !== 'search');
  $('#filterActive').innerHTML = active.length
    ? `<span class="muted small">已筛选：</span>` + active.map(([k, v]) => `<button class="chip on" data-fkey="${k}" data-fval="${esc(v)}">${k === 'color' ? `<i class="dot" style="background:${colorHex(v)}"></i>` : ''}${esc(v)} ✕</button>`).join('')
    + `<button class="clear" id="clearFilters">清除全部</button>`
    : '';
}

function renderGrid() {
  const list = filteredGarments();
  const grid = $('#garmentGrid');
  $('#garmentEmpty').hidden = state.garments.length > 0;
  grid.style.display = state.garments.length ? '' : 'none';

  if (!state.garments.length) return;
  if (!list.length) {
    grid.innerHTML = `<div style="grid-column:1/-1;text-align:center;padding:60px 0;color:var(--text-3);font-size:14px">没有符合条件的衣物，换个筛选试试～</div>`;
    return;
  }
  grid.innerHTML = list.map((g) => {
    const seasons = (g.seasons || []).map((s) => SEASON_ICON[s]).join('');
    const cols = garmentColors(g);
    const dots = cols.length
      ? `<span class="dots">${cols.map((c) => `<i class="dot" style="background:${colorHex(c)}"></i>`).join('')}</span>`
      : '';
    return `<div class="card" data-id="${g.id}">
      <div class="card-img">
        ${g.photo ? `<img src="${blobUrl(g.photo)}" alt="${esc(g.name)}" loading="lazy">` : `<div class="noimg">${TYPE_ICON[g.type] || '👕'}</div>`}
        ${cols.length ? `<div class="card-badge">${dots}<span class="cname">${esc(cols.map(colorLabel).join('·'))}</span></div>` : ''}
      </div>
      <div class="card-body">
        <div class="card-title">${esc(g.name || '未命名')}</div>
        <div class="card-meta">
          <div class="row">${TYPE_ICON[g.type] || ''} ${esc(g.type || '')} ${seasons}</div>
          ${g.location ? `<div class="row card-loc">📍 ${esc(g.location)}</div>` : ''}
        </div>
        ${(g.styles || []).length ? `<div class="card-tags">${g.styles.slice(0, 3).map((s) => `<span class="mini-tag">${esc(s)}</span>`).join('')}</div>` : ''}
      </div>
    </div>`;
  }).join('');
}

function renderAll() {
  renderStats();
  renderFilters();
  renderGrid();
  renderPalette();
}

/* ============================================================
   衣物弹窗
   ============================================================ */
function chipHTML(list, selected, key, iconMap) {
  return list.map((v) => {
    const on = [].concat(selected).includes(v) ? ' on' : '';
    const icon = iconMap && iconMap[v] ? iconMap[v] + ' ' : '';
    return `<button type="button" class="chip${on}" data-chip="${key}" data-val="${esc(v)}">${icon}${esc(v)}</button>`;
  }).join('');
}

function renderColorSwatches(selected) {
  const sel = [].concat(selected || []);
  const builtin = COLORS.map((c) =>
    `<button type="button" class="sw${sel.includes(c.name) ? ' on' : ''}" data-color="${c.name}" style="background:${c.hex}" title="${c.name}"></button>`
  ).join('');
  // 曾用过的自定义色（hex），追加为可复选的色块
  const customs = collectCustomHexes(sel).map((hex) =>
    `<button type="button" class="sw${sel.includes(hex) ? ' on' : ''}" data-color="${hex}" style="background:${hex}" title="自定义色"></button>`
  ).join('');
  return builtin + customs;
}

/* 风格区：内置 + 自定义 + 新增按钮 */
function renderStyleChips(selected) {
  const sel = [].concat(selected || []);
  const chips = allStyles().map((v) =>
    `<button type="button" class="chip${sel.includes(v) ? ' on' : ''}" data-chip="style" data-val="${esc(v)}">${esc(v)}${customStyles.includes(v) ? `<span class="del-tag" data-deltag="${esc(v)}" title="删除这个自定义标签">✕</span>` : ''}</button>`
  ).join('');
  return chips + `<button type="button" class="chip add-chip" id="btnAddStyle">＋ 自定义</button>`;
}

function openGarmentModal(id = null) {
  state.editingId = id;
  state.photoBlobs = [];
  state.photoUrls = [];
  state.photoOriginals = [];
  state.mainPhotoIndex = 0;

  const g = id ? state.garments.find((x) => x.id === id) : null;
  $('#garmentModalTitle').textContent = g ? '编辑衣物' : '添加衣物';
  $('#btnDeleteGarment').hidden = !g;
  $('#btnWear').hidden = !g;
  if (g) $('#btnWear').textContent = `✓ 今天穿了（已穿 ${g.wearCount || 0} 次）`;

  $('#gName').value = g?.name || '';
  $('#gLocation').value = g?.location || '';
  $('#gNote').value = g?.note || '';
  $('#gColorCustom').value = '#888888';
  $('#gColorCustom').dataset.custom = '';
  $('.custom-color')?.classList.remove('on');

  // 已有照片
  if (g?.photo) {
    state.photoBlobs = [g.photo];
    state.photoUrls = [blobUrl(g.photo)];
    state.photoOriginals = [null]; // 存库时已丢失原图，不提供恢复
  }

  const selColors = garmentColors(g || {});
  $('#gType').innerHTML = chipHTML(TYPES, g?.type || '', 'type', TYPE_ICON);
  $('#gSeason').innerHTML = chipHTML(SEASONS, g?.seasons || [], 'season', SEASON_ICON);
  $('#gStyle').innerHTML = renderStyleChips(g?.styles || []);
  $('#gColorSwatches').innerHTML = renderColorSwatches(selColors);

  // 类型单选：选中后再点取消
  $('#gType').dataset.single = 'true';
  updatePhotoUI();
  renderLocationOptions();
  $('#modalGarment').hidden = false;
}

/* 新增自定义风格标签 */
async function addCustomStyle() {
  const val = prompt('输入新的风格标签名称（如：JK、汉服、约会战袍）');
  if (val === null) return;
  const name = val.trim();
  if (!name) return;
  if (name.length > 8) { toast('标签名称请控制在 8 个字以内'); return; }
  if (allStyles().includes(name)) { toast('这个标签已经存在啦'); return; }
  customStyles.push(name);
  await dbPut('meta', { key: 'customStyles', value: customStyles });
  // 新标签自动选中
  const on = $$('#gStyle .chip.on').map((c) => c.dataset.val);
  on.push(name);
  $('#gStyle').innerHTML = renderStyleChips(on);
  toast(`已添加标签「${name}」`);
}

/* 删除自定义风格标签 */
async function delCustomStyle(name) {
  if (!customStyles.includes(name)) return;
  if (!confirm(`删除自定义标签「${name}」？\n已使用该标签的衣物会保留标签文字。`)) return;
  customStyles = customStyles.filter((s) => s !== name);
  // 已选中的也去掉
  const on = $$('#gStyle .chip.on').map((c) => c.dataset.val).filter((v) => v !== name);
  await dbPut('meta', { key: 'customStyles', value: customStyles });
  $('#gStyle').innerHTML = renderStyleChips(on);
  renderFilters();
  toast(`已删除「${name}」`);
}

function renderLocationOptions() {
  const locs = [...new Set(state.garments.map((g) => g.location).filter(Boolean))];
  $('#locationList').innerHTML = locs.map((l) => `<option value="${esc(l)}">`).join('');
}

function updatePhotoUI() {
  const has = state.photoBlobs.length > 0;
  $('#photoPlaceholder').hidden = has;
  const img = $('#photoPreview');
  img.hidden = !has;
  if (has) {
    img.src = state.photoUrls[state.mainPhotoIndex] || state.photoUrls[0];
  }
  // 缩略图
  const thumbs = $('#photoThumbs');
  thumbs.innerHTML = state.photoBlobs.slice(0, 6).map((b, i) =>
    `<div class="t${i === state.mainPhotoIndex ? ' on' : ''}" data-pi="${i}"><img src="${state.photoUrls[i]}"></div>`
  ).join('') + (state.photoBlobs.length > 0
    ? `<div class="t more" id="addMorePhoto">+</div>` : '');
  // 抠图按钮
  $('#photoActions').hidden = !has;
  $('#btnUndoRmbg').hidden = !state.photoOriginals[state.mainPhotoIndex];
}

async function handlePhotoFiles(files) {
  const arr = [...files].filter((f) => f.type.startsWith('image/'));
  if (!arr.length) return;
  toast('正在压缩图片…');
  for (const f of arr.slice(0, 8)) {
    try {
      const blob = await compressImage(f);
      state.photoBlobs.push(blob);
      state.photoUrls.push(blobUrl(blob));
      state.photoOriginals.push(blob); // 原图备份
    } catch (e) { console.warn('图片处理失败', e); }
  }
  updatePhotoUI();
}

async function doRmbg() {
  const i = state.mainPhotoIndex;
  const src = state.photoBlobs[i];
  if (!src) return;
  if (!canRmbg()) { toast(_rmbgAvailable === false ? rmbgUnavailableMsg() : '离线状态无法抠图，请联网后重试'); return; }
  const btn = $('#btnRmbg');
  btn.disabled = true;
  btn.textContent = '✂️ 抠图中…';
  try {
    const t = Date.now();
    const out = await apiRemoveBg(src);
    if (!state.photoOriginals[i]) state.photoOriginals[i] = src;
    state.photoBlobs[i] = out;
    state.photoUrls[i] = blobUrl(out);
    updatePhotoUI();
    toast(`抠图完成 ✨ 用时 ${((Date.now() - t) / 1000).toFixed(1)} 秒`);
  } catch (e) {
    console.warn(e);
    toast('抠图失败：' + (location.protocol === 'file:' ? '本地文件方式无抠图服务' : '请稍后重试'));
  } finally {
    btn.disabled = false;
    btn.textContent = '✂️ 一键去背景';
  }
}

function undoRmbg() {
  const i = state.mainPhotoIndex;
  const orig = state.photoOriginals[i];
  if (!orig) return;
  state.photoBlobs[i] = orig;
  state.photoUrls[i] = blobUrl(orig);
  state.photoOriginals[i] = null;
  updatePhotoUI();
  toast('已恢复原图');
}

async function saveGarment() {
  const name = $('#gName').value.trim();
  const type = $('#gType .chip.on')?.dataset.val || '';
  // 颜色多选：色板 + 自定义取色器（hex 直接作为颜色标识，不会互相覆盖）
  const colors = $$('#gColorSwatches .sw.on').map((s) => s.dataset.color);
  const customHex = $('#gColorCustom').dataset.custom;
  if (customHex && !colors.includes(customHex)) colors.push(customHex);
  const seasons = $$('#gSeason .chip.on').map((c) => c.dataset.val);
  const styles = $$('#gStyle .chip.on').map((c) => c.dataset.val);
  const location = $('#gLocation').value.trim();
  const note = $('#gNote').value.trim();

  if (!name) { toast('给这件衣服起个名字吧'); $('#gName').focus(); return; }
  if (!type) { toast('选一下类型吧'); return; }

  const photo = state.photoBlobs[state.mainPhotoIndex] || state.photoBlobs[0] || null;

  const exist = state.editingId ? state.garments.find((g) => g.id === state.editingId) : null;
  const item = {
    id: exist?.id || uid(),
    name, type,
    colors,                    // 新版：颜色数组
    color: colors[0] || '',    // 兼容旧字段
    seasons, styles, location, note,
    photo,
    wearCount: exist?.wearCount || 0,
    createdAt: exist?.createdAt || Date.now(),
    updatedAt: Date.now()
  };
  await dbPut('garments', item);
  await loadAll();
  $('#modalGarment').hidden = true;
  toast(exist ? '已保存修改' : '已加入衣柜 ✨');
  renderAll();
}

/* ============================================================
   搭配页：衣物篮
   ============================================================ */
function renderPalette() {
  // 类型快捷筛选
  const used = TYPES.filter((t) => state.garments.some((g) => g.type === t));
  $('#paletteFilter').innerHTML = `<button class="mini-chip${state.paletteFilter === '' ? ' on' : ''}" data-pf="">全部</button>` +
    used.map((t) => `<button class="mini-chip${state.paletteFilter === t ? ' on' : ''}" data-pf="${t}">${t}</button>`).join('');

  const kw = ($('#paletteSearch').value || '').trim().toLowerCase();
  const list = state.garments.filter((g) => {
    if (state.paletteFilter && g.type !== state.paletteFilter) return false;
    if (kw && !`${g.name} ${g.color} ${(g.styles || []).join('')}`.toLowerCase().includes(kw)) return false;
    return true;
  });
  const meHtml = state.mePhotos.map((m) => `
    <div class="palette-item me" data-me="${m.id}" draggable="true">
      <div class="pimg"><img src="${blobUrl(m.photo)}" loading="lazy"></div>
      <div class="pname">${esc(m.name || '我的照片')}</div>
      <div class="me-ops">
        <button class="me-op" data-meop="rmbg" title="去背景">✂️</button>
        <button class="me-op" data-meop="del" title="删除">🗑</button>
      </div>
    </div>`).join('');
  const meUpload = `
    <div class="palette-item me upload" id="meUpload" title="上传我的照片">
      <div class="pimg up"><span>＋</span></div>
      <div class="pname">我的照片</div>
    </div>`;
  $('#paletteList').innerHTML = meUpload + meHtml + list.map((g) => `
    <div class="palette-item" data-gid="${g.id}" draggable="true">
      <div class="pimg">${g.photo ? `<img src="${blobUrl(g.photo)}" loading="lazy">` : `<div class="noimg">${TYPE_ICON[g.type] || '👕'}</div>`}</div>
      <div class="pname">${esc(g.name)}</div>
    </div>`).join('');
}

/* ============================================================
   搭配页：画布
   ============================================================ */
const stage = $('#stage');
const ctx = stage.getContext('2d');

/* 画布显示尺寸适配：JS 计算，规避 grid 内百分比高度解析失效 */
function fitStage() {
  const parent = stage.parentElement;
  const cs = getComputedStyle(parent);
  const availW = parent.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  const availH = parent.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  const s = Math.max(120, Math.min(availW, availH));
  stage.style.width = s + 'px';
  stage.style.height = s + 'px';
}
window.addEventListener('resize', fitStage);

function drawCanvas() {
  const W = stage.width, H = stage.height;
  ctx.save();
  ctx.fillStyle = state.canvasBg;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();

  // 元素按 z 排序绘制
  const ordered = state.elements.map((el, i) => ({ el, i })).sort((a, b) => a.el.z - b.el.z);
  for (const { el, i } of ordered) {
    if (!el.img || !el.img.complete || !el.img.naturalWidth) continue;
    const w = el.baseW * el.scale;
    const h = el.baseH * el.scale;
    ctx.save();
    ctx.translate(el.x, el.y);
    ctx.rotate((el.rot * Math.PI) / 180);
    ctx.scale(el.flip ? -1 : 1, 1);
    ctx.drawImage(el.img, -w / 2, -h / 2, w, h);
    ctx.restore();

    // 选中框
    if (i === state.selected) {
      ctx.save();
      ctx.translate(el.x, el.y);
      ctx.rotate((el.rot * Math.PI) / 180);
      ctx.strokeStyle = '#b8754a';
      ctx.lineWidth = 2.5;
      ctx.setLineDash([8, 6]);
      ctx.strokeRect(-w / 2 - 5, -h / 2 - 5, w + 10, h + 10);
      ctx.setLineDash([]);
      // 右下角缩放手柄
      ctx.fillStyle = '#b8754a';
      ctx.beginPath();
      ctx.arc(w / 2 + 5, h / 2 + 5, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.moveTo(w / 2 + 1, h / 2 + 9); ctx.lineTo(w / 2 + 9, h / 2 + 1);
      ctx.moveTo(w / 2 + 5, h / 2 + 9); ctx.lineTo(w / 2 + 9, h / 2 + 5);
      ctx.stroke();
      ctx.restore();
    }
  }
  $('#canvasHint').hidden = state.elements.length > 0;
}

function addToCanvas(gid, atX, atY) {
  const isMe = gid.startsWith('me_');
  let photo, name;
  if (isMe) {
    const m = state.mePhotos.find((x) => x.id === gid.slice(3));
    if (!m) return;
    photo = m.photo; name = m.name || '我的照片';
  } else {
    const g = state.garments.find((x) => x.id === gid);
    if (!g) return;
    if (!g.photo) { toast('这件衣物没有照片，无法加入画布'); return; }
    photo = g.photo; name = g.name;
  }
  const url = blobUrl(photo);
  const img = new Image();
  img.onload = () => {
    let baseW, baseH, z, x0, y0;
    if (isMe) {
      // 人物照片：高度撑到画布 78%，居中偏下，垫底
      const ratio = (stage.height * 0.78) / img.naturalHeight;
      baseW = img.naturalWidth * ratio;
      baseH = img.naturalHeight * ratio;
      x0 = stage.width / 2;
      y0 = stage.height * 0.55;
      z = 0;
      // 若已有人物垫底，新人物放最上层但仍在衣服之下
      if (state.elements.some((e) => e.isMe)) {
        z = Math.max(...state.elements.map((e) => e.isMe ? e.z : -1)) + 0.5;
      }
    } else {
      // 衣物：最长边不超过画布的 42%
      const maxSide = stage.width * 0.42;
      const ratio = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
      baseW = img.naturalWidth * ratio;
      baseH = img.naturalHeight * ratio;
      x0 = atX ?? stage.width / 2;
      y0 = atY ?? stage.height / 2;
      z = state.elements.length ? Math.max(...state.elements.map((e) => e.z), 0) + 1 : 1;
    }
    const el = {
      gid,
      img,
      isMe,
      baseW, baseH,
      x: x0, y: y0,
      scale: 1, rot: 0, flip: false,
      z
    };
    state.elements.push(el);
    state.selected = state.elements.length - 1;
    drawCanvas();
  };
  img.onerror = () => toast('图片加载失败');
  img.src = url;
}

/* 画布坐标换算 */
function stagePos(evt) {
  const rect = stage.getBoundingClientRect();
  const cx = evt.touches ? evt.touches[0].clientX : evt.clientX;
  const cy = evt.touches ? evt.touches[0].clientY : evt.clientY;
  return {
    x: ((cx - rect.left) / rect.width) * stage.width,
    y: ((cy - rect.top) / rect.height) * stage.height
  };
}

function hitTest(pos) {
  const ordered = state.elements.map((el, i) => ({ el, i })).sort((a, b) => b.el.z - a.el.z);
  for (const { el, i } of ordered) {
    const w = el.baseW * el.scale, h = el.baseH * el.scale;
    // 转换为元素本地坐标
    const dx = pos.x - el.x, dy = pos.y - el.y;
    const rad = (-el.rot * Math.PI) / 180;
    const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
    const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
    if (Math.abs(lx) <= w / 2 && Math.abs(ly) <= h / 2) return { el, i, lx, ly, w, h };
  }
  return null;
}

// 判断是否点在缩放手柄上
function onHandle(hit, pos) {
  if (!hit) return false;
  const { el, lx, ly, w, h } = hit;
  const hx = w / 2 + 5, hy = h / 2 + 5;
  return Math.hypot(lx - hx, ly - hy) < 20;
}

function startDrag(evt) {
  // 双指捏合缩放：第二根手指落下时切换为 pinch 模式
  if (evt.touches && evt.touches.length >= 2 && state.selected >= 0) {
    const t1 = evt.touches[0], t2 = evt.touches[1];
    state.dragging = {
      mode: 'pinch',
      pinchDist0: Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY),
      elScale: state.elements[state.selected].scale,
      started: true
    };
    evt.preventDefault();
    return;
  }
  const pos = stagePos(evt);
  const hit = hitTest(pos);
  if (!hit) {
    state.selected = -1;
    drawCanvas();
    return;
  }
  if (evt.__isDbl) return;
  state.selected = hit.i;
  const mode = onHandle(hit, pos) ? 'scale' : 'move';
  state.dragging = {
    mode,
    startX: pos.x, startY: pos.y,
    elX: hit.el.x, elY: hit.el.y,
    elScale: hit.el.scale,
    started: false
  };
  evt.preventDefault();
  drawCanvas();
}

function moveDrag(evt) {
  const d = state.dragging;
  if (!d) return;
  if (d.mode === 'pinch') {
    if (!evt.touches || evt.touches.length < 2) return;
    const t1 = evt.touches[0], t2 = evt.touches[1];
    const dist = Math.hypot(t1.clientX - t2.clientX, t1.clientY - t2.clientY);
    const el = state.elements[state.selected];
    if (el && d.pinchDist0 > 4) {
      el.scale = Math.max(0.12, Math.min(4, d.elScale * (dist / d.pinchDist0)));
      drawCanvas();
    }
    evt.preventDefault();
    return;
  }
  const pos = stagePos(evt);
  const el = state.elements[state.selected];
  if (!el) return;
  const dx = pos.x - d.startX, dy = pos.y - d.startY;
  if (!d.started && Math.hypot(dx, dy) < 2) return;
  d.started = true;

  if (d.mode === 'move') {
    el.x = d.elX + dx;
    el.y = d.elY + dy;
  } else {
    // 缩放手柄：以中心为基准按距离比例缩放
    const dist0 = Math.hypot(stage.width / 2 + 5, stage.height / 2 + 5);
    const d0 = Math.hypot(d.startX - d.elX, d.startY - d.elY);
    const d1 = Math.hypot(pos.x - el.x, pos.y - el.y);
    if (d0 > 8) el.scale = Math.max(0.12, Math.min(4, d.elScale * (d1 / d0)));
  }
  drawCanvas();
  evt.preventDefault();
}

function endDrag() {
  state.dragging = null;
}

/* 画布事件绑定 */
stage.addEventListener('mousedown', startDrag);
stage.addEventListener('touchstart', startDrag, { passive: false });
window.addEventListener('mousemove', (e) => { if (state.dragging) moveDrag(e); });
window.addEventListener('touchmove', (e) => { if (state.dragging) moveDrag(e); }, { passive: false });
window.addEventListener('mouseup', endDrag);
window.addEventListener('touchend', endDrag);

stage.addEventListener('dblclick', (e) => {
  const hit = hitTest(stagePos(e));
  if (hit) {
    state.elements.splice(hit.i, 1);
    state.selected = -1;
    drawCanvas();
    toast('已移除');
  }
});

stage.addEventListener('wheel', (e) => {
  const hit = hitTest(stagePos(e));
  if (!hit) return;
  e.preventDefault();
  state.selected = hit.i;
  const el = hit.el;
  el.scale = Math.max(0.12, Math.min(4, el.scale * (e.deltaY < 0 ? 1.08 : 0.926)));
  drawCanvas();
}, { passive: false });

/* 键盘微调 */
window.addEventListener('keydown', (e) => {
  if ($('#modalGarment').hidden === false || $('#modalOutfit').hidden === false || $('#modalBackup').hidden === false) return;
  if (document.activeElement?.tagName === 'INPUT' || document.activeElement?.tagName === 'TEXTAREA') return;
  if (state.selected < 0 || !state.elements[state.selected]) return;
  const el = state.elements[state.selected];
  const step = e.shiftKey ? 10 : 2;
  let used = true;
  switch (e.key) {
    case 'ArrowLeft': el.x -= step; break;
    case 'ArrowRight': el.x += step; break;
    case 'ArrowUp': el.y -= step; break;
    case 'ArrowDown': el.y += step; break;
    case 'Delete': case 'Backspace': state.elements.splice(state.selected, 1); state.selected = -1; break;
    case 'r': case 'R': el.rot = (el.rot + (e.shiftKey ? -15 : 15)) % 360; break;
    default: used = false;
  }
  if (used) { e.preventDefault(); drawCanvas(); }
});

/* ---------- 画布工具栏 ---------- */
function layerShift(dir) {
  const el = state.elements[state.selected];
  if (!el) return;
  const sorted = [...state.elements].sort((a, b) => a.z - b.z);
  const idx = sorted.indexOf(el);
  const target = sorted[idx + dir];
  if (!target) return;
  const tmp = el.z; el.z = target.z; target.z = tmp;
  // 重新按 z 排序数组并编号
  state.elements.sort((a, b) => a.z - b.z).forEach((e, i) => { e.z = i + 1; });
  // 数组顺序变了，修正选中索引
  state.selected = state.elements.indexOf(el);
  drawCanvas();
}

async function saveOutfit() {
  if (!state.elements.length) { toast('画布还是空的，先加几件衣服吧'); return; }
  const name = $('#outfitName').value.trim() || `搭配 ${state.outfits.length + 1}`;
  const thumb = await makeThumb(stage, 480);
  const layout = state.elements.map((el) => ({
    gid: el.gid, x: el.x, y: el.y, scale: el.scale, rot: el.rot, flip: el.flip, z: el.z,
    bw: el.baseW, bh: el.baseH
  }));
  const exist = state.editingOutfitId ? state.outfits.find((o) => o.id === state.editingOutfitId) : null;
  const item = {
    id: exist?.id || uid(),
    name,
    bg: state.canvasBg,
    layout,
    thumb,
    canvasW: stage.width,
    canvasH: stage.height,
    createdAt: exist?.createdAt || Date.now(),
    updatedAt: Date.now()
  };
  await dbPut('outfits', item);
  await loadOutfits();
  renderOutfits();
  toast(exist ? '搭配已更新 ✨' : '搭配已保存 ✨');
  state.editingOutfitId = null;
  $('#outfitName').value = '';
  renderStats();
}

/* ---------- 从布局还原到画布 ---------- */
function loadLayoutToCanvas(outfit) {
  state.elements = [];
  state.selected = -1;
  state.canvasBg = outfit.bg || '#ffffff';
  $$('.swatch').forEach((s) => s.classList.toggle('on', s.dataset.bg === state.canvasBg));
  state.editingOutfitId = outfit.id;
  $('#outfitName').value = outfit.name;

  const scaleX = stage.width / (outfit.canvasW || stage.width);
  outfit.layout.forEach((L) => {
    let photo;
    if (String(L.gid).startsWith('me_')) {
      const m = state.mePhotos.find((x) => x.id === String(L.gid).slice(3));
      if (!m) return;
      photo = m.photo;
    } else {
      const g = state.garments.find((x) => x.id === L.gid);
      if (!g || !g.photo) return;
      photo = g.photo;
    }
    const img = new Image();
    img.onload = () => {
      let baseW, baseH;
      if (L.bw && L.bh) {
        // 新版布局：直接用记录的基准尺寸（随画布等比缩放）
        baseW = L.bw * scaleX;
        baseH = L.bh * scaleX;
      } else {
        const maxSide = stage.width * 0.42;
        const ratio = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
        baseW = img.naturalWidth * ratio;
        baseH = img.naturalHeight * ratio;
      }
      state.elements.push({
        gid: L.gid, img, isMe: String(L.gid).startsWith('me_'),
        baseW, baseH,
        x: L.x * scaleX, y: L.y * scaleX,
        scale: L.scale, rot: L.rot, flip: L.flip, z: L.z
      });
      drawCanvas();
    };
    img.src = blobUrl(photo);
  });
  if (!outfit.layout.length) drawCanvas();
}

function renderOutfits() {
  const grid = $('#outfitGrid');
  $('#outfitCount').textContent = state.outfits.length;
  $('#outfitEmpty').hidden = state.outfits.length > 0;
  grid.innerHTML = state.outfits.slice().sort((a, b) => b.updatedAt - a.updatedAt).map((o) => `
    <div class="outfit-card" data-oid="${o.id}">
      <div class="oimg"><img src="${blobUrl(o.thumb)}" alt="${esc(o.name)}" loading="lazy"></div>
      <div class="obody">
        <div class="otitle">${esc(o.name)}</div>
        <div class="odate">${fmtDate(o.updatedAt)} · ${o.layout.length} 件</div>
      </div>
    </div>`).join('');
}

/* ============================================================
   导出 / 导入
   ============================================================ */
function blobToDataURL(blob) {
  return new Promise((res) => {
    if (!blob) return res(null);
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = () => res(null);
    r.readAsDataURL(blob);
  });
}

async function dataURLToBlob(url) {
  if (!url) return null;
  const res = await fetch(url);
  return await res.blob();
}

async function exportBackup() {
  toast('正在打包数据…');
  const garments = [];
  for (const g of state.garments) {
    garments.push({ ...g, photo: await blobToDataURL(g.photo) });
  }
  const outfits = [];
  for (const o of state.outfits) {
    outfits.push({ ...o, thumb: await blobToDataURL(o.thumb) });
  }
  const me = [];
  for (const m of state.mePhotos) {
    me.push({ ...m, photo: await blobToDataURL(m.photo) });
  }
  const payload = { app: 'my-wardrobe', version: 2, exportedAt: Date.now(), garments, outfits, me, customStyles };
  const blob = new Blob([JSON.stringify(payload)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `衣柜备份_${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast('备份已导出 ⬇️');
}

async function importBackup(file) {
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    if (data.app !== 'my-wardrobe') { toast('这不是本应用的备份文件'); return; }
    if (!confirm(`将导入 ${data.garments?.length || 0} 件衣物、${data.outfits?.length || 0} 套搭配${data.me?.length ? `、${data.me.length} 张我的照片` : ''}。\n导入会覆盖当前数据，确定继续吗？`)) return;

    await dbClear('garments');
    await dbClear('outfits');
    if (db.objectStoreNames.contains('me')) await dbClear('me');
    for (const g of data.garments || []) {
      g.photo = await dataURLToBlob(g.photo);
      await dbPut('garments', g);
    }
    for (const o of data.outfits || []) {
      o.thumb = await dataURLToBlob(o.thumb);
      await dbPut('outfits', o);
    }
    for (const m of data.me || []) {
      m.photo = await dataURLToBlob(m.photo);
      await dbPut('me', m);
    }
    // 恢复自定义风格标签
    if (Array.isArray(data.customStyles) && data.customStyles.length) {
      customStyles = data.customStyles;
      await dbPut('meta', { key: 'customStyles', value: customStyles });
    }
    await loadAll();
    renderAll();
    renderOutfits();
    toast('数据已恢复 ✅');
    $('#modalBackup').hidden = true;
  } catch (e) {
    console.error(e);
    toast('导入失败，文件可能已损坏');
  }
}

/* ============================================================
   数据加载与事件绑定
   ============================================================ */
async function loadAll() {
  state.garments = await dbAll('garments');
  state.outfits = await dbAll('outfits');
  state.mePhotos = db.objectStoreNames.contains('me') ? await dbAll('me') : [];
  // 自定义风格标签
  const meta = await dbAll('meta');
  const cs = meta.find((m) => m.key === 'customStyles');
  customStyles = Array.isArray(cs?.value) ? cs.value : [];
}
async function loadOutfits() {
  state.outfits = await dbAll('outfits');
}

function bindEvents() {
  // 顶部 Tab
  $$('.tab').forEach((t) => t.addEventListener('click', () => {
    $$('.tab').forEach((x) => x.classList.remove('active'));
    t.classList.add('active');
    $$('.view').forEach((v) => v.classList.remove('active'));
    $(`#view-${t.dataset.view}`).classList.add('active');
    if (t.dataset.view === 'outfits') { fitStage(); renderPalette(); drawCanvas(); }
  }));

  // 添加衣物
  $('#btnAdd').onclick = () => openGarmentModal();
  $('#btnAddEmpty').onclick = () => openGarmentModal();

  // 弹窗关闭
  $$('[data-close]').forEach((b) => b.onclick = (e) => {
    e.target.closest('.modal').hidden = true;
  });
  $$('.modal').forEach((m) => m.addEventListener('mousedown', (e) => {
    if (e.target === m) m.hidden = true;
  }));

  // 单选芯片 / 多选芯片
  document.addEventListener('click', (e) => {
    // 删除自定义标签
    const dt = e.target.closest('.del-tag');
    if (dt) {
      e.stopPropagation();
      delCustomStyle(dt.dataset.deltag);
      return;
    }
    // 新增自定义标签
    if (e.target.closest('#btnAddStyle')) { addCustomStyle(); return; }

    const chip = e.target.closest('.chip[data-chip]');
    if (chip) {
      const key = chip.dataset.chip;
      if (key === 'type') {
        const wasOn = chip.classList.contains('on');
        $$('#gType .chip').forEach((c) => c.classList.remove('on'));
        if (!wasOn) chip.classList.add('on');
      } else {
        chip.classList.toggle('on');
      }
      return;
    }
    // 颜色（多选：点一次切换）
    const sw = e.target.closest('.sw[data-color]');
    if (sw) {
      sw.classList.toggle('on');
      if ($('#gColorCustom').dataset.custom) {
        $('#gColorCustom').dataset.custom = '';
        $('.custom-color')?.classList.remove('on');
      }
      return;
    }
    // 筛选 chip
    const fc = e.target.closest('.chip[data-fkey]');
    if (fc) {
      const k = fc.dataset.fkey, v = fc.dataset.fval;
      state.filters[k] = state.filters[k] === v ? '' : v;
      renderFilters(); renderGrid();
      return;
    }
    if (e.target.id === 'clearFilters') {
      state.filters = { search: '', type: '', color: '', season: '', style: '', location: '' };
      $('#searchInput').value = '';
      renderFilters(); renderGrid();
      return;
    }
    // 缩略图切换主图
    const th = e.target.closest('.photo-thumbs .t');
    if (th && th.dataset.pi !== undefined) {
      state.mainPhotoIndex = +th.dataset.pi;
      updatePhotoUI();
      return;
    }
    if (e.target.id === 'addMorePhoto') { $('#photoInput').click(); return; }
    // 衣物卡片 -> 编辑
    const card = e.target.closest('.card[data-id]');
    if (card) { openGarmentModal(card.dataset.id); return; }
    // 衣柜篮点击 -> 加入画布
    const pi = e.target.closest('.palette-item[data-gid]');
    if (pi) { addToCanvas(pi.dataset.gid); return; }
    // 我的照片：点击操作按钮
    const mop = e.target.closest('.me-op');
    if (mop) {
      e.stopPropagation();
      const item = mop.closest('.palette-item[data-me]');
      handleMeOp(mop.dataset.meop, item.dataset.me);
      return;
    }
    // 我的照片：点击本体加入画布
    const meItem = e.target.closest('.palette-item[data-me]');
    if (meItem) { addToCanvas('me_' + meItem.dataset.me); return; }
    // 我的照片：上传入口
    if (e.target.closest('#meUpload')) { $('#meInput').click(); return; }
    // 篮筛选
    const mf = e.target.closest('.mini-chip[data-pf]');
    if (mf) { state.paletteFilter = mf.dataset.pf; renderPalette(); return; }
    // 搭配卡片
    const oc = e.target.closest('.outfit-card[data-oid]');
    if (oc) { openOutfitModal(oc.dataset.oid); return; }
    // 背景色
    const bg = e.target.closest('.swatch[data-bg]');
    if (bg) {
      state.canvasBg = bg.dataset.bg;
      $$('.swatch').forEach((s) => s.classList.toggle('on', s === bg));
      drawCanvas();
      return;
    }
  });

  // 照片选择
  $('#photoDrop').onclick = () => $('#photoInput').click();
  $('#photoInput').onchange = (e) => { handlePhotoFiles(e.target.files); e.target.value = ''; };

  // 自定义颜色
  $('#gColorCustom').oninput = (e) => {
    $$('#gColorSwatches .sw').forEach((s) => s.classList.remove('on'));
    $('#gColorCustom').dataset.custom = e.target.value;
    $('.custom-color')?.classList.add('on');
  };

  // 保存 / 删除衣物
  $('#btnSaveGarment').onclick = saveGarment;
  $('#btnWear').onclick = async () => {
    const g = state.garments.find((x) => x.id === state.editingId);
    if (!g) return;
    g.wearCount = (g.wearCount || 0) + 1;
    g.updatedAt = Date.now();
    await dbPut('garments', g);
    $('#btnWear').textContent = `✓ 今天穿了（已穿 ${g.wearCount} 次）`;
    await loadAll();
    renderAll();
    toast('记录成功，穿得开心 ✨');
  };
  $('#btnDeleteGarment').onclick = async () => {
    if (!state.editingId) return;
    if (!confirm('确定把这件衣物从衣柜移除吗？')) return;
    await dbDel('garments', state.editingId);
    await loadAll();
    $('#modalGarment').hidden = true;
    renderAll(); renderOutfits();
    toast('已移除');
  };

  // 搜索 / 排序
  $('#searchInput').oninput = (e) => { state.filters.search = e.target.value; renderGrid(); };
  $('#sortSelect').onchange = (e) => { state.sort = e.target.value; renderGrid(); };
  $('#paletteSearch').oninput = renderPalette;

  // 画布工具
  $('#btnLayerUp').onclick = () => layerShift(1);
  $('#btnLayerDown').onclick = () => layerShift(-1);
  $('#btnFlip').onclick = () => {
    const el = state.elements[state.selected];
    if (!el) { toast('先选中一个元素'); return; }
    el.flip = !el.flip; drawCanvas();
  };
  $('#btnDeleteEl').onclick = () => {
    if (state.selected < 0) { toast('先选中一个元素'); return; }
    state.elements.splice(state.selected, 1);
    state.selected = -1; drawCanvas();
  };
  $('#btnClearCanvas').onclick = () => {
    if (!state.elements.length) return;
    if (!confirm('清空画布上的所有衣物？')) return;
    state.elements = []; state.selected = -1; state.editingOutfitId = null;
    $('#outfitName').value = '';
    drawCanvas();
  };
  $('#btnSaveOutfit').onclick = saveOutfit;

  // 备份
  $('#btnBackup').onclick = async () => {
    const est = await navigator.storage?.estimate?.();
    if (est) {
      $('#storageInfo').textContent = `当前占用约 ${(est.usage / 1024 / 1024).toFixed(1)} MB（浏览器配额 ${(est.quota / 1024 / 1024 / 1024).toFixed(1)} GB）`;
    }
    $('#modalBackup').hidden = false;
  };
  $('#btnExport').onclick = exportBackup;
  $('#btnImport').onclick = () => $('#importInput').click();
  $('#importInput').onchange = (e) => { if (e.target.files[0]) importBackup(e.target.files[0]); e.target.value = ''; };
  $('#btnReset').onclick = async () => {
    if (!confirm('这会删除全部衣物和搭配，且无法撤销。确定吗？')) return;
    await dbClear('garments'); await dbClear('outfits');
    await loadAll(); renderAll(); renderOutfits();
    $('#modalBackup').hidden = true;
    toast('已清空');
  };

  // 拖拽到画布
  stage.addEventListener('dragover', (e) => e.preventDefault());
  stage.addEventListener('drop', (e) => {
    e.preventDefault();
    const gid = e.dataTransfer.getData('text/gid');
    if (!gid) return;
    const pos = stagePos(e);
    addToCanvas(gid, pos.x, pos.y);
  });
  $('#paletteList').addEventListener('dragstart', (e) => {
    const it = e.target.closest('.palette-item');
    if (!it) return;
    const gid = it.dataset.gid || (it.dataset.me ? 'me_' + it.dataset.me : '');
    if (gid) e.dataTransfer.setData('text/gid', gid);
  });

  // 抠图按钮
  $('#btnRmbg').onclick = doRmbg;
  $('#btnUndoRmbg').onclick = undoRmbg;

  // 我的照片上传
  $('#meInput').onchange = async (e) => {
    const arr = [...e.target.files].filter((f) => f.type.startsWith('image/')).slice(0, 5);
    e.target.value = '';
    if (!arr.length) return;
    toast('正在处理照片…');
    for (const f of arr) {
      try {
        const blob = await compressImage(f, 1100, 0.85);
        const item = { id: uid(), name: '我的照片', photo: blob, createdAt: Date.now() };
        await dbPut('me', item);
        state.mePhotos.push(item);
      } catch (err) { console.warn(err); }
    }
    renderPalette();
    toast('已添加，点击照片可放到画布 ✨');
  };
}

/* 我的照片操作：抠图 / 删除 */
async function handleMeOp(op, id) {
  const m = state.mePhotos.find((x) => x.id === id);
  if (!m) return;
  if (op === 'del') {
    if (!confirm('删除这张照片？')) return;
    await dbDel('me', id);
    state.mePhotos = state.mePhotos.filter((x) => x.id !== id);
    renderPalette();
    toast('已删除');
    return;
  }
  if (op === 'rmbg') {
    if (!canRmbg()) { toast(_rmbgAvailable === false ? rmbgUnavailableMsg() : '离线状态无法抠图，请联网后重试'); return; }
    toast('✂️ 正在抠图，几秒钟…');
    try {
      const out = await apiRemoveBg(m.photo);
      m.photo = out;
      await dbPut('me', m);
      renderPalette();
      toast('抠图完成 ✨ 点击照片放到画布');
    } catch (err) {
      console.warn(err);
      toast('抠图失败，请稍后重试');
    }
  }
}

/* 搭配详情弹窗 */
function openOutfitModal(id) {
  const o = state.outfits.find((x) => x.id === id);
  if (!o) return;
  $('#outfitModalTitle').textContent = o.name;
  $('#outfitImage').src = blobUrl(o.thumb);
  const items = o.layout.map((l) => state.garments.find((g) => g.id === l.gid)).filter(Boolean);
  $('#outfitMeta').textContent = `${fmtDate(o.updatedAt)} · ${items.length} 件 · ${items.map((g) => g.name).join(' / ')}`;
  $('#modalOutfit').dataset.oid = id;

  $('#btnDeleteOutfit').onclick = async () => {
    if (!confirm('删除这套搭配？')) return;
    await dbDel('outfits', id);
    await loadOutfits(); renderOutfits(); renderStats();
    $('#modalOutfit').hidden = true;
    toast('已删除');
  };
  $('#btnDownloadOutfit').onclick = () => {
    const a = document.createElement('a');
    a.href = blobUrl(o.thumb);
    a.download = `${o.name}.png`;
    a.click();
  };
  $('#btnEditOutfit').onclick = () => {
    $('#modalOutfit').hidden = true;
    // 切到搭配页
    $$('.tab').forEach((x) => x.classList.toggle('active', x.dataset.view === 'outfits'));
    $$('.view').forEach((v) => v.classList.toggle('active', v.id === 'view-outfits'));
    state.editingOutfitId = id;
    loadLayoutToCanvas(o);
    renderPalette();
    toast('已载入搭配，继续编辑吧');
  };
  $('#modalOutfit').hidden = false;
}

/* ---------- 启动 ---------- */
(async function init() {
  try {
    db = await openDB();
    await loadAll();
    renderAll();
    renderOutfits();
    bindEvents();
    fitStage();
    drawCanvas();
    // 默认选中第一个背景色
    $$('.swatch')[0]?.classList.add('on');
    probeRmbg(); // 静态托管降级探测（不阻塞加载）
  } catch (e) {
    console.error(e);
    document.body.innerHTML = `<div style="padding:60px;text-align:center;font-family:sans-serif">
      <h2>无法初始化数据库</h2><p style="color:#888;margin-top:10px">请使用 Chrome / Edge / Safari 等现代浏览器打开，并关闭无痕模式。</p></div>`;
  }
})();
