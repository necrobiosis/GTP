/*
 * 声音：
 *   Voice  —— 先放录好的 mp3（audio/ 文件夹，见 tools/gen-audio.py），没有录音的话再用设备自带的中文语音。
 *   Speech —— 设备自带的中文语音（备用）。
 *   Sfx    —— 小音效（Web Audio 现场合成，不用音频文件）。
 * iPad / iPhone 只有在点屏幕的时候才允许出声，所以第一次点屏幕时会先「打开」声音（Voice.unlock）。
 */
window.Speech = (function () {
  'use strict';
  const synth = window.speechSynthesis;
  const ok = !!(synth && window.SpeechSynthesisUtterance);
  let voices = [];
  let chosen = null;  // 只有家长在设置里选了声音，才指定声音；否则交给系统按 zh-CN 挑
  let pref = '';
  let rate = 0.8;
  let unlocked = false;
  let current = null; // 留住引用，避免某些浏览器回收后不触发 onend
  let watchdog = 0;
  let pendingT = 0;
  const listeners = [];

  function isChinese(v) {
    return /^(zh|cmn)/i.test(v.lang) || /chinese|中文|普通话|國語|国语/i.test(v.name);
  }
  function refresh() {
    if (!ok) return;
    voices = synth.getVoices().filter(isChinese).filter((v) => !/zh[-_]hk|yue/i.test(v.lang));
    chosen = pref ? voices.find((v) => v.voiceURI === pref) || null : null;
    listeners.forEach((f) => f());
  }
  if (ok) {
    refresh();
    if (synth.addEventListener) synth.addEventListener('voiceschanged', refresh);
    else synth.onvoiceschanged = refresh;
    setTimeout(refresh, 300);
    setTimeout(refresh, 1500);
  }

  function unlock() {
    if (!ok || unlocked || synth.speaking || synth.pending) return;
    try {
      const u = new SpeechSynthesisUtterance(' ');
      u.volume = 0;
      synth.speak(u);
      unlocked = true;
    } catch (e) { /* 忽略 */ }
  }

  function speak(text, o) {
    o = o || {};
    if (!ok) {
      if (o.onend) setTimeout(o.onend, 250);
      return false;
    }
    clearTimeout(watchdog);
    clearTimeout(pendingT);
    const go = () => {
      const u = new SpeechSynthesisUtterance(text);
      u.lang = chosen ? chosen.lang : 'zh-CN';
      if (chosen) u.voice = chosen;
      u.rate = o.rate || rate;
      u.pitch = 1.05;
      u.volume = 1;
      let ended = false;
      const end = () => {
        if (ended) return;
        ended = true;
        clearTimeout(watchdog);
        if (current === u) current = null;
        if (o.onend) o.onend();
      };
      u.onstart = () => { if (o.onstart) o.onstart(); };
      u.onend = end;
      u.onerror = end;
      u.onboundary = (e) => { if (o.onboundary) o.onboundary(e); };
      current = u;
      synth.speak(u);
      if (synth.paused) synth.resume();
      watchdog = setTimeout(end, 3000 + (text.length * 520) / u.rate);
    };
    // 正在说话时先停下；否则马上说（这样还在「点击」里面，iPad 才肯出声）
    if (synth.speaking || synth.pending) {
      synth.cancel();
      pendingT = setTimeout(go, 90);
    } else {
      go();
    }
    return true;
  }

  function stop() {
    if (!ok) return;
    clearTimeout(watchdog);
    clearTimeout(pendingT);
    current = null;
    if (synth.speaking || synth.pending) synth.cancel();
  }

  return {
    ok,
    speak,
    stop,
    unlock,
    get voices() { return voices; },
    get voice() { return chosen; },
    get rate() { return rate; },
    setRate(r) { rate = r; },
    setVoice(uri) { pref = uri || ''; refresh(); },
    onVoices(f) { listeners.push(f); },
  };
})();

window.Voice = (function () {
  'use strict';
  const INDEX = window.AUDIO_INDEX || {};
  const DATA = window.AUDIO_DATA || null; // 打包成一个文件时，录音直接放在网页里
  // 录音放在哪里：默认是网页旁边的 audio/；放在别处（比如 CDN）时在网页里先写 window.AUDIO_BASE = '…/audio/'
  const BASE = window.AUDIO_BASE || 'audio/';
  const FIX = window.SAY_FIX || [];
  const ALONE = window.SAY_ALONE || {};
  // 一小段静音，用来在第一次点屏幕时「打开」播放器
  const SILENT = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQQAAACAgICA';
  let el = null;
  let token = 0;
  let unlocked = false;
  let guard = 0;
  let rate = 1;
  let lastError = '';

  function player() {
    if (!el) {
      el = new Audio();
      el.preload = 'auto';
      el.setAttribute('playsinline', '');
    }
    return el;
  }
  // 录音地址：一般是 audio/xxx.mp3；打包成一个文件时用 data: 地址，放不出来再换 blob: 地址试一次
  const blobs = {};
  function blobOf(id) {
    if (!blobs[id]) {
      const bin = atob(DATA[id]);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      blobs[id] = URL.createObjectURL(new Blob([bytes], { type: 'audio/mpeg' }));
    }
    return blobs[id];
  }
  let useBlob = false;
  const srcOf = (id) => {
    if (!(DATA && DATA[id])) return BASE + id + '.mp3';
    return useBlob ? blobOf(id) : 'data:audio/mpeg;base64,' + DATA[id];
  };
  const fixText = (t) => FIX.reduce((s, [re, to]) => s.replace(re, to), t);
  // 设备语音念的文字：单个字用同音字（多音字不读错），句子按 SAY_FIX 改
  const spoken = (t) => ([...t].length === 1 ? ALONE[t] || t : fixText(t));

  function unlock() {
    try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (e) { /* 旧浏览器没有 */ }
    if (unlocked) return;
    unlocked = true;
    const a = player();
    try {
      a.src = SILENT;
      const p = a.play();
      if (p && p.catch) p.catch(() => {});
    } catch (e) { /* 忽略 */ }
    if (!Object.keys(INDEX).length) Speech.unlock();
  }

  // 念一句：有录音放录音，没有就用设备语音。o: { onstart(entry), onend(), onboundary() }
  function say(text, o) {
    o = o || {};
    stop();
    const tk = token;
    const entry = INDEX[text];
    if (!entry) {
      return Speech.speak(spoken(text), {
        rate: [...text].length === 1 ? Speech.rate * 0.92 : undefined,
        onstart: () => { if (tk === token && o.onstart) o.onstart(null); },
        onboundary: o.onboundary,
        onend: () => { if (tk === token && o.onend) o.onend(); },
      });
    }
    const a = player();
    let started = false;
    let finished = false;
    const done = () => {
      if (finished || tk !== token) return;
      finished = true;
      clearTimeout(guard);
      if (o.onend) o.onend();
    };
    const fallback = (err) => {
      if (finished || tk !== token) return;
      lastError = err && err.name ? err.name : 'error';
      finished = true;
      clearTimeout(guard);
      // 录音放不出来（比如浏览器不让）：改用设备语音
      Speech.speak(spoken(text), {
        onstart: () => { if (tk === token && o.onstart) o.onstart(null); },
        onend: () => { if (tk === token && o.onend) o.onend(); },
      });
    };
    a.onplaying = () => {
      if (tk !== token || started) return;
      started = true;
      lastError = '';
      if (o.onstart) o.onstart(entry);
      clearTimeout(guard);
      guard = setTimeout(done, (entry[1] / (a.playbackRate || 1)) * 1000 + 1500);
    };
    a.onended = done;
    let retried = false;
    const start = () => {
      try {
        a.src = srcOf(entry[0]);
        a.playbackRate = rate;
        a.defaultPlaybackRate = rate;
        const p = a.play();
        if (p && p.catch) p.catch((err) => { if (!started && !(err && err.name === 'AbortError')) failed(err); });
      } catch (err) {
        failed(err);
      }
    };
    // data: 地址放不出来时，换成 blob: 地址再试一次
    const failed = (err) => {
      if (tk !== token || started) return;
      if (!retried && DATA && DATA[entry[0]] && !useBlob) {
        retried = true;
        useBlob = true;
        start();
        return;
      }
      fallback(err);
    };
    a.onerror = () => failed(a.error ? { name: 'MediaError' + a.error.code } : null);
    start();
    // 4 秒还没开始放：当作失败
    guard = setTimeout(() => { if (!started) fallback({ name: 'Timeout' }); }, 4000);
    return true;
  }

  // 连着念几句，比如「找一找」+「山」
  function seq(list, o) {
    o = o || {};
    const items = list.filter(Boolean);
    let i = 0;
    const next = () => {
      if (i >= items.length) { if (o.onend) o.onend(); return; }
      say(items[i++], { onend: next });
    };
    next();
  }

  function stop() {
    token += 1;
    clearTimeout(guard);
    if (el && !el.paused) el.pause();
    Speech.stop();
  }

  return {
    say,
    seq,
    stop,
    unlock,
    has: (t) => !!INDEX[t],
    entry: (t) => INDEX[t] || null,
    time: () => (el ? el.currentTime : 0),
    get clips() { return Object.keys(INDEX).length; },
    get lastError() { return lastError; },
    setRate(r) { rate = r; },
    // 能不能出声：有录音，或者设备有中文语音
    get ready() { return Object.keys(INDEX).length > 0 || (Speech.ok && Speech.voices.length > 0); },
  };
})();

window.Sfx = (function () {
  'use strict';
  let ctx = null;
  let on = true;

  function ac() {
    if (!ctx) {
      const C = window.AudioContext || window.webkitAudioContext;
      if (!C) return null;
      try { ctx = new C(); } catch (e) { return null; }
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function note(f, t0, dur, type, vol, f2) {
    if (!on) return;
    const c = ac();
    if (!c) return;
    const t = c.currentTime + t0;
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type || 'sine';
    o.frequency.setValueAtTime(f, t);
    if (f2) o.frequency.exponentialRampToValueAtTime(f2, t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol || 0.18, t + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g);
    g.connect(c.destination);
    o.start(t);
    o.stop(t + dur + 0.05);
  }

  return {
    unlock() {
      const c = ac();
      if (!c) return;
      try {
        const b = c.createBuffer(1, 1, 22050);
        const s = c.createBufferSource();
        s.buffer = b;
        s.connect(c.destination);
        s.start(0);
      } catch (e) { /* 忽略 */ }
    },
    get enabled() { return on; },
    set enabled(v) { on = !!v; },
    pop() { note(520, 0, 0.12, 'sine', 0.22, 1040); },
    tap() { note(880, 0, 0.07, 'triangle', 0.1); },
    page() { note(620, 0, 0.09, 'sine', 0.08, 900); },
    ding() { note(988, 0, 0.18, 'triangle', 0.2); note(1319, 0.1, 0.34, 'triangle', 0.18); },
    oops() { note(330, 0, 0.2, 'sine', 0.16, 210); },
    count(n) { note(560 + n * 70, 0, 0.14, 'triangle', 0.16); },
    fanfare() {
      [523, 659, 784, 1047].forEach((f, i) => note(f, i * 0.11, 0.3, 'triangle', 0.17));
      note(1568, 0.48, 0.55, 'sine', 0.12);
    },
    sparkle() { for (let i = 0; i < 5; i++) note(1400 + Math.random() * 1400, i * 0.06, 0.1, 'sine', 0.06); },
  };
})();
