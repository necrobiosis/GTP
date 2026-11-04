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
    { name: '第七站 · 好朋友', note: '可可的同学小爱、点点来了！' },
  ];
  const MEDALS = [[10, '🥉', '铜牌'], [30, '🥈', '银牌'], [60, '🥇', '金牌'], [100, '👑', '皇冠']];
  // 每关能得的爱心（自己读完全都拿到；求助一次用掉一颗），越往后越多
  const LEVEL_HEARTS = { 1: 3, 2: 3, 3: 4, 4: 4, 5: 5, 6: 5, 7: 5 };

  // 故事里出现、但还没学过的字（按第一次出现的顺序）
  const EXTRA = [];
  STORIES.forEach((s, i) => {
    hanOf(s.title + storyText(s)).forEach((c) => {
      if (!KNOWN.has(c) && !EXTRA.some((e) => e.ch === c)) EXTRA.push({ ch: c, story: i });
    });
  });

  // 点图片时念的词、固定的话（js/phrases.js）
  const WORDS = window.PIC_WORDS || {};
  const PHRASES = Object.assign({
    quizAsk: '找一找', quizAgain: '再听一听', praise: ['对啦！'], rewardPrefix: '太棒了！你得到了', hello: '你好，我们来读故事。',
    helpAsk: '要用一颗爱心求助吗？', helpAskFree: '要求助吗？', helpPick: '点一点，你不会读的那个字。', helpHint: '不会读？点举手的按钮求助。',
    introHello: '先来认识几个生字吧！',
  }, window.PHRASES || {});

  /* ======================= 存档 ======================= */
  const KEY = 'shizi-gushiwu-v1';
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch (e) { saved = {}; }
  const progress = {};
  const FIELDS = {
    done: {},      // 读完的故事
    hearts: 0,
    likes: 0,
    intro: {},     // 每个字上过几次课
    learned: {},   // 家长标成「认识了」的生字
    taught: {},    // 上过课（找一找五次都找到了）的字：读故事前不再拿出来
    bank: {},      // 生字库：求助过的字、说不认识的字
    challenge: {}, // 完整读一遍读完的故事
    unlockAll: false,
  };
  // together：家长陪读（故事页有「读一读」、点字直接发音）；默认关，孩子先自己读，不会的字再求助
  // intro：读故事前先挑生字、上课；review：读新故事前先复习生字库
  const DEFAULTS = { rate: 1, sfx: true, voice: '', together: false, intro: true, review: true };
  const settings = {};
  function loadState(st) {
    Object.keys(FIELDS).forEach((k) => {
      const v = st[k];
      progress[k] = v == null ? (typeof FIELDS[k] === 'object' ? {} : FIELDS[k]) : v;
    });
    progress.unlockAll = !!progress.unlockAll;
    Object.keys(settings).forEach((k) => delete settings[k]);
    Object.assign(settings, DEFAULTS, st.settings || {});
    delete settings.auto; // 以前的「翻页后自动朗读」不要了：先让孩子自己读
    delete settings.introN;
  }
  loadState(saved);
  let savedAt = saved.at || 0;
  const snapshot = () => Object.assign({}, ...Object.keys(FIELDS).map((k) => ({ [k]: progress[k] })), { settings, at: savedAt });
  function save() {
    savedAt = Date.now();
    try {
      localStorage.setItem(KEY, JSON.stringify(snapshot()));
    } catch (e) { /* 无痕模式等情况下存不了，没关系 */ }
    Cloud.push();
  }

  /* 在 claude.ai 上打开时，进度还存到自己的账号里（换了设备、App 清了缓存也不会丢）。别的网站上只存在浏览器里。 */
  const Cloud = (() => {
    let ref = null;
    let timer = 0;
    let writing = false;
    let again = false;
    const write = async () => {
      if (!ref) return;
      if (writing) { again = true; return; }
      writing = true;
      try { await ref.set({ at: savedAt, state: JSON.stringify(snapshot()) }); } catch (e) { /* 存不上就算了，本机还有 */ }
      writing = false;
      if (again) { again = false; write(); }
    };
    return {
      get on() { return !!ref; },
      push() { if (!ref) return; clearTimeout(timer); timer = setTimeout(write, 1500); },
      async init(onAdopt) {
        const use = window.claude && window.claude.use;
        if (typeof use !== 'function') return;
        try {
          const [db, user] = await Promise.all([use.call(window.claude, 'db'), use.call(window.claude, 'user')]);
          if (!db || !user) return;
          const id = await user.id();
          if (!id) return;
          const r = db.doc(`data/users/${id}/save`);
          const snap = await r.get();
          ref = r;
          const body = snap.exists ? snap.data() : null;
          if (body && body.state && (body.at || 0) > savedAt) {
            // 账号里的更新：用账号里的
            const st = JSON.parse(body.state);
            loadState(st);
            savedAt = body.at;
            try { localStorage.setItem(KEY, JSON.stringify(snapshot())); } catch (e) { /* 忽略 */ }
            if (onAdopt) onAdopt();
          } else if (savedAt || Object.keys(progress.done).length || progress.hearts || Object.keys(progress.bank).length) {
            // 账号里还没有（或者是旧的）：把这台设备上的进度存上去（旧版本存的进度没有时间，就当是现在的）
            if (!savedAt) savedAt = Date.now();
            write();
          }
        } catch (e) { ref = null; }
      },
    };
  })();
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
    book: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 6.4C9.8 4.9 6.6 4.5 3.2 5v13.6c3.4-.5 6.6-.1 8.8 1.4 2.2-1.5 5.4-1.9 8.8-1.4V5c-3.4-.5-6.6-.1-8.8 1.4z" fill="none" stroke="currentColor" stroke-width="2.3" stroke-linejoin="round"/><path d="M12 6.4V20" stroke="currentColor" stroke-width="2"/></svg>',
    // 求助：举起的小手 + 问号泡泡（泡泡的底色跟着按钮变：--hand-bg）
    help: '<svg viewBox="0 0 24 24" aria-hidden="true"><g fill="currentColor"><rect x="5.6" y="6.6" width="2.9" height="9" rx="1.45"/><rect x="8.75" y="4.4" width="2.9" height="11" rx="1.45"/><rect x="11.9" y="5.4" width="2.9" height="10" rx="1.45"/><rect x="15" y="7.8" width="2.7" height="8" rx="1.35"/><rect x="2.3" y="12.2" width="2.9" height="7.4" rx="1.45" transform="rotate(-38 3.75 15.9)"/><path d="M5.6 12.6h12.1v3.2c0 3.6-2.7 6.5-6.05 6.5S5.6 19.4 5.6 15.8z"/></g><circle cx="19.2" cy="4.9" r="4.2" style="fill:var(--hand-bg,#fff)" stroke="currentColor" stroke-width="1.3"/><path d="M17.85 3.95a1.4 1.4 0 1 1 2.05 1.25c-.45.25-.7.55-.7 1.05v.25" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/><circle cx="19.2" cy="7.55" r=".72" fill="currentColor"/></svg>',
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
  function hitTile(b) {
    b.classList.remove('hit');
    void b.offsetWidth;
    b.classList.add('hit');
  }
  // where：'text' 故事里的字、'title' 封面上的题目——孩子自己读的时候，点了不发音（要求助）
  function charTile(c, cls, idx, where) {
    const known = KNOWN.has(c);
    const b = h('button', {
      class: `ch${cls ? ' ' + cls : ''}${known ? '' : ' new'}${PRACTICE.has(c) ? ' practice' : ''}`,
      type: 'button',
      'data-i': idx,
      'aria-label': known ? c : `${c}（新字）`,
    }, c);
    b.addEventListener('click', (e) => {
      e.stopPropagation();
      if (where && !settings.together) { tapToRead(b, c, where); return; }
      if (R && view === 'reader') stopReading();
      sayChar(c);
      hitTile(b);
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
        (() => {
          const b = toolBtn(I.book, '生字库', openBank);
          const n = bankDue().length;
          if (n) b.append(h('i', { class: 'tool-n', 'aria-label': `${n} 个要复习` }, n));
          return b;
        })(),
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
          done ? h('span', { class: 'badge' }, i + 1) : null,
          progress.challenge[s.id] ? h('span', { class: 'crown', title: '从头到尾读过一遍' }, '👑') : null),
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
    // 这一关第一次出现的新字（前面故事里见过的不再列出来）
    const fresh = EXTRA.filter((e) => e.story === i).map((e) => e.ch);
    const due = settings.review ? bankDue() : []; // 读之前要先复习的字
    Voice.prefetch(fresh);
    const seen = hanOf(s.title + storyText(s)).some((c) => !KNOWN.has(c));
    const done = isDone(i);
    Voice.unlock();
    modal('cover st-' + s.stage, [
      h('div', { class: 'cover-top' },
        h('span', { class: 'chip' }, `第 ${i + 1} 关`),
        h('span', { class: 'meta' }, `${s.pages.length} 页 · ${all.length} 个字`)),
      h('div', { class: 'cover-title', lang: 'zh-CN' }, [...s.title].map((c) => charTile(c, '', undefined, 'title'))),
      due.length ? h('div', { class: 'cover-pre' }, h('span', { class: 'lbl' }, '先复习'),
        due.slice(0, 8).map((c) => h('span', { class: 'ch sm practice' }, c)), h('span', { class: 'hint' }, '上次不认识的字，先找一找')) : null,
      fresh.length
        ? h('div', { class: 'cover-new' }, h('span', { class: 'lbl' }, '新字'), fresh.map((c) => charTile(c)), h('span', { class: 'hint' }, '点一点，听一听'))
        : h('div', { class: 'cover-new' }, h('span', { class: 'lbl ok' }, seen ? '没有新字' : '全是学过的字')),
      h('div', { class: 'cover-prize' },
        h('span', { class: 'pz' + (done ? '' : ' hidden') }, s.prize[0]),
        h('span', null, done ? `已经得到「${s.prize[1]}」，再读一遍还有爱心` : '读完有奖品哦'),
        h('span', { class: 'cv-hearts', title: '这一关的爱心' }, icon(I.heart), `×${LEVEL_HEARTS[s.stage] || 3}`)),
      settings.together ? null : h('p', { class: 'cover-help' },
        h('span', { class: 'ic hand', html: I.help }), '先自己读。不会的字点「求助」，每次用一颗爱心，只读一个字。'),
      h('div', { class: 'cover-btns' },
        h('button', { class: 'btn big', type: 'button', onclick: () => startStory(i) }, due.length ? '先复习' : '开始读', icon(I.next)),
        done ? h('button', { class: 'btn soft', type: 'button', onclick: () => { closeModal(true); openChallenge(i); } }, '📖 完整读一遍') : null),
    ]);
    // 不先读题目：让孩子自己读
  }

  /* ======================= 读故事 ======================= */
  let probe = null;
  // 有的托管网站会在右下角放自己的小标签（比如 Netlify 免费版的「Powered by Netlify」），
  // 盖住翻页按钮。发现了就在底下留出一条，不去动它。
  let hostBadge = 0;
  function watchHostBadge() {
    const found = () => document.getElementById('nl-badge-frame');
    const apply = () => {
      hostBadge = 56;
      document.documentElement.style.setProperty('--hb', hostBadge + 'px');
      document.body.classList.add('host-badge');
      if (view === 'reader' && R) { layout(); fitText(); }
    };
    if (found()) { apply(); return; }
    const mo = new MutationObserver(() => { if (found()) { mo.disconnect(); apply(); } });
    mo.observe(document.body, { childList: true });
    setTimeout(() => mo.disconnect(), 20000);
  }

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
    const self = !settings.together; // 孩子自己读（默认）
    const base = LEVEL_HEARTS[s.stage] || 3;
    const hearts = h('div', { class: 'r-hearts', title: '这一关的爱心，求助一次用一颗' }, icon(I.heart), h('b', null, String(base)));
    const bar = h('header', { class: 'r-bar' },
      h('button', { class: 'rbtn', type: 'button', 'aria-label': '回到小路', html: I.home, onclick: () => exitReader() }),
      h('div', { class: 'r-title' }, h('b', null, s.title), dots),
      self ? hearts : null,
      h('div', { class: 'r-count' }, ''));
    const text = h('div', { class: 'text', lang: 'zh-CN' });
    const prev = h('button', { class: 'nav prev', type: 'button', 'aria-label': '上一页', html: I.prev, onclick: () => go(-1) });
    const next = h('button', { class: 'nav next', type: 'button', 'aria-label': '下一页', onclick: () => go(1) }, icon(I.next), h('span', { class: 'done-lbl' }, '读完了'));
    const say = h('button', { class: 'say read', type: 'button', 'aria-label': '读一读', onclick: () => toggleRead() },
      icon(I.speaker, 'on-idle'), icon(I.stop, 'on-play'), h('span', { class: 'lbl' }, '读一读'));
    const helpLbl = h('span', { class: 'lbl' }, '求助');
    const help = h('button', { class: 'say help', type: 'button', 'aria-label': '求助', onclick: () => askHelp() },
      h('span', { class: 'ic hand', html: I.help }), helpLbl);
    const tip = h('div', { class: 'help-tip', role: 'status', hidden: true },
      h('span', { class: 'ic hand', html: I.help }), h('span', null, '点一点你不会读的字'),
      h('button', { class: 'tip-x', type: 'button', 'aria-label': '不用了', html: I.close, onclick: (e) => { e.stopPropagation(); cancelHelp(); } }));
    const nudge = h('div', { class: 'help-nudge', hidden: true }, '不会读？点这里求助');
    const card = h('section', { class: 'card' }, h('div', { class: 'card-box' }, prev, text, next, self ? help : say, self ? tip : null, self ? nudge : null));
    const big = h('div', { class: 'bigchar', 'aria-hidden': 'true' });
    const root = h('div', { class: `reader st-${s.stage}${self ? ' self' : ''}` }, scenes, art, hint, bar, card, big);
    app.append(root);
    R = {
      i, s, page: -1, root, scenes, art, hint, dots, count: bar.querySelector('.r-count'), text, prev, next, say, big, token: 0, autoT: 0, swiped: false,
      // 求助：这一关的爱心、求助了几次、求助过的字（再点不扣）、是不是正在挑字
      self, base, hearts: base, helps: 0, helped: new Set(), helping: false, helpPaid: false, hinted: false,
      help, helpLbl, tip, nudgeEl: nudge, heartsEl: hearts,
    };
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
    const H = window.innerHeight - hostBadge; // 底下留出托管网站自己的小标签
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
    const cap = { 1: 116, 2: 98, 3: 86, 4: 74, 5: 80, 6: 76, 7: 80 }[R.s.stage] || 74;
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
        const tile = charTile(c, '', idx, 'text');
        if (R.helped.has(c)) tile.classList.add('helped');
        group.append(tile);
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
    if (R.helping) cancelHelp();
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
    // 这一页的字先下载好，求助时马上能听到
    if (R.self) Voice.prefetch([...new Set(hanOf(pg.text))].concat(R.page === 0 || dir === undefined ? [PHRASES.helpAsk, PHRASES.helpAskFree, PHRASES.helpPick, PHRASES.helpHint] : []));
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

    // 翻页后不自动朗读：先让孩子自己读，不会的字再求助
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

  /* ---------- 自己读 + 求助 ---------- */
  // 孩子先自己读。不会读的字点「求助」→ 确认用一颗爱心 → 点那个字 → 只读这一个字。
  // 求助过的字，这一关里再点就直接读，不再扣。
  function tapToRead(b, c, where) {
    if (where === 'text' && R) {
      if (R.helped.has(c)) {
        if (R.helping) cancelHelp(); // 这个字已经求助过了，不用再花爱心
        stopReading();
        sayChar(c);
        hitTile(b);
        showBig(c);
        return;
      }
      if (R.helping) { useHelp(b, c); return; }
    }
    // 自己读的时候点字不发音：晃一晃，提醒去点「求助」
    b.classList.remove('nope');
    void b.offsetWidth;
    b.classList.add('nope');
    if (where === 'text' && R) nudgeHelp();
  }
  let nudgeT = 0;
  function nudgeHelp() {
    const btn = R.help;
    btn.classList.remove('call');
    void btn.offsetWidth;
    btn.classList.add('call');
    R.nudgeEl.hidden = false;
    clearTimeout(nudgeT);
    nudgeT = setTimeout(() => { if (R) R.nudgeEl.hidden = true; }, 2600);
    // 第一次说出来（小朋友还看不懂字），以后只晃按钮
    if (!R.hinted) { R.hinted = true; Voice.say(PHRASES.helpHint); }
  }
  function updateHearts(spent) {
    if (!R || !R.heartsEl) return;
    const el = R.heartsEl;
    el.querySelector('b').textContent = String(R.hearts);
    el.classList.toggle('empty', R.hearts <= 0);
    if (!spent) return;
    el.classList.remove('spend');
    void el.offsetWidth;
    el.classList.add('spend');
    const r = el.getBoundingClientRect();
    const m = h('span', { class: 'minus-float' }, '−1');
    m.style.left = r.left + r.width / 2 + 'px';
    m.style.top = r.bottom + 'px';
    fx.append(m);
    if (!m.animate) { setTimeout(() => m.remove(), 600); return; }
    m.animate([
      { transform: 'translate(-50%, 0) scale(.6)', opacity: 0 },
      { transform: 'translate(-50%, 10px) scale(1.2)', opacity: 1, offset: 0.25 },
      { transform: 'translate(-50%, 46px) scale(1)', opacity: 0 },
    ], { duration: 1100, easing: 'ease-out' }).onfinish = () => m.remove();
  }
  function askHelp() {
    if (!R) return;
    if (R.helping) { cancelHelp(); return; }
    stopReading();
    R.nudgeEl.hidden = true;
    const left = R.hearts;
    modal('ask', [
      h('div', { class: 'ask-ic', html: I.help }),
      h('h2', null, '不会读了吗？'),
      left > 0
        ? h('p', { class: 'ask-cost' }, h('span', { class: 'cost' }, icon(I.heart), '−1'), h('span', null, `求助要用掉一颗爱心，这一关还有 ${left} 颗。`))
        : h('p', { class: 'ask-cost' }, '这一关的爱心用完了，求助不再扣爱心。'),
      h('p', { class: 'ask-sub' }, '求助以后，点你不会读的那个字，只读这一个字。'),
      h('div', { class: 'ask-btns' },
        h('button', { class: 'btn big', type: 'button', onclick: () => { closeModal(); startHelp(); } },
          h('span', { class: 'ic hand', html: I.help }), '求助'),
        h('button', { class: 'btn soft', type: 'button', onclick: () => { closeModal(); Voice.stop(); } }, '我再试试')),
    ]);
    Voice.say(left > 0 ? PHRASES.helpAsk : PHRASES.helpAskFree);
  }
  function startHelp() {
    if (!R) return;
    R.helpPaid = R.hearts > 0;
    if (R.helpPaid) {
      R.hearts -= 1;
      updateHearts(true);
    }
    R.helps += 1;
    R.helping = true;
    R.root.classList.add('helping');
    R.helpLbl.textContent = '不用了';
    R.help.setAttribute('aria-label', '不用了');
    R.tip.hidden = false;
    Voice.say(PHRASES.helpPick);
  }
  function endHelp() {
    R.helping = false;
    R.helpPaid = false;
    R.root.classList.remove('helping');
    R.helpLbl.textContent = '求助';
    R.help.setAttribute('aria-label', '求助');
    R.tip.hidden = true;
  }
  // 挑字之前不要了：爱心还回去
  function cancelHelp() {
    if (!R || !R.helping) return;
    if (R.helpPaid) {
      R.hearts += 1;
      updateHearts(false);
    }
    R.helps -= 1;
    endHelp();
    Voice.stop();
  }
  function useHelp(b, c) {
    endHelp();
    R.helped.add(c);
    bankAdd(c, 'help');
    R.text.querySelectorAll('.ch').forEach((t) => { if (t.textContent === c) t.classList.add('helped'); });
    stopReading();
    sayChar(c);
    hitTile(b);
    showBig(c);
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

  /* ======================= 认生字（读故事之前） ======================= */
  // 读新故事前：① 先复习生字库里还没过关的字（听音，在十个字里找，每个字要对两次）；
  // ② 把故事里可能不认识的字列出来，孩子自己点不认识的；③ 点了的字一个一个上课；④ 读故事。
  // 上课：有图的生字六步（看一看、变一变、读一读、写一写、说一说、找一找），故事里别的字三步（读一读、写一写、找一找）。
  // 老师的话都是慢一点的录音；一步讲完自动到下一步，读一读、写一写、找一找要等孩子做完。
  const HZ = window.HANZI_INTRO || {};
  const LESSON = window.LESSON || {};
  const PY = window.CHAR_PY || {};
  const SN = window.STROKE_NAMES || {};
  const PRACTICE_LIST = [...PRACTICE];
  const hearOf = (c) => (HZ[c] && HZ[c].hear) || c;
  const linesOf = (c) => (window.lessonLines ? window.lessonLines(c) : { read: '', count: '', find: '', words: [], strokes: [] });
  const strokeName = (key) => key.replace(/^笔画·/, '');
  const canTeach = (c) => !!(HZ[c] || (SN[c] && window.HANZI_STROKES && window.HANZI_STROKES[c]));
  // 故事里所有的字（都有录音、笔顺、拼音）
  const ALL_CHARS = [...new Set(STORIES.flatMap((s) => hanOf(s.title + storyText(s))))];
  const syl = (c) => (PY[c] || c).replace(/\d$/, '');
  const INITIALS = ['zh', 'ch', 'sh', 'b', 'p', 'm', 'f', 'd', 't', 'n', 'l', 'g', 'k', 'h', 'j', 'q', 'x', 'r', 'z', 'c', 's', 'y', 'w'];
  const splitPy = (c) => { const s = syl(c); const i = INITIALS.find((x) => s.startsWith(x)) || ''; return [i, s.slice(i.length)]; };
  // 长得像不像：笔画种类重合得多、笔画数差不多
  function lookAlike(a, b) {
    const A = SN[a] || [];
    const B = SN[b] || [];
    if (!A.length || !B.length) return 0;
    const cnt = {};
    A.forEach((x) => { cnt[x] = (cnt[x] || 0) + 1; });
    let common = 0;
    B.forEach((x) => { if (cnt[x] > 0) { cnt[x] -= 1; common += 1; } });
    return common / Math.max(A.length, B.length) - Math.abs(A.length - B.length) * 0.06;
  }
  // 找字的干扰项：读音不能一样（听音找字要分得出来）；挑 similar 个长得像的，其余随便
  function lookOptions(c, n, similar) {
    const pool = ALL_CHARS.filter((x) => x !== c && syl(x) !== syl(c) && !SKIP_QUIZ.has(x));
    const ranked = pool.map((x) => ({ x, s: lookAlike(c, x) + Math.random() * 0.12 })).sort((a, b) => b.s - a.s).map((o) => o.x);
    const near = shuffle(ranked.slice(0, Math.max(similar * 2, 6))).slice(0, Math.min(similar, n));
    const rest = shuffle(pool.filter((x) => !near.includes(x))).slice(0, n - near.length);
    return [...near, ...rest];
  }
  // 读音的干扰项：读音像（韵母或者声母一样）、但不是同一个音的字
  function soundOptions(c, n) {
    const [i0, f0] = splitPy(c);
    const seen = new Set([syl(c)]);
    return ALL_CHARS.filter((x) => x !== c && PY[x] && !SKIP_QUIZ.has(x) && !(HZ[x] && HZ[x].hear))
      .map((x) => { const [i, f] = splitPy(x); return { x, s: (f === f0 ? 2 : 0) + (i === i0 ? 1.6 : 0) + Math.random() * 1.2 }; })
      .sort((a, b) => b.s - a.s)
      .filter((o) => { if (seen.has(syl(o.x))) return false; seen.add(syl(o.x)); return true; })
      .slice(0, n).map((o) => o.x);
  }

  // 念完再往下走；步骤换了（tok 变了）就停。被别的话打断时也会往下走（得到 false）
  let introEl = null;
  let lessonTok = 0;
  let lessonWriter = null;
  let pendingSay = null;
  const sayP = (text, tok) => new Promise((res) => {
    if (pendingSay) { const p = pendingSay; pendingSay = null; p(false); }
    if (!text || tok !== lessonTok) { res(false); return; }
    pendingSay = res;
    Voice.say(text, { onend: () => { if (pendingSay === res) pendingSay = null; res(true); } });
  });
  const waitP = (ms) => new Promise((res) => setTimeout(res, ms));
  function stopIntroUI() {
    lessonTok += 1;
    if (pendingSay) { const p = pendingSay; pendingSay = null; p(false); }
    if (lessonWriter) { try { lessonWriter.cancelQuiz(); } catch (e) { /* 忽略 */ } lessonWriter = null; }
    if (introEl) { introEl.remove(); introEl = null; }
  }
  // 全屏的一层（上课、复习、挑字、完整读一遍都用它）
  function overlay(cls) {
    Voice.unlock();
    Sfx.unlock();
    closeModal(true);
    stopIntroUI();
    introEl = h('div', { class: 'intro ' + cls });
    document.body.append(introEl);
    return lessonTok;
  }

  /* ---------- 生字库：求助过的字、读故事前说不认识的字 ---------- */
  // bank[字] = { n: 求助几次, k: 说不认识几次, at: 最近一次, m: 复习过关的时间（没有就是还要复习） }
  function bankAdd(c, how) {
    if (!isHan(c)) return;
    const b = progress.bank[c] || (progress.bank[c] = { n: 0, k: 0 });
    if (how === 'help') b.n += 1; else b.k += 1;
    b.at = Date.now();
    delete b.m;
    save();
  }
  const bankDue = () => Object.keys(progress.bank).filter((c) => !progress.bank[c].m)
    .sort((a, b) => (progress.bank[a].at || 0) - (progress.bank[b].at || 0));

  /* ---------- 读新故事：复习 → 挑生字 → 上课 → 读故事 ---------- */
  function startStory(i) {
    const toStory = () => openReader(i);
    const pick = () => {
      const cands = settings.intro ? storyCandidates(i) : [];
      if (cands.length) openPick(i, cands, toStory);
      else toStory();
    };
    const due = settings.review ? bankDue().slice(0, 8) : [];
    if (due.length) openReview(due, { story: i, then: pick });
    else pick();
  }

  // 这个故事里可能不认识的字（五六个）：生字、这一关第一次出现的字、上一关刚出现的字……
  // 已经上过课的、复习过关的、家长标了「认识了」的不再拿出来
  function storyCandidates(i) {
    const s = STORIES[i];
    const chars = [...new Set(hanOf(s.title + storyText(s)))].filter(canTeach);
    const fresh = new Set(EXTRA.filter((e) => e.story === i).map((e) => e.ch));
    const recent = new Set(EXTRA.filter((e) => e.story === i - 1 || e.story === i - 2).map((e) => e.ch));
    const skip = (c) => progress.learned[c] || progress.taught[c] || (progress.bank[c] && progress.bank[c].m);
    const ranked = chars.filter((c) => !skip(c)).map((c, k) => {
      let sc = 0;
      if (progress.bank[c]) sc += 5;
      if (PRACTICE.has(c)) sc += 4;
      if (fresh.has(c)) sc += 3;
      if (recent.has(c)) sc += 2;
      if (!KNOWN.has(c)) sc += 1;
      return { c, sc, k, n: (SN[c] || []).length };
    });
    const top = ranked.filter((x) => x.sc > 0).sort((a, b) => b.sc - a.sc || a.k - b.k).slice(0, 6).map((x) => x.c);
    // 不到五个：再从故事里拿笔画多的字凑上
    const more = ranked.filter((x) => !top.includes(x.c)).sort((a, b) => b.n - a.n || a.k - b.k).map((x) => x.c);
    return top.concat(more.slice(0, Math.max(0, 5 - top.length)));
  }

  /* ---------- 挑生字：孩子自己点不认识的字 ---------- */
  function openPick(i, cands, toStory) {
    const tok = overlay('pick st-' + STORIES[i].stage);
    const chosen = new Set();
    const go = h('button', { class: 'btn big', type: 'button' });
    const drawGo = () => {
      go.innerHTML = '';
      go.append(chosen.size ? `学这 ${chosen.size} 个字` : '我都认识', icon(I.next));
      go.classList.toggle('soft', !chosen.size);
    };
    const tiles = cands.map((c) => {
      const b = h('button', { class: 'ch pk', type: 'button', 'aria-label': c, 'aria-pressed': 'false' }, c, h('span', { class: 'pk-q', 'aria-hidden': 'true' }, '?'));
      b.addEventListener('click', () => {
        if (chosen.has(c)) chosen.delete(c); else chosen.add(c);
        const on = chosen.has(c);
        b.classList.toggle('unk', on);
        b.setAttribute('aria-pressed', on ? 'true' : 'false');
        Sfx.pop();
        pop(b);
        drawGo();
      });
      return b;
    });
    go.addEventListener('click', async () => {
      if (!chosen.size) {
        Voice.stop();
        stopIntroUI();
        Voice.say(LESSON.pickAll);
        toStory();
        return;
      }
      const list = cands.filter((c) => chosen.has(c));
      list.forEach((c) => bankAdd(c, 'pick'));
      await sayP(LESSON.pickLearn, tok);
      if (tok !== lessonTok) return;
      openIntro(list, { story: i });
    });
    drawGo();
    introEl.append(
      h('header', { class: 'q-head' },
        h('button', { class: 'rbtn', type: 'button', 'aria-label': '不挑了，直接读故事', html: I.close, onclick: () => { stopIntroUI(); Voice.stop(); toStory(); } }),
        h('b', null, `读故事前 · ${STORIES[i].title}`)),
      h('div', { class: 'l-stage pk-stage' },
        h('h2', { class: 'pk-title' }, '这些字，你都认识吗？'),
        h('p', { class: 'pk-sub' }, '不认识的字，点一下。'),
        h('div', { class: `pk-grid n${tiles.length}` }, tiles)),
      h('footer', { class: 'i-btns' }, go));
    Voice.prefetch([LESSON.pickAsk, LESSON.pickAll, LESSON.pickLearn]);
    (async () => { await waitP(400); await sayP(LESSON.pickAsk, tok); })();
  }

  /* ---------- 复习：听音，在十个字里找；每个字要找对两次 ---------- */
  // o.story：复习完读哪个故事前的（标题里显示）；o.then：复习完以后做什么
  function openReview(chars, o) {
    o = o || {};
    const tok = overlay('review' + (o.story != null ? ' st-' + STORIES[o.story].stage : ''));
    const need = {};
    chars.forEach((c) => { need[c] = 2; });
    let last = '';
    let busy = false;
    let misses = 0;
    const dots = h('div', { class: 'rv-dots' });
    const drawDots = () => {
      dots.innerHTML = '';
      chars.forEach((c) => dots.append(h('span', { class: 'rv-dot' + (need[c] <= 0 ? ' ok' : '') }, need[c] <= 0 ? c : '')));
    };
    const grid = h('div', { class: 'rv-grid' });
    const sub = h('p', { class: 'l-sub' });
    let target = '';
    const ear = h('button', { class: 'f-ear', type: 'button', 'aria-label': '再听一遍', onclick: () => sayP(target, tok) }, icon(I.speaker), h('span', null, '再听一遍'));
    const finish = async () => {
      chars.forEach((c) => { if (progress.bank[c]) progress.bank[c].m = Date.now(); });
      save();
      grid.innerHTML = '';
      ear.hidden = true;
      grid.append(h('div', { class: 'rv-done' }, chars.map((c) => h('span', { class: 'ch md' }, c))));
      sub.textContent = LESSON.reviewDone;
      Sfx.fanfare();
      confettiRain();
      await sayP(LESSON.reviewDone, tok);
      await waitP(900);
      if (tok !== lessonTok) return;
      stopIntroUI();
      if (o.then) o.then();
    };
    const ask = () => {
      const left = chars.filter((c) => need[c] > 0);
      if (!left.length) { finish(); return; }
      // 轮着问，不连着问同一个字
      const pool = left.length > 1 ? left.filter((c) => c !== last) : left;
      target = pool.sort((a, b) => need[b] - need[a])[0];
      if (pool.length > 1 && Math.random() < 0.4) target = pool[1];
      last = target;
      misses = 0;
      busy = false;
      const opts = shuffle([target, ...lookOptions(target, 9, 4)]);
      grid.innerHTML = '';
      grid.dataset.t = target; // 给自动测试用
      opts.forEach((x) => {
        const b = h('button', { class: 'ch rv-opt', type: 'button', 'aria-label': x }, x);
        b.addEventListener('click', () => answerReview(b, x));
        grid.append(b);
      });
      sub.textContent = '听一听，找一找';
      (async () => { await waitP(250); await sayP(target, tok); })();
    };
    const answerReview = async (b, x) => {
      if (busy || tok !== lessonTok) return;
      if (x === target) {
        busy = true;
        b.classList.add('right');
        if (!misses) need[target] -= 1;
        drawDots();
        Sfx.ding();
        burstAt(b, { set: ['⭐', '✨', '💛'], n: 10 });
        await sayP(PHRASES.praise[Math.floor(Math.random() * PHRASES.praise.length)], tok);
        if (tok === lessonTok) ask();
        return;
      }
      misses += 1;
      b.classList.remove('wrong');
      void b.offsetWidth;
      b.classList.add('wrong');
      Sfx.oops();
      if (misses < 2) {
        await sayP(LESSON.findWrong, tok);
        await sayP(target, tok);
        return;
      }
      // 第二次还不对：告诉孩子在哪里，这个字要多对一次
      busy = true;
      need[target] = Math.min(need[target] + 1, 3);
      const right = grid.querySelector(`.rv-opt[aria-label="${target}"]`);
      if (right) right.classList.add('show');
      sub.textContent = LESSON.reviewShow;
      await sayP(LESSON.reviewShow, tok);
      await sayP(target, tok);
      await waitP(900);
      if (tok === lessonTok) ask();
    };
    introEl.append(
      h('header', { class: 'q-head' },
        h('button', { class: 'rbtn', type: 'button', 'aria-label': '先不复习了', html: I.close, onclick: () => { stopIntroUI(); Voice.stop(); if (o.story != null) renderMap(o.story); else if (o.back) o.back(); } }),
        h('b', null, '复习生字'),
        dots),
      h('div', { class: 'l-stage rv-stage' }, ear, grid),
      sub);
    drawDots();
    Voice.prefetch([LESSON.reviewHello, LESSON.reviewShow, LESSON.reviewDone, LESSON.findWrong, ...PHRASES.praise, ...chars]);
    (async () => {
      sub.textContent = LESSON.reviewHello;
      await waitP(300);
      await sayP(LESSON.reviewHello, tok);
      if (tok === lessonTok) ask();
    })();
  }

  /* ---------- 上课：一个字一个字来 ---------- */
  // 图 →（古时候的字，一笔一笔画出来）→ 字。slow：动画放慢几倍
  function picRow(d, chTile, slow) {
    const k0 = slow || 1;
    const kids = [];
    let t = 0;
    const at = (el, dt) => { el.style.setProperty('--d', t.toFixed(2) + 's'); t += dt * k0; return el; };
    kids.push(at(d.pics ? h('div', { class: 'iv-pic many' }, d.pics.map((e) => h('span', null, e))) : h('div', { class: 'iv-pic' }, d.pic), 0.4));
    if (d.old) {
      kids.push(at(h('span', { class: 'iv-op' }, '→'), 0.15));
      const t0 = t;
      const per = Math.min(0.24, 1.4 / d.old.length) * k0; // 一笔一笔画，笔画多的画快一点
      const paths = d.old.map((pth, k) => `<path d="${pth}" pathLength="1" style="--pd:${(t0 + 0.15 + k * per).toFixed(2)}s;--pdur:${(0.4 * k0).toFixed(2)}s"/>`).join('');
      const svg = `<svg viewBox="0 0 100 100" aria-hidden="true"><g class="${d.turn ? 'turn' : ''}" style="--turn:${d.turn || 0}deg;--td:${(t0 + 0.5 * k0 + d.old.length * per).toFixed(2)}s">${paths}</g></svg>`;
      kids.push(at(h('div', { class: 'iv-old', html: svg }), 0.4 + d.old.length * per / k0 + (d.turn ? 0.6 : 0)));
    }
    kids.push(at(h('span', { class: 'iv-op' }, '→'), 0.2));
    kids.push(at(chTile, 0.5));
    return { el: h('div', { class: 'iv' }, kids), t };
  }
  // 拆开看：部件 + 部件 = 字
  function partsRow(ps, chTile, slow) {
    const k0 = slow || 1;
    const kids = [];
    let t = 0;
    const at = (el, dt) => { el.style.setProperty('--d', t.toFixed(2) + 's'); t += dt * k0; return el; };
    ps.forEach(([g, e, label], k) => {
      if (k) kids.push(at(h('span', { class: 'iv-op' }, '+'), 0.15));
      kids.push(at(h('div', { class: 'iv-part' }, h('span', { class: 'e' }, e), h('span', { class: 'ch md' }, g), h('small', null, label)), 0.45));
    });
    kids.push(at(h('span', { class: 'iv-op' }, '='), 0.2));
    kids.push(at(chTile, 0.5));
    return { el: h('div', { class: 'iv parts' }, kids), t };
  }

  const STEP_INFO = {
    look: { icon: '👀', name: '看一看' },
    grow: { icon: '✨', name: '变一变' },
    read: { icon: '🗣️', name: '读一读' },
    write: { icon: '✍️', name: '写一写' },
    words: { icon: '💬', name: '说一说' },
    find: { icon: '🔍', name: '找一找' },
  };
  const stepsOf = (c) => (HZ[c] ? ['look', 'grow', 'read', 'write', 'words', 'find'] : ['read', 'write', 'find']);
  const FIND_ROUNDS = [3, 4, 4, 6, 6]; // 找一找：找五次，越往后选项越多、越像

  // list：要认的字；o.story：认完以后读哪一关；o.done：认完以后做什么（从字卡、生字库打开时没有）
  function openIntro(list, o) {
    o = o || {};
    list = [...new Set(list)].filter(canTeach);
    if (!list.length) { if (o.done) o.done(); else if (o.story != null) openReader(o.story); return; }
    const story = o.story != null ? STORIES[o.story] : null;
    overlay('lesson' + (story ? ` st-${story.stage}` : ''));
    Voice.prefetch(list.flatMap((c) => {
      const ln = linesOf(c);
      const d = HZ[c] || {};
      return [d.look, d.say, ln.read, ln.count, ln.find, ...ln.words, ...ln.strokes, hearOf(c)];
    }).concat(Object.values(LESSON)));
    let ci = 0;
    let si = 0;
    const finish = () => {
      stopIntroUI();
      Voice.stop();
      if (o.done) o.done();
      else if (story) openReader(o.story);
    };

    function render() {
      lessonTok += 1;
      const tok = lessonTok;
      if (pendingSay) { const p = pendingSay; pendingSay = null; p(false); }
      if (lessonWriter) { try { lessonWriter.cancelQuiz(); } catch (e) { /* 忽略 */ } lessonWriter = null; }
      Voice.stop();
      const c = list[ci];
      const d = HZ[c] || {};
      const ln = linesOf(c);
      const steps = stepsOf(c);
      const sid = steps[si];
      const lastChar = ci === list.length - 1;
      const hear = hearOf(c);
      const sub = h('p', { class: 'l-sub' });
      const stage = h('div', { class: `l-stage l-${sid}` });
      const nextBtn = h('button', { class: 'btn big l-next', type: 'button' });
      const setSub = (t) => { sub.textContent = t || ''; };
      const go = (n) => { si = n; render(); };
      const nextStep = () => {
        if (tok !== lessonTok) return;
        if (si < steps.length - 1) go(si + 1);
      };
      const nextChar = () => {
        if (ci < list.length - 1) { ci += 1; si = 0; render(); } else finish();
      };
      const lastStep = si === steps.length - 1;
      if (lastStep) {
        nextBtn.append(lastChar ? (story ? '开始读故事' : '好了') : '下一个字', icon(I.next));
        nextBtn.addEventListener('click', nextChar);
      } else {
        nextBtn.append('下一步', icon(I.next));
        nextBtn.addEventListener('click', () => go(si + 1));
      }
      const learnBtn = story || !lastStep || !PRACTICE.has(c) ? null
        : h('button', { class: 'btn soft learn' + (progress.learned[c] ? ' on' : ''), type: 'button' }, icon(I.check), progress.learned[c] ? '已经认识了' : '认识了');
      if (learnBtn) {
        learnBtn.addEventListener('click', () => {
          progress.learned[c] = !progress.learned[c];
          if (!progress.learned[c]) delete progress.learned[c];
          save();
          learnBtn.classList.toggle('on', !!progress.learned[c]);
          learnBtn.lastChild.textContent = progress.learned[c] ? '已经认识了' : '认识了';
          if (progress.learned[c]) { Sfx.ding(); burstAt(learnBtn, { set: ['⭐', '✨', '💛'], n: 10, dist: 90 }); }
        });
      }
      const replay = h('button', { class: 'btn soft', type: 'button', onclick: () => render() }, icon(I.speaker), '再听一遍');
      introEl.innerHTML = '';
      introEl.append(
        h('header', { class: 'q-head' },
          h('button', { class: 'rbtn', type: 'button', 'aria-label': story ? '不认了，直接读故事' : '关闭', html: I.close, onclick: finish }),
          h('b', null, story ? `先认生字 · ${c}` : `认生字 · ${c}`),
          h('div', { class: 'i-dots' }, list.length > 1 ? list.map((x, j) => h('i', { class: j === ci ? 'on' : j < ci ? 'done' : '' })) : null)),
        h('nav', { class: 'l-steps' }, steps.map((id, k) => h('button', {
          class: 'l-step' + (k === si ? ' on' : k < si ? ' done' : ''), type: 'button', 'aria-label': STEP_INFO[id].name, onclick: () => go(k),
        }, h('span', { class: 'e' }, STEP_INFO[id].icon), h('span', null, STEP_INFO[id].name)))),
        stage, sub,
        h('footer', { class: 'i-btns' }, replay, learnBtn, nextBtn));

      const big = () => {
        const b = h('button', { class: `ch xl l-ch${KNOWN.has(c) ? '' : ' new'}`, type: 'button', 'aria-label': c, onclick: () => { Voice.say(hear); pop(b); } }, c);
        return b;
      };

      if (sid === 'look') {
        stage.append(d.pics ? h('div', { class: 'l-pic many' }, d.pics.map((e) => h('span', null, e))) : h('div', { class: 'l-pic' }, d.pic || (d.parts && d.parts[0][1])));
        setSub(d.look);
        (async () => {
          await waitP(400);
          await sayP(d.look, tok);
          await waitP(900);
          nextStep();
        })();
      } else if (sid === 'grow') {
        const row = d.parts ? partsRow(d.parts, big(), 1.6) : picRow(d, big(), 1.6);
        stage.append(row.el);
        setSub(d.say);
        (async () => {
          await waitP(row.t * 1000 + 500);
          await sayP(d.say, tok);
          await waitP(1000);
          nextStep();
        })();
      } else if (sid === 'read') {
        // ① 老师念：念三遍，一遍一遍停一停 ② 三只小动物各念一个，孩子听一听，谁念对了
        const ch = big();
        const row = h('div', { class: 'snd-row', hidden: true });
        stage.append(ch, row);
        const intro = ln.read || LESSON.readIntro;
        setSub(intro);
        (async () => {
          await waitP(500);
          await sayP(intro, tok);
          const said = [];
          for (let k = 0; k < 3; k++) {
            if (tok !== lessonTok) return;
            await waitP(k ? 900 : 600);
            if (tok !== lessonTok) return;
            said.push(hear);
            setSub(`${ln.read || ''}${said.join('，')}${k === 2 ? '。' : '，'}`);
            pop(ch);
            await sayP(hear, tok);
          }
          await waitP(800);
          if (tok !== lessonTok) return;
          if (d.hear) { nextStep(); return; } // 「着」这样单念不好念的字，不考读音
          const opts = shuffle([c, ...soundOptions(c, 2)]);
          const animals = [['🐶', LESSON.dog], ['🐱', LESSON.cat], ['🐰', LESSON.bunny]];
          let picked = false;
          let run = 0;
          const cards = opts.map((x, k) => h('button', { class: 'snd-card', type: 'button', 'aria-label': animals[k][1].replace('：', '') },
            h('span', { class: 'e' }, animals[k][0]), icon(I.speaker)));
          const playAll = async () => {
            const my = ++run;
            for (let k = 0; k < cards.length; k++) {
              if (my !== run || picked || tok !== lessonTok) return;
              cards.forEach((b, j) => b.classList.toggle('on', j === k));
              setSub(animals[k][1]);
              if (!(await sayP(animals[k][1], tok)) || my !== run) return;
              if (!(await sayP(opts[k], tok)) || my !== run) return;
              await waitP(450);
            }
            cards.forEach((b) => b.classList.remove('on'));
            if (my === run && !picked && tok === lessonTok) { setSub(LESSON.soundWho); await sayP(LESSON.soundWho, tok); }
          };
          cards.forEach((b, k) => b.addEventListener('click', async () => {
            if (picked || tok !== lessonTok) return;
            run += 1; // 停下正在念的
            cards.forEach((x) => x.classList.remove('on'));
            if (opts[k] === c) {
              picked = true;
              b.classList.add('right');
              Sfx.ding();
              burstAt(b, { set: ['⭐', '✨', '💛'], n: 12 });
              setSub(LESSON.soundRight);
              await sayP(LESSON.soundRight, tok);
              pop(ch);
              await sayP(hear, tok);
              await waitP(900);
              nextStep();
            } else {
              b.classList.remove('wrong');
              void b.offsetWidth;
              b.classList.add('wrong');
              Sfx.oops();
              setSub(LESSON.soundWrong);
              if (await sayP(LESSON.soundWrong, tok)) playAll();
            }
          }));
          row.append(...cards);
          row.dataset.k = String(opts.indexOf(c)); // 给自动测试用
          row.hidden = false;
          setSub(LESSON.soundAsk);
          if (await sayP(LESSON.soundAsk, tok)) playAll();
        })();
      } else if (sid === 'write') {
        const target = h('div', { class: 'l-target' });
        const count = h('p', { class: 'l-count' });
        stage.append(target, count);
        setSub(LESSON.writeIntro);
        const data = window.HANZI_STROKES && window.HANZI_STROKES[c];
        const names = ln.strokes.map(strokeName);
        const showStroke = (k, done) => {
          count.innerHTML = '';
          count.append(...[h('span', { class: 'sk' }, `第 ${k + 1} 笔`), names[k] ? h('b', null, names[k]) : null, done ? ' ✓' : null].filter(Boolean));
        };
        if (!data || !window.HanziWriter) {
          target.append(big());
          (async () => { await sayP(LESSON.writeIntro, tok); await waitP(1000); nextStep(); })();
        } else {
          const size = Math.round(Math.min(320, window.innerWidth * 0.6, window.innerHeight * 0.36));
          target.style.width = target.style.height = size + 'px';
          const writer = window.HanziWriter.create(target, c, {
            width: size, height: size, padding: Math.round(size * 0.06),
            showOutline: true, showCharacter: false,
            strokeColor: '#2b2433', outlineColor: '#eadcc4', highlightColor: '#ff9f43', drawingColor: '#ff6fa8',
            drawingWidth: Math.max(14, Math.round(size / 14)), strokeAnimationSpeed: 0.55, delayBetweenStrokes: 450,
            charDataLoader: (ch, onLoad) => onLoad(window.HANZI_STROKES[ch]),
          });
          lessonWriter = writer;
          const n = data.strokes.length;
          const strokeP = (k) => new Promise((res) => writer.animateStroke(k, { onComplete: res }));
          (async () => {
            await waitP(300);
            await sayP(LESSON.writeIntro, tok);
            // 一笔一笔写，一边写一边说笔画的名字：横、竖、横折钩……
            for (let k = 0; k < n; k++) {
              if (tok !== lessonTok) return;
              showStroke(k);
              await Promise.all([strokeP(k), ln.strokes[k] ? sayP(ln.strokes[k], tok) : Sfx.count(k + 1)]);
              await waitP(450);
            }
            if (tok !== lessonTok) return;
            count.textContent = `一共 ${n} 笔`;
            await sayP(ln.count, tok);
            await waitP(400);
            if (tok !== lessonTok) return;
            // 用手指描：老师一开口就可以描（不用等老师说完）；描对一笔就说下一笔叫什么；描错两次会提示从哪里开始
            setSub(LESSON.traceAsk);
            writer.hideCharacter();
            showStroke(0);
            let started = false;
            writer.quiz({
              showHintAfterMisses: 2, highlightOnComplete: true, leniency: 1.5,
              onCorrectStroke: (st) => {
                started = true;
                Sfx.pop();
                const k = st.strokeNum + 1;
                if (k < n) { showStroke(k); if (ln.strokes[k]) sayP(ln.strokes[k], tok); }
              },
              onComplete: async () => {
                if (tok !== lessonTok) return;
                count.textContent = '写好啦！';
                Sfx.ding();
                burstAt(target, { set: ['⭐', '✨', '💛'], n: 14, dist: 140 });
                await sayP(LESSON.traceDone, tok);
                await waitP(900);
                nextStep();
              },
            });
            nextBtn.classList.add('call');
            await sayP(LESSON.traceAsk, tok);
            if (tok === lessonTok && !started && ln.strokes[0]) sayP(ln.strokes[0], tok);
          })();
        }
      } else if (sid === 'words') {
        const tiles = (d.words || []).map((w) => h('button', { class: 'iw-w big', type: 'button', 'aria-label': w, onclick: () => Voice.say(w) },
          [...w].map((x) => h('span', { class: 'ch sm' + (x === c ? ' tg' : '') }, x))));
        stage.append(h('div', { class: 'iw' }, tiles));
        setSub(LESSON.wordsIntro);
        (async () => {
          await waitP(400);
          await sayP(LESSON.wordsIntro, tok);
          for (let k = 0; k < tiles.length; k++) {
            if (tok !== lessonTok) return;
            tiles.forEach((t, j) => t.classList.toggle('on', j === k));
            setSub(ln.words[k]);
            await waitP(250);
            await sayP(ln.words[k], tok);
            await waitP(700);
          }
          if (tok !== lessonTok) return;
          tiles.forEach((t) => t.classList.remove('on'));
          await waitP(400);
          nextStep();
        })();
      } else if (sid === 'find') {
        // 找五次：选项从三个慢慢变成六个，长得像的越来越多
        const stars = h('div', { class: 'f-stars' }, FIND_ROUNDS.map(() => icon(I.star)));
        const grid = h('div', { class: 'f-opts' });
        const ear = h('button', { class: 'f-ear', type: 'button', 'aria-label': '再听一遍', onclick: () => sayP(hear, tok) }, icon(I.speaker), h('span', null, '再听一遍'));
        stage.append(stars, ear, grid);
        let round = 0;
        let busy = false;
        const prompt = async () => {
          if (round === 0 && ln.find) { await sayP(ln.find, tok); return; }
          if (await sayP(round === 0 ? LESSON.findIntro : LESSON.findMore, tok)) await sayP(hear, tok);
        };
        const showRound = () => {
          busy = false;
          const n = FIND_ROUNDS[round];
          const opts = shuffle([c, ...lookOptions(c, n - 1, Math.min(n - 1, round + 1))]);
          grid.className = `f-opts n${n}`;
          grid.innerHTML = '';
          setSub(round === 0 && ln.find ? ln.find : (round === 0 ? LESSON.findIntro : LESSON.findMore) + hear);
          opts.forEach((x) => {
            const b = h('button', { class: 'ch f-opt', type: 'button', 'aria-label': x }, x);
            b.addEventListener('click', async () => {
              if (busy || tok !== lessonTok) return;
              if (x !== c) {
                b.classList.remove('wrong');
                void b.offsetWidth;
                b.classList.add('wrong');
                Sfx.oops();
                setSub(LESSON.findWrong);
                if (await sayP(LESSON.findWrong, tok)) await sayP(hear, tok);
                return;
              }
              busy = true;
              b.classList.add('right');
              stars.children[round].classList.add('got');
              Sfx.ding();
              burstAt(b, { set: ['⭐', '✨', '🌟', '💛'], n: 12 });
              round += 1;
              if (round < FIND_ROUNDS.length) {
                await sayP(PHRASES.praise[(round + ci) % PHRASES.praise.length], tok);
                if (tok !== lessonTok) return;
                showRound();
                prompt();
                return;
              }
              // 五次都找到了：这个字学会了，以后读故事前不再拿出来
              progress.taught[c] = Date.now();
              progress.intro[c] = (progress.intro[c] || 0) + 1;
              save();
              setSub(LESSON.findRight);
              await sayP(LESSON.findRight, tok);
              setSub(LESSON.done);
              await sayP(LESSON.done, tok);
              if (tok !== lessonTok) return;
              nextBtn.classList.add('call');
              // 从故事、生字库来的：过一会儿自己往下走；从字卡来的等孩子点
              await waitP(2000);
              if (tok === lessonTok && (story || o.done)) nextChar();
            });
            grid.append(b);
          });
        };
        showRound();
        (async () => { await waitP(400); await prompt(); })();
      }
    }
    render();
  }

  /* ---------- 生字库 ---------- */
  function openBank() {
    const due = bankDue();
    const all = Object.keys(progress.bank).sort((a, b) => (progress.bank[b].at || 0) - (progress.bank[a].at || 0));
    const okList = all.filter((c) => progress.bank[c].m);
    const tile = (c) => {
      const b = progress.bank[c];
      const note = [b.n ? `求助 ${b.n} 次` : '', b.k ? '说不认识' : ''].filter(Boolean).join(' · ');
      return h('button', { class: 'bk' + (b.m ? ' got' : ''), type: 'button', 'aria-label': c, onclick: () => openIntro([c], { done: openBank }) },
        h('span', { class: 'ch md' + (b.m ? '' : ' practice') }, c), h('small', null, note || '　'), b.m ? h('span', { class: 'ok', html: I.check }) : null);
    };
    modal('sheet bank', [
      h('h2', null, '生字库'),
      h('p', { class: 'sheet-sub' }, '读故事时求助过的字、读故事前说不认识的字，都放在这里。读新故事以前，要先把「要复习」的字复习一遍（听一听，在十个字里找一找，每个字找对两次）。点一个字可以再上一次课。'),
      all.length ? null : h('p', { class: 'bk-empty' }, '还没有生字。读故事时点「求助」的字，会放到这里。'),
      due.length ? [
        h('div', { class: 'bk-head' }, h('h3', null, `要复习（${due.length} 个）`),
          h('button', { class: 'btn tiny', type: 'button', onclick: () => openReview(due.slice(0, 10), { then: openBank, back: openBank }) }, icon(I.replay), '复习一下')),
        h('div', { class: 'bk-grid' }, due.map(tile)),
      ] : null,
      okList.length ? [
        h('div', { class: 'bk-head' }, h('h3', null, `复习过关的（${okList.length} 个）`),
          h('button', { class: 'btn tiny soft', type: 'button', onclick: () => openReview(shuffle(okList).slice(0, 10), { then: openBank, back: openBank }) }, icon(I.replay), '再考一考')),
        h('div', { class: 'bk-grid' }, okList.map(tile)),
      ] : null,
    ]);
  }

  /* ---------- 挑战：把整个故事从头到尾读一遍 ---------- */
  // 一句一句往下读；不会的字可以求助（读完的奖励少一颗爱心），求助的字放进生字库
  function sentencesOf(s) {
    const out = [];
    s.pages.forEach((p) => {
      let cur = '';
      const chars = [...p.text];
      chars.forEach((c, k) => {
        cur += c;
        const next = chars[k + 1];
        if ('。！？'.includes(c) && next !== '”' && next !== '」' && next !== '！' && next !== '？') { out.push(cur); cur = ''; }
        else if ((c === '”' || c === '」') && '。！？'.includes(chars[k - 1] || '')) { out.push(cur); cur = ''; }
      });
      if (cur.trim()) out.push(cur);
    });
    return out;
  }
  function openChallenge(i) {
    stopQuizUI();
    const s = STORIES[i];
    const tok = overlay('challenge st-' + s.stage);
    const lines = sentencesOf(s);
    const BONUS = 5;
    let at = 0;
    let helps = 0;
    let helping = false;
    const bar = h('div', { class: 'ch-bar' }, h('i'));
    const count = h('span', { class: 'ch-count' });
    const list = h('div', { class: 'ch-list', lang: 'zh-CN' });
    // 标点粘在字上（前引号粘后面的字，句号、逗号粘前面的字），不会单独跑到下一行开头
    const groups = (line) => {
      const out = [];
      let lead = [];
      [...line].forEach((c) => {
        if (isHan(c)) { out.push({ c, pre: lead, post: [] }); lead = []; }
        else if ('“「（《'.includes(c) || !out.length) lead.push(c);
        else out[out.length - 1].post.push(c);
      });
      if (lead.length && out.length) out[out.length - 1].post.push(...lead);
      return out;
    };
    const rows = lines.map((line, k) => {
      const row = h('p', { class: 'ch-line' }, groups(line).map((g) => h('span', { class: 'ch-w' },
        g.pre.map((x) => h('span', { class: 'ch-p' }, x)),
        h('span', { class: 'ch-c', onclick: (e) => tapChar(e.currentTarget, g.c, k) }, g.c),
        g.post.map((x) => h('span', { class: 'ch-p' }, x)))));
      list.append(row);
      return row;
    });
    const helpBtn = h('button', { class: 'say help', type: 'button', 'aria-label': '求助', onclick: () => toggleHelp() }, h('span', { class: 'ic hand', html: I.help }), h('span', { class: 'lbl' }, '求助'));
    const next = h('button', { class: 'btn big', type: 'button', onclick: () => advance() }, '读完这一句', icon(I.next));
    const tip = h('p', { class: 'ch-tip', hidden: true }, '点一点你不会读的字');
    function setHelping(on) {
      helping = on;
      if (!introEl) return;
      introEl.classList.toggle('helping', on);
      tip.hidden = !on;
      helpBtn.querySelector('.lbl').textContent = on ? '不用了' : '求助';
      if (on) Voice.say(PHRASES.helpPick);
    }
    // 求助要先确认：读完的时候少得一颗爱心
    function toggleHelp() {
      if (helping) { setHelping(false); Voice.stop(); return; }
      modal('ask', [
        h('div', { class: 'ask-ic', html: I.help }),
        h('h2', null, '不会读了吗？'),
        h('p', { class: 'ask-cost' }, h('span', { class: 'cost' }, icon(I.heart), '−1'), h('span', null, '求助一次，读完的时候少得一颗爱心。')),
        h('p', { class: 'ask-sub' }, '求助以后，点这一句里你不会读的那个字，只读这一个字。'),
        h('div', { class: 'ask-btns' },
          h('button', { class: 'btn big', type: 'button', onclick: () => { closeModal(); setHelping(true); } }, h('span', { class: 'ic hand', html: I.help }), '求助'),
          h('button', { class: 'btn soft', type: 'button', onclick: () => { closeModal(); Voice.stop(); } }, '我再试试')),
      ]);
      Voice.say(PHRASES.helpAsk);
    }
    function tapChar(el, c, k) {
      if (k !== at) return;
      if (!helping && !el.classList.contains('helped')) { el.classList.remove('nope'); void el.offsetWidth; el.classList.add('nope'); return; }
      if (helping) {
        setHelping(false);
        helps += 1;
        bankAdd(c, 'help');
      }
      list.querySelectorAll('.ch-c').forEach((t) => { if (t.textContent === c) t.classList.add('helped'); });
      sayChar(c);
      pop(el);
    }
    function show() {
      rows.forEach((r, k) => { r.className = 'ch-line' + (k < at ? ' done' : k === at ? ' cur' : ''); });
      count.textContent = `第 ${Math.min(at + 1, lines.length)} 句 / 共 ${lines.length} 句`;
      bar.firstChild.style.width = (at / lines.length) * 100 + '%';
      if (rows[at]) rows[at].scrollIntoView({ block: 'center', behavior: 'smooth' });
      next.firstChild.textContent = at === lines.length - 1 ? '读完了' : '读完这一句';
    }
    function advance() {
      if (helping) setHelping(false);
      Sfx.page();
      at += 1;
      if (at < lines.length) { show(); return; }
      done();
    }
    function done() {
      const gain = Math.max(1, BONUS - helps);
      progress.hearts += gain;
      const c0 = progress.challenge[s.id] || { n: 0 };
      progress.challenge[s.id] = { n: c0.n + 1, at: Date.now() };
      save();
      introEl.innerHTML = '';
      introEl.append(h('div', { class: 'ch-done' },
        h('div', { class: 'ch-crown', 'aria-hidden': 'true' }, '👑'),
        h('h2', null, `《${s.title}》从头到尾读完啦！`),
        h('p', { class: 'rw-hearts' }, icon(I.heart), h('b', { class: 'plus' }, '+' + gain), h('span', null, `一共 ${progress.hearts} 颗爱心`)),
        helps ? h('p', { class: 'rw-help' }, h('span', { class: 'ic hand', html: I.help }), `求助了 ${helps} 次，这些字放进了生字库`) : h('p', { class: 'rw-help solo' }, icon(I.star), '一次也没求助！'),
        h('div', { class: 'rw-btns' },
          i + 1 < STORIES.length ? h('button', { class: 'btn big', type: 'button', onclick: () => { stopIntroUI(); startStory(i + 1); } }, '下一关', icon(I.next)) : null,
          h('button', { class: 'btn soft', type: 'button', onclick: () => { stopIntroUI(); renderMap(i); } }, icon(I.home), '回到小路'))));
      Sfx.fanfare();
      confettiRain();
      sayP(LESSON.challengeDone, tok);
    }
    introEl.append(
      h('header', { class: 'q-head' },
        h('button', { class: 'rbtn', type: 'button', 'aria-label': '不读了，回到小路', html: I.close, onclick: () => { stopIntroUI(); Voice.stop(); renderMap(i); } }),
        h('b', null, `完整读一遍 · ${s.title}`),
        count),
      bar,
      list,
      tip,
      h('footer', { class: 'i-btns ch-btns' }, helpBtn, next));
    show();
    (async () => { await waitP(300); await sayP(LESSON.challengeGo, tok); })();
  }

  /* ======================= 小挑战 ======================= */
  let quizEl = null;
  function stopQuizUI() {
    if (quizEl) { quizEl.remove(); quizEl = null; }
    Q = null;
  }

  function startQuiz() {
    if (R.helping) cancelHelp();
    stopReading();
    const s = R.s;
    const pool = [...new Set(hanOf(storyText(s)))].filter((c) => KNOWN.has(c) && !SKIP_QUIZ.has(c));
    const first = shuffle(pool.filter((c) => PRACTICE.has(c)));
    const fromTitle = shuffle(pool.filter((c) => !PRACTICE.has(c) && s.title.includes(c)));
    const rest = shuffle(pool.filter((c) => !PRACTICE.has(c) && !s.title.includes(c)));
    const targets = [...new Set([...first, ...fromTitle.slice(0, 1), ...rest])].slice(0, 3);
    Q = { s, i: R.i, pool, targets, n: 0, firstTry: 0, missed: false, busy: false, self: R.self, base: R.base, hearts: R.hearts, helps: R.helps };
    Voice.prefetch([PHRASES.quizAsk, PHRASES.quizAgain, ...PHRASES.praise, ...targets]);
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
    // 第一题说「找一找」，后面的题直接念字，快一点
    const prompt = () => Voice.seq(Q.n === 0 ? [PHRASES.quizAsk, t] : [t]);
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
          ? h('button', { class: 'q-ear', type: 'button', onclick: () => Voice.say(t) }, icon(I.speaker), h('span', null, '听一听，点一点'))
          : h('div', { class: 'q-ear static' }, h('span', null, '找一样的字'), h('span', { class: 'ch md' }, t)),
        h('div', { class: `q-opts n${opts.length}` }, opts.map((c) => {
          const b = h('button', { class: 'ch q-opt', type: 'button', 'aria-label': c }, c);
          b.addEventListener('click', () => answer(b, c, t));
          return b;
        }))));
    if (talk) setTimeout(() => { if (Q && Q.targets[Q.n] === t) prompt(); }, Q.n === 0 ? 250 : 80);
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
      }, 850);
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
    // 这一关的爱心（求助用掉的不算）+ 小挑战一次答对的
    const gain = Q.hearts + Q.firstTry;
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
      Q.self ? h('p', { class: 'rw-help' + (Q.helps ? '' : ' solo') },
        Q.helps ? [h('span', { class: 'ic hand', html: I.help }), `求助了 ${Q.helps} 次，用掉 ${Q.base - Q.hearts} 颗爱心`]
          : [icon(I.star), '全靠自己读完，一次也没求助！']) : null,
      medal ? h('p', { class: 'rw-medal' }, `爱心满 ${medal[0]} 颗，得到${medal[2]} ${medal[1]}`) : null,
      nextI < 0 ? h('p', { class: 'rw-all' }, '所有故事都读完啦！') : null,
      h('div', { class: 'rw-btns' },
        nextI >= 0 ? h('button', { class: 'btn big', type: 'button', onclick: () => { stopQuizUI(); startStory(nextI); } }, '下一关', icon(I.next)) : null,
        // 挑战：把整个故事从头到尾读一遍（「再读一遍」在封面上还有）
        h('button', { class: 'btn soft chal', type: 'button', onclick: () => openChallenge(i) }, progress.challenge[s.id] ? '👑 再挑战' : '📖 完整读一遍'),
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
        Voice.seq([PHRASES.rewardPrefix, s.prize[1], LESSON.challengeAsk]);
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
    const szPic = (c) => (HZ[c] ? HZ[c].pic || (HZ[c].pics && HZ[c].pics[0]) || (HZ[c].parts && HZ[c].parts[0][1]) : '');
    modal('sheet', [
      h('h2', null, '字卡'),
      PRACTICE_LIST.length ? [
        h('h3', null, `${KID.name}的生字（${PRACTICE_LIST.length} 个）`),
        h('p', { class: 'sheet-sub' }, '点一个字，像上课一样认一认；认会了可以点「认识了」，以后读故事前就不再拿出来。'),
        h('div', { class: 'sz-grid' }, PRACTICE_LIST.map((c) => h('button', {
          class: 'sz' + (progress.learned[c] ? ' got' : ''), type: 'button', 'aria-label': c,
          onclick: () => (canTeach(c) ? openIntro([c], { done: openChars }) : sayChar(c)),
        }, h('span', { class: 'e' }, szPic(c)), h('span', { class: 'ch md practice' }, c), progress.learned[c] ? h('span', { class: 'ok', html: I.check }) : null))),
        h('h3', null, '所有学过的字'),
      ] : null,
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
        row('家长陪读', sw('set-together', settings.together, (v) => { settings.together = v; save(); }),
          '关着（默认）：孩子先自己读，不会的字点「求助」，用一颗爱心换一个字的读音。打开：故事页有「读一读」可以整页朗读，点字直接发音，不扣爱心。'),
        row('读故事前挑生字', sw('set-intro', settings.intro, (v) => { settings.intro = v; save(); }),
          `读新故事以前，把故事里可能不认识的字列出来（五六个），${KID.name}自己点不认识的字，再一个一个上课：看一看、变一变、读一读（听小动物念，挑出念对的）、写一写（一笔一笔说笔画名称，再用手指描）、说一说、找一找（找五次）。上过课的字以后不再拿出来。`),
        row('读新故事前先复习', sw('set-review', settings.review, (v) => { settings.review = v; save(); if (view === 'map') renderMap(); }),
          '读故事时求助过的字、说不认识的字，会放进「生字库」。读新故事以前，先把这些字复习一遍：听一听，在十个字里找出来，每个字要找对两次才过关。'),
        row('读到哪一关', (() => {
          const cur = currentLevel();
          const sel = h('select', { id: 'set-level', 'aria-label': '选择从哪一关接着读' }, STAGES.map((st, si) => h('optgroup', { label: st.name },
            STORIES.map((x, k) => [x, k]).filter(([x]) => x.stage === si + 1).map(([x, k]) => {
              const op = h('option', { value: String(k) }, `第 ${k + 1} 关 · ${x.title}`);
              if (k === (cur < 0 ? STORIES.length - 1 : cur)) op.selected = true;
              return op;
            }))));
          const apply = () => {
            const k = Number(sel.value);
            STORIES.forEach((x, j) => {
              if (j < k) { if (!progress.done[x.id]) progress.done[x.id] = { n: 1, at: Date.now() }; } else delete progress.done[x.id];
            });
            save();
            closeModal();
            renderMap(k);
            toast(`设好了：从第 ${k + 1} 关《${STORIES[k].title}》接着读`);
          };
          return h('div', { class: 'lv-set' }, sel, h('button', { class: 'btn tiny', type: 'button', onclick: apply }, '设好'));
        })(), '换了设备、或者进度没了的时候用：选的这一关前面的都算读完了，从这一关接着读（后面的关重新锁上）。爱心和生字库不变。'),
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
        h('p', { class: 'credit' }, '故事字体：霞鹜文楷 GB（SIL OFL 1.1）。笔顺：Hanzi Writer（MIT）、hanzi-writer-data（Arphic）；笔画名称：cnchar（MIT）。',
          Cloud.on ? '进度存在你的 claude.ai 账号里，换设备也在。' : '进度只存在这台设备的浏览器里。'),
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
    if (introEl) return;
    if (view !== 'reader' || !R || quizEl) return;
    if (e.key === 'ArrowRight') go(1);
    else if (e.key === 'ArrowLeft') go(-1);
    else if (e.key === ' ' && settings.together) { e.preventDefault(); toggleRead(); }
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
    watchHostBadge();
    Cloud.init(() => { if (view === 'map' && !introEl && !currentModal) renderMap(); });
    loadUserPhotos().then(() => { if (view === 'map' && userPhotos.length) renderMap(); });
    renderMap();
    if (data && data.view === 'reader' && data.story != null && STORIES[data.story]) openReader(data.story, data.page || 0);
  }
  if (hot && hot.ready) hot.ready(start);
  else start((hot && hot.data) || {});
})();
