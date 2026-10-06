#!/usr/bin/env python3
"""Wikipedia日本語版の情報ボックスから element-details.js を生成する。

「一般特性」「物理特性」「原子特性」「その他」の4区分だけを取り出す（主な同位体以降は対象外）。
使い方: python3 tools/build_element_details.py   （リポジトリ直下で実行）
取得した HTML は tools/.cache/ に保存し、2回目以降はそれを使う。
"""
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

from bs4 import BeautifulSoup, NavigableString, Tag

ROOT = Path(__file__).resolve().parent.parent
CACHE = Path(__file__).resolve().parent / ".cache"
OUT = ROOT / "element-details.js"
UA = "periodic_table-builder/1.0 (https://github.com/supergenom/periodic_table)"
SECTIONS = ["一般特性", "物理特性", "原子特性", "その他"]
KEEP_TAGS = {"sup", "sub", "br"}
# 英語版の記事名が元素と一致しないもの
EN_TITLE_OVERRIDES = {"Mercury": "Mercury (element)"}


def get_json(host, params):
    url = f"https://{host}/w/api.php?" + urllib.parse.urlencode({**params, "format": "json", "formatversion": 2})
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.load(r)


def read_symbols_and_names():
    html = (ROOT / "index.html").read_text(encoding="utf8")
    symbols = re.search(r'const SYMBOLS = "([^"]+)"', html).group(1).split(" ")
    block = re.search(r"const NAMES = \[([\s\S]*?)\]\.join", html).group(1)
    names = " ".join(re.findall(r'"([^"]+)"', block)).split(" ")
    assert len(symbols) == len(names) == 118
    return symbols, names


def ja_titles(names):
    """英語名 → 日本語版の記事名（英語版の言語間リンクを利用）"""
    en = [EN_TITLE_OVERRIDES.get(n, n) for n in names]
    result = {}
    for i in range(0, len(en), 50):
        chunk = en[i:i + 50]
        data = get_json("en.wikipedia.org", {"action": "query", "titles": "|".join(chunk),
                                             "prop": "langlinks", "lllang": "ja", "redirects": 1, "lllimit": "max"})
        q = data["query"]
        redirect = {r["from"]: r["to"] for r in q.get("redirects", [])}
        normalized = {r["from"]: r["to"] for r in q.get("normalized", [])}
        ja_by_page = {p["title"]: p["langlinks"][0]["title"] for p in q["pages"] if p.get("langlinks")}
        for t in chunk:
            t2 = normalized.get(t, t)
            t2 = redirect.get(t2, t2)
            result[t] = ja_by_page.get(t2)
    return [result[t] for t in en]


def fetch_infobox_html(number, title):
    CACHE.mkdir(exist_ok=True)
    path = CACHE / f"{number:03d}.html"
    if path.exists():
        return path.read_text(encoding="utf8")
    data = get_json("ja.wikipedia.org", {"action": "parse", "page": title, "prop": "text", "section": 0, "redirects": 1})
    html = data["parse"]["text"]
    path.write_text(html, encoding="utf8")
    time.sleep(0.3)
    return html


def clean(node):
    """セル内の HTML から脚注などを除き、sup/sub/br だけ残した文字列にする"""
    for bad in node.select("sup.reference, style, .mw-ref, .reference, .noprint"):
        bad.decompose()

    def walk(n):
        if isinstance(n, NavigableString):
            return str(n).replace("<", "&lt;").replace(">", "&gt;")
        if not isinstance(n, Tag):
            return ""
        inner = "".join(walk(c) for c in n.children)
        if n.name == "br":
            return "<br>"
        if n.name in KEEP_TAGS:
            return f"<{n.name}>{inner}</{n.name}>"
        if n.name in ("p", "div", "li"):
            return inner + "<br>"
        return inner

    s = walk(node)
    s = s.replace("\xa0", " ")
    s = re.sub(r"（画像）|\(画像\)", "", s)
    s = re.sub(r"[ \t\r\n]+", " ", s)
    s = re.sub(r"\s*<br>\s*", "<br>", s)
    s = re.sub(r"(<br>)+", "<br>", s).strip()
    s = re.sub(r"^(<br>)+|(<br>)+$", "", s)
    s = re.sub(r"\s*&gt;$", "", s)   # 記事側の入力ミスで末尾に残る「>」
    return s.strip()


def text_of(node):
    return re.sub(r"\s+", " ", node.get_text(" ", strip=True))


def parse_vapor(cell):
    rows = cell.find("table").find_all("tr")
    temps = [c.get_text(strip=True) for c in rows[1].find_all(["td", "th"])[1:7]] if len(rows) > 1 else []
    temps += [""] * (6 - len(temps))
    return {"vaporPressure": [float(t) if re.fullmatch(r"[\d.]+", t) and "." in t else (int(t) if t.isdigit() else None)
                              for t in temps]}


def parse_infobox(html):
    soup = BeautifulSoup(html, "html.parser")
    box = next((t for t in soup.find_all("table") if t.find("th", string=re.compile("一般特性"))), None)
    if box is None:
        return []
    body = box.find("tbody") or box
    sections, current, pending_header, span_left = [], None, None, 0
    for tr in body.find_all("tr", recursive=False):
        cells = tr.find_all(["th", "td"], recursive=False)
        if not cells:
            continue
        # 複数行にまたがる項目（rowspan）の続きの行は、前の項目の値に追記する
        if span_left > 0:
            span_left -= 1
            extra = " ".join(v for v in (clean(c) for c in cells) if v)
            if extra and current and current["rows"] and isinstance(current["rows"][-1][1], str):
                current["rows"][-1][1] += "<br>" + extra
            continue
        # 区分見出し・小見出し（colspan=2 の th だけの行）
        if len(cells) == 1 and cells[0].name == "th":
            label = text_of(cells[0])
            if "同位体" in label:
                break
            sec = next((s for s in SECTIONS if label.startswith(s)), None)
            if sec:
                current = {"title": sec, "rows": []}
                sections.append(current)
                pending_header = None
            elif current:
                pending_header = label   # 例: 蒸気圧
            continue
        if current is None:
            continue
        # 小見出しの直後の全幅セル（蒸気圧の表など）
        if len(cells) == 1 and cells[0].name == "td":
            cell = cells[0]
            if cell.find("table") and pending_header and "蒸気圧" in pending_header:
                current["rows"].append([pending_header, parse_vapor(cell)])
            elif cell.find("img") and not text_of(cell):
                pass
            elif current["rows"] and text_of(cell):
                current["rows"][-1][1] += "<br>" + clean(cell)   # 前の行の続き
            pending_header = None
            continue
        th = tr.find("th", recursive=False)
        tds = tr.find_all("td", recursive=False)
        if th is None:
            if current["rows"] and isinstance(current["rows"][-1][1], str):
                current["rows"][-1][1] += "<br>" + " ".join(clean(td) for td in tds)
            continue
        label = clean(th).replace("<br>", "")
        span_left = int(th.get("rowspan", 1) or 1) - 1
        value = " ".join(v for v in (clean(td) for td in tds) if v)
        if not value:
            continue
        prev = current["rows"][-1] if current["rows"] else None
        if prev and isinstance(prev[1], str) and (not label or label == prev[0]):
            prev[1] += "<br>" + value   # 見出しなし・同じ見出しの行は前の項目の続き
        else:
            current["rows"].append([label, value])
        pending_header = None
    return [s for s in sections if s["rows"]]


def main():
    symbols, names = read_symbols_and_names()
    titles = ja_titles(names)
    lines = [
        "// 元素の詳細データ（出典: Wikipedia日本語版 各元素記事の情報ボックス, CC BY-SA 4.0）",
        "// tools/build_element_details.py で自動生成。直接編集せず、スクリプトを再実行すること。",
        "// 原子番号をキーに、「一般特性」「物理特性」「原子特性」「その他」の4区分を持つ。",
        "// rows の値は HTML（上付き・下付き文字のため）。蒸気圧は { vaporPressure: [...] } で表す。",
        "// vaporPressure の並びは 1, 10, 100, 1k, 10k, 100k Pa に対する温度 (K)。空欄は null。",
        "const ELEMENT_DETAILS = {};",
        "",
    ]
    problems = []
    for i, (sym, title) in enumerate(zip(symbols, titles)):
        n = i + 1
        if not title:
            problems.append(f"{n} {sym}: 日本語版の記事名が見つからない")
            continue
        sections = parse_infobox(fetch_infobox_html(n, title))
        found = [s["title"] for s in sections]
        if found != SECTIONS:
            problems.append(f"{n} {sym} {title}: 区分 {found}")
        if not sections:
            continue
        entry = {"ja": title, "source": "https://ja.wikipedia.org/wiki/" + urllib.parse.quote(title.replace(" ", "_")),
                 "sections": sections}
        lines.append(f"ELEMENT_DETAILS[{n}] = {json.dumps(entry, ensure_ascii=False, indent=2)};")
        lines.append("")
        print(f"{n:3d} {sym:2s} {title}: " + " ".join(f"{s['title']}{len(s['rows'])}" for s in sections))
    OUT.write_text("\n".join(lines), encoding="utf8")
    print(f"\n{OUT.name} を書き出しました")
    if problems:
        print("要確認:", *problems, sep="\n  ")
    return 0


if __name__ == "__main__":
    sys.exit(main())
