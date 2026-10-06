#!/usr/bin/env python3
"""PubChem の周期表データ（CSV）から、各元素の殻ごとの電子数を計算して element-shells.js を生成する。

電子配置（例: "[Ar]4s2 3d6"）を展開し、主量子数（1s の「1」など）ごとに電子数を合計すると
K, L, M, … 殻の電子数になる（鉄なら 2, 8, 14, 2）。
使い方: python3 tools/build_electron_shells.py   （リポジトリ直下で実行）
最後に element-details.js（Wikipedia）の「電子殻」と比べ、違う元素を表示する。
"""
import csv
import io
import json
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "element-shells.js"
CSV_URL = "https://pubchem.ncbi.nlm.nih.gov/rest/pug/periodictable/CSV"
UA = "periodic_table-builder/1.0 (https://github.com/supergenom/periodic_table)"
NOBLE = {"He": 2, "Ne": 10, "Ar": 18, "Kr": 36, "Xe": 54, "Rn": 86}


def fetch_rows():
    req = urllib.request.Request(CSV_URL, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        text = r.read().decode("utf8")
    return {int(r["AtomicNumber"]): r for r in csv.DictReader(io.StringIO(text))}


def shells_from_config(config, configs_by_symbol):
    """電子配置の文字列 → 殻ごとの電子数のリスト"""
    config = re.sub(r"\(.*?\)", "", config)   # "(predicted)" などを除く
    counts = {}
    m = re.match(r"\s*\[(\w+)\]", config)
    if m:   # [Ar] などの貴ガス部分を展開
        for n, c in enumerate(shells_from_config(configs_by_symbol[m.group(1)], configs_by_symbol), 1):
            counts[n] = counts.get(n, 0) + c
        config = config[m.end():]
    for n, _, e in re.findall(r"(\d)([spdfg])(\d+)", config):
        counts[int(n)] = counts.get(int(n), 0) + int(e)
    return [counts.get(n, 0) for n in range(1, max(counts) + 1)]


def wikipedia_shells():
    """element-details.js から「電子殻」の値を読む（照合用）"""
    path = ROOT / "element-details.js"
    if not path.exists():
        return {}
    text = path.read_text(encoding="utf8")
    result = {}
    for n, body in re.findall(r"ELEMENT_DETAILS\[(\d+)\] = (\{[\s\S]*?\n\});", text):
        for section in json.loads(body)["sections"]:
            for label, value in section["rows"]:
                if label == "電子殻" and isinstance(value, str):
                    nums = re.findall(r"\d+", re.sub(r"<[^>]+>", "", value))
                    result[int(n)] = [int(x) for x in nums]
    return result


def main():
    rows = fetch_rows()
    assert len(rows) == 118, len(rows)
    configs_by_symbol = {r["Symbol"]: r["ElectronConfiguration"] for r in rows.values()}
    shells = {}
    for n in range(1, 119):
        s = shells_from_config(rows[n]["ElectronConfiguration"], configs_by_symbol)
        assert sum(s) == n, f"{n} {rows[n]['Symbol']}: 電子数の合計 {sum(s)} が原子番号と合わない"
        shells[n] = s
    lines = [
        "// 各元素の殻ごとの電子数（K, L, M, N, O, P, Q 殻の順）",
        "// データ出典: PubChem Periodic Table (https://pubchem.ncbi.nlm.nih.gov/periodic-table/)",
        "// tools/build_electron_shells.py で電子配置から自動計算。直接編集せず、スクリプトを再実行すること。",
        "const ELECTRON_SHELLS = {",
        *[f"  {n}: {json.dumps(s)},   // {rows[n]['Symbol']} {rows[n]['ElectronConfiguration']}" for n, s in shells.items()],
        "};",
        "",
    ]
    OUT.write_text("\n".join(lines), encoding="utf8")
    print(f"{OUT.name} を書き出しました（118元素）")

    wiki = wikipedia_shells()
    diffs = [f"  {n:3d} {rows[n]['Symbol']:2s} PubChem {shells[n]}  Wikipedia {wiki[n]}"
             for n in shells if n in wiki and wiki[n] != shells[n]]
    print(f"Wikipedia の電子殻と違う元素: {len(diffs)}", *diffs, sep="\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
