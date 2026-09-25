"""문제 은행 검증·빌드: data/questions/*.json -> docs/questions.json

    python3 scripts/build.py          # 검증 + 빌드
    python3 scripts/build.py --check  # 검증만

문제 파일 형식 (data/questions/<유형코드>.json):
    [{"q": "... ------- ...", "c": [4개 보기], "a": 정답 인덱스(0-3),
      "tr": 해석, "st": 문장 구조, "ex": 해설(오답 이유 포함), "tip": 팁,
      "v": [["단어", "뜻"], ...]}]

문제 ID는 문제 문장의 해시로 자동 부여한다 -> 파일 안 순서를 바꿔도 학습 기록이 유지된다.
문장을 고치면 새 문제로 취급된다.
"""
from __future__ import annotations

import hashlib
import json
import re
import sys
from datetime import datetime, timezone
from difflib import SequenceMatcher
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "data"
OUT = ROOT / "docs" / "questions.json"
BLANK = "-------"
NEAR_DUP_RATIO = 0.85


def normalize(text: str) -> str:
    text = text.replace(BLANK, " ").lower()
    return re.sub(r"[^a-z0-9 ]+", "", re.sub(r"\s+", " ", text)).strip()


def question_id(code: str, q: str) -> str:
    return f"{code}-{hashlib.sha1(normalize(q).encode()).hexdigest()[:6]}"


def validate(code: str, i: int, item: dict) -> list[str]:
    where = f"{code}.json #{i + 1}"
    errors = []
    for key in ("q", "c", "a", "tr", "st", "ex", "tip", "v"):
        if key not in item:
            errors.append(f"{where}: '{key}' 없음")
    if errors:
        return errors
    if item["q"].count(BLANK) != 1:
        errors.append(f"{where}: 빈칸({BLANK})이 정확히 1개여야 함")
    choices = item["c"]
    if len(choices) != 4 or len({c.strip().lower() for c in choices}) != 4:
        errors.append(f"{where}: 서로 다른 보기 4개가 필요함 {choices}")
    if not isinstance(item["a"], int) or not 0 <= item["a"] <= 3:
        errors.append(f"{where}: 정답 인덱스는 0-3")
    for key in ("tr", "st", "ex", "tip"):
        if not str(item[key]).strip():
            errors.append(f"{where}: '{key}' 비어 있음")
    if not item["v"] or any(not isinstance(p, list) or len(p) != 2 for p in item["v"]):
        errors.append(f"{where}: v는 [단어, 뜻] 목록")
    return errors


def main() -> int:
    taxonomy = json.loads((DATA / "taxonomy.json").read_text(encoding="utf-8"))
    codes = [s["code"] for g in taxonomy["groups"] for s in g["subtypes"]]
    known = set(codes)

    errors: list[str] = []
    questions: list[dict] = []
    counts: dict[str, int] = {c: 0 for c in codes}

    for path in sorted((DATA / "questions").glob("*.json")):
        code = path.stem
        if code not in known:
            errors.append(f"{path.name}: taxonomy.json에 없는 유형 코드")
            continue
        items = json.loads(path.read_text(encoding="utf-8"))
        for i, item in enumerate(items):
            problems = validate(code, i, item)
            errors.extend(problems)
            if problems:
                continue
            questions.append({"id": question_id(code, item["q"]), "t": code, **item})
            counts[code] += 1

    # 중복·유사 문제 검사 (한 번 푼 문제를 다시 보지 않도록)
    seen_ids: dict[str, str] = {}
    norms = [(q["id"], normalize(q["q"])) for q in questions]
    for qid, _ in norms:
        if qid in seen_ids:
            errors.append(f"중복 문제: {qid}")
        seen_ids[qid] = qid
    for i in range(len(norms)):
        for j in range(i + 1, len(norms)):
            a, b = norms[i][1], norms[j][1]
            sm = SequenceMatcher(None, a, b)
            if sm.real_quick_ratio() >= NEAR_DUP_RATIO and sm.quick_ratio() >= NEAR_DUP_RATIO and sm.ratio() >= NEAR_DUP_RATIO:
                errors.append(f"너무 비슷한 문제: {norms[i][0]} ~ {norms[j][0]}")

    width = max(len(c) for c in codes)
    for g in taxonomy["groups"]:
        total = sum(counts[s["code"]] for s in g["subtypes"])
        print(f"[{g['name']}] {total}문제")
        for s in g["subtypes"]:
            print(f"  {s['code']:<{width}}  {counts[s['code']]:>3}  {s['name']}")
    print(f"총 {len(questions)}문제")

    if errors:
        print("\n오류:", *errors, sep="\n  ")
        return 1
    if "--check" not in sys.argv:
        OUT.write_text(
            json.dumps(
                {
                    "version": datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S"),
                    "taxonomy": taxonomy,
                    "questions": questions,
                },
                ensure_ascii=False,
                separators=(",", ":"),
            ),
            encoding="utf-8",
        )
        print(f"-> {OUT.relative_to(ROOT)} ({OUT.stat().st_size // 1024} KB)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
