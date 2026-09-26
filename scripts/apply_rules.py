"""풀이 공식과 어휘 데이터 반영: 검토 텍스트 -> data/rules.json + 문제의 r·k·cm

    python3 scripts/apply_rules.py <검토 폴더>

검토 폴더의 *.txt (voc-data.txt 제외) — 공식 정의와 연결할 문제:
    >pos                              이후 공식이 속할 영역(taxonomy 그룹 코드)
    @ID | 공식 | 설명 | 예시            공식 정의
    = 유형코드: 0 3 5                  바로 위 공식을 이 문제들(파일 안 순서, 0부터)에 연결

examples-*.txt — 공식마다 예문 3개 (오답노트 PDF의 '같은 공식 예문', 문제 은행과 겹치면 안 됨):
    @ID
    영어 예문 ([ ]로 공식이 적용된 부분 표시) | 해석

voc-data.txt — 어휘 문제별 짝꿍 표현·보기 뜻·공식:
    유형코드 번호 | 짝꿍 표현 | 뜻1 / 뜻2 / 뜻3 / 뜻4 (없으면 -) | 공식ID 공식ID
    + 유형코드 번호 번호 | 공식ID ...    (문법 문제에 공식 추가)

공식 순서 = 파일 이름 순 + 파일 안 순서 = 앱 '공식 모음' 표시 순서.
문제 한 개에 공식은 앞에서부터 최대 3개까지 보여준다.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"


def main(src: Path) -> int:
    taxonomy = json.loads((DATA / "taxonomy.json").read_text(encoding="utf-8"))
    groups = {g["code"] for g in taxonomy["groups"]}
    banks = {p.stem: json.loads(p.read_text(encoding="utf-8")) for p in sorted((DATA / "questions").glob("*.json"))}
    links: dict[tuple[str, int], list[str]] = {}
    rules: list[dict] = []
    errors: list[str] = []

    def link(code: str, idx: int, rid: str, where: str) -> None:
        if code not in banks or not 0 <= idx < len(banks[code]):
            errors.append(f"{where}: 없는 문제 {code} {idx}")
            return
        lst = links.setdefault((code, idx), [])
        if rid not in lst:
            lst.append(rid)

    for path in sorted(src.glob("*.txt")):
        if path.name == "voc-data.txt" or path.name.startswith("examples-"):
            continue
        group = None
        current = None
        for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            where = f"{path.name}:{n}"
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith(">"):
                group = line[1:].strip()
                if group not in groups:
                    errors.append(f"{where}: 없는 영역 {group}")
            elif line.startswith("@"):
                parts = [p.strip() for p in line[1:].split("|")]
                if len(parts) != 4 or not all(parts):
                    errors.append(f"{where}: '@ID | 공식 | 설명 | 예시' 형식이 아님")
                    continue
                rid, title, detail, example = parts
                current = {"id": rid, "g": group, "t": title, "d": detail, "e": example}
                rules.append(current)
            elif line.startswith("="):
                code, _, nums = line[1:].partition(":")
                for idx in nums.split():
                    link(code.strip(), int(idx), current["id"], where)
            else:
                errors.append(f"{where}: 알 수 없는 줄")

    vocab: dict[tuple[str, int], tuple[str, list[str] | None]] = {}
    for n, line in enumerate((src / "voc-data.txt").read_text(encoding="utf-8").splitlines(), 1):
        where = f"voc-data.txt:{n}"
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        if line.startswith("+"):
            head, _, ids = line[1:].partition("|")
            code, *nums = head.split()
            for idx in nums:
                for rid in ids.split():
                    link(code, int(idx), rid, where)
            continue
        parts = [p.strip() for p in line.split("|")]
        if len(parts) != 4:
            errors.append(f"{where}: 칸 수가 4가 아님")
            continue
        head, k, cm, ids = parts
        code, idx = head.split()
        meanings = None if cm == "-" else [m.strip() for m in cm.split(" / ")]
        if meanings is not None and len(meanings) != 4:
            errors.append(f"{where}: 보기 뜻이 4개가 아님 ({len(meanings)})")
        vocab[(code, int(idx))] = (k, meanings)
        for rid in ids.split():
            link(code, int(idx), rid, where)

    examples: dict[str, list[list[str]]] = {}
    for path in sorted(src.glob("examples-*.txt")):
        rid = None
        for n, line in enumerate(path.read_text(encoding="utf-8").splitlines(), 1):
            where = f"{path.name}:{n}"
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith("@"):
                rid = line[1:].strip()
                examples.setdefault(rid, [])
                continue
            en, _, ko = (p.strip() for p in line.partition("|"))
            if not (en and ko and "[" in en and "]" in en):
                errors.append(f"{where}: '영어 [핵심] | 해석' 형식이 아님")
            examples[rid].append([en, ko])

    known = {r["id"] for r in rules}
    errors += [f"예문의 공식 ID가 없음: {rid}" for rid in sorted(set(examples) - known)]
    errors += [f"예문이 3개 미만인 공식: {r['id']}" for r in rules if len(examples.get(r["id"], [])) < 3]
    for r in rules:
        r["x"] = examples.get(r["id"], [])
    if len(known) != len(rules):
        errors.append("공식 ID 중복")
    used = {rid for lst in links.values() for rid in lst}
    errors += [f"정의 없는 공식 {rid}" for rid in sorted(used - known)]
    errors += [f"문제에 안 쓰인 공식 {rid}" for rid in sorted(known - used)]
    for code, items in banks.items():
        for i in range(len(items)):
            if not links.get((code, i)):
                errors.append(f"공식 없는 문제 {code} {i}: {items[i]['q'][:50]}")
            if code.startswith("voc-") and (code, i) not in vocab:
                errors.append(f"짝꿍 표현 없는 어휘 문제 {code} {i}")
    if errors:
        print("오류:", *errors, sep="\n  ")
        return 1

    for code, items in banks.items():
        for i, item in enumerate(items):
            item["r"] = links[(code, i)]
            item.pop("k", None)
            item.pop("cm", None)
            if (code, i) in vocab:
                k, meanings = vocab[(code, i)]
                item["k"] = k
                if meanings:
                    item["cm"] = meanings
        (DATA / "questions" / f"{code}.json").write_text(
            "[\n" + ",\n".join(json.dumps(q, ensure_ascii=False) for q in items) + "\n]\n", encoding="utf-8"
        )
    (DATA / "rules.json").write_text(json.dumps(rules, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    per_group: dict[str, int] = {}
    for r in rules:
        per_group[r["g"]] = per_group.get(r["g"], 0) + 1
    print(f"공식 {len(rules)}개 {per_group} · 문제 {sum(len(v) for v in banks.values())}개 연결 · 어휘 데이터 {len(vocab)}개")
    return 0


if __name__ == "__main__":
    sys.exit(main(Path(sys.argv[1])))
