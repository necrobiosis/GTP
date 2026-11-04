#!/usr/bin/env python3
"""
故事里每个字的笔顺、笔画名称和拼音，写到 js/strokes.js（认生字时「写一写」「读一读」用）。

- 笔顺（每一笔的形状和中线）：hanzi-writer-data 2.0.1（Make Me a Hanzi，Arphic Public License，
  见 js/vendor/ARPHICPL-hanzi-writer-data.txt）。
- 笔画名称（横、竖、横折钩……）：cnchar-order 3.2.6（MIT，见 js/vendor/LICENSE-cnchar.txt）。
  只把它里面的两份 JSON 数据读出来用，不运行它的代码。它有几个字母一个代表两种笔画
  （横撇/横钩、斜钩/卧钩……），按笔画的形状分开；几、九这类字的「横斜钩」按课本叫横折弯钩。
- 两份数据的笔顺来源不同，这里按每一笔的走向互相核对一遍，对不上的会打印出来，
  在下面的 FIX 里按课本的笔顺改。
- 拼音：pypinyin（单念时的读音按 js/chars.js 的 SAY_ALONE）。用来挑「读音像但不一样」的干扰项。

用法（需要 pypinyin）：python3 tools/build-strokes.py
下载的文件缓存在 tools/.cache/（不进 git）。
"""
import json
import math
import re
import sys
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "tools" / ".cache"
HW_URL = "https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0.1/{}.json"
CN_URL = "https://cdn.jsdelivr.net/npm/cnchar-order@3.2.6/cnchar.order.min.js"

# cnchar-order 的字母 → 课本上的笔画名称（一个字母两种的，先写常见的，再按形状改）
NAMES = {
    "a": "横折折撇", "b": "竖折", "c": "横折", "d": "点", "e": "横撇", "f": "竖", "g": "竖钩",
    "h": "竖提", "i": "提", "j": "横", "k": "点", "l": "捺", "m": "撇点", "n": "撇折",
    "o": "横折弯钩", "p": "横折提", "q": "横折折折", "r": "横折钩", "s": "撇", "t": "弯钩",
    "u": "竖弯钩", "v": "横折折", "w": "横撇弯钩", "x": "竖折撇", "y": "斜钩", "z": "竖折折钩",
}

# 按课本改的地方：{字: {第几笔（从 0 数）: 名称}}。都是对照笔画形状一个一个看过的。
FIX = {
    # 宀、冖、卖、尔、欠 里的是横钩（cnchar 用同一个字母表示横撇和横钩）
    "家": {2: "横钩"}, "字": {2: "横钩"}, "安": {2: "横钩"}, "雪": {2: "横钩"}, "亮": {6: "横钩"},
    "爱": {5: "横钩"}, "读": {4: "横钩"}, "你": {3: "横钩"}, "歌": {11: "横钩"},
    # 横斜钩 / 横折斜钩（风、气、飞），其余的（几、九、吃、亮）是横折弯钩
    "风": {1: "横斜钩"}, "气": {3: "横斜钩"}, "飞": {0: "横折斜钩"},
    # 竖弯（四），横折弯（朵、船右上的「几」没有钩）
    "四": {3: "竖弯"}, "朵": {1: "横折弯", 5: "点"}, "船": {4: "提", 7: "横折弯"},
    # 女字旁最后一笔是提；马的最后一笔是提；虫的第五笔是提
    "好": {2: "提"}, "妈": {2: "提", 5: "提"}, "马": {2: "提"}, "虫": {4: "提"},
    "蛋": {4: "点", 9: "提"}, "香": {4: "点"}, "绿": {10: "点"},
    # 走之底最后一笔是平捺
    "连": {6: "平捺"}, "还": {6: "平捺"}, "送": {8: "平捺"},
}

# 这些字在两份数据里笔顺不一样：用 hanzi-writer 的笔顺，名称按它的顺序重新排（下标是 cnchar 的顺序）
REORDER = {}


def fetch(url, name):
    CACHE.mkdir(parents=True, exist_ok=True)
    p = CACHE / name
    if not p.exists():
        with urllib.request.urlopen(url, timeout=60) as r:
            p.write_bytes(r.read())
    return p.read_text(encoding="utf-8")


def js_string(text, name):
    m = re.search(name + r"\s*=\s*'([^']*)'", text)
    return m.group(1) if m else ""


def all_chars():
    """故事（题目和每一页）里的字 + 生字。"""
    stories = (ROOT / "js" / "stories.js").read_text(encoding="utf-8")
    stories = re.sub(r"/\*.*?\*/", "", stories, flags=re.S)
    stories = re.sub(r"(?m)^\s*//.*$", "", stories)
    texts = re.findall(r"(?:title|text):\s*'([^']*)'", stories)
    chars = []
    for t in texts:
        for c in t:
            if "一" <= c <= "鿿" and c not in chars:
                chars.append(c)
    practice = js_string((ROOT / "js" / "chars.js").read_text(encoding="utf-8"), r"PRACTICE_CHARS")
    for c in practice:
        if c not in chars:
            chars.append(c)
    return chars


def say_alone():
    text = (ROOT / "js" / "chars.js").read_text(encoding="utf-8")
    block = re.search(r"SAY_ALONE\s*=\s*\{(.*?)\};", text, re.S)
    return dict(re.findall(r"(\S):\s*'(\S)'", block.group(1))) if block else {}


# ---------- 用笔画的走向核对笔顺 ----------
def simplify(pts, eps):
    if len(pts) < 3:
        return pts
    (x1, y1), (x2, y2) = pts[0], pts[-1]
    L = math.hypot(x2 - x1, y2 - y1) or 1
    far, idx = 0, 0
    for i in range(1, len(pts) - 1):
        x0, y0 = pts[i]
        d = abs((y2 - y1) * x0 - (x2 - x1) * y0 + x2 * y1 - y2 * x1) / L
        if d > far:
            far, idx = d, i
    if far > eps:
        return simplify(pts[: idx + 1], eps)[:-1] + simplify(pts[idx:], eps)
    return [pts[0], pts[-1]]


def directions(median):
    """一笔的走向：h 横（向右）、v 竖（向下）、p 撇（左下）、n 捺/点（右下）、t 提（右上）、g 钩（向上、向左）。"""
    pts = [(x, 900 - y) for x, y in median]  # 换成 y 朝下
    pts = simplify(pts, 45)
    total = sum(math.hypot(x2 - x1, y2 - y1) for (x1, y1), (x2, y2) in zip(pts, pts[1:])) or 1
    out = []
    for j, ((x1, y1), (x2, y2)) in enumerate(zip(pts, pts[1:])):
        dx, dy = x2 - x1, y2 - y1
        seg = math.hypot(dx, dy)
        # 太短的不算；起笔的小顿笔（第一段很短）也不算
        if seg < 40 or (j == 0 and len(pts) > 2 and seg < 0.25 * total):
            continue
        a = math.degrees(math.atan2(dy, dx))  # 0 向右，90 向下
        if -25 <= a <= 25:
            k = "h"
        elif 25 < a < 62:
            k = "n"
        elif 62 <= a <= 112:
            k = "v"
        elif 112 < a <= 175:
            k = "p"
        elif -82 <= a < -20:
            k = "t"
        else:
            k = "g"
        if not out or out[-1] != k:
            out.append(k)
    return "".join(out) or "k"


# 简单笔画允许的形状（撇常常先往下再往左，捺常常最后平出去）
SIMPLE_OK = {"撇": ("vp",), "捺": ("nh",), "平捺": ("nh", "hn", "hnh"), "横": ("ht", "th", "hn"), "竖": ("vp",),
             "点": ("nv", "vn", "pv", "np", "vp", "nh")}

# 每种笔画的第一段走向（点可以朝很多方向，不核对）
FIRST = {"横": "ht", "竖": "v", "撇": "pv", "捺": "nh", "提": "th", "点": None}


def first_of(name):
    for k, v in FIRST.items():
        if name.startswith(k):
            return v
    return None


def main():
    try:
        from pypinyin import Style, lazy_pinyin
    except ImportError:
        sys.exit("需要 pypinyin：pip install pypinyin")
    chars = all_chars()
    alone = say_alone()
    src = fetch(CN_URL, "cnchar.order.min.js")
    blobs = [json.loads(b) for b in re.findall(r"JSON\.parse\('(.*?)'\)", src, flags=re.S)]
    orders = next(b for b in blobs if len(b) > 1000)

    strokes, names, pinyin, problems = {}, {}, {}, []
    for c in chars:
        d = json.loads(fetch(HW_URL.format(urllib.parse.quote(c)), f"hw-{ord(c):x}.json"))
        strokes[c] = {"strokes": d["strokes"], "medians": d["medians"]}
        code = orders.get(c)
        if not code:
            problems.append(f"{c}：cnchar 里没有")
            continue
        nm = [NAMES[k] for k in code]
        if c in REORDER:
            nm = [nm[i] for i in REORDER[c]]
        for i, v in FIX.get(c, {}).items():
            nm[i] = v
        if len(nm) != len(d["medians"]):
            problems.append(f"{c}：笔画数不一样 cnchar {len(nm)} / hanzi-writer {len(d['medians'])}")
            continue
        for i, (n, med) in enumerate(zip(nm, d["medians"])):
            want = first_of(n)
            got = directions(med)
            simple = n in ("横", "竖", "撇", "捺", "点", "提", "平捺")
            if simple and len(got) > 1 and got not in SIMPLE_OK.get(n, ()):
                problems.append(f"{c} 第{i + 1}笔：名称 {n}，形状却拐了弯 {got}（cnchar {code}）")
            elif not simple and len(got) == 1 and n not in ("横撇", "横钩", "横折钩", "横折", "弯钩", "竖钩", "斜钩", "卧钩"):
                problems.append(f"{c} 第{i + 1}笔：名称 {n}，形状却是一条线 {got}（cnchar {code}）")
            if want and got[0] not in want:
                problems.append(f"{c} 第{i + 1}笔：名称 {n}，形状 {got}（cnchar {code}）")
        names[c] = nm
        pinyin[c] = lazy_pinyin(alone.get(c, c), style=Style.TONE3, neutral_tone_with_five=True)[0]

    out = (ROOT / "js" / "strokes.js")
    out.write_text(
        "/* 自动生成，不要手改：python3 tools/build-strokes.py。\n"
        " * HANZI_STROKES：每个字的笔顺（hanzi-writer-data，Arphic Public License）\n"
        " * STROKE_NAMES：每一笔叫什么（cnchar-order 的数据，MIT，按课本的叫法整理过）\n"
        " * CHAR_PY：单念时的拼音（数字是声调，5 是轻声） */\n"
        f"window.HANZI_STROKES = {json.dumps(strokes, ensure_ascii=False, separators=(',', ':'))};\n"
        f"window.STROKE_NAMES = {json.dumps(names, ensure_ascii=False, separators=(',', ':'))};\n"
        f"window.CHAR_PY = {json.dumps(pinyin, ensure_ascii=False, separators=(',', ':'))};\n",
        encoding="utf-8")
    used = sorted({n for v in names.values() for n in v})
    print(f"{len(strokes)} 个字 → js/strokes.js（{out.stat().st_size // 1024} KB）；用到的笔画：{'、'.join(used)}")
    for p in problems:
        print("对不上：", p)


if __name__ == "__main__":
    main()
