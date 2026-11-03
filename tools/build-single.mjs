#!/usr/bin/env node
/*
 * 把网页打包成一个 HTML 文件（字体、样式、脚本、录音都塞进去），方便发给别人或离线打开。
 * 用法：node tools/build-single.mjs [输出路径]      默认输出 dist/识字故事屋.html
 *      node tools/build-single.mjs out.html --fragment   只要 <head>/<body> 里面的内容（给 claude.ai 页面用）
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const fragment = args.includes('--fragment');
const out = resolve(args.find((a) => !a.startsWith('--')) || join(root, 'dist', '识字故事屋.html'));
const read = (p) => readFileSync(join(root, p), 'utf8');

let css = read('css/style.css');
const font = readFileSync(join(root, 'fonts/kidkai.woff2')).toString('base64');
css = css.replace('url("../fonts/kidkai.woff2")', `url("data:font/woff2;base64,${font}")`);

let html = read('index.html');

// 录音：打包成一个文件时直接放进网页（window.AUDIO_DATA = { 文件名: base64 }）
const ctx = { window: {} };
vm.createContext(ctx);
vm.runInContext(read('js/audio-index.js'), ctx);
const ids = [...new Set(Object.values(ctx.window.AUDIO_INDEX || {}).map((e) => e[0]))];
const audioData = {};
for (const id of ids) audioData[id] = readFileSync(join(root, 'audio', id + '.mp3')).toString('base64');
html = html.replace('<script src="js/audio-index.js"></script>', () => `<script src="js/audio-index.js"></script>\n<script>window.AUDIO_DATA = ${JSON.stringify(audioData)};</script>`);
html = html.replace('<link rel="stylesheet" href="css/style.css">', () => `<style>\n${css}\n</style>`);
html = html.replace(/<script src="(js\/[^"]+)"><\/script>/g, (m, src) => `<script>\n${read(src).replace(/<\/script/gi, '<\\/script')}\n</script>`);

if (fragment) {
  // 只留标题、字体和样式；外面的 <html>/<head>/<body> 由托管页面提供
  const head = html.match(/<head>([\s\S]*?)<\/head>/)[1];
  const keep = [
    head.match(/<title>[\s\S]*?<\/title>/)[0],
    '<meta name="claude:viewport-fit-sides" content="cover">',
    ...(head.match(/<link [^>]*fonts\.g[^>]*>/g) || []),
    head.match(/<style>[\s\S]*<\/style>/)[0],
  ];
  const body = html.match(/<body>([\s\S]*?)<\/body>/)[1];
  html = `${keep.join('\n')}\n${body.trim()}\n`;
}
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, html);
console.log(`${out}（${Math.round(Buffer.byteLength(html) / 1024)} KB）`);
