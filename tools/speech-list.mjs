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
for (const f of ['js/chars.js', 'js/stories.js', 'js/phrases.js']) {
  vm.runInContext(readFileSync(join(root, f), 'utf8'), ctx, { filename: f });
}
const { CHAR_BATCHES, STORIES, SAY_ALONE = {}, SAY_FIX = [], PHRASES, PIC_WORDS } = ctx.window;
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
    (p.art || []).forEach((a) => { if (a[5] && a[5].say) add(a[5].say, a[5].say, 'word'); });
    [...p.text].forEach((c) => { if (isHan(c) && !chars.includes(c)) chars.push(c); });
  });
  [...s.title].forEach((c) => { if (isHan(c) && !chars.includes(c)) chars.push(c); });
});
chars.forEach((c) => add(c, SAY_ALONE[c] || c, 'char'));
Object.values(PIC_WORDS).forEach((w) => add(w, w, 'word'));
add(PHRASES.quizAsk, null, 'phrase');
add(PHRASES.quizAgain, null, 'phrase');
PHRASES.praise.forEach((w) => add(w, null, 'phrase'));
add(PHRASES.rewardPrefix, null, 'phrase');
add(PHRASES.hello, null, 'phrase');
(PHRASES.cheers || []).forEach((w) => add(w, null, 'phrase'));
add(PHRASES.stageDone, null, 'phrase');

process.stdout.write(JSON.stringify([...items.values()], null, 1));
