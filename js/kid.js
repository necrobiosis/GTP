/*
 * 孩子的名字（表扬、故事里用）。
 * 照片和视频不放进 git（仓库是公开的）。两种加法：
 *   1. 在网页里点「家长 → 可可的照片 → 添加照片」，照片只存在这台设备上；
 *   2. 放进 media/ 文件夹，再写一个 media/media.js（见 README）。
 */
window.KID = Object.assign({ name: '可可', photos: [], avatar: '', video: '', poster: '' }, window.KID || {});
