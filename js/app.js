/*
 * 识字故事屋：地图（闯关小路）→ 读故事（点读）→ 小挑战 → 奖励。
 */
(function () {
  'use strict';

  /* ======================= 数据 ======================= */
  const STORIES = window.STORIES || [];
  const BATCHES = window.CHAR_BATCHES || [];
  const KNOWN_LIST = BATCHES.flatMap((b) => [...b.chars]);
  const KNOWN = new Set(KNOWN_LIST);
  const PRACTICE = new Set([...(window.PRACTICE_CHARS || '')]);
  const SAY_ALONE = window.SAY_ALONE || {};
  const HAN = /\p{Script=Han}/u;
  const isHan = (c) => HAN.test(c);
  const hanOf = (s) => [...s].filter(isHan);
  const storyText = (s) => s.pages.map((p) => p.text).join('');
  const NUM = '一二三四五六七八九十';
  const SKIP_QUIZ = new Set([...'了的只干几']);
  const RATES = [0.62, 0.8, 0.98];
  const STAGES = [
    { name: '第一站 · 小芽', note: '一页一句，短短的' },
    { name: '第二站 · 花朵', note: '一页一两句' },
    { name: '第三站 · 大树', note: '一页两三句，长一点' },
    { name: '第四站 · 果子', note: '一页一段话，最后一个故事一口气读完' },
    { name: '第五站 · 小河', note: '可可来了！每个故事学几个新字' },
    { name: '第六站 · 大海', note: '新字更多，可可会读书了' },
  ];
  const MEDALS = [[10, '🥉', '铜牌'], [30, '🥈', '银牌'], [60, '🥇', '金牌'], [100, '👑', '皇冠']];

  // 故事里出现、但还没学过的字（按第一次出现的顺序）
  const EXTRA = [];
  STORIES.forEach((s, i) => {
    hanOf(s.title + storyText(s)).forEach((c) => {
      if (!KNOWN.has(c) && !EXTRA.some((e) => e.ch === c)) EXTRA.push({ ch: c, story: i });
    });
  });

  // 点图片时念的词、固定的话（js/phrases.js）
  const WORDS = window.PIC_WORDS || {};
  const PHRASES = Object.assign({ quizAsk: '找一找', quizAgain: '再听一听', praise: ['对啦！'], rewardPrefix: '太棒了！你得到了', hello: '你好，我们来读故事。' }, window.PHRASES || {});

  /* ======================= 存档 ======================= */
  const KEY = 'shizi-gushiwu-v1';
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { saved = {}; }
  const progress = {
    done: saved.done || {},
    hearts: saved.hearts || 0,
    likes: saved.likes || 0,
    unlockAll: !!saved.unlockAll,
  };
  const settings = Object.assign({ rate: 1, auto: true, sfx: true, voice: '' }, saved.settings || {});
  function save() {
    try {
      localStorage.setItem(KEY, JSON.stringify({ done: progress.done, hearts: progress.hearts, likes: progress.likes, unlockAll: progress.unlockAll, settings }));
    } catch (e) { /* 无痕模式等情况下存不了，没关系 */ }
  }
  function applySettings() {
    Speech.setRate(RATES[settings.rate] || 0.8);
    Speech.setVoice(settings.voice);
    Voice.setRate([0.85, 1, 1.15][settings.rate] || 1);
    Sfx.enabled = settings.sfx;
  }
  applySettings();

  /* ======================= 小工具 ======================= */
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    if (props) {
      for (const k of Object.keys(props)) {
        const v = props[k];
        if (v == null || v === false) continue;
        if (k === 'class') el.className = v;
        else if (k === 'style') el.style.cssText = v;
        else if (k === 'html') el.innerHTML = v;
        else if (k.slice(0, 2) === 'on') el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? '' : v);
      }
    }
    kids.flat(3).forEach((kid) => {
      if (kid == null || kid === false) return;
      el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    });
    return el;
  }
  const shuffle = (a) => {
    a = a.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  const canTalk = () => Voice.ready;

  const I = {
    speaker: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 9.2h3.8L12.4 5v14l-5.1-4.2H3.5z" fill="currentColor"/><path d="M15.6 8.6a4.8 4.8 0 0 1 0 6.8M18.3 6a8.6 8.6 0 0 1 0 12" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>',
    stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="6.5" width="11" height="11" rx="2.5" fill="currentColor"/></svg>',
    next: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 4.5 16.5 12 9 19.5" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    prev: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 4.5 7.5 12 15 19.5" fill="none" stroke="currentColor" stroke-width="3.4" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    home: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5 11.2 12 4l8.5 7.2V20a1 1 0 0 1-1 1h-4.8v-6.2H9.3V21H4.5a1 1 0 0 1-1-1z" fill="currentColor"/></svg>',
    close: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>',
    gear: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="7.6" fill="none" stroke="currentColor" stroke-width="3.6" stroke-dasharray="2.98 2.98"/><circle cx="12" cy="12" r="5.4" fill="none" stroke="currentColor" stroke-width="3"/></svg>',
    gift: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="9" width="17" height="4.2" rx="1.2" fill="currentColor"/><rect x="5" y="13" width="14" height="8" rx="1.4" fill="currentColor"/><path d="M12 9v12" stroke="#fff" stroke-width="2.2"/><path d="M12 9C10.4 5.8 6.6 5 6.4 7.4 6.2 9 9.4 9 12 9zm0 0c1.6-3.2 5.4-4 5.6-1.6.2 1.6-3 1.6-5.6 1.6z" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linejoin="round"/></svg>',
    grid: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="3.5" width="17" height="17" rx="3" fill="none" stroke="currentColor" stroke-width="2.6"/><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="1.8" stroke-dasharray="2.2 2"/></svg>',
    lock: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="5" y="10.5" width="14" height="10" rx="2.6" fill="currentColor"/><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" fill="none" stroke="currentColor" stroke-width="2.6"/></svg>',
    heart: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-9.2-9.3C1.6 7.8 3.8 4.5 7.2 4.5c2 0 3.6 1.1 4.8 2.8 1.2-1.7 2.8-2.8 4.8-2.8 3.4 0 5.6 3.3 4.4 6.7-1.7 4.7-9.2 9.3-9.2 9.3z" fill="currentColor"/></svg>',
    check: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7" fill="none" stroke="currentColor" stroke-width="3.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    replay: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.2 12.5A7 7 0 1 0 7.4 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><path d="M4.6 3.8v4.6h4.6" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    star: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2l2.6 5.5 6 .7-4.4 4.1 1.2 5.9L12 16.5l-5.4 2.9 1.2-5.9L3.4 9.4l6-.7z" fill="currentColor"/></svg>',
  };
  const icon = (svg, cls) => h('span', { class: 'ic' + (cls ? ' ' + cls : ''), html: svg });

  /* ---------- 特效层：飘爱心、提示、大字 ---------- */
  const fx = h('div', { class: 'fx', 'aria-hidden': 'true' });
  document.body.append(fx);

  function burst(x, y, o) {
    o = o || {};
    const set = o.set || ['❤️', '💖', '⭐', '✨', '💛', '💗'];
    const n = o.n || 14;
    for (let i = 0; i < n; i++) {
      const s = h('span', { class: 'ptc' }, set[i % set.length]);
      s.style.left = x + 'px';
      s.style.top = y + 'px';
      s.style.fontSize = Math.round((o.size || 28) * (0.7 + Math.random() * 0.7)) + 'px';
      fx.append(s);
      const a = Math.random() * Math.PI * 2;
      const d = (o.dist || 150) * (0.45 + Math.random() * 0.75);
      const dx = Math.cos(a) * d;
      const dy = Math.sin(a) * d - (o.up || 50);
      const rot = (Math.random() - 0.5) * 140;
      if (!s.animate) { setTimeout(() => s.remove(), 600); continue; }
      const an = s.animate([
        { transform: 'translate(-50%,-50%) scale(.2)', opacity: 1 },
        { transform: `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px)) scale(1) rotate(${rot}deg)`, opacity: 1, offset: 0.65 },
        { transform: `translate(calc(-50% + ${dx * 1.1}px), calc(-50% + ${dy + 70}px)) scale(.85) rotate(${rot * 1.4}deg)`, opacity: 0 },
      ], { duration: 950 + Math.random() * 600, easing: 'cubic-bezier(.2,.7,.3,1)' });
      an.onfinish = () => s.remove();
    }
  }
  function burstAt(el, o) {
    const r = el.getBoundingClientRect();
    burst(r.left + r.width / 2, r.top + r.height / 2, o);
  }
  function confettiRain() {
    const colors = ['#ff6b8b', '#ffc93c', '#4cc38a', '#4aa8ff', '#a98bff', '#ff9f43'];
    for (let i = 0; i < 46; i++) {
      const c = h('i', { class: 'cfx' });
      c.style.left = Math.random() * 100 + 'vw';
      c.style.background = colors[i % colors.length];
      fx.append(c);
      if (!c.animate) { c.remove(); continue; }
      const an = c.animate([
        { transform: `translateY(-8vh) rotate(0deg)`, opacity: 1 },
        { transform: `translate(${(Math.random() - 0.5) * 30}vw, 108vh) rotate(${600 + Math.random() * 600}deg)`, opacity: 1 },
      ], { duration: 2200 + Math.random() * 1600, delay: Math.random() * 500, easing: 'cubic-bezier(.3,.2,.6,1)' });
      an.onfinish = () => c.remove();
    }
  }
  function toast(msg) {
    const t = h('div', { class: 'toast', role: 'status' }, msg);
    document.body.append(t);
    requestAnimationFrame(() => t.classList.add('in'));
    setTimeout(() => { t.classList.remove('in'); setTimeout(() => t.remove(), 300); }, 2200);
  }
  function pop(el) {
    if (!el || !el.animate) return;
    el.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.22) translateY(-6%)' }, { transform: 'scale(1)' }], { duration: 380, easing: 'ease-out' });
  }

  // 没有中文语音时只提醒一次
  let warnedVoice = false;
  function warnNoVoice() {
    if (warnedVoice) return;
    warnedVoice = true;
    toast('这台设备没有中文语音，请看「家长」里的说明');
  }
  // 点读：念一个字
  function sayChar(c) {
    if (!canTalk()) warnNoVoice();
    Voice.say(c);
  }
  function charTile(c, cls, idx) {
    const known = KNOWN.has(c);
    const b = h('button', {
      class: `ch${cls ? ' ' + cls : ''}${known ? '' : ' new'}${PRACTICE.has(c) ? ' practice' : ''}`,
      type: 'button',
      'data-i': idx,
      'aria-label': known ? c : `${c}（新字）`,
    }, c);
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (R && view === 'reader') stopReading();
      sayChar(c);
      b.classList.remove('hit');
      void b.offsetWidth;
      b.classList.add('hit');
      if (view === 'reader' && b.closest('.text')) showBig(c);
    });
    return b;
  }

  /* ---------- 弹出层 ---------- */
  let currentModal = null;
  function modal(kind, kids) {
    closeModal(true);
    const back = h('div', { class: 'modal-back ' + kind });
    const box = h('div', { class: 'modal', role: 'dialog', 'aria-modal': 'true' },
      h('button', { class: 'x', type: 'button', 'aria-label': '关闭', html: I.close, onclick: () => closeModal() }),
      kids);
    back.addEventListener('click', (e) => { if (e.target === back) closeModal(); });
    back.append(box);
    document.body.append(back);
    requestAnimationFrame(() => back.classList.add('in'));
    currentModal = back;
    return box;
  }
  function closeModal(now) {
    if (!currentModal) return;
    const m = currentModal;
    currentModal = null;
    if (now) { m.remove(); return; }
    m.classList.remove('in');
    setTimeout(() => m.remove(), 240);
  }

  /* ======================= 可可：照片、点赞、表扬 ======================= */
  const KID = window.KID || (window.KID = { name: '可可', photos: [] });
  // 家长在网页里加的照片，只存在这台设备上（IndexedDB）
  const PhotoDB = (() => {
    let db = null;
    const open = () => new Promise((res, rej) => {
      if (db) { res(db); return; }
      if (!window.indexedDB) { rej(new Error('no indexedDB')); return; }
      const r = indexedDB.open('shizi-kid-photos', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('photos', { keyPath: 'id' });
      r.onsuccess = () => { db = r.result; res(db); };
      r.onerror = () => rej(r.error);
    });
    const run = (mode, fn) => open().then((d) => new Promise((res, rej) => {
      const q = fn(d.transaction('photos', mode).objectStore('photos'));
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
    }));
    return {
      all: () => run('readonly', (st) => st.getAll()).catch(() => []),
      put: (rec) => run('readwrite', (st) => st.put(rec)),
      del: (id) => run('readwrite', (st) => st.delete(id)),
    };
  })();
  let userPhotos = [];
  const allPhotos = () => [...(KID.photos || []), ...userPhotos.map((p) => p.data)];
  const baseAvatar = KID.avatar || '';
  function refreshAvatar() {
    KID.avatar = baseAvatar || (userPhotos[0] && userPhotos[0].data) || '';
  }
  function loadUserPhotos() {
    return PhotoDB.all().then((list) => {
      userPhotos = (list || []).sort((a, b) => a.id - b.id);
      refreshAvatar();
    }).catch(() => {});
  }
  function fileToPhoto(file) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const sc = Math.min(1, 720 / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * sc);
        c.height = Math.round(img.naturalHeight * sc);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        res(c.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('bad image')); };
      img.src = url;
    });
  }

  // 读完一关时跳出来的表扬（每次不大一样，都有「可可」）
  let lastCheer = -1;
  function pickCheer(stageEnd) {
    if (stageEnd && PHRASES.stageDone) return PHRASES.stageDone;
    const list = PHRASES.cheers && PHRASES.cheers.length ? PHRASES.cheers : [`${KID.name}，你真棒！`];
    let k = Math.floor(Math.random() * list.length);
    if (k === lastCheer && list.length > 1) k = (k + 1) % list.length;
    lastCheer = k;
    return list[k];
  }
  let lastPhoto = -1;
  function pickPhoto() {
    const list = allPhotos();
    if (!list.length) return '';
    let k = Math.floor(Math.random() * list.length);
    if (k === lastPhoto && list.length > 1) k = (k + 1) % list.length;
    lastPhoto = k;
    return list[k];
  }

  // 打包成一个文件时视频是 data: 地址；iPhone / iPad 上换成 blob: 地址更容易播放
  const blobURLs = {};
  function playable(src) {
    if (!src || src.slice(0, 5) !== 'data:') return src;
    if (blobURLs[src]) return blobURLs[src];
    try {
      const comma = src.indexOf(',');
      const bin = atob(src.slice(comma + 1));
      const u8 = new Uint8Array(bin.length);
      for (let k = 0; k < bin.length; k++) u8[k] = bin.charCodeAt(k);
      blobURLs[src] = URL.createObjectURL(new Blob([u8], { type: src.slice(5, comma).split(';')[0] }));
      return blobURLs[src];
    } catch (e) { return src; }
  }

  // 照片卡：一直往上冒 👍 和 ❤️，点一下再点个赞
  function floatLike(card) {
    const icons = ['👍', '❤️', '👍', '💖', '👍', '⭐'];
    const s = h('span', { class: 'like-float' }, icons[Math.floor(Math.random() * icons.length)]);
    // 从照片两边往上飘，不挡住脸
    const side = Math.random() < 0.5 ? -1 : 1;
    s.style.left = (side < 0 ? 2 + Math.random() * 12 : 86 + Math.random() * 12) + '%';
    card.append(s);
    if (!s.animate) { setTimeout(() => s.remove(), 300); return; }
    const dx = side * (10 + Math.random() * 40);
    const an = s.animate([
      { transform: 'translate(0, 0) scale(.4)', opacity: 0 },
      { transform: `translate(${dx * 0.4}px, -40px) scale(1)`, opacity: 1, offset: 0.2 },
      { transform: `translate(${dx}px, -150px) scale(1.15)`, opacity: 0 },
    ], { duration: 1600 + Math.random() * 600, easing: 'ease-out' });
    an.onfinish = () => s.remove();
  }
  function photoCard(o) {
    o = o || {};
    const count = h('b', null, String(progress.likes));
    let media;
    if (o.video) {
      media = h('video', { src: playable(o.video), poster: o.poster || '', muted: true, autoplay: true, loop: true, playsinline: true, 'webkit-playsinline': true, preload: 'auto' });
      media.muted = true;
      media.addEventListener('error', () => { if (media.src !== o.video && o.video.slice(0, 5) === 'data:') media.src = o.video; }, { once: true });
      const p = media.play && media.play();
      if (p && p.catch) p.catch(() => {});
    } else {
      media = h('img', { src: o.src, alt: KID.name, draggable: 'false' });
    }
    const card = h('button', { class: 'kid-card' + (o.small ? ' small' : ''), type: 'button', 'aria-label': `给${KID.name}点赞` },
      h('span', { class: 'kid-photo' }, media, h('span', { class: 'kid-thumb', 'aria-hidden': 'true' }, '👍')),
      o.video ? h('span', { class: 'kid-play' }, `🔊 听${KID.name}说话`) : null,
      h('span', { class: 'kid-likes' }, '👍 ', count, ' 个赞'));
    // 一直往上冒的赞（系统设置了「减少动态效果」时不冒，点了才冒）
    const calm = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const timer = calm ? 0 : setInterval(() => {
      if (!card.isConnected) { clearInterval(timer); return; }
      if (!o.small || Math.random() < 0.3) floatLike(card);
    }, o.small ? 900 : 420);
    card.addEventListener('click', (e) => {
      e.stopPropagation();
      progress.likes += 1;
      save();
      count.textContent = String(progress.likes);
      card.classList.remove('liked');
      void card.offsetWidth;
      card.classList.add('liked');
      Sfx.pop();
      for (let k = 0; k < 4; k++) setTimeout(() => card.isConnected && floatLike(card), k * 90);
      burstAt(card, { set: ['👍', '❤️', '💖', '⭐'], n: 10, dist: 120 });
      if (o.video) {
        Voice.stop();
        media.muted = false;
        media.loop = false;
        try { media.currentTime = 0; } catch (err) { /* 忽略 */ }
        const p = media.play();
        if (p && p.catch) p.catch(() => {});
        media.onended = () => { media.muted = true; media.loop = true; const q = media.play(); if (q && q.catch) q.catch(() => {}); };
      }
    });
    return card;
  }

  /* ======================= 地图（闯关小路） ======================= */
  const app = document.getElementById('app');
  let view = 'map';
  let R = null; // 正在读的故事
  let Q = null; // 小挑战

  const isDone = (i) => !!progress.done[STORIES[i].id];
  const isOpen = (i) => progress.unlockAll || i === 0 || isDone(i - 1) || isDone(i);
  function currentLevel() {
    for (let i = 0; i < STORIES.length; i++) if (isOpen(i) && !isDone(i)) return i;
    return -1;
  }

  function toolBtn(svg, label, fn) {
    return h('button', { class: 'tool', type: 'button', onclick: fn }, icon(svg), h('span', null, label));
  }

  function renderMap(focus) {
    view = 'map';
    R = null;
    document.body.classList.remove('lock');
    app.innerHTML = '';
    const cur = currentLevel();
    const doneCount = STORIES.filter((s, i) => isDone(i)).length;

    const head = h('header', { class: 'map-head' },
      h('div', { class: 'brand' },
        KID.avatar
          ? h('button', { class: 'logo kid', type: 'button', 'aria-label': `给${KID.name}点赞`, onclick: (e) => { Sfx.pop(); burstAt(e.currentTarget, { set: ['👍', '❤️', '⭐'], n: 8, dist: 90 }); Voice.say(KID.name); } }, h('img', { src: KID.avatar, alt: '' }))
          : h('div', { class: 'logo', 'aria-hidden': 'true' }, h('span', null, '字')),
        h('div', { class: 'brand-t' },
          h('h1', null, '识字故事屋'),
          h('p', null, `${KID.name}认识 ${KNOWN_LIST.length} 个字 · ${STORIES.length} 个故事 · 读完 ${doneCount} 个`))),
      h('div', { class: 'tools' },
        h('div', { class: 'hearts', title: '爱心' }, icon(I.heart), h('b', null, progress.hearts)),
        toolBtn(I.gift, '宝箱', openStickers),
        toolBtn(I.grid, '字卡', openChars),
        toolBtn(I.gear, '家长', openSettings)));

    const wrap = h('main', { class: 'map' }, head);
    STAGES.forEach((st, si) => {
      const levels = STORIES.map((s, i) => [s, i]).filter(([s]) => s.stage === si + 1);
      if (!levels.length) return;
      const trail = h('div', { class: 'trail' });
      levels.forEach(([s, i], k) => {
        const x = [50, 76, 50, 24][k % 4];
        const done = isDone(i);
        const open = isOpen(i);
        const state = done ? 'done' : open ? 'open' : 'locked';
        const node = h('button', {
          class: `node ${state}${i === cur ? ' current' : ''}`,
          type: 'button',
          style: `--x:${x}`,
          'data-i': i,
          'aria-label': `第${i + 1}关 ${s.title}${open ? '' : '（还没打开）'}`,
        },
        h('span', { class: 'disc' },
          done ? h('span', { class: 'prize' }, s.prize[0]) : open ? h('span', { class: 'num' }, i + 1) : icon(I.lock, 'lock'),
          done ? h('span', { class: 'badge' }, i + 1) : null),
        h('span', { class: 'name' }, s.title),
        i === cur ? h('span', { class: 'flag' }, '开始') : null);
        node.addEventListener('click', () => {
          if (!open) {
            pop(node);
            Sfx.oops();
            toast('先读完前面的故事，就能打开啦');
            return;
          }
          openCover(i);
        });
        trail.append(node);
      });
      wrap.append(h('section', { class: `stage-sec st-${si + 1}` },
        h('div', { class: 'sign' }, h('b', null, st.name), h('span', null, st.note)),
        trail));
    });
    wrap.append(h('footer', { class: 'map-foot' }, '学会新字后，可以把新字和新故事加进来。'));
    app.append(wrap);
    drawTrails();
    // 当前关卡不在屏幕里时才滚过去
    const target = app.querySelector(`.node[data-i="${focus != null ? focus : cur}"]`);
    if (target) {
      const r = target.getBoundingClientRect();
      if (r.bottom > window.innerHeight - 20 || r.top < 0) target.scrollIntoView({ block: 'center' });
    }
  }

  function drawTrails() {
    app.querySelectorAll('.trail').forEach((trail) => {
      const old = trail.querySelector('.trail-svg');
      if (old) old.remove();
      const tb = trail.getBoundingClientRect();
      const pts = [...trail.querySelectorAll('.disc')].map((d) => {
        const r = d.getBoundingClientRect();
        return [r.left + r.width / 2 - tb.left, r.top + r.height / 2 - tb.top];
      });
      if (pts.length < 2) return;
      let d = `M${pts[0][0].toFixed(1)},${pts[0][1].toFixed(1)}`;
      for (let i = 1; i < pts.length; i++) {
        const [x0, y0] = pts[i - 1];
        const [x1, y1] = pts[i];
        const my = (y0 + y1) / 2;
        d += ` C${x0.toFixed(1)},${my.toFixed(1)} ${x1.toFixed(1)},${my.toFixed(1)} ${x1.toFixed(1)},${y1.toFixed(1)}`;
      }
      const svg = `<svg class="trail-svg" width="${tb.width}" height="${tb.height}" viewBox="0 0 ${tb.width} ${tb.height}" aria-hidden="true"><path class="road" d="${d}"/><path class="dash" d="${d}"/></svg>`;
      trail.insertAdjacentHTML('afterbegin', svg);
    });
  }

  /* ---------- 故事封面 ---------- */
  function openCover(i) {
    const s = STORIES[i];
    const all = hanOf(storyText(s));
    const fresh = [...new Set(hanOf(s.title + storyText(s)).filter((c) => !KNOWN.has(c)))];
    const done = isDone(i);
    Voice.unlock();
    modal('cover st-' + s.stage, [
      h('div', { class: 'cover-top' },
        h('span', { class: 'chip' }, `第 ${i + 1} 关`),
        h('span', { class: 'meta' }, `${s.pages.length} 页 · ${all.length} 个字`)),
      h('div', { class: 'cover-title', lang: 'zh-CN' }, [...s.title].map((c) => charTile(c))),
      fresh.length
        ? h('div', { class: 'cover-new' }, h('span', { class: 'lbl' }, '新字'), fresh.map((c) => charTile(c)), h('span', { class: 'hint' }, '点一点，听一听'))
        : h('div', { class: 'cover-new' }, h('span', { class: 'lbl ok' }, '全是学过的字')),
      h('div', { class: 'cover-prize' },
        h('span', { class: 'pz' + (done ? '' : ' hidden') }, s.prize[0]),
        h('span', null, done ? `已经得到「${s.prize[1]}」，再读一遍还有爱心` : '读完有奖品哦')),
      h('div', { class: 'cover-btns' },
        h('button', { class: 'btn big', type: 'button', onclick: () => openReader(i) }, '开始读', icon(I.next))),
    ]);
    Voice.say(s.title);
  }

  /* ======================= 读故事 ======================= */
  let probe = null;
  function safeArea() {
    if (!probe) {
      probe = h('div', { class: 'sa-probe', 'aria-hidden': 'true' });
      document.body.append(probe);
    }
    const cs = getComputedStyle(probe);
    return { t: parseFloat(cs.paddingTop) || 0, b: parseFloat(cs.paddingBottom) || 0 };
  }

  function openReader(i, page) {
    Voice.unlock();
    Sfx.unlock();
    closeModal(true);
    stopQuizUI();
    const s = STORIES[i];
    view = 'reader';
    document.body.classList.add('lock');
    app.innerHTML = '';
    const scenes = h('div', { class: 'scenes' });
    const art = h('div', { class: 'art' });
    const hint = h('div', { class: 'art-hint', hidden: true }, '点一点，数一数');
    const dots = h('div', { class: 'dots' }, s.pages.map(() => h('i')));
    const bar = h('header', { class: 'r-bar' },
      h('button', { class: 'rbtn', type: 'button', 'aria-label': '回到小路', html: I.home, onclick: () => exitReader() }),
      h('div', { class: 'r-title' }, h('b', null, s.title), dots),
      h('div', { class: 'r-count' }, ''));
    const text = h('div', { class: 'text', lang: 'zh-CN' });
    const prev = h('button', { class: 'nav prev', type: 'button', 'aria-label': '上一页', html: I.prev, onclick: () => go(-1) });
    const next = h('button', { class: 'nav next', type: 'button', 'aria-label': '下一页', onclick: () => go(1) }, icon(I.next), h('span', { class: 'done-lbl' }, '读完了'));
    const say = h('button', { class: 'say', type: 'button', 'aria-label': '读一读', onclick: () => toggleRead() },
      icon(I.speaker, 'on-idle'), icon(I.stop, 'on-play'), h('span', { class: 'lbl' }, '读一读'));
    const card = h('section', { class: 'card' }, h('div', { class: 'card-box' }, prev, text, next, say));
    const big = h('div', { class: 'bigchar', 'aria-hidden': 'true' });
    const root = h('div', { class: `reader st-${s.stage}` }, scenes, art, hint, bar, card, big);
    app.append(root);
    R = { i, s, page: -1, root, scenes, art, hint, dots, count: bar.querySelector('.r-count'), text, prev, next, say, big, token: 0, autoT: 0, swiped: false };
    bindSwipe(root);
    showPage(Math.min(page || 0, s.pages.length - 1), 0);
  }

  function exitReader() {
    stopReading();
    const i = R ? R.i : null;
    renderMap(i);
  }

  function layout() {
    if (!R) return;
    const pg = R.s.pages[R.page];
    const W = window.innerWidth;
    const H = window.innerHeight;
    const sa = safeArea();
    const narrow = W < 700 || W / H < 0.8;
    const n = hanOf(pg.text).length;
    const pct = narrow
      ? (n <= 6 ? 0.2 : n <= 12 ? 0.24 : n <= 20 ? 0.29 : n <= 30 ? 0.36 : n <= 40 ? 0.42 : 0.48)
      : (n <= 6 ? 0.24 : n <= 12 ? 0.27 : n <= 20 ? 0.31 : n <= 30 ? 0.36 : n <= 40 ? 0.41 : 0.46);
    const ctrl = narrow ? 78 : 0;
    const cardH = Math.round(Math.min(H * (narrow ? 0.64 : 0.58), Math.max(narrow ? 210 : 160, H * pct + ctrl)) + sa.b);
    const barH = 62 + sa.t;
    const artH = Math.max(120, H - barH - cardH);
    const sw = Math.min(W, (artH * 4) / 3);
    const sh = sw * 0.75;
    const st = barH + artH - sh;
    const rs = R.root.style;
    rs.setProperty('--bar-h', barH + 'px');
    rs.setProperty('--card-h', cardH + 'px');
    rs.setProperty('--sw', sw.toFixed(1) + 'px');
    rs.setProperty('--sh', sh.toFixed(1) + 'px');
    rs.setProperty('--st', st.toFixed(1) + 'px');
    rs.setProperty('--u', (sw / 100).toFixed(3) + 'px');
    rs.setProperty('--hz', (st + sh * 0.7).toFixed(1) + 'px');
    R.root.classList.toggle('narrow', narrow);
  }

  function fitText() {
    if (!R) return;
    const t = R.text;
    const cap = { 1: 116, 2: 98, 3: 86, 4: 74, 5: 80, 6: 76 }[R.s.stage] || 74;
    let lo = 18;
    let hi = Math.max(lo + 1, Math.min(cap, t.clientHeight / 1.2, t.clientWidth / 2.4));
    for (let k = 0; k < 9; k++) {
      const mid = (lo + hi) / 2;
      t.style.setProperty('--fs', mid + 'px');
      // 只看高度：标点字形本身比格子宽一点，横向的那一点溢出不碍事
      if (t.scrollHeight <= t.clientHeight + 1) lo = mid;
      else hi = mid;
    }
    // 留一点空，不要顶满
    t.style.setProperty('--fs', Math.floor(lo * 0.9) + 'px');
  }

  function renderText(str) {
    const t = R.text;
    t.innerHTML = '';
    const OPEN = '“‘（《「';
    let group = null;
    let open = '';
    [...str].forEach((c, idx) => {
      if (isHan(c)) {
        group = h('span', { class: 'wd' });
        if (open) { group.append(h('span', { class: 'pu op' }, open)); open = ''; }
        group.append(charTile(c, '', idx));
        t.append(group);
      } else if (OPEN.includes(c)) {
        open += c;
      } else if (group) {
        group.append(h('span', { class: 'pu' }, c));
      } else {
        t.append(h('span', { class: 'pu' }, c));
      }
    });
  }

  function buildStage(art) {
    const stage = h('div', { class: 'stage' });
    (art || []).forEach((it, k) => {
      const [g, x, y, s, a, o0] = it;
      const o = o0 || {};
      const isProp = g[0] === '#';
      const glyph = isProp ? h('div', { class: 'g', html: Scenes.prop(g.slice(1), o.p) }) : h('span', { class: 'g' }, g);
      const tf = (o.f ? 'scaleX(-1) ' : '') + (o.r ? `rotate(${o.r}deg)` : '');
      if (tf) glyph.style.transform = tf;
      const idle = h('span', { class: `i a-${a || 'bob'}` }, glyph);
      const move = h('span', { class: 'm' + (o.m ? ' m-' + o.m : '') }, idle);
      const ent = h('span', { class: 'e' + (o.m ? ' no-pop' : '') }, move);
      const sp = h('div', {
        class: `sp${isProp ? ' prop' : ''}${o.c ? ' countable' : ''}`,
        style: `--x:${x};--y:${y};--s:${s};--k:${k};--d:${o.d || 0}${o.z ? ';z-index:' + o.z : ''}`,
      }, ent);
      sp.addEventListener('click', (e) => onSprite(sp, g, o, e));
      stage.append(sp);
    });
    return stage;
  }

  function showPage(p, dir) {
    const s = R.s;
    if (p < 0 || p >= s.pages.length) return;
    stopReading();
    clearTimeout(R.autoT);
    const pg = s.pages[p];
    const prevScene = R.page >= 0 ? s.pages[R.page].scene : null;
    R.page = p;
    R.countN = 0;
    R.countDone = false;
    layout();

    // 背景：同一个背景就不换，云接着飘
    if (pg.scene !== prevScene) {
      const sc = Scenes.build(pg.scene);
      sc.classList.add('fading');
      R.scenes.append(sc);
      requestAnimationFrame(() => requestAnimationFrame(() => sc.classList.remove('fading')));
      const olds = [...R.scenes.children].slice(0, -1);
      setTimeout(() => olds.forEach((o) => o.remove()), 700);
    }
    // 图
    const stage = buildStage(pg.art);
    [...R.art.children].forEach((o) => {
      o.classList.add('out');
      setTimeout(() => o.remove(), 350);
    });
    R.art.append(stage);
    const countables = stage.querySelectorAll('.countable').length;
    R.hint.hidden = !countables;

    // 字
    renderText(pg.text);
    R.text.classList.remove('in-next', 'in-prev');
    void R.text.offsetWidth;
    if (dir) R.text.classList.add(dir > 0 ? 'in-next' : 'in-prev');
    fitText();

    // 按钮和页码
    [...R.dots.children].forEach((d, k) => d.classList.toggle('on', k === p));
    R.count.textContent = `${p + 1}/${s.pages.length}`;
    R.prev.classList.toggle('gone', p === 0);
    const last = p === s.pages.length - 1;
    R.next.classList.toggle('last', last);
    R.next.setAttribute('aria-label', last ? '读完了' : '下一页');

    if (settings.auto) R.autoT = setTimeout(readPage, dir ? 650 : 900);
  }

  function go(d) {
    if (!R) return;
    if (d > 0 && R.page === R.s.pages.length - 1) {
      startQuiz();
      return;
    }
    const p = R.page + d;
    if (p < 0 || p >= R.s.pages.length) return;
    Sfx.page();
    showPage(p, d);
  }

  function bindSwipe(el) {
    let x0 = 0, y0 = 0, t0 = 0, on = false;
    el.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.card, .r-bar')) return;
      on = true; x0 = e.clientX; y0 = e.clientY; t0 = Date.now(); R.swiped = false;
    });
    el.addEventListener('pointermove', (e) => {
      if (!on) return;
      if (Math.abs(e.clientX - x0) > 24) R.swiped = true;
    });
    el.addEventListener('pointerup', (e) => {
      if (!on) return;
      on = false;
      const dx = e.clientX - x0, dy = e.clientY - y0;
      if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.4 && Date.now() - t0 < 800) go(dx < 0 ? 1 : -1);
      setTimeout(() => { if (R) R.swiped = false; }, 50);
    });
    el.addEventListener('pointercancel', () => { on = false; });
  }

  function onSprite(sp, g, o, e) {
    if (!R || R.swiped) return;
    e.stopPropagation();
    pop(sp.firstChild);
    if (o.c) {
      if (!sp.dataset.n) {
        R.countN += 1;
        sp.dataset.n = R.countN;
        sp.append(h('span', { class: 'count-badge' }, R.countN));
      }
      const n = +sp.dataset.n;
      stopReading();
      Voice.say(NUM[n - 1] || String(n));
      Sfx.count(n);
      const total = R.art.lastChild.querySelectorAll('.countable').length;
      if (R.countN === total && !R.countDone) {
        R.countDone = true;
        setTimeout(() => { Sfx.ding(); burstAt(sp, { set: ['⭐', '✨', '🌟'], n: 12 }); }, 450);
      }
      return;
    }
    Sfx.pop();
    const word = o.say || WORDS[g];
    if (word) {
      stopReading();
      Voice.say(word);
      R.text.querySelectorAll('.ch').forEach((c) => {
        if (word.includes(c.textContent)) {
          c.classList.remove('hit');
          void c.offsetWidth;
          c.classList.add('hit');
        }
      });
    }
  }

  let bigT = 0;
  function showBig(c) {
    if (!R) return;
    clearTimeout(bigT);
    R.big.innerHTML = '';
    R.big.append(h('span', { class: `ch xl${KNOWN.has(c) ? '' : ' new'}${PRACTICE.has(c) ? ' practice' : ''}` }, c));
    if (!KNOWN.has(c)) R.big.append(h('span', { class: 'big-tag' }, '新字'));
    R.big.classList.remove('show');
    void R.big.offsetWidth;
    R.big.classList.add('show');
    bigT = setTimeout(() => R && R.big.classList.remove('show'), 1500);
  }

  /* ---------- 朗读 + 跟读高亮 ---------- */
  // 没有录音时：估计每个字什么时候读到（毫秒）
  function estimateTimes(text) {
    const per = (290 * 0.8) / Speech.rate;
    const times = [];
    let t = 0;
    [...text].forEach((c, i) => {
      times[i] = t;
      if (isHan(c)) t += per;
      else if ('，、：；'.includes(c)) t += per * 0.9;
      else if ('。！？'.includes(c)) t += per * 1.35;
      else if (c === '…') t += per * 0.5;
    });
    times.total = t;
    return times;
  }

  function readPage() {
    if (!R) return;
    if (!canTalk()) {
      warnNoVoice();
      return;
    }
    stopReading();
    const token = ++R.token;
    const pg = R.s.pages[R.page];
    const tiles = [...R.text.querySelectorAll('.ch')];
    const times = estimateTimes(pg.text);
    let marks = null; // 有录音时：每个字开始的秒数
    let t0 = 0;
    let raf = 0;
    R.reading = true;
    R.say.classList.add('on');
    const tick = () => {
      if (!R || token !== R.token) return;
      let cur = -1;
      if (marks) {
        const t = Voice.time();
        marks.forEach((m, k) => { if (m <= t + 0.04) cur = k; });
      } else {
        const el = performance.now() - t0;
        tiles.forEach((tile, k) => { if (times[tile.dataset.i] <= el) cur = k; });
      }
      tiles.forEach((tile, k) => {
        tile.classList.toggle('rd', k === cur);
        tile.classList.toggle('was', k < cur);
      });
      raf = requestAnimationFrame(tick);
    };
    R.stopTick = () => cancelAnimationFrame(raf);
    Voice.say(pg.text, {
      onstart(entry) {
        if (!R || token !== R.token) return;
        if (entry && entry[2] && entry[2].length === tiles.length) marks = entry[2];
        else if (entry) {
          // 录音里没有逐字时间：按估计的比例摊到录音长度上
          const span = Math.max(0.5, entry[1] - 0.25);
          marks = tiles.map((tile) => (times[tile.dataset.i] / (times.total || 1)) * span);
        }
        t0 = performance.now();
        tick();
      },
      onboundary(e) {
        if (!R || token !== R.token || e.charIndex == null) return;
        const tt = times[e.charIndex];
        if (tt != null) t0 = performance.now() - tt;
      },
      onend() {
        if (!R || token !== R.token) return;
        cancelAnimationFrame(raf);
        R.reading = false;
        R.say.classList.remove('on');
        tiles.forEach((tile) => { tile.classList.remove('rd'); tile.classList.add('was'); });
        setTimeout(() => { if (R && token === R.token) tiles.forEach((tile) => tile.classList.remove('was')); }, 900);
      },
    });
  }

  function stopReading() {
    if (!R) { Voice.stop(); return; }
    clearTimeout(R.autoT);
    R.token++;
    if (R.stopTick) R.stopTick();
    if (R.reading) Voice.stop();
    R.reading = false;
    R.say.classList.remove('on');
    R.text.querySelectorAll('.rd, .was').forEach((t) => t.classList.remove('rd', 'was'));
  }

  function toggleRead() {
    if (!R) return;
    if (R.reading) stopReading();
    else readPage();
  }

  /* ======================= 小挑战 ======================= */
  let quizEl = null;
  function stopQuizUI() {
    if (quizEl) { quizEl.remove(); quizEl = null; }
    Q = null;
  }

  function startQuiz() {
    stopReading();
    const s = R.s;
    const pool = [...new Set(hanOf(storyText(s)))].filter((c) => KNOWN.has(c) && !SKIP_QUIZ.has(c));
    const first = shuffle(pool.filter((c) => PRACTICE.has(c)));
    const fromTitle = shuffle(pool.filter((c) => !PRACTICE.has(c) && s.title.includes(c)));
    const rest = shuffle(pool.filter((c) => !PRACTICE.has(c) && !s.title.includes(c)));
    const targets = [...new Set([...first, ...fromTitle.slice(0, 1), ...rest])].slice(0, 3);
    Q = { s, i: R.i, pool, targets, n: 0, firstTry: 0, missed: false, busy: false };
    quizEl = h('div', { class: `quiz st-${s.stage}` });
    document.body.append(quizEl);
    Sfx.ding();
    showQuestion();
  }

  function showQuestion() {
    const t = Q.targets[Q.n];
    const nOpt = Math.min(Q.s.stage + 1, 4);
    const others = shuffle(Q.pool.filter((c) => c !== t)).slice(0, nOpt - 1);
    let guard = 0;
    while (others.length < nOpt - 1 && guard++ < 200) {
      const c = KNOWN_LIST[Math.floor(Math.random() * KNOWN_LIST.length)];
      if (c !== t && !others.includes(c) && !SKIP_QUIZ.has(c)) others.push(c);
    }
    const opts = shuffle([t, ...others]);
    const talk = canTalk();
    const prompt = () => Voice.seq([PHRASES.quizAsk, t]);
    Q.missed = false;
    Q.busy = false;
    quizEl.innerHTML = '';
    quizEl.append(
      h('header', { class: 'q-head' },
        h('button', { class: 'rbtn', type: 'button', 'aria-label': '不玩了，回到小路', html: I.close, onclick: () => { stopQuizUI(); exitReader(); } }),
        h('b', null, '小挑战'),
        h('div', { class: 'q-stars' }, Q.targets.map((x, k) => icon(I.star, k < Q.n ? 'got' : '')))),
      h('div', { class: 'q-body' },
        talk
          ? h('button', { class: 'q-ear', type: 'button', onclick: prompt }, icon(I.speaker), h('span', null, '听一听，点一点'))
          : h('div', { class: 'q-ear static' }, h('span', null, '找一样的字'), h('span', { class: 'ch md' }, t)),
        h('div', { class: `q-opts n${opts.length}` }, opts.map((c) => {
          const b = h('button', { class: 'ch q-opt', type: 'button', 'aria-label': c }, c);
          b.addEventListener('click', () => answer(b, c, t));
          return b;
        }))));
    if (talk) setTimeout(prompt, 350);
  }

  function answer(b, c, t) {
    if (!Q || Q.busy) return;
    if (c === t) {
      Q.busy = true;
      b.classList.add('right');
      if (!Q.missed) Q.firstTry += 1;
      Sfx.ding();
      burstAt(b, { set: ['⭐', '✨', '🌟', '💛'], n: 14 });
      Voice.say(PHRASES.praise[Q.n % PHRASES.praise.length]);
      setTimeout(() => {
        if (!Q) return;
        Q.n += 1;
        if (Q.n >= Q.targets.length) showReward();
        else showQuestion();
      }, 1200);
    } else {
      Q.missed = true;
      b.classList.remove('wrong');
      void b.offsetWidth;
      b.classList.add('wrong');
      Sfx.oops();
      if (canTalk()) Voice.seq([PHRASES.quizAgain, t]);
    }
  }

  /* ======================= 奖励 ======================= */
  function showReward() {
    const s = Q.s;
    const i = Q.i;
    const firstTime = !progress.done[s.id];
    const gain = 3 + Q.firstTry;
    const before = progress.hearts;
    progress.hearts += gain;
    progress.done[s.id] = { n: ((progress.done[s.id] || {}).n || 0) + 1, at: Date.now() };
    save();
    const medal = MEDALS.find(([n]) => before < n && progress.hearts >= n);
    const nextI = i + 1 < STORIES.length ? i + 1 : -1;

    stopReading();
    quizEl.innerHTML = '';
    quizEl.className = 'reward';
    const stageEnd = nextI < 0 || STORIES[nextI].stage !== s.stage;
    const cheer = pickCheer(stageEnd);
    const pic = stageEnd && KID.video ? '' : pickPhoto();
    const card = stageEnd && KID.video ? photoCard({ video: KID.video, poster: KID.poster }) : pic ? photoCard({ src: pic }) : null;
    // 表扬的话里，「可可」两个字用黄色
    const cheerKids = cheer.split(KID.name).flatMap((part, k) => (k ? [h('span', { class: 'nm' }, KID.name), part] : [part]));
    const gift = h('button', { class: 'gift', type: 'button', 'aria-label': '打开礼物' },
      h('i', { class: 'box' }), h('i', { class: 'lid' }), h('i', { class: 'bow l' }), h('i', { class: 'bow r' }));
    const tapHint = h('p', { class: 'rw-hint' }, '点一点礼物');
    const sticker = h('div', { class: 'sticker', hidden: true }, h('span', null, s.prize[0]));
    const reveal = h('div', { class: 'rw-reveal', hidden: true },
      h('p', { class: 'rw-name' }, firstTime ? `得到新贴纸「${s.prize[1]}」！` : `又见到「${s.prize[1]}」啦！`),
      h('p', { class: 'rw-hearts' }, icon(I.heart), h('b', { class: 'plus' }, '+' + gain), h('span', null, `一共 ${progress.hearts} 颗爱心`)),
      medal ? h('p', { class: 'rw-medal' }, `爱心满 ${medal[0]} 颗，得到${medal[2]} ${medal[1]}`) : null,
      nextI < 0 ? h('p', { class: 'rw-all' }, '所有故事都读完啦！') : null,
      h('div', { class: 'rw-btns' },
        nextI >= 0 ? h('button', { class: 'btn big', type: 'button', onclick: () => { stopQuizUI(); openReader(nextI); } }, '下一关', icon(I.next)) : null,
        h('button', { class: 'btn soft', type: 'button', onclick: () => { stopQuizUI(); openReader(i); } }, icon(I.replay), '再读一遍'),
        h('button', { class: 'btn soft', type: 'button', onclick: () => { stopQuizUI(); renderMap(nextI >= 0 ? nextI : i); } }, icon(I.home), '回到小路')));
    quizEl.append(
      h('div', { class: 'rays', 'aria-hidden': 'true' }),
      h('h2', { class: 'rw-cheer', style: `--n:${[...cheer].length + 1.6}` }, cheerKids),
      h('div', { class: 'rw-row' + (card ? '' : ' solo') }, card, h('div', { class: 'rw-stage' }, gift, sticker, tapHint), reveal));
    setTimeout(() => { if (quizEl) { Voice.say(cheer); Sfx.sparkle(); } }, 250);

    let opened = false;
    gift.addEventListener('click', (e) => {
      e.stopPropagation();
      if (opened) return;
      opened = true;
      gift.classList.add('open');
      tapHint.hidden = true;
      Sfx.fanfare();
      burstAt(gift, { n: 26, dist: 260, size: 34 });
      confettiRain();
      setTimeout(() => {
        gift.classList.add('gone');
        sticker.hidden = false;
        reveal.hidden = false;
        Voice.seq([PHRASES.rewardPrefix, s.prize[1]]);
        burstAt(sticker, { set: ['✨', '⭐', '💖'], n: 12 });
      }, 650);
    });
    quizEl.addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      Sfx.pop();
      burst(e.clientX, e.clientY, { n: 9, dist: 110, set: ['❤️', '💖', '👍', '⭐'] });
    });
  }

  /* ======================= 宝箱（贴纸） ======================= */
  function openStickers() {
    const got = STORIES.filter((s, i) => isDone(i)).length;
    modal('sheet', [
      h('h2', null, '我的宝箱'),
      h('p', { class: 'sheet-sub' }, `贴纸 ${got} / ${STORIES.length} · `, icon(I.heart, 'inline'), ` ${progress.hearts} 颗爱心`),
      h('div', { class: 'stk-grid' }, STORIES.map((s, i) => {
        const have = isDone(i);
        const b = h('button', { class: 'stk' + (have ? ' got' : ''), type: 'button' },
          h('span', { class: 'stk-e' }, s.prize[0]),
          h('span', { class: 'stk-n' }, have ? s.prize[1] : `第 ${i + 1} 关`));
        b.addEventListener('click', () => {
          pop(b.firstChild);
          if (have) { Sfx.pop(); Voice.say(s.prize[1]); burstAt(b, { n: 8, dist: 80 }); }
          else toast(`读完第 ${i + 1} 关「${s.title}」就能得到`);
        });
        return b;
      })),
      h('h3', null, '爱心奖章'),
      h('div', { class: 'medals' }, MEDALS.map(([n, e, name]) => h('div', { class: 'medal' + (progress.hearts >= n ? ' got' : '') },
        h('span', { class: 'stk-e' }, e), h('span', null, name), h('small', null, `${n} 颗爱心`)))),
      allPhotos().length || KID.video ? [
        h('h3', null, `${KID.name}的照片`),
        h('p', { class: 'sheet-sub' }, `点一点照片，给${KID.name}点个赞！`),
        h('div', { class: 'album' },
          KID.video ? photoCard({ video: KID.video, poster: KID.poster, small: true }) : null,
          allPhotos().map((src) => photoCard({ src, small: true }))),
      ] : null,
    ]);
  }

  /* ======================= 字卡 ======================= */
  function openChars() {
    modal('sheet', [
      h('h2', null, '字卡'),
      h('p', { class: 'sheet-sub' }, '点一个字，听它怎么读。'),
      h('div', { class: 'legend' },
        h('span', null, h('i', { class: 'key practice' }), '还要多练'),
        h('span', null, h('i', { class: 'key new' }), '故事里的新字')),
      BATCHES.map((b) => [
        h('h3', null, `${b.name}（${[...b.chars].length} 个）`),
        h('div', { class: 'char-grid' }, [...b.chars].map((c) => charTile(c))),
      ]),
      EXTRA.length ? [
        h('h3', null, `故事里的新字（${EXTRA.length} 个）`),
        h('p', { class: 'sheet-sub' }, '还没学过，读故事时会遇到。学会以后，可以把它们加进 js/chars.js。'),
        h('div', { class: 'char-grid' }, EXTRA.map((e) => h('div', { class: 'xtra' }, charTile(e.ch), h('small', null, `第${e.story + 1}关`)))),
      ] : null,
    ]);
  }

  /* ======================= 家长设置 ======================= */
  function openSettings() {
    const box = modal('sheet settings', [h('h2', null, '家长设置'), h('div', { class: 'set-body' })]);
    const body = box.querySelector('.set-body');
    const row = (label, ctl, note) => h('div', { class: 'set-row' }, h('div', { class: 'set-l' }, h('b', null, label), note ? h('small', null, note) : null), ctl);
    const seg = (vals, cur, onPick) => h('div', { class: 'seg', role: 'group' }, vals.map((v, k) => {
      const b = h('button', { class: k === cur ? 'on' : '', type: 'button', 'aria-pressed': k === cur ? 'true' : 'false' }, v);
      b.addEventListener('click', () => { onPick(k); draw(); });
      return b;
    }));
    const sw = (id, on, onFlip) => {
      const b = h('button', { class: 'switch' + (on ? ' on' : ''), id, type: 'button', role: 'switch', 'aria-checked': on ? 'true' : 'false' }, h('i'));
      b.addEventListener('click', () => { onFlip(!on); draw(); });
      return b;
    };
    let confirming = false;
    function draw() {
      body.innerHTML = '';
      const voices = Speech.voices;
      const status = h('p', { class: 'snd-status', role: 'status' });
      const test = () => {
        Voice.unlock();
        status.textContent = '正在放……';
        Voice.say(PHRASES.hello, {
          onstart: (entry) => { status.textContent = entry ? '正在放录好的声音……' : '正在用设备语音读……'; },
          onend: () => {
            status.textContent = Voice.lastError
              ? `录音放不出来（${Voice.lastError}），改用了设备语音。`
              : '放完了。还是听不到的话：把音量调大，看看是不是连着蓝牙耳机。';
          },
        });
      };
      const pick = () => {
        const sel = h('select', { id: 'set-voice', 'aria-label': '选择设备语音' },
          h('option', { value: '' }, '系统默认的中文声音'),
          voices.map((v) => {
            const op = h('option', { value: v.voiceURI }, `${v.name}（${v.lang}）`);
            if (Speech.voice && v.voiceURI === Speech.voice.voiceURI) op.selected = true;
            return op;
          }));
        sel.addEventListener('change', () => { settings.voice = sel.value; save(); applySettings(); Speech.speak('你好，我们来读故事。'); });
        return sel;
      };
      // 空的一行（null）不放进去，不然会显示成文字 "null"
      body.append(...[
        row('声音', h('div', { class: 'snd' },
          h('button', { class: 'btn tiny', type: 'button', onclick: test }, icon(I.speaker), '听一听'),
          status),
          Voice.clips ? `故事、字和表扬的话都录好了音（${Voice.clips} 句），不用设备语音也能读。` : '没有录音，会用设备自带的中文语音。'),
        row('朗读速度', seg(['慢', '正常', '快'], settings.rate, (k) => { settings.rate = k; save(); applySettings(); Voice.say(STORIES[0].pages[0].text); })),
        row('翻页后自动朗读', sw('set-auto', settings.auto, (v) => { settings.auto = v; save(); }), '关掉后，可以先让孩子自己读，再点「读一读」'),
        row('音效', sw('set-sfx', settings.sfx, (v) => { settings.sfx = v; save(); applySettings(); if (v) Sfx.ding(); })),
        voices.length
          ? row('设备语音', h('div', { class: 'voice-pick' }, pick()), '只在没有录音的话上用到')
          : Voice.clips ? null : row('设备语音', h('p', { class: 'warn' }, '没有找到中文语音。iPad / iPhone：设置 → 辅助功能 → 朗读内容 → 声音 → 中文，下载一个声音。')),
        row(`${KID.name}的照片`, (() => {
          const input = h('input', { type: 'file', accept: 'image/*', multiple: true, id: 'set-photos', class: 'sr-only' });
          input.addEventListener('change', () => {
            const files = [...(input.files || [])].slice(0, 12);
            if (!files.length) return;
            toast('正在加照片……');
            Promise.all(files.map((f, k) => fileToPhoto(f).then((data) => PhotoDB.put({ id: Date.now() + k, data })).then(() => 1, () => 0)))
              .then((ok) => loadUserPhotos().then(() => ok.reduce((a, b) => a + b, 0)))
              .then((n) => {
                draw();
                toast(n ? `加好了 ${n} 张照片` : '照片没加上：这个浏览器不让存照片');
                if (view === 'map') renderMap();
              });
          });
          return h('div', { class: 'photo-set' },
            h('div', { class: 'thumbs' },
              (KID.photos || []).map((src) => h('span', { class: 'thumb' }, h('img', { src, alt: '' }))),
              userPhotos.map((p) => h('span', { class: 'thumb' }, h('img', { src: p.data, alt: '' }),
                h('button', { class: 'thumb-x', type: 'button', 'aria-label': '删掉这张照片', html: I.close,
                  onclick: () => PhotoDB.del(p.id).then(loadUserPhotos).then(() => { draw(); if (view === 'map') renderMap(); }) })))),
            h('label', { class: 'btn tiny', for: 'set-photos' }, '添加照片'), input);
        })(), '读完一关会跳出来，还能点赞。照片只存在这台设备上。'),
        row('关卡', sw('set-unlock', progress.unlockAll, (v) => {
          progress.unlockAll = v;
          save();
          if (view === 'map') renderMap();
          toast(v ? '所有关卡都打开了，可以点任何一关' : '关卡恢复成读完一关开一关');
        }), '打开后，所有故事都可以直接读，不用一关一关解锁'),
        row('重新开始', confirming
          ? h('div', { class: 'confirm' },
              h('span', null, '清空爱心、贴纸和关卡进度？'),
              h('button', { class: 'btn tiny danger', type: 'button', onclick: () => { progress.done = {}; progress.hearts = 0; progress.likes = 0; progress.unlockAll = false; save(); closeModal(); renderMap(); toast('已经重新开始'); } }, '清空'),
              h('button', { class: 'btn tiny soft', type: 'button', onclick: () => { confirming = false; draw(); } }, '不清空'))
          : h('button', { class: 'btn tiny soft', type: 'button', onclick: () => { confirming = true; draw(); } }, '清空进度')),
        h('p', { class: 'credit' }, '故事字体：霞鹜文楷 GB（SIL OFL 1.1）。进度只存在这台设备的浏览器里。'),
      ].filter(Boolean));
    }
    draw();
    Speech.onVoices(() => { if (box.isConnected) draw(); });
  }

  /* ======================= 启动 ======================= */
  let rz = 0;
  window.addEventListener('resize', () => {
    cancelAnimationFrame(rz);
    rz = requestAnimationFrame(() => {
      if (view === 'reader' && R) { layout(); fitText(); }
      else if (view === 'map') drawTrails();
    });
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && currentModal) { closeModal(); return; }
    if (view !== 'reader' || !R || quizEl) return;
    if (e.key === 'ArrowRight') go(1);
    else if (e.key === 'ArrowLeft') go(-1);
    else if (e.key === ' ') { e.preventDefault(); toggleRead(); }
  });
  // iOS：第一次点屏幕时打开声音
  const unlockOnce = () => {
    Voice.unlock();
    Sfx.unlock();
    window.removeEventListener('click', unlockOnce, true);
    window.removeEventListener('touchend', unlockOnce, true);
  };
  window.addEventListener('click', unlockOnce, true);
  window.addEventListener('touchend', unlockOnce, true);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(() => { if (view === 'reader') fitText(); else drawTrails(); });

  const hot = window.claude && window.claude.hot;
  if (hot && hot.snapshot) {
    hot.snapshot(() => ({ view, story: R ? R.i : null, page: R ? R.page : null }));
  }
  function start(data) {
    loadUserPhotos().then(() => { if (view === 'map' && userPhotos.length) renderMap(); });
    renderMap();
    if (data && data.view === 'reader' && data.story != null && STORIES[data.story]) openReader(data.story, data.page || 0);
  }
  if (hot && hot.ready) hot.ready(start);
  else start((hot && hot.data) || {});
})();
