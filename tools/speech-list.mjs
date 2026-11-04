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
for (const f of ['js/chars.js', 'js/stories.js', 'js/phrases.js', 'js/strokes.js', 'js/hanzi.js']) {
  vm.runInContext(readFileSync(join(root, f), 'utf8'), ctx, { filename: f });
}
const { CHAR_BATCHES, STORIES, SAY_ALONE = {}, SAY_FIX = [], PHRASES, PIC_WORDS, HANZI_INTRO = {}, LESSON = {}, lessonLines } = ctx.window;
const fix = (s) => SAY_FIX.reduce((acc, [re, to]) => acc.replace(re, to), s);
const isHan = (c) => /\p{Script=Han}/u.test(c);
const items = new Map();
const add = (key, say, kind) => { if (key && !items.has(key)) items.set(key, { key, say: kind === 'char' ? say || key : fix(say || key), kind }); };

const chars = CHAR_BATCHES.flatMap((b) => [...b.chars]);
STORIES.forEach((s) => {
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
// 认生字用到的字（有的还不在故事里）
Object.keys(HANZI_INTRO).forEach((c) => { if (!chars.includes(c)) chars.push(c); });
chars.forEach((c) => add(c, SAY_ALONE[c] || c, 'char'));
// 认生字（老师上课，语速慢一点：teach）：看一看、变一变、读一读、写一写、说一说、找一找
Object.values(LESSON).forEach((w) => add(w, null, 'teach'));
Object.entries(HANZI_INTRO).forEach(([c, d]) => {
  add(d.look, null, 'teach');
  add(d.say, null, 'teach');
  const ln = lessonLines ? lessonLines(c) : null;
  if (ln) {
    add(ln.read, null, 'teach');
    add(ln.count, null, 'teach');
    (ln.strokes || []).forEach((w) => add(w, null, 'teach'));
    add(ln.find, null, 'teach');
    ln.words.forEach((w) => add(w, null, 'teach'));
  }
  if (d.hear) add(d.hear, d.hear, 'word');
});
Object.values(PIC_WORDS).forEach((w) => add(w, w, 'word'));
// js/phrases.js 里所有固定的话（表扬、求助的提示……）
Object.values(PHRASES).flat().forEach((w) => add(w, null, 'phrase'));

process.stdout.write(JSON.stringify([...items.values()], null, 1));
