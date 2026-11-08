#!/usr/bin/env node
/*
 * 列出网页会读出来的每一句话（给 tools/gen-audio.py 录音用），输出 JSON。
 * 每一项：{ key: 网页里查找用的文字, say: 实际念的文字, kind }
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ctx = { window: {} };
vm.createContext(ctx);
for (const f of ['js/chars.js', 'js/stories.js', 'js/phrases.js', 'js/strokes.js', 'js/hanzi.js', 'js/charinfo.js', 'js/mine.js', 'js/tests.js', 'js/garden.js']) {
  vm.runInContext(readFileSync(join(root, f), 'utf8'), ctx, { filename: f });
}
const { CHAR_BATCHES, STORIES, SAY_ALONE = {}, SAY_FIX = [], PHRASES, PIC_WORDS, HANZI_INTRO = {}, LESSON = {}, lessonLines, STROKE_NAMES = {}, strokeKey, CHAR_INFO = {}, MINE = { stories: [] }, STATION_TESTS = {}, GARDEN = {} } = ctx.window;
const fix = (s) => SAY_FIX.reduce((acc, [re, to]) => acc.replace(re, to), s);
const isHan = (c) => /\p{Script=Han}/u.test(c);
const items = new Map();
const add = (key, say, kind) => { if (key && !items.has(key)) items.set(key, { key, say: kind === 'char' ? say || key : fix(say || key), kind }); };

const chars = CHAR_BATCHES.flatMap((b) => [...b.chars]);
// 主线的故事 + 身边的字里的故事（《冰雪奇缘》）
[...STORIES, ...MINE.stories].forEach((s) => {
  add(s.title, s.title, 'title');
  add(s.prize[1], s.prize[1], 'word');
  s.pages.forEach((p) => {
    add(p.text, p.text, 'page');
    // 点图片念的词；只有一个字的按单字录（和点这个字一样）
    (p.art || []).forEach((a) => {
      const w = a[5] && a[5].say;
      if (w) add(w, [...w].length === 1 ? SAY_ALONE[w] || w : w, [...w].length === 1 ? 'char' : 'word');
    });
    [...p.text].forEach((c) => { if (isHan(c) && !chars.includes(c)) chars.push(c); });
  });
  [...s.title].forEach((c) => { if (isHan(c) && !chars.includes(c)) chars.push(c); });
});
// 认生字用到的字（有的还不在故事里）、有讲解的字（身边的字……）
[...Object.keys(HANZI_INTRO), ...Object.keys(CHAR_INFO)].forEach((c) => { if (!chars.includes(c)) chars.push(c); });
chars.forEach((c) => add(c, SAY_ALONE[c] || c, 'char'));
// 认生字（老师上课，语速慢一点：teach）：看一看、变一变、读一读、写一写、说一说、找一找
Object.values(LESSON).forEach((w) => add(w, null, 'teach'));
// 笔画名称（写一写时一笔一笔说）：横、竖、横折钩……
[...new Set(Object.values(STROKE_NAMES).flat())].forEach((n) => add(strokeKey(n), n, 'teach'));
// 故事里每个字都能上课（读故事前孩子自己挑不认识的字）：这个字一共几笔
chars.forEach((c) => { const ln = lessonLines(c); add(ln.count, null, 'teach'); });
Object.entries(HANZI_INTRO).forEach(([c, d]) => {
  add(d.look, null, 'teach');
  add(d.say, null, 'teach');
  const ln = lessonLines(c);
  add(ln.read, null, 'teach');
  add(ln.find, null, 'teach');
  ln.words.forEach((w) => add(w, null, 'teach'));
  if (d.hear) add(d.hear, d.hear, 'word');
});
// 拆一拆的讲解、复习时的一句话、带图的词（每个字都有）
Object.values(CHAR_INFO).forEach((v) => {
  add(v[5], null, 'teach');
  add(v[6], null, 'teach');
  v[7].forEach(([w]) => add(`${w}，${w}。`, null, 'teach'));
});
// 每一站的小测验（测完以后可以听一听）
Object.values(STATION_TESTS).forEach((t) => { add(t.title, t.title, 'title'); t.lines.forEach((l) => add(l, l, 'page')); });
// 贴纸花园：贴纸说的话、小动物的叫声、商店
[...(GARDEN.talks || []), ...(GARDEN.foodTalks || [])].flat().forEach((w) => add(w, null, 'phrase'));
[...(GARDEN.party || []), ...Object.values(GARDEN.sounds || {}), GARDEN.shopHello, GARDEN.shopBuy, GARDEN.shopPoor].forEach((w) => add(w, null, 'phrase'));
(GARDEN.shop || []).forEach(([, name]) => add(name, name, 'word'));
Object.values(PIC_WORDS).forEach((w) => add(w, w, 'word'));
// js/phrases.js 里所有固定的话（表扬、求助的提示……）
Object.values(PHRASES).flat().forEach((w) => add(w, null, 'phrase'));

process.stdout.write(JSON.stringify([...items.values()], null, 1));
