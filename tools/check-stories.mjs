#!/usr/bin/env node
/*
 * 检查故事用字：哪些字不在「已学会的字」里（新字），每个故事多长，90 个字有没有都用到。
 * 用法：node tools/check-stories.mjs
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ctx = { window: {} };
vm.createContext(ctx);
for (const f of ['js/chars.js', 'js/stories.js', 'js/scenes.js']) {
  vm.runInContext(readFileSync(join(root, f), 'utf8'), ctx, { filename: f });
}
const { CHAR_BATCHES, STORIES, Scenes } = ctx.window;
const known = CHAR_BATCHES.flatMap((b) => [...b.chars]);
const knownSet = new Set(known);
const isHan = (c) => /\p{Script=Han}/u.test(c);
const problems = [];

if (knownSet.size !== known.length) problems.push('chars.js 里有重复的字');

const used = new Set();
const seenExtra = new Set();
const ids = new Set();
console.log('关  故事              页  字数  最长一页  新字');
STORIES.forEach((s, i) => {
  if (ids.has(s.id)) problems.push(`重复的 id：${s.id}`);
  ids.add(s.id);
  const all = s.title + s.pages.map((p) => p.text).join('');
  const han = [...all].filter(isHan);
  han.forEach((c) => knownSet.has(c) && used.add(c));
  const extra = [...new Set(han.filter((c) => !knownSet.has(c)))];
  const fresh = extra.filter((c) => !seenExtra.has(c));
  extra.forEach((c) => seenExtra.add(c));
  const longest = Math.max(...s.pages.map((p) => [...p.text].filter(isHan).length));
  const textChars = s.pages.reduce((n, p) => n + [...p.text].filter(isHan).length, 0);
  console.log(
    `${String(i + 1).padStart(2)}  ${s.title.padEnd(8, '　')}  ${String(s.pages.length).padStart(2)}  ${String(textChars).padStart(4)}  ${String(longest).padStart(6)}    ` +
    (extra.length ? `${extra.join('')}${fresh.length ? `（第一次出现：${fresh.join('')}）` : ''}` : '—'),
  );
  if (fresh.length > 3) problems.push(`第${i + 1}关「${s.title}」一下出现 ${fresh.length} 个新字`);
  s.pages.forEach((p, k) => {
    if (!Scenes.PRESETS[p.scene]) problems.push(`第${i + 1}关第${k + 1}页：没有这个背景 ${p.scene}`);
    (p.art || []).forEach((a) => {
      if (a[0][0] === '#' && !Scenes.prop(a[0].slice(1))) problems.push(`第${i + 1}关第${k + 1}页：没有这个道具 ${a[0]}`);
      if (a.length < 4 || a.slice(1, 4).some((n) => typeof n !== 'number')) problems.push(`第${i + 1}关第${k + 1}页：图片格式不对 ${JSON.stringify(a)}`);
    });
  });
});
const missing = known.filter((c) => !used.has(c));
console.log(`\n学过的字用到了 ${used.size}/${known.length} 个${missing.length ? '，没用到：' + missing.join('') : '，全部用到了'}`);
console.log(`故事里一共有 ${seenExtra.size} 个新字：${[...seenExtra].join('')}`);
if (problems.length) {
  console.error('\n需要修改：\n- ' + problems.join('\n- '));
  process.exit(1);
}
