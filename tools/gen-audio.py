#!/usr/bin/env python3
"""
给网页录音：把网页里会读出来的每一句话（故事每一页、每个字、图片名、表扬的话……）
用开源的 Kokoro 中文语音模型（Kokoro-82M-v1.1-zh，Apache-2.0）录成 mp3，放进 audio/，
再写出 js/audio-index.js：每句话对应哪个文件、有多长、每个字从第几秒开始（朗读时一个字一个字亮起来）。

准备（只需要一次）：
  python3 -m venv .venv
  .venv/bin/pip install kokoro-onnx soundfile numpy
  .venv/bin/pip install --ignore-requires-python "misaki[zh]==0.9.4"
  把这三个文件放进 tools/.cache/kokoro/：
    kokoro-v1.1-zh.onnx、voices-v1.1-zh.bin
      https://github.com/thewh1teagle/kokoro-onnx/releases/tag/model-files-v1.1
    config.json
      https://huggingface.co/hexgrad/Kokoro-82M-v1.1-zh/raw/main/config.json
  还需要 ffmpeg。

运行：
  .venv/bin/python tools/gen-audio.py              只录新加的或改过的话，删掉用不到的旧录音
  .venv/bin/python tools/gen-audio.py --g2p        只打印每句话的拼音（检查多音字）
  .venv/bin/python tools/gen-audio.py --check DIR  录完用语音识别（sherpa-onnx paraformer 模型目录）核对一遍
"""
import argparse
import hashlib
import json
import re
import subprocess
import sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
AUDIO_DIR = ROOT / "audio"
INDEX_FILE = ROOT / "js" / "audio-index.js"
DEFAULT_MODELS = ROOT / "tools" / ".cache" / "kokoro"
# 句子、标题、词、表扬的话：zf_084，一句话读得连贯、有轻有重（50 个女声里节奏最自然、识别也准）
VOICE = "zf_084"
# 点一个字时念的单字：zf_003，单念时字音更清楚、也长一点（语音识别核对 106 个字：zf_003 对 72 个，zf_084 对 49–60 个）
CHAR_VOICE = "zf_003"
REF_F0 = {"zf_084": 277, "zf_003": 216}  # 声音说话时的平均音高（Hz），用来判断声调
SPEED = {"char": 0.8, "word": 1.0, "phrase": 1.0, "title": 1.0, "page": 1.1}
# 单个字：稍微拉长、收尾圆一点、码率高一点，听起来饱满（录法有变化时改 CHAR_RECIPE，单字会全部重录）
CHAR_TEMPO = 0.88
CHAR_KBPS = 64
CHAR_RECIPE = f"|full{CHAR_TEMPO}"
TONES = set("12345")
HAN = re.compile(r"[㐀-鿿]")

INITIALS = {"ㄅ": "b", "ㄆ": "p", "ㄇ": "m", "ㄈ": "f", "ㄉ": "d", "ㄊ": "t", "ㄋ": "n", "ㄌ": "l", "ㄍ": "g", "ㄎ": "k",
            "ㄏ": "h", "ㄐ": "j", "ㄑ": "q", "ㄒ": "x", "ㄓ": "zh", "ㄔ": "ch", "ㄕ": "sh", "ㄖ": "r", "ㄗ": "z", "ㄘ": "c", "ㄙ": "s"}
FINALS = {"ㄚ": "a", "ㄛ": "o", "ㄜ": "e", "ㄝ": "ê", "ㄞ": "ai", "ㄟ": "ei", "ㄠ": "ao", "ㄡ": "ou", "ㄢ": "an", "ㄣ": "en",
          "ㄤ": "ang", "ㄥ": "eng", "ㄦ": "er", "ㄧ": "i", "ㄨ": "u", "ㄩ": "ü", "ㄭ": "i", "十": "i", "万": "uan", "中": "ong",
          "为": "ui", "云": "ün", "元": "üan", "压": "ia", "又": "iu", "外": "uai", "应": "ing", "我": "uo", "文": "un",
          "月": "üe", "王": "uang", "瓮": "ueng", "用": "iong", "穵": "ua", "要": "iao", "言": "ian", "阳": "iang", "阴": "in"}


def load_items():
    out = subprocess.check_output(["node", str(ROOT / "tools" / "speech-list.mjs")])
    return json.loads(out)


def voice_for(kind):
    return CHAR_VOICE if kind == "char" else VOICE


# 拼音转换把叠字名字的第二个字念成轻声：可可 → kě ke，第二个字跟在三声后面会念得很高，听起来像 kě kē。
# 按平常说话的样子改回来：两个三声连着念，前一个变成二声（ké kě）。
PHONE_FIX = [
    ("ㄎㄜ3ㄎㄜ5", "ㄎㄜ2ㄎㄜ3"),          # 可可
    ("ㄆㄠ3ㄆㄠ5", "ㄆㄠ2ㄆㄠ3"),          # 跑跑（小狗的名字）
    ("ㄆㄠ3ㄆㄠ3", "ㄆㄠ2ㄆㄠ3"),
    ("ㄒ要3ㄒ要5ㄋ要3", "ㄒ要2ㄒ要2ㄋ要3"),  # 小小鸟
    ("ㄒ要3ㄒ要5/ㄋ要3", "ㄒ要2ㄒ要2/ㄋ要3"),
    ("ㄒ要3ㄒ要5", "ㄒ要2ㄒ要3"),          # 小小的
    ("王1王5", "王1王1"),                  # 汪汪
    ("ㄉㄞ4王2", "ㄉㄚ4王2"),              # 大王：dà wáng，不是戏里的 dài wang
]


def phone_fix(ph):
    for a, b in PHONE_FIX:
        ph = ph.replace(a, b)
    return ph


def clip_id(say, kind, fixed=False):
    recipe = CHAR_RECIPE if kind == "char" else "|carrier2"
    if fixed:
        recipe += "|pfix1"  # 改过拼音的句子要重新录
    return hashlib.sha1(f"{voice_for(kind)}|{SPEED[kind]}|{say}{recipe}".encode("utf-8")).hexdigest()[:10]


def syllables(phonemes):
    """把 G2P 的结果切成音节（每个音节以声调数字结尾），返回 [(音节, 声调)]。"""
    out, cur = [], ""
    for ch in phonemes:
        if ch in TONES:
            out.append((cur, ch))
            cur = ""
        elif ch == "R" and cur:
            out.append((cur, ""))
            cur = "ㄦ"
        elif ch in INITIALS or ch in FINALS:
            cur += ch
    return out


def to_pinyin(syl, tone):
    return "".join(INITIALS.get(c) or FINALS.get(c) or c for c in syl) + tone


def char_starts(timings):
    """每个音节（= 每个字）开始的时间。"""
    starts, cur = [], None
    for t in timings:
        p = t.phoneme
        if p in TONES:
            starts.append(cur if cur is not None else t.start)
            cur = None
        elif p == "R" and cur is not None:
            # 儿化（月儿 → 月R4）：「儿」从 R 开始
            starts.append(cur)
            cur = t.start
        elif p in INITIALS or p in FINALS:
            if cur is None:
                cur = t.start
    return starts


def syllable_spans(timings):
    """每个音节的 (开始, 韵母开始, 结束) 时间。"""
    out, cur, fin = [], None, None
    for t in timings:
        p = t.phoneme
        if p in TONES:
            out.append((cur if cur is not None else t.start, fin if fin is not None else t.start, t.end))
            cur = fin = None
        elif p in INITIALS or p in FINALS:
            if cur is None:
                cur = t.start
            if p in FINALS and fin is None:
                fin = t.start
    return out


def f0_track(x, sr):
    """简单的自相关音高跟踪，每 10ms 一个值（不发声的地方是 nan）。"""
    hop, win = int(sr * 0.01), int(sr * 0.04)
    starts = range(0, max(0, len(x) - win), hop)
    energy = [float(np.sqrt(np.mean(x[i:i + win] ** 2))) for i in starts]
    top = max(energy) if energy else 1.0
    out = []
    for e, i in zip(energy, starts):
        if e < 0.25 * top:
            out.append(np.nan)
            continue
        fr = x[i:i + win] - np.mean(x[i:i + win])
        ac = np.correlate(fr, fr, "full")[win - 1:]
        lo, hi = int(sr / 500), int(sr / 120)
        j = lo + int(np.argmax(ac[lo:hi]))
        out.append(sr / j if ac[j] > 0.45 * ac[0] else np.nan)
    return np.array(out)


def core_contour(x, sr, ref):
    """韵母部分（最响的那一段）的音高，单位：比平均音高高几个半音；去掉跟踪错的跳点。"""
    hop, win = int(sr * 0.01), int(sr * 0.04)
    starts = list(range(0, max(0, len(x) - win), hop))
    if not starts:
        return np.array([])
    energy = np.array([np.sqrt(np.mean(x[i:i + win] ** 2)) for i in starts])
    f = f0_track(x, sr)[:len(energy)]
    keep = (energy >= 0.45 * energy.max()) & ~np.isnan(f)
    st = 12 * np.log2(f[keep] / ref)
    if len(st) >= 3:
        st = st[np.abs(st - np.median(st)) <= 5]
    return st


def tone_score(x, sr, tone, ref):
    """音高形状有多像这个声调（越大越像）：一声平、二声升、三声低、四声降。"""
    s = core_contour(x, sr, ref)
    if tone == "5" or len(s) < 4:
        return 0.0
    k = max(1, len(s) // 4)
    a, b = s[:k].mean(), s[-k:].mean()
    if tone == "1":
        return -(max(0.0, a - b) + 0.5 * (s.max() - s.min()))
    if tone == "2":
        return b - a
    if tone == "3":
        return -s.mean() + 0.3 * (a - s.min())
    return a - b


def tone_ok(x, sr, tone, ref):
    sc = tone_score(x, sr, tone, ref)
    return {"1": sc >= -3.5, "2": sc >= 2.0, "3": sc >= 1.0, "4": sc >= 3.0}.get(tone, True)


# 单个字放在几种句子里念，剪出不在开头、也不在结尾的那一遍（开头和结尾常多出杂音）：
#   mid  「X，X，X。」的第 2 遍：列举的语气，一、二、四声最清楚
#   stop 「X，X。X。」的第 2 遍：句子末尾，三声低下去，不会像二声
#   mid4 「X，X，X，X。」的第 3 遍
SINGLE_PATTERNS = {"mid": ("{p}, {p}, {p}.", 1), "stop": ("{p}, {p}. {p}.", 1),
                   "mid4": ("{p}, {p}, {p}, {p}.", 2), "mid5": ("{p}, {p}, {p}, {p}, {p}.", 2),
                   "stop4": ("{p}, {p}, {p}. {p}.", 2)}
SINGLE_ORDER = {"1": ["mid", "mid4", "mid5", "stop"], "2": ["mid", "mid4", "mid5"], "3": ["stop", "stop4", "mid"],
                "4": ["mid", "mid4", "stop"], "5": ["mid"]}


def envelope(x, sr):
    """5ms 平滑的响度（加上高频部分，「s / sh / x」这类擦音也算进去）。"""
    d = np.abs(np.diff(x, prepend=x[:1])) + 0.3 * np.abs(x)
    f = max(1, int(sr * 0.005))
    return np.convolve(d, np.ones(f) / f, mode="same")


def first_quiet(env, sr, t0, t1, rel=0.06, hold=0.03):
    """从 t0 往后找第一段安静（低于最响的 rel，至少 hold 秒），在这段里最安静的地方剪。找不到返回 None。
    句子后面那句「对。」的时间有时报得特别晚，用「最安静的点」会剪到「对」后面去。"""
    i0, i1 = max(0, int(t0 * sr)), min(len(env), int(t1 * sr))
    thr = rel * env.max()
    need = max(1, int(hold * sr))
    k = i0
    while k < i1:
        if env[k] < thr:
            j = k
            while j < i1 and env[j] < thr:
                j += 1
            if j - k >= need:
                return k + int(np.argmin(env[k:j]))
            k = j
        k += 1
    return None


def quietest(env, sr, t0, t1):
    i0, i1 = max(0, int(t0 * sr)), min(len(env), int(t1 * sr))
    if i1 <= i0:
        return i0
    return i0 + int(np.argmin(env[i0:i1]))


def make_single(kokoro, phonemes, speed, ref, voice=CHAR_VOICE):
    """单个字：单独念时模型常在前面多出一个「衣」的音、声调也不稳，所以放在句子中间念几种，
    在真正没声音的地方剪出来（模型报的时间会晚 0–0.15 秒，不能直接按它剪），挑声调形状最像的一个。"""
    tone = next((c for c in phonemes if c in TONES), "5")
    best = None
    tries = [(name, speed) for name in SINGLE_ORDER.get(tone, ["mid"])]
    i = 0
    while i < len(tries):
        name, sp = tries[i]
        i += 1
        if i == len(SINGLE_ORDER.get(tone, ["mid"])) and best is not None and not tone_ok(best[0], best[1], tone, ref):
            # 都不够像：换个语速再试一轮
            tries += [(n, speed + 0.12) for n in SINGLE_ORDER.get(tone, ["mid"])] + [(n, speed - 0.08) for n in SINGLE_ORDER.get(tone, ["mid"])]
        pattern, k = SINGLE_PATTERNS[name]
        audio, sr, timings = kokoro.create_timed(pattern.format(p=phonemes), voice=voice, speed=sp, is_phonemes=True)
        audio = np.asarray(audio, dtype=np.float32)
        spans = syllable_spans(timings)
        if len(spans) <= k + 1:
            continue
        env = envelope(audio, sr)
        a = quietest(env, sr, spans[k - 1][2] - 0.05, spans[k][0] + 0.02)
        b = quietest(env, sr, spans[k][2] - 0.05, spans[k + 1][0] + 0.02)
        clip = audio[a:b].copy()
        n = min(len(clip) // 4, int(0.008 * sr))
        if n:
            clip[:n] *= np.linspace(0, 1, n, dtype=np.float32)
            clip[-n:] *= np.linspace(1, 0, n, dtype=np.float32)
        score = tone_score(clip, sr, tone, ref)
        if best is None or score > best[3]:
            best = (clip, sr, f"{name}@{sp:.2f}", score)
    if best is None:
        audio, sr, _ = kokoro.create_timed(phonemes, voice=voice, speed=speed, is_phonemes=True)
        return np.asarray(audio, dtype=np.float32), sr, "单独念", False
    clip, sr, name, score = best
    return clip, sr, f"{name} {score:+.1f}", tone_ok(clip, sr, tone, ref)


def make_line(kokoro, g2p, phonemes, speed):
    """句子和词：前面加一句「好。」、后面加一句「对。」一起念，再在真正的停顿处剪掉，
    这样开头和结尾不会多出杂音（很短的词尤其容易多出一个「衣」的音）。
    后面用「对」：d 开头前面有一小段完全安静，好剪；用「好」的话 h 和句子连在一起，结尾会带出一点「要」「以」的音。"""
    head, _ = g2p("好。")
    tail, _ = g2p("对。")
    body = phonemes if phonemes.rstrip()[-1:] in ".!?" else phonemes + "."
    audio, sr, timings = kokoro.create_timed(f"{head} {body} {tail}", voice=VOICE, speed=speed, is_phonemes=True)
    audio = np.asarray(audio, dtype=np.float32)
    spans = syllable_spans(timings)
    starts = char_starts(timings)
    if len(spans) < 3:
        return audio, sr, starts
    env = envelope(audio, sr)
    a = quietest(env, sr, spans[0][2] - 0.1, spans[1][0] + 0.02)
    b = first_quiet(env, sr, spans[-2][1], spans[-1][2])
    if b is None:
        b = quietest(env, sr, spans[-2][2] - 0.1, spans[-1][0] + 0.02)
    clip = audio[a:b].copy()
    n = min(len(clip) // 4, int(0.008 * sr))
    if n:
        clip[:n] *= np.linspace(0, 1, n, dtype=np.float32)
        clip[-n:] *= np.linspace(1, 0, n, dtype=np.float32)
    return clip, sr, [t - a / sr for t in starts[1:-1]]


def polish(audio, sr):
    """去掉前后的静音、统一音量、前后留一点空。返回 (音频, 时间偏移)。"""
    a = np.asarray(audio, dtype=np.float32)
    env = envelope(a, sr)
    loud = np.where(env > 0.03 * (env.max() if len(env) else 1))[0]
    s0 = 0
    if len(loud):
        s0 = max(0, loud[0] - int(0.06 * sr))
        a = a[s0:min(len(a), loud[-1] + int(0.1 * sr))]
    frame = int(0.02 * sr)
    if len(a) > frame:
        rms = np.sqrt(np.mean(a[: len(a) // frame * frame].reshape(-1, frame) ** 2, axis=1))
        level = np.percentile(rms, 90)
        if level > 1e-4:
            a = a * (0.2 / level)
    peak = float(np.max(np.abs(a))) if len(a) else 0
    if peak > 0.95:
        a = a * (0.95 / peak)
    lead = 0.05
    a = np.concatenate([np.zeros(int(lead * sr), np.float32), a, np.zeros(int(0.12 * sr), np.float32)])
    return a.astype(np.float32), lead - s0 / sr


def encode_mp3(a, sr, path, kbps=32):
    subprocess.run(
        ["ffmpeg", "-v", "error", "-y", "-f", "f32le", "-ar", str(sr), "-ac", "1", "-i", "-",
         "-codec:a", "libmp3lame", "-b:a", f"{kbps}k", str(path)],
        input=a.tobytes(), check=True)


def ffilter(a, sr, chain):
    """用 ffmpeg 的滤镜处理一段音频（float32 单声道）。"""
    out = subprocess.run(
        ["ffmpeg", "-v", "error", "-f", "f32le", "-ar", str(sr), "-ac", "1", "-i", "-", "-af", chain,
         "-f", "f32le", "-ac", "1", "-ar", str(sr), "-"],
        input=np.asarray(a, np.float32).tobytes(), capture_output=True, check=True).stdout
    return np.frombuffer(out, np.float32).copy()


def fuller(audio, sr):
    """单个字念得饱满一点：稍微拉长（不变调）、低音厚一点、去掉一点刺耳的高音。"""
    chain = "lowshelf=g=2:f=180,equalizer=f=3500:t=q:w=1:g=-1.5"
    if CHAR_TEMPO != 1:
        chain = f"rubberband=tempo={CHAR_TEMPO}:window=short:transients=mixed," + chain
    return ffilter(audio, sr, chain)


def round_tail(a, sr, lead=0.05, tail=0.12):
    """收尾圆一点：声音最后 60 毫秒慢慢收掉，不要一下子断掉（polish 之后用）。"""
    end = len(a) - int(tail * sr)
    n = int(0.06 * sr)
    if end - n > int(lead * sr):
        a = a.copy()
        a[end - n:end] *= (0.5 + 0.5 * np.cos(np.linspace(0, np.pi, n))).astype(np.float32)
    return a


def decode(path, sr=16000):
    raw = subprocess.check_output(["ffmpeg", "-v", "error", "-i", str(path), "-f", "f32le", "-ac", "1", "-ar", str(sr), "-"])
    return np.frombuffer(raw, dtype=np.float32)


def read_index():
    if not INDEX_FILE.exists():
        return {}
    text = INDEX_FILE.read_text(encoding="utf-8")
    m = re.search(r"window\.AUDIO_INDEX = (\{.*\});", text, re.S)
    return json.loads(m.group(1)) if m else {}


def write_index(index):
    lines = ["/* 自动生成，不要手改：python3 tools/gen-audio.py。每一项：[文件名, 秒数, 每个字开始的秒数] */",
             "window.AUDIO_INDEX = {"]
    keys = sorted(index)
    for i, k in enumerate(keys):
        lines.append(f"  {json.dumps(k, ensure_ascii=False)}: {json.dumps(index[k], ensure_ascii=False, separators=(',', ':'))}" + ("," if i < len(keys) - 1 else ""))
    lines.append("};")
    INDEX_FILE.write_text("\n".join(lines) + "\n", encoding="utf-8")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--models", default=str(DEFAULT_MODELS))
    ap.add_argument("--g2p", action="store_true", help="只打印拼音")
    ap.add_argument("--check", metavar="ASR_DIR", help="用 sherpa-onnx paraformer 识别模型核对录音")
    ap.add_argument("--force", action="store_true", help="全部重新录")
    args = ap.parse_args()

    from misaki import zh
    g2p = zh.ZHG2P(version="1.1")
    items = load_items()

    if args.g2p:
        for it in items:
            ph = phone_fix(g2p(it["say"])[0])
            print(it["key"], "→", " ".join(to_pinyin(s, t) for s, t in syllables(ph)))
        return

    from kokoro_onnx import Kokoro
    m = Path(args.models)
    kokoro = Kokoro(str(m / "kokoro-v1.1-zh.onnx"), str(m / "voices-v1.1-zh.bin"), vocab_config=str(m / "config.json"))
    AUDIO_DIR.mkdir(exist_ok=True)
    old = read_index()
    index, made, warn = {}, 0, []
    for it in items:
        key, say, kind = it["key"], it["say"], it["kind"]
        ph0, _ = g2p(say)
        ph = phone_fix(ph0)
        cid = clip_id(say, kind, ph != ph0)
        path = AUDIO_DIR / f"{cid}.mp3"
        if not args.force and path.exists() and key in old and old[key][0] == cid:
            index[key] = old[key]
            continue
        if kind == "char":
            audio, sr, method, ok = make_single(kokoro, ph, SPEED[kind], REF_F0[CHAR_VOICE])
            audio = fuller(audio, sr)
            starts = []
            if not ok:
                warn.append(f"「{key}」的声调形状不太对，请听一下（用的是{method}）")
        else:
            audio, sr, starts = make_line(kokoro, g2p, ph, SPEED[kind])
        a, shift = polish(audio, sr)
        shift -= 0.05  # 模型报的时间一般晚一点，高亮提前 0.05 秒
        if kind == "char":
            a = round_tail(a, sr)
        encode_mp3(a, sr, path, CHAR_KBPS if kind == "char" else 32)
        entry = [cid, round(len(a) / sr, 2)]
        n_han = len(HAN.findall(key))
        if kind in ("page", "title") and n_han > 1:
            marks = [round(max(0.0, t + shift), 2) for t in starts]
            if len(marks) == n_han:
                entry.append(marks)
            else:
                warn.append(f"字数和音节数对不上（{n_han} / {len(marks)}），这一句改用估算的高亮：{key}")
        index[key] = entry
        made += 1
        print(f"录好 {made}: {key}", flush=True)
    keep = {v[0] for v in index.values()}
    removed = 0
    for f in AUDIO_DIR.glob("*.mp3"):
        if f.stem not in keep:
            f.unlink()
            removed += 1
    write_index(index)
    total = sum(f.stat().st_size for f in AUDIO_DIR.glob("*.mp3"))
    print(f"新录 {made} 句，删掉 {removed} 个旧文件；一共 {len(index)} 句，{total // 1024} KB")
    for w in warn:
        print("注意：", w)
    if args.check:
        check(items, index, Path(args.check))


def check(items, index, asr_dir):
    """用语音识别听一遍：句子比较拼音（不看声调），单个字比较带声调的拼音。"""
    import sherpa_onnx
    from pypinyin import lazy_pinyin, Style

    rec = sherpa_onnx.OfflineRecognizer.from_paraformer(
        paraformer=str(asr_dir / "model.int8.onnx"), tokens=str(asr_dir / "tokens.txt"),
        num_threads=4, sample_rate=16000, feature_dim=80, decoding_method="greedy_search")

    def hear(path):
        s = rec.create_stream()
        s.accept_waveform(16000, decode(path))
        rec.decode_stream(s)
        return s.result.text

    def py(text, style):
        return [p for p in lazy_pinyin("".join(HAN.findall(text)), style=style, neutral_tone_with_five=True)]

    def dist(a, b):
        d = list(range(len(b) + 1))
        for i in range(1, len(a) + 1):
            prev, d[0] = d[0], i
            for j in range(1, len(b) + 1):
                cur = min(d[j] + 1, d[j - 1] + 1, prev + (a[i - 1] != b[j - 1]))
                prev, d[j] = d[j], cur
        return d[len(b)]

    bad = []
    errs = total = 0
    for it in items:
        key, say, kind = it["key"], it["say"], it["kind"]
        got = hear(AUDIO_DIR / f"{index[key][0]}.mp3")
        if kind == "char":
            ok = py(say, Style.TONE3)[:1] == py(got, Style.TONE3)[:1]
            if not ok:
                bad.append(f"[字] {key}（念 {say}）听成：{got or '（没听出来）'}")
            continue
        want, heard = py(say, Style.NORMAL), py(got, Style.NORMAL)
        e = dist(want, heard)
        errs += e
        total += len(want)
        if e:
            bad.append(f"[{kind}] {key} 听成：{got}")
    print(f"\n语音识别核对：句子音节错误率 {errs}/{total} = {errs / max(1, total):.1%}")
    for b in bad:
        print("  ", b)


if __name__ == "__main__":
    sys.exit(main())
