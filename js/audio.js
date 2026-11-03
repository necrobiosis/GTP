/*
 * 声音：中文朗读（浏览器自带的语音合成）+ 小音效（Web Audio 现场合成，不用音频文件）。
 */
window.Speech = (function () {
  'use strict';
  const synth = window.speechSynthesis;
  const ok = !!(synth && window.SpeechSynthesisUtterance);
  let voices = [];
  let chosen = null;
  let pref = '';
  let rate = 0.8;
  let unlocked = false;
  let current = null;   // 留住引用，避免某些浏览器回收后不触发 onend
  let watchdog = 0;
  let pendingT = 0;
  const listeners = [];

  function isChinese(v) {
    return /^(zh|cmn)/i.test(v.lang) || /chinese|中文|普通话|國語|国语/i.test(v.name);
  }
  function score(v) {
    const lang = (v.lang || '').replace('_', '-').toLowerCase();
    const n = v.name || '';
    let s = 0;
    if (/zh-cn|cmn-hans|zh-hans|cmn-cn/.test(lang)) s += 50;
    else if (/zh-tw|zh-hant|cmn-tw/.test(lang)) s += 20;
    else if (/zh-hk|yue/.test(lang)) s -= 40; // 粤语放最后
    if (/xiaoxiao|xiaoyi|xiaohan|xiaomo|晓晓|晓伊/i.test(n)) s += 30;
    if (/tingting|婷婷|lili|莉莉|yu-?shu|语舒|lilian/i.test(n)) s += 22;
    if (/google/i.test(n)) s += 18;
    if (/natural|neural|premium|enhanced|高级|优化/i.test(n)) s += 12;
    if (/huihui|yaoyao|kangkang|yunxi|yunyang/i.test(n)) s += 6;
    if (v.localService) s += 3;
    return s;
  }
  function refresh() {
    if (!ok) return;
    voices = synth.getVoices().filter(isChinese).sort((a, b) => score(b) - score(a));
    chosen = voices.find((v) => v.voiceURI === pref) || voices[0] || null;
    listeners.forEach((f) => f());
  }
  if (ok) {
    refresh();
    if (synth.addEventListener) synth.addEventListener('voiceschanged', refresh);
    else synth.onvoiceschanged = refresh;
    setTimeout(refresh, 300);
    setTimeout(refresh, 1500);
  }

  // iOS 要求第一次朗读发生在点击里：点一下屏幕时先“热身”
  function unlock() {
    if (!ok || unlocked) return;
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
      u.pitch = o.pitch || 1.05;
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
    synth.cancel();
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
