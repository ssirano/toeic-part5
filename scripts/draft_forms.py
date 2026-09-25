"""문장 형식(fm)·빈칸 자리(sl) 초안 생성 — 사람이 검토·수정하기 위한 도구.

st(문장 구조)의 라벨을 보고 주절 기준 형식을 추정한다. 결과는 반드시 검토해서 고친다.
    python3 scripts/draft_forms.py <유형코드>   # 초안을 표 형태로 출력
"""
import json
import re
import sys
from pathlib import Path

BLANK = "-------"
BE = {"is", "are", "was", "were", "be", "been", "being", "am"}


def segments(st):
    out = []
    for part in st.split(" / "):
        m = re.match(r"^\[(.+?)\]\s*(.*)$", part)
        out.append((m.group(1), m.group(2)) if m else ("", part))
    return out


def guess_form(st):
    segs = segments(st)
    labels = [l for l, _ in segs]
    # 주절 동사부터 다음 절 경계 전까지만 본다
    try:
        vi = labels.index("동사")
    except ValueError:
        return "?"
    verb = segs[vi][1].lower().split()
    main = []
    for l, t in segs[vi + 1:]:
        if l in ("접속사", "등위접속사", "주절", "부사절", "관계절") or l.startswith("주어"):
            break
        main.append(l)
    passive = len(verb) >= 2 and any(w in BE for w in verb) and re.search(r"(ed|en|wn|lt|pt|ld|ne|ung|id|ught|ft|nt)$", verb[-1] or "")
    imperative = labels[0] == "동사" and "주어" not in labels[:vi]
    if "목적격 보어" in main:
        f = "5형식"
    elif "간접목적어" in main and "직접목적어" in main:
        f = "4형식"
    elif any(l.startswith("목적어") or l.startswith("직접목적어") or l == "명사절" for l in main):
        f = "3형식"
    elif any(l.startswith("보어") for l in main) or "진주어" in labels:
        f = "2형식"
    else:
        f = "1형식"
    if passive and f in ("1형식", "2형식"):
        f = "수동태"
    if imperative:
        f = f"명령문 · {f}"
    if labels[0] == "유도부사":
        f = "1형식 (There + be + 주어)"
    return f


IRREGULAR_PAST = {"took", "spoke", "rose", "grew", "gave", "made", "found", "held", "sent", "went", "came", "saw",
    "began", "built", "bought", "brought", "chose", "fell", "felt", "got", "had", "kept", "knew", "left", "led", "lost",
    "met", "paid", "put", "ran", "said", "sold", "set", "stood", "told", "thought", "understood", "won", "wrote", "cut", "read", "spent", "sought", "taught", "caught", "dealt", "meant", "led", "fought", "hung", "shut", "became", "began", "chose", "drove", "ate", "forgot", "rode", "wore", "withdrew", "underwent", "arose", "overcame", "did"}
IRREGULAR_PP = {"taken", "spoken", "risen", "grown", "given", "made", "found", "held", "sent", "gone", "come", "seen",
    "begun", "built", "bought", "brought", "chosen", "fallen", "felt", "got", "gotten", "had", "kept", "known", "left", "led",
    "lost", "met", "paid", "put", "run", "said", "sold", "set", "shown", "stood", "told", "thought", "understood", "won",
    "written", "cut", "read", "done", "been", "hidden", "drawn", "driven", "eaten", "worn", "become", "proven",
    "broken", "forgotten", "withdrawn", "undergone", "arisen", "overcome", "shut", "spent", "sought", "taught", "caught", "dealt", "meant"}
MODALS = {"can", "could", "must", "should", "may", "might", "shall"}
ADVERBS = {"already", "still", "just", "never", "always", "also", "not", "soon", "recently", "only", "usually", "often",
    "finally", "currently", "yet", "ever", "now"}


NOT_ED = {"need", "proceed", "exceed", "succeed", "feed", "bleed", "speed", "breed", "seed", "heed", "shed", "embed"}


def is_pp(w):
    return w in IRREGULAR_PP or (w.endswith("ed") and w not in NOT_ED)


def verb_display(st):
    for label, text in segments(st):
        if label == "동사":
            return re.sub(r"\s+", " ", re.sub(r"\(.*?\)", " ", text)).strip()
    return ""


def verb_words(st):
    for label, text in segments(st):
        if label == "동사":
            words = re.sub(r"\(.*?\)", " ", text).lower().replace(",", " ").split()
            return [w for w in words if w not in ADVERBS and not w.endswith("ly") or w in ("apply", "supply", "rely", "reply")]
    return []


def guess_tense(st):
    w = verb_words(st)
    if not w:
        return "?"
    txt = verb_display(st) or " ".join(w)
    if w[0] in ("do", "does", "did") and len(w) > 1:
        tense = "과거" if w[0] == "did" else "현재"
        return f"{tense} ({txt})"
    if w[0] == "please" and len(w) > 2 and w[1] == "do":
        return f"명령문 · 부정 ({txt})"
    if w[0] == "please":
        return f"명령문 (동사원형 {w[1] if len(w) > 1 else ''})"
    if w[0] == "will":
        if len(w) > 2 and w[1] == "have" and w[2] == "been" and len(w) > 3:
            return f"미래완료{' 수동' if is_pp(w[3]) else '진행'} ({txt})"
        if len(w) > 1 and w[1] == "have":
            return f"미래완료 ({txt})"
        if len(w) > 2 and w[1] == "be":
            return f"미래{' 수동' if is_pp(w[2]) else ' 진행'} ({txt})"
        return f"미래 ({txt})"
    if w[0] == "would":
        if len(w) > 1 and w[1] == "have":
            return f"가정법 과거완료 would have p.p. ({txt})"
        return f"가정법 과거 would + 동사원형 ({txt})"
    if w[0] in MODALS:
        if len(w) > 2 and w[1] == "be" and is_pp(w[2]):
            return f"조동사 {w[0]} + 수동 ({txt})"
        if len(w) > 1 and w[1] == "have":
            return f"조동사 {w[0]} + have p.p. ({txt})"
        return f"조동사 {w[0]} + 동사원형 ({txt})"
    if w[0] in ("has", "have"):
        if len(w) > 2 and w[1] == "been":
            return f"현재완료{' 진행' if w[2].endswith('ing') else ' 수동'} ({txt})"
        if len(w) > 1 and is_pp(w[1]):
            return f"현재완료 ({txt})"
        return f"현재 ({txt})"
    if w[0] == "had":
        if len(w) > 2 and w[1] == "been":
            return f"과거완료{' 진행' if w[2].endswith('ing') else ' 수동'} ({txt})"
        if len(w) > 1 and is_pp(w[1]):
            return f"과거완료 ({txt})"
        return f"과거 ({txt})"
    if w[0] in ("is", "are", "am", "was", "were"):
        tense = "현재" if w[0] in ("is", "are", "am") else "과거"
        if len(w) > 2 and w[1] == "being":
            return f"{tense}진행 수동 ({txt})"
        if len(w) > 1 and w[1].endswith("ing"):
            return f"{tense}진행 ({txt})"
        if len(w) > 1 and is_pp(w[1]):
            return f"{tense} 수동 ({txt})"
        return f"{tense} ({txt})"
    if w[0] in IRREGULAR_PAST or (w[0].endswith("ed") and w[0] not in NOT_ED):
        return f"과거 ({txt})"
    return f"현재 ({txt})"


if __name__ == "__main__":
    code = sys.argv[1]
    items = json.loads(Path(f"data/questions/{code}.json").read_text())
    for i, q in enumerate(items):
        ans = q["c"][q["a"]]
        sent = q["q"].replace(BLANK, f"[{ans}]")
        print(f"{i}|{guess_form(q['st'])}|{guess_tense(q['st'])}|{sent}|{' / '.join(q['c'])}")
