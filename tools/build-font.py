#!/usr/bin/env python3
"""
把「霞鹜文楷 GB」裁成只包含故事里用到的字的小字体（fonts/kidkai.woff2）。
加了新字或新故事以后运行一次：

    pip install fonttools brotli
    python3 tools/build-font.py

第一次运行会把原字体（约 19MB）下载到 tools/.cache/ 里（这个目录不进 git）。
字体许可：SIL Open Font License 1.1，见 fonts/OFL.txt。
"""
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CACHE = ROOT / "tools" / ".cache"
SRC_URL = "https://github.com/lxgw/LxgwWenkaiGB/releases/download/v1.501/LXGWWenKaiGB-Medium.ttf"
SRC = CACHE / "LXGWWenKaiGB-Medium.ttf"
OUT = ROOT / "fonts" / "kidkai.woff2"

# 界面上用楷体显示、但不在故事里的字
EXTRA = "字"
PUNCT = "，。！？、：；“”‘’（）《》……—·0123456789"


def collect_chars() -> str:
    text = ""
    for name in ("chars.js", "stories.js", "hanzi.js"):
        text += (ROOT / "js" / name).read_text(encoding="utf-8")
    han = set(re.findall(r"[㐀-鿿]", text))
    return "".join(sorted(han)) + EXTRA + PUNCT


def main() -> None:
    from fontTools import subset

    src = Path(sys.argv[1]) if len(sys.argv) > 1 else SRC
    if not src.exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        print("下载字体：", SRC_URL)
        urllib.request.urlretrieve(SRC_URL, SRC)
        src = SRC
    chars = collect_chars()
    opts = subset.Options()
    opts.flavor = "woff2"
    opts.layout_features = ["*"]
    opts.name_IDs = ["*"]
    opts.name_languages = ["*"]
    opts.notdef_outline = True
    font = subset.load_font(str(src), opts)
    sub = subset.Subsetter(opts)
    sub.populate(text=chars)
    sub.subset(font)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    subset.save_font(font, str(OUT), opts)
    print(f"{len(set(chars))} 个字符 → {OUT.relative_to(ROOT)}（{OUT.stat().st_size // 1024} KB）")


if __name__ == "__main__":
    main()
