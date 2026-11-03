#!/usr/bin/env node
/*
 * 把网页打包成一个 HTML 文件（字体、样式、脚本、录音都塞进去），方便发给别人或离线打开。
 * 用法：node tools/build-single.mjs [输出路径]      默认输出 dist/识字故事屋.html
 *      node tools/build-single.mjs out.html --fragment   只要 <head>/<body> 里面的内容（给 claude.ai 页面用）
 *      加 --no-media：不放孩子的照片和视频（media/ 文件夹），适合发给别人
 * media/ 文件夹不进 git：照片只在打包出来的文件里，发这个文件就等于发了照片。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
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
// 孩子的照片和视频（media/media.js 里列的文件）变成 data: 地址放进网页
const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', mp4: 'video/mp4', m4v: 'video/mp4', mov: 'video/quicktime', webm: 'video/webm' };
const mediaJs = join(root, 'media', 'media.js');
let mediaKB = 0;
html = html.replace('<script src="media/media.js"></script>', () => {
  if (args.includes('--no-media') || !existsSync(mediaJs)) return '';
  const mctx = { window: {} };
  vm.createContext(mctx);
  vm.runInContext(readFileSync(mediaJs, 'utf8'), mctx);
  const kid = mctx.window.KID || {};
  const inline = (v) => {
    const m = typeof v === 'string' && v.match(/\.([a-z0-9]+)$/i);
    if (!m || !MIME[m[1].toLowerCase()]) return v;
    const buf = readFileSync(join(root, v));
    mediaKB += buf.length / 1024;
    return `data:${MIME[m[1].toLowerCase()]};base64,${buf.toString('base64')}`;
  };
  const out = {};
  for (const [k, v] of Object.entries(kid)) out[k] = Array.isArray(v) ? v.map(inline) : inline(v);
  return `<script>window.KID = Object.assign(window.KID || {}, ${JSON.stringify(out)});</script>`;
});
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
console.log(`${out}（${Math.round(Buffer.byteLength(html) / 1024)} KB${mediaKB ? `，含照片和视频 ${Math.round(mediaKB)} KB` : '，没有照片'}）`);
