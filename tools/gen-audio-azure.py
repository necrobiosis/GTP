#!/usr/bin/env python3
"""
用微软 Azure 语音（神经网络声音「晓晓」zh-CN-XiaoxiaoNeural）给网页录音。
和 tools/gen-audio.py 一样：把网页里会读出来的每一句话录成 mp3 放进 audio/，写出 js/audio-index.js。
哪几句话保留原来的声音（tools/gen-audio.py 用 Kokoro 录的），写在 tools/voices.json 的 keep_original 里。

准备（只需要一次）：
  pip install numpy          还需要 ffmpeg、node
  在 Azure 门户建一个「语音」资源，记下密钥和区域（比如 eastus）

运行（密钥只放在环境变量里，不要写进任何文件、不要提交到 git）：
  AZURE_SPEECH_KEY=你的密钥 AZURE_SPEECH_REGION=eastus python3 tools/gen-audio-azure.py
      只录新加的或改过的话，删掉用不到的旧录音
  python3 tools/gen-audio-azure.py --ssml          只打印每句话发给 Azure 的内容（不联网）
  python3 tools/gen-audio-azure.py --only 动 山     只录这几句（试听用，不删别的）
  python3 tools/gen-audio-azure.py --check DIR     录完用语音识别（sherpa-onnx paraformer 模型目录）核对一遍
  python3 tools/gen-audio-azure.py --check-new DIR 只核对这一次新录的

按字数收费：全部重录一遍大约 2.5 万字（Azure 免费档每月 50 万字）。

每个字开始的时间（整页朗读时一个字一个字亮起来）：Azure 的普通接口不给，这里自己算——
找出声音里的停顿，和句子里的标点对上，每一小句里的字按时间平均分（轻声的字短一点，小句最后一个字长一点）。
"""
import argparse
import hashlib
import importlib.util
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from xml.sax.saxutils import escape

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
# 剪静音、统一音量、存 mp3、读写录音目录、语音识别核对：和 tools/gen-audio.py 用同一套
_spec = importlib.util.spec_from_file_location("gen_audio", ROOT / "tools" / "gen-audio.py")
ga = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(ga)

CONFIG = json.loads((ROOT / "tools" / "voices.json").read_text(encoding="utf-8"))
VOICE = CONFIG["azure_voice"]
KEEP_ORIGINAL = set(CONFIG.get("keep_original", []))
REGION = os.environ.get("AZURE_SPEECH_REGION", CONFIG.get("azure_region", "eastus"))
# 没有设密钥时发一个占位的值：有的环境（比如带网络代理的云端开发环境）会在请求里自动换成真的密钥
KEY = os.environ.get("AZURE_SPEECH_KEY", "proxy-injected")

# 语速：故事、词、表扬的话用晓晓平常的速度；老师讲字慢一点；单个字再慢一点、念清楚
RATE = {"char": "-10%", "word": "-5%", "phrase": "0%", "title": "0%", "page": "0%", "teach": "-12%"}
KBPS = {"char": 64}   # 单个字码率高一点；句子用 KBPS_LINE
KBPS_LINE = 40
RECIPE = f"v2|{KBPS_LINE}k"  # 录法有变化时改这里，全部会重新做（Azure 念好的声音存在 tools/.cache/azure/，不用重新花字数）
CACHE = ROOT / "tools" / ".cache" / "azure"
SR = 24000
HAN = ga.HAN

# 句子里晓晓容易念错的词：指定拼音（声调写数字，轻声写 5）。两个三声连着时，前一个要自己写成二声。
# 第二项可以是整个词的拼音，也可以是写好的一段（只给其中一个字指定拼音）。
WORD_PY = [
    ("大王", "da 4 wang 2"),      # dà wáng，不是戏里的 dài wang
    ("可可的生日", '可可<phoneme alphabet="sapi" ph="de 5">的</phoneme>生日'),  # 这里的「的」晓晓念得像 dì
]
# 笔画名称里的「撇」念 piě（后面跟着三声的「点」时念成二声）
STROKE_PY = {"撇": "pie 3"}


def load_char_py():
    """每个字单念时的拼音：js/strokes.js 里的 CHAR_PY（shan1、nv3、le5……）。"""
    text = (ROOT / "js" / "strokes.js").read_text(encoding="utf-8")
    m = re.search(r"window\.CHAR_PY\s*=\s*(\{.*?\});", text, re.S)
    return json.loads(m.group(1)) if m else {}


def sapi(py):
    """shan1 → 'shan 1'（Azure 的 sapi 拼音写法）。"""
    return f"{py[:-1]} {py[-1]}"


def phoneme(text, ph):
    return f'<phoneme alphabet="sapi" ph="{ph}">{escape(text)}</phoneme>'


def lesson_marks(key, char_py):
    """老师讲字的话里，说的是「这个字本身」的地方：返回 {第几个字符: 拼音}。
    这些地方前后没有词可以参考，晓晓有时会念成别的读音（比如「还，走之底加不」念成 huán），所以指定拼音：
      「还是半包围结构……」「还，走之底加不，还有的还。」  开头的字、结尾「的还。」的字
      「这个字念着，看着的着。」                          「念」后面的字、结尾的字
      「请你找一找，哪个是出字？」「……哪个是看着的着？」    要找的那个字"""
    out = {}
    last = len(key) - 2  # 句号、问号前面的那个字
    tail = len(key) >= 3 and key[-1] in "。！？" and key[last - 1] == "的" and key[last] in char_py
    if len(key) > 1 and key[0] in char_py and key[1] in "是，":
        out[0] = char_py[key[0]]
        if tail and key[last] == key[0]:
            out[last] = char_py[key[0]]
        elif len(key) >= 2 and key[-1] in "。！" and key[last] == key[0] and key[last - 1] in "是用说叫":
            out[last] = char_py[key[0]]  # 「……就是多。」「……都用只。」
    elif key.startswith("这个字"):
        m = re.match(r"这个字念(.)", key)
        if m and m.group(1) in char_py:
            out[4] = char_py[m.group(1)]
        if tail and (not m or key[last] == m.group(1)):
            out[last] = char_py[key[last]]
    elif key.startswith("请你找一找，"):
        m = re.search(r"哪个是(.)字？$", key) or re.search(r"，(.)字在哪里？$", key)
        if m and m.group(1) in char_py:
            out[m.start(1)] = char_py[m.group(1)]
        elif tail:
            out[last] = char_py[key[last]]
    return out


def body_for(item, char_py):
    """这一句话发给 Azure 的内容：单个字指定拼音（多音字、轻声不会念错），句子是文字本身。"""
    key, say, kind = item["key"], item["say"], item["kind"]
    han = HAN.findall(key)
    if kind == "char" and len(han) == 1 and han[0] in char_py:
        return phoneme(han[0], sapi(char_py[han[0]]))
    if key.startswith("笔画·"):
        # 笔画名称：横、竖、撇点、横撇弯钩……只有「撇」指定拼音
        out = []
        for i, c in enumerate(say):
            if c in STROKE_PY:
                ph = STROKE_PY[c]
                if say[i + 1:i + 2] == "点":
                    ph = ph[:-1] + "2"
                out.append(phoneme(c, ph))
            else:
                out.append(escape(c))
        return "".join(out)
    marks = lesson_marks(key, char_py) if kind == "teach" and len(say) == len(key) else {}
    if marks:
        # 屏幕上的字（key）指定拼音；别的地方用 say（js/chars.js 的 SAY_FIX 换过同音字的）
        return "".join(phoneme(key[i], sapi(marks[i])) if i in marks else escape(c) for i, c in enumerate(say))
    body = escape(say)
    for word, ph in WORD_PY:
        body = body.replace(escape(word), ph if ph.startswith("<") or "<phoneme" in ph else phoneme(word, ph))
    return body


def ssml_for(body, kind):
    return ("<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='zh-CN'>"
            f"<voice name='{VOICE}'><prosody rate='{RATE[kind]}'>{body}</prosody></voice></speak>")


def clip_id(body, kind):
    return hashlib.sha1(f"azure|{VOICE}|{RATE[kind]}|{body}|{RECIPE}".encode("utf-8")).hexdigest()[:10]


def synth(ssml, tries=6):
    """让 Azure 念一句，返回 float32 的声音（24 kHz 单声道）。念过的存在 tools/.cache/azure/，下次直接用。
    太快被限速（429）时等一等再试。"""
    cached = CACHE / (hashlib.sha1(ssml.encode("utf-8")).hexdigest() + ".pcm")
    if cached.exists() and cached.stat().st_size > 2000:
        return np.frombuffer(cached.read_bytes(), dtype="<i2").astype(np.float32) / 32768.0
    url = f"https://{REGION}.tts.speech.microsoft.com/cognitiveservices/v1"
    req = urllib.request.Request(url, data=ssml.encode("utf-8"), method="POST", headers={
        "Ocp-Apim-Subscription-Key": KEY,
        "Content-Type": "application/ssml+xml",
        "X-Microsoft-OutputFormat": "raw-24khz-16bit-mono-pcm",
        "User-Agent": "shizi-gushiwu",
    })
    wait = 3.0
    for k in range(tries):
        try:
            raw = urllib.request.urlopen(req, timeout=90).read()
            if len(raw) < 2000:
                raise RuntimeError(f"声音太短（{len(raw)} 字节）")
            raw = raw[: len(raw) // 2 * 2]
            CACHE.mkdir(parents=True, exist_ok=True)
            tmp = cached.with_suffix(f".{os.getpid()}.{time.monotonic_ns()}.tmp")
            tmp.write_bytes(raw)
            tmp.replace(cached)
            return np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768.0
        except urllib.error.HTTPError as e:
            if e.code in (401, 403):
                raise SystemExit(f"Azure 不认这个密钥（HTTP {e.code}）：检查 AZURE_SPEECH_KEY 和 AZURE_SPEECH_REGION。")
            if e.code == 400:
                raise RuntimeError(f"Azure 说这句话的写法不对（HTTP 400）：{ssml}")
            if k == tries - 1:
                raise
            retry = e.headers.get("Retry-After")
            time.sleep(float(retry) if retry and retry.isdigit() else wait)
            wait = min(60.0, wait * 2)
        except (urllib.error.URLError, TimeoutError, RuntimeError, ConnectionError):
            if k == tries - 1:
                raise
            time.sleep(wait)
            wait = min(60.0, wait * 2)


# ---------- 每个字开始的时间 ----------
PAUSE_PUNCT = set("，。！？：；、…—,.!?:;")
LIGHT = set("的了着吗呢吧啊呀啦们子儿")  # 常念轻声的字：短一点


def speech_runs(a, sr, min_gap=0.14):
    """有声音的一段一段：[(开始秒, 结束秒)]。中间安静不到 min_gap 秒的算同一段。"""
    env = ga.envelope(a, sr)
    loud = env > 0.03 * env.max()
    idx = np.flatnonzero(loud)
    if not len(idx):
        return []
    runs, s0, last = [], idx[0], idx[0]
    gap = int(min_gap * sr)
    for i in idx[1:]:
        if i - last > gap:
            runs.append((s0 / sr, (last + 1) / sr))
            s0 = i
        last = i
    runs.append((s0 / sr, (last + 1) / sr))
    return runs


def char_marks(a, sr, text):
    """估计每个汉字开始的秒数。
    先把停顿去掉，只看「说话的时间」：字在说话时间里大致是均匀的；
    再把声音里的停顿和文字里的标点对上（对得上的当作定位点），每两个定位点之间按字的轻重分。"""
    chars = [c for c in text]
    w, ends = [], []          # 每个汉字的权重；每个小句结束在第几个汉字后面
    n = 0
    for i, c in enumerate(chars):
        if HAN.match(c):
            nxt = next((x for x in chars[i + 1:] if HAN.match(x) or x in PAUSE_PUNCT), None)
            last = nxt is None or nxt in PAUSE_PUNCT
            w.append(1.3 if last else 0.75 if c in LIGHT and n else 1.0)
            n += 1
        elif c in PAUSE_PUNCT and n and (not ends or ends[-1] != n):
            ends.append(n)
    if n < 2:
        return []
    runs = speech_runs(a, sr)
    if not runs:
        return []
    total = sum(e - s for s, e in runs)
    cw = np.concatenate([[0.0], np.cumsum(w)])        # 权重累计：cw[k] = 第 k 个字开始的位置
    scale = total / cw[-1]
    # 声音里每个停顿在「说话时间」里的位置
    acc, pauses = 0.0, []
    for s, e in runs[:-1]:
        acc += e - s
        pauses.append(acc)
    # 小句结束的位置（按字数估计）和停顿配对：从左到右，最近的、差得不太远的
    anchors = [(0, 0.0)]
    cand = [k for k in ends if k < n]
    j = 0
    for p in pauses:
        best = None
        while j < len(cand):
            d = abs(cw[cand[j]] * scale - p)
            if best is None or d < best[0]:
                best = (d, j)
                j += 1
            else:
                break
        if best is None:
            break
        j = best[1] + 1
        if best[0] <= max(0.9, 0.35 * p) and cand[best[1]] > anchors[-1][0]:
            anchors.append((cand[best[1]], p))
    anchors.append((n, total))

    def real(t):
        """说话时间 → 录音里真正的时间（把停顿加回去）。"""
        left = t
        for s, e in runs:
            if left <= e - s + 1e-9:
                return s + left
            left -= e - s
        return runs[-1][1]

    marks = []
    for (k0, t0), (k1, t1) in zip(anchors, anchors[1:]):
        span = cw[k1] - cw[k0]
        for k in range(k0, k1):
            # 小句的第一个字：从这一段声音的开头算起（停顿算在前面那个字后面）
            t = t0 + (t1 - t0) * (cw[k] - cw[k0]) / span
            marks.append(real(t + 1e-6) if k == k0 and k0 else real(t))
    return [round(float(max(0.0, m - 0.03)), 2) for m in marks]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ssml", action="store_true", help="只打印每句话发给 Azure 的内容")
    ap.add_argument("--only", nargs="+", metavar="KEY", help="只录这几句（试听用）")
    ap.add_argument("--out", metavar="DIR", help="和 --only 一起用：录到这个文件夹，不动 audio/ 和录音目录")
    ap.add_argument("--check", metavar="ASR_DIR", help="用 sherpa-onnx paraformer 识别模型核对全部录音")
    ap.add_argument("--check-new", metavar="ASR_DIR", help="只核对这一次新录的")
    ap.add_argument("--force", action="store_true", help="全部重新录")
    ap.add_argument("--jobs", type=int, default=4, help="同时发几个请求（被限速时改小）")
    args = ap.parse_args()

    items = ga.load_items()
    char_py = load_char_py()
    plan = []
    for it in items:
        if it["key"] in KEEP_ORIGINAL:
            continue
        body = body_for(it, char_py)
        plan.append((it, body, clip_id(body, it["kind"])))

    if args.ssml:
        for it, body, cid in plan:
            print(f"{it['key']}\t{it['kind']} {RATE[it['kind']]}\t{body}")
        print(f"\n一共 {len(plan)} 句，{sum(len(b) for _, b, _ in plan)} 个字符；保留原来声音的：{'、'.join(sorted(KEEP_ORIGINAL)) or '没有'}")
        return

    def record(job):
        it, body, cid = job
        kind = it["kind"]
        a = synth(ssml_for(body, kind))
        a, _ = ga.polish(a, SR)
        if kind == "char":
            a = ga.round_tail(a, SR)
        entry = [cid, round(len(a) / SR, 2)]
        n_han = len(HAN.findall(it["key"]))
        if kind in ("page", "title") and n_han > 1:
            marks = char_marks(a, SR, it["key"])
            if len(marks) == n_han:
                entry.append(marks)
        return a, entry

    if args.only:
        out = Path(args.out) if args.out else None
        if out:
            out.mkdir(parents=True, exist_ok=True)
        todo = [j for j in plan if j[0]["key"] in set(args.only)]
        for job in todo:
            a, entry = record(job)
            path = (out or ga.AUDIO_DIR) / f"{entry[0]}.mp3"
            ga.encode_mp3(a, SR, path, KBPS.get(job[0]["kind"], KBPS_LINE))
            print(job[0]["key"], "→", path, entry[1], "秒", entry[2] if len(entry) > 2 else "")
        return

    ga.AUDIO_DIR.mkdir(exist_ok=True)
    old = ga.read_index()
    index, warn, new_keys = {}, [], []
    for it in items:
        if it["key"] in KEEP_ORIGINAL:
            if it["key"] in old and (ga.AUDIO_DIR / f"{old[it['key']][0]}.mp3").exists():
                index[it["key"]] = old[it["key"]]
            else:
                warn.append(f"「{it['key']}」要保留原来的声音，但是没有找到录音：先运行 python3 tools/gen-audio.py")
    todo = []
    for job in plan:
        it, body, cid = job
        key = it["key"]
        if not args.force and key in old and old[key][0] == cid and (ga.AUDIO_DIR / f"{cid}.mp3").exists():
            index[key] = old[key]
        else:
            todo.append(job)
    print(f"要录 {len(todo)} 句（已经录好 {len(plan) - len(todo)} 句，保留原来声音 {len(KEEP_ORIGINAL)} 句）", flush=True)

    made = 0
    try:
        with ThreadPoolExecutor(max(1, args.jobs)) as pool:
            for job, (a, entry) in zip(todo, pool.map(record, todo)):
                it = job[0]
                ga.encode_mp3(a, SR, ga.AUDIO_DIR / f"{entry[0]}.mp3", KBPS.get(it["kind"], KBPS_LINE))
                if it["kind"] in ("page", "title") and len(HAN.findall(it["key"])) > 1 and len(entry) < 3:
                    warn.append(f"没算出每个字的时间，这一句用估算的高亮：{it['key']}")
                index[it["key"]] = entry
                new_keys.append(it["key"])
                made += 1
                if made % 25 == 0 or made == len(todo):
                    # 中途存一下：断了再运行，录好的不用重录
                    ga.write_index({**{k: v for k, v in old.items() if k not in index}, **index})
                print(f"录好 {made}/{len(todo)}: {it['key']}", flush=True)
    finally:
        if made and made < len(todo):
            ga.write_index({**{k: v for k, v in old.items() if k not in index}, **index})
            print(f"中途停了：已经录好 {made} 句，再运行一次接着录。", flush=True)

    keep = {v[0] for v in index.values()}
    removed = 0
    for f in ga.AUDIO_DIR.glob("*.mp3"):
        if f.stem not in keep:
            f.unlink()
            removed += 1
    ga.write_index(index)
    total = sum(f.stat().st_size for f in ga.AUDIO_DIR.glob("*.mp3"))
    print(f"新录 {made} 句，删掉 {removed} 个旧文件；一共 {len(index)} 句，{total // 1024} KB")
    for w in warn:
        print("注意：", w)
    asr = args.check or args.check_new
    if asr:
        which = items if args.check else [it for it in items if it["key"] in set(new_keys)]
        ga.check([it for it in which if it["key"] in index], index, Path(asr))


if __name__ == "__main__":
    sys.exit(main())
