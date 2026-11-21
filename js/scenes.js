/*
 * 动态背景和画好的道具。
 * 背景铺满整个屏幕；地平线位置由 app.js 算好放在 CSS 变量 --hz 里。
 */
window.Scenes = (function () {
  'use strict';

  const PRESETS = {
    meadow:     { sky: 'day', sun: 'day', clouds: 3, far: 'hills', ground: 'grass' },
    pond:       { sky: 'day', sun: 'day', clouds: 2, far: 'hills', ground: 'grass' },
    sky:        { sky: 'day', sun: 'day', clouds: 6, far: 'hills', ground: 'grass', birds: 1 },
    rain:       { sky: 'rain', clouds: 4, cloud: 'grey', far: 'hills-wet', ground: 'grass-wet', weather: 'rain', puddles: 1 },
    storm:      { sky: 'storm', clouds: 5, cloud: 'dark', far: 'hills-wet', ground: 'grass-wet', weather: 'storm' },
    windy:      { sky: 'windy', clouds: 6, cloud: 'grey', fast: 1, far: 'hills', ground: 'grass', weather: 'leaves' },
    night:      { sky: 'night', stars: 1, far: 'hills-night', ground: 'grass-night' },
    nightsky:   { sky: 'night', stars: 1, ground: 'none' },
    cloudnight: { sky: 'night', stars: 1, ground: 'cloudfloor' },
    farm:       { sky: 'day', sun: 'day', clouds: 2, far: 'hills', ground: 'field' },
    farmrain:   { sky: 'rain', clouds: 3, cloud: 'grey', far: 'hills-wet', ground: 'field-wet', weather: 'rain' },
    farmbow:    { sky: 'day', sun: 'day', clouds: 2, far: 'hills', ground: 'field', rainbow: 1 },
    dry:        { sky: 'hot', sun: 'hot', far: 'hills-dry', ground: 'dry' },
    home:       { sky: 'day', sun: 'day', clouds: 2, far: 'hills', ground: 'grass' },
    morning:    { sky: 'dawn', sun: 'rise', clouds: 2, far: 'hills', ground: 'grass' },
    noon:       { sky: 'day', sun: 'high', clouds: 1, far: 'hills', ground: 'grass' },
    sunset:     { sky: 'dusk', sun: 'set', clouds: 2, cloud: 'pink', far: 'hills-dusk', ground: 'grass-dusk' },
    rainbow:    { sky: 'day', sun: 'day', clouds: 2, far: 'hills', ground: 'grass-wet', rainbow: 1, puddles: 1 },
    train:      { sky: 'day', sun: 'day', clouds: 3, far: 'hills', ground: 'track' },
    trainmove:  { sky: 'day', sun: 'day', clouds: 3, far: 'hills', ground: 'track', moving: 1 },
    soil:       { sky: 'day', sun: 'day', clouds: 2, ground: 'soil' },
    party:      { sky: 'party', clouds: 2, far: 'hills', ground: 'grass', bunting: 1, confetti: 1 },
    partybow:   { sky: 'party', clouds: 2, far: 'hills', ground: 'grass', bunting: 1, rainbow: 1 },
    sea:        { sky: 'day', sun: 'day', clouds: 3, ground: 'beach' },
    seadusk:    { sky: 'dusk', sun: 'set', clouds: 2, cloud: 'pink', ground: 'beach-dusk' },
    snow:       { sky: 'winter', clouds: 3, cloud: 'grey', far: 'hills-snow', ground: 'snowfield', weather: 'snow' },
    snowsun:    { sky: 'day', sun: 'day', clouds: 2, far: 'hills-snow', ground: 'snowfield' },
    dawnplain:  { sky: 'dawn', clouds: 2, far: 'hills', ground: 'grass' },
  };

  // 固定种子的随机数：同一个背景每次画出来都一样
  function rng(seed) {
    let s = seed % 2147483647 || 1;
    return () => (s = (s * 16807) % 2147483647) / 2147483647;
  }
  function hash(str) {
    let h = 7;
    for (const c of str) h = (h * 31 + c.charCodeAt(0)) % 100000;
    return h + 11;
  }

  function clouds(p, r) {
    let h = '<div class="clouds">';
    for (let i = 0; i < p.clouds; i++) {
      const w = 14 + r() * 16;               // vmin
      const top = 4 + r() * 34;              // 地平线以上的百分比
      const t = (p.fast ? 16 : 46) + r() * (p.fast ? 10 : 40);
      const dl = -r() * t;
      h += `<i class="cl cl-${p.cloud || 'white'}" style="--w:${w.toFixed(1)}vmin;--top:${top.toFixed(1)};--t:${t.toFixed(1)}s;--dl:${dl.toFixed(1)}s"></i>`;
    }
    return h + '</div>';
  }

  function stars(r, all) {
    let h = `<div class="stars${all ? ' all' : ''}">`;
    for (let i = 0; i < 34; i++) {
      const x = r() * 100, y = r() * (all ? 100 : 62);
      const sz = 2 + r() * 3.5, d = -r() * 3;
      h += `<i class="st" style="left:${x.toFixed(1)}%;top:${y.toFixed(1)}%;--z:${sz.toFixed(1)}px;animation-delay:${d.toFixed(2)}s"></i>`;
    }
    return h + '</div>';
  }

  function rain(n, r) {
    let h = '<div class="rain">';
    for (let i = 0; i < n; i++) {
      const x = r() * 104 - 2, d = -r() * 1.2, t = 0.55 + r() * 0.45, len = 12 + r() * 14;
      h += `<i class="dr" style="left:${x.toFixed(1)}%;--len:${len.toFixed(0)}px;animation-duration:${t.toFixed(2)}s;animation-delay:${d.toFixed(2)}s"></i>`;
    }
    return h + '</div>';
  }

  function leaves(r) {
    let h = '<div class="leaves">';
    for (let i = 0; i < 7; i++) {
      const top = 10 + r() * 70, t = 3 + r() * 3, d = -r() * 6, sz = 18 + r() * 16;
      h += `<i class="lf" style="top:${top.toFixed(0)}%;font-size:${sz.toFixed(0)}px;animation-duration:${t.toFixed(1)}s;animation-delay:${d.toFixed(1)}s">🍃</i>`;
    }
    return h + '</div>';
  }

  function farBirds(r) {
    let h = '<div class="fbirds">';
    for (let i = 0; i < 4; i++) {
      const top = 8 + r() * 30, t = 18 + r() * 14, d = -r() * 30, sz = 10 + r() * 8;
      h += `<i class="fb" style="--top:${top.toFixed(0)};--sz:${sz.toFixed(0)}px;animation-duration:${t.toFixed(0)}s;animation-delay:${d.toFixed(0)}s"></i>`;
    }
    return h + '</div>';
  }

  function snow(r) {
    let h = '<div class="snowfall">';
    for (let i = 0; i < 40; i++) {
      const x = r() * 100, d = -r() * 8, t = 5 + r() * 5, sz = 4 + r() * 7;
      h += `<i class="sn" style="left:${x.toFixed(1)}%;--z:${sz.toFixed(0)}px;animation-duration:${t.toFixed(1)}s;animation-delay:${d.toFixed(1)}s"></i>`;
    }
    return h + '</div>';
  }

  function puddles() {
    return '<div class="puddles"><i class="pd" style="left:12%;--dy:.12;--w:22"></i><i class="pd" style="left:70%;--dy:.2;--w:28"></i><i class="pd" style="left:44%;--dy:.27;--w:18"></i></div>';
  }

  function bunting() {
    const colors = ['#ff6b8b', '#ffc93c', '#4cc38a', '#4aa8ff', '#a98bff'];
    let h = '<div class="bunting"><i class="rope"></i>';
    for (let i = 0; i < 18; i++) h += `<i class="flag" style="left:${(i * 5.8 + 1).toFixed(1)}%;--c:${colors[i % colors.length]};animation-delay:${(-i * 0.23).toFixed(2)}s"></i>`;
    return h + '</div>';
  }

  function confetti(r) {
    const colors = ['#ff6b8b', '#ffc93c', '#4cc38a', '#4aa8ff', '#a98bff', '#ff9f43'];
    let h = '<div class="confetti">';
    for (let i = 0; i < 22; i++) {
      const x = r() * 100, t = 4 + r() * 4, d = -r() * 8, rot = r() * 360;
      h += `<i class="cf" style="left:${x.toFixed(1)}%;background:${colors[i % colors.length]};--rot:${rot.toFixed(0)}deg;animation-duration:${t.toFixed(1)}s;animation-delay:${d.toFixed(1)}s"></i>`;
    }
    return h + '</div>';
  }

  function build(name) {
    const p = PRESETS[name] || PRESETS.meadow;
    const r = rng(hash(name));
    const el = document.createElement('div');
    el.className = 'scene sc-' + name;
    let h = `<div class="sky sky-${p.sky}"></div>`;
    if (p.stars) h += stars(r, p.ground === 'none' || p.ground === 'cloudfloor');
    if (p.rainbow) h += '<div class="rainbow"></div>';
    if (p.sun) h += `<div class="sun sun-${p.sun}"><i></i></div>`;
    if (p.clouds) h += clouds(p, r);
    if (p.birds) h += farBirds(r);
    if (p.far) h += `<div class="far far-${p.far}${p.moving ? ' moving' : ''}"></div>`;
    if (p.ground && p.ground !== 'none') h += `<div class="ground g-${p.ground}${p.moving ? ' moving' : ''}"></div>`;
    if (p.puddles) h += puddles();
    if (p.bunting) h += bunting();
    if (p.confetti) h += confetti(r);
    if (p.weather === 'rain' || p.weather === 'storm') h += rain(p.weather === 'storm' ? 70 : 46, r);
    if (p.weather === 'storm') h += '<div class="flash"></div>';
    if (p.weather === 'leaves') h += leaves(r);
    if (p.weather === 'snow') h += snow(r);
    el.innerHTML = h;
    return el;
  }

  /* ---------- 画好的道具（宽度 = 画面宽度的百分之几） ---------- */
  function prop(name, o) {
    o = o || {};
    switch (name) {
      case 'mountain':
        return '<div class="pr pr-mountain"><i class="pk2"></i><i class="pk"></i><i class="cap"></i></div>';
      case 'house':
        return '<div class="pr pr-house"><i class="chim"></i><i class="roof"></i><i class="wall"><i class="win"></i><i class="door"></i></i></div>';
      case 'tree':
        return '<div class="pr pr-tree"><i class="trunk"></i><i class="crown c1"></i><i class="crown c2"></i><i class="crown c3"></i></div>';
      case 'pond':
        return '<div class="pr pr-pond"><i class="shine"></i><i class="wave w1"></i><i class="wave w2"></i></div>';
      case 'rock':
        return `<div class="pr pr-rock${o.flat ? ' flat' : ''}"><i class="shine"></i></div>`;
      case 'melon':
        return '<div class="pr pr-melon"><i class="body"></i><i class="stem"></i><i class="leaf"></i></div>';
      case 'melonopen':
        return '<div class="pr pr-melonopen"><i class="half l"></i><i class="half r"></i></div>';
      case 'cloud':
        return '<div class="pr pr-cloud"><i class="puff p1"></i><i class="puff p2"></i><i class="puff p3"></i><i class="base"></i></div>';
      case 'cloudface':
        return `<div class="pr pr-cloud face mood-${o.mood || 'smile'}"><i class="puff p1"></i><i class="puff p2"></i><i class="puff p3"></i><i class="base"></i>` +
          '<i class="eye l"></i><i class="eye r"></i><i class="blush l"></i><i class="blush r"></i><i class="mouth"></i></div>';
      case 'seeds': {
        let h = '<div class="pr pr-seeds">';
        const pos = [[8, 40, -20], [22, 70, 15], [30, 25, 40], [42, 60, -35], [52, 20, 10], [60, 72, 60], [70, 38, -10], [80, 66, 30], [90, 30, -45], [36, 88, 5], [66, 92, -25]];
        pos.forEach(([x, y, r]) => { h += `<i style="left:${x}%;top:${y}%;--r:${r}deg"></i>`; });
        return h + '</div>';
      }
      case 'log':
        return '<div class="pr pr-log"><i class="end"></i></div>';
      case 'nest':
        return '<div class="pr pr-nest"><i class="egg"></i></div>';
      case 'kid': {
        // 可可：有照片就用照片做的圆头像，没有就是一个写着名字的圆牌
        const kid = window.KID || {};
        const name = String(kid.name || '可可').replace(/[<>&"]/g, '');
        return kid.avatar
          ? `<div class="pr pr-kid"><img src="${kid.avatar}" alt="" draggable="false"></div>`
          : `<div class="pr pr-kid kid-name"><span style="font-size:${Math.min(0.36, 0.74 / Math.max(1, [...name].length)).toFixed(3)}em">${name}</span></div>`;
      }
      case 'badge': {
        // 同学（小爱、点点……）：写着名字的圆牌，o.bg 是底色
        const name = String(o.name || '').replace(/[<>&"]/g, '');
        const bg = /^#[0-9a-f]{3,8}$/i.test(o.bg || '') ? o.bg : '#ff7eb3';
        return `<div class="pr pr-badge" style="--bg:${bg}"><span style="font-size:${Math.min(0.36, 0.74 / Math.max(1, [...name].length)).toFixed(3)}em">${name}</span></div>`;
      }
      case 'paper': {
        // 可可的画：draw 里写画了哪些东西
        const d = ' ' + (o.draw || '') + ' ';
        let h = '<div class="pr pr-paper"><i class="sheet"></i>';
        if (d.includes(' sun ')) h += '<i class="d-sun"></i>';
        if (d.includes(' mt ')) h += '<i class="d-mt"></i>';
        if (d.includes(' river ')) h += '<i class="d-river"></i><i class="d-fish"></i>';
        if (d.includes(' grass ')) h += '<i class="d-grass"></i>';
        if (d.includes(' flower ')) h += '<i class="d-flower"></i><i class="d-bug"></i>';
        if (d.includes(' dog ')) h += '<i class="d-dog">🐶</i>';
        return h + '</div>';
      }
      case 'flower':
        return '<div class="pr pr-flower"><i class="stem"></i><i class="leaf l"></i><i class="leaf r"></i><i class="head"><i class="face"><i class="eye l"></i><i class="eye r"></i><i class="mouth"></i></i></i></div>';
      default:
        return '';
    }
  }

  return { build, prop, PRESETS };
})();
