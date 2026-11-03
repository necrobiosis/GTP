#!/usr/bin/env node
/*
 * 把网页要用的文件复制到 dist/site/，用来放到 Netlify、GitHub Pages 这类公开网站上。
 * 不带孩子的照片和视频（media/ 不复制，index.html 里也去掉 media/media.js）。
 * 用法：node tools/build-site.mjs [输出目录]
 * Netlify：netlify deploy --prod --dir dist/site
 */
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(process.argv[2] || join(root, 'dist', 'site'));

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
for (const d of ['css', 'js', 'fonts', 'audio']) cpSync(join(root, d), join(out, d), { recursive: true });

const html = readFileSync(join(root, 'index.html'), 'utf8').replace(/\s*<script src="media\/media\.js"><\/script>/, '');
if (html.includes('media/')) throw new Error('index.html 里还有 media/ 的地址');
writeFileSync(join(out, 'index.html'), html);

// 录音的文件名由要念的话算出来，内容不会变，可以一直缓存；其他文件每次都检查有没有更新
writeFileSync(join(out, '_headers'), '/audio/*\n  Cache-Control: public, max-age=31536000, immutable\n');
// Netlify：这个文件夹原样发布，不用构建
writeFileSync(join(out, 'netlify.toml'), '[build]\n  publish = "."\n  command = ""\n');

let files = 0;
let bytes = 0;
const walk = (d) => readdirSync(d).forEach((f) => {
  const p = join(d, f);
  const st = statSync(p);
  if (st.isDirectory()) walk(p);
  else { files += 1; bytes += st.size; }
});
walk(out);
console.log(`${out}（${files} 个文件，${Math.round(bytes / 1024)} KB，没有照片）`);
