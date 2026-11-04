#!/usr/bin/env python3
"""
下载生字（js/chars.js 里的 PRACTICE_CHARS）的笔顺数据，写到 js/strokes.js（认生字时「写一写」用）。
数据来自 hanzi-writer-data（Make Me a Hanzi，Arphic Public License，见 js/vendor/ARPHICPL-hanzi-writer-data.txt）。
用法：python3 tools/build-strokes.py
"""
import json
import re
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
URL = "https://cdn.jsdelivr.net/npm/hanzi-writer-data@2.0.1/{}.json"


def main():
    text = (ROOT / "js" / "chars.js").read_text(encoding="utf-8")
    m = re.search(r"PRACTICE_CHARS\s*=\s*'([^']*)'", text)
    chars = list(dict.fromkeys(m.group(1))) if m else []
    out = {}
    for c in chars:
        with urllib.request.urlopen(URL.format(urllib.parse.quote(c)), timeout=30) as r:
            d = json.loads(r.read().decode("utf-8"))
        out[c] = {"strokes": d["strokes"], "medians": d["medians"], "radStrokes": d.get("radStrokes", [])}
    body = json.dumps(out, ensure_ascii=False, separators=(",", ":"))
    (ROOT / "js" / "strokes.js").write_text(
        "/* 自动生成，不要手改：python3 tools/build-strokes.py。生字的笔顺（hanzi-writer-data，Arphic Public License）。 */\n"
        f"window.HANZI_STROKES = {body};\n", encoding="utf-8")
    print(f"{len(out)} 个字的笔顺 → js/strokes.js")


if __name__ == "__main__":
    main()
