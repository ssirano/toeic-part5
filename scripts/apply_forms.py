"""검토한 문장 형식·빈칸 자리·시제(fm/sl/tn)와 문제 수정 사항을 문제 파일에 반영한다.

    python3 scripts/apply_forms.py <검토 파일 폴더>

검토 파일 형식 (유형별 섹션):
    ## pos-noun
    인덱스|형식 코드 또는 문구|빈칸 자리|[tn:시제 덮어쓰기]|[+추가 시제 설명]...

형식 코드: 1~5, P3/P4/P5(수동태), I1~I5(명령문), T(There 구문), IT(가주어 It)
시제(tn)는 st의 주절 동사로 자동 판별하고, tn: 으로 덮어쓰거나 + 로 부사절·관계절·단서를 덧붙인다.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from draft_forms import guess_tense  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
QDIR = ROOT / "data" / "questions"

FORMS = {
    "1": "1형식 (주어 + 동사)",
    "2": "2형식 (주어 + 동사 + 보어)",
    "3": "3형식 (주어 + 동사 + 목적어)",
    "4": "4형식 (주어 + 동사 + 간접목적어 + 직접목적어)",
    "5": "5형식 (주어 + 동사 + 목적어 + 목적격 보어)",
    "P3": "3형식 수동태 (주어 + be p.p.) — 능동태의 목적어가 주어로",
    "P4": "4형식 수동태 (주어 + be p.p. + 남은 목적어)",
    "P5": "5형식 수동태 (주어 + be p.p. + 목적격 보어)",
    "T": "1형식 (There + be + 주어)",
    "IT": "2형식 (가주어 It + be + 보어 + 진주어)",
}
IMPERATIVE = {
    "I1": "명령문 · 1형식 (동사) — 주어 you 생략",
    "I2": "명령문 · 2형식 (동사 + 보어) — 주어 you 생략",
    "I3": "명령문 · 3형식 (동사 + 목적어) — 주어 you 생략",
    "I4": "명령문 · 4형식 (동사 + 간접목적어 + 직접목적어) — 주어 you 생략",
    "I5": "명령문 · 5형식 (동사 + 목적어 + 목적격 보어) — 주어 you 생략",
}


def expand_form(code: str) -> str:
    return FORMS.get(code) or IMPERATIVE.get(code) or code


def parse_reviews(folder: Path) -> dict[str, dict[int, list[str]]]:
    reviews: dict[str, dict[int, list[str]]] = {}
    for f in sorted(folder.glob("*.txt")):
        section = None
        for line in f.read_text(encoding="utf-8").splitlines():
            if line.startswith("## "):
                section = line[3:].strip()
                reviews.setdefault(section, {})
            elif line.strip():
                parts = line.split("|")
                reviews[section][int(parts[0])] = parts[1:]
    return reviews


def apply(q: dict, parts: list[str]) -> None:
    form, slot, *extras = parts
    q["fm"] = expand_form(form.strip())
    q["sl"] = slot.strip()
    main = None
    notes = []
    for e in extras:
        e = e.strip()
        if e.startswith("tn:"):
            main = e[3:].strip()
        elif e.startswith("+"):
            notes.append(e[1:].strip())
    q["tn"] = [f"주절: {main or guess_tense(q['st'])}", *notes]


def load(code: str) -> list[dict]:
    return json.loads((QDIR / f"{code}.json").read_text(encoding="utf-8"))


def save(code: str, items: list[dict]) -> None:
    (QDIR / f"{code}.json").write_text(
        "[\n" + ",\n".join(json.dumps(q, ensure_ascii=False) for q in items) + "\n]\n", encoding="utf-8"
    )


def main() -> int:
    folder = Path(sys.argv[1])
    reviews = parse_reviews(folder)
    fixes = json.loads((folder / "fixes.json").read_text(encoding="utf-8")) if (folder / "fixes.json").exists() else {}

    moves = []
    missing = []
    for code, lines in reviews.items():
        items = load(code)
        # 1) 문제 교체·수정 (같은 인덱스 유지)
        for fix in fixes.get(code, []):
            i = fix["index"]
            assert items[i]["q"].startswith(fix["expect"]), (code, i, items[i]["q"][:50])
            if "replace" in fix:
                items[i] = fix["replace"]
            else:
                items[i].update(fix["update"])
        # 2) 형식·빈칸 자리·시제
        for i, q in enumerate(items):
            parts = lines.get(i)
            if parts is None:
                missing.append(f"{code} #{i}")
                continue
            if parts[0].startswith("MOVE:"):
                moves.append((code, i, parts[0][5:]))
                continue
            apply(q, parts)
        save(code, items)

    # 3) 다른 유형으로 옮길 문제 (fixes.json의 moves에 형식 정보 포함)
    for src, i, dst in sorted(moves, key=lambda m: -m[1]):
        items = load(src)
        q = items.pop(i)
        info = fixes["moves"][f"{src}#{i}"]
        apply(q, info)
        save(src, items)
        target = load(dst)
        target.append(q)
        save(dst, target)
        print(f"이동: {src} #{i} → {dst} ({q['c'][q['a']]})")

    if missing:
        print("검토 누락:", *missing, sep="\n  ")
        return 1
    print("반영 완료")
    return 0


if __name__ == "__main__":
    sys.exit(main())
