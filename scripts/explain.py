"""검토된 형식(fm)·시제(tn)와 문장 구조(st)로 '왜 그런지' 설명(why)을 만든다.

    python3 scripts/explain.py            # 모든 문제 파일에 why 필드 생성
    python3 scripts/explain.py --sample N # 유형별로 N개씩 결과만 출력(검토용)

why = {"fm": 형식 이유, "vo": 태(능동/수동) 이유, "tn": 시제 이유}
"""
from __future__ import annotations

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
QDIR = ROOT / "data" / "questions"
BLANK = "-------"
BOUNDARY = ("접속사", "등위접속사", "주절", "부사절", "관계절", "관계부사절", "결과절", "분사구문", "양보절")
BE = {"is", "are", "am", "was", "were", "be", "been", "being"}

MODAL_MEANING = {
    "must": "의무(~해야 한다)", "should": "권고·의무(~해야 한다)", "can": "가능·허가(~할 수 있다)",
    "could": "가능(~할 수 있었다)·공손한 표현", "may": "허가·가능성(~해도 된다, ~일지도 모른다)",
    "might": "약한 추측(~일지도 모른다)", "would": "공손한 표현·희망(would like)", "shall": "제안·미래",
}

TENSE_WHY = [
    ("미래완료", "미래의 어느 기준 시점까지 완료될 일이라서 미래완료(will have p.p.)예요."),
    ("과거완료 진행", "과거의 기준 시점까지 계속 진행되던 동작이라 과거완료진행(had been -ing)이에요."),
    ("과거완료", "과거의 기준 시점보다 더 먼저 일어났거나 그때까지 계속된 일이라 과거완료(had p.p.)예요."),
    ("현재완료 진행", "과거에 시작해 지금까지 계속 진행 중인 동작이라 현재완료진행(have been -ing)이에요."),
    ("현재완료", "과거에 시작된 일이 지금까지 이어지거나 지금과 관련된 결과를 나타내서 현재완료(have p.p.)예요."),
    ("현재진행", "지금(요즘) 진행 중인 일이라 현재진행(be -ing)이에요."),
    ("과거진행", "과거의 한 시점에 진행 중이던 동작이라 과거진행(was/were -ing)이에요."),
    ("미래", "앞으로 일어날 일(예정)이라 미래(will)예요."),
    ("과거", "과거에 이미 끝난 일이라 과거시제예요."),
    ("현재", "현재의 사실·상태나 반복되는 일이라 현재시제예요."),
]

PASSIVE_FORMS = [
    ("현재완료 수동", "have/has been + p.p."), ("과거완료 수동", "had been + p.p."), ("미래완료 수동", "will have been + p.p."),
    ("현재진행 수동", "am/is/are being + p.p."), ("과거진행 수동", "was/were being + p.p."),
    ("미래 수동", "will be + p.p."), ("현재 수동", "am/is/are + p.p."), ("과거 수동", "was/were + p.p."),
]

# 시제 단서: (정규식, 설명)
CUES = [
    (r"\bby the time\b", "by the time(~할 때쯤)", "완료"),
    (r"\bsince\b", "since(~ 이후로)", "완료"),
    (r"\bover the (past|last)\b[^,.]*", "over the past ~(지난 ~ 동안)", "완료"),
    (r"\bfor (more than |over |nearly |almost )?(\d+|two|three|four|five|six|ten|twenty|fifteen|several)\b[^,.]*?(years?|months?|weeks?|days?|hours?)\b", "for + 기간", "완료"),
    (r"\balready\b", "already(이미)", "완료"),
    (r"\byet\b", "yet(아직)", "완료"),
    (r"\brecently\b", "recently(최근에)", "완료"),
    (r"\byesterday\b", "yesterday(어제)", "과거"),
    (r"\blast (week|month|year|spring|summer|fall|winter|quarter|night|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b", "last ~(지난 ~)", "과거"),
    (r"\b\w+ ago\b", "~ ago(~ 전에)", "과거"),
    (r"\bin (19|20)\d\d\b", "in + 연도(과거 시점)", "과거"),
    (r"\bnext (week|month|year|spring|summer|fall|winter|quarter|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b", "next ~(다음 ~)", "미래"),
    (r"\btomorrow\b", "tomorrow(내일)", "미래"),
    (r"\bsoon\b", "soon(곧)", "미래"),
    (r"\bstarting\b", "starting ~(~부터)", "미래"),
    (r"\bevery (day|week|month|year|night|sunday|monday|friday|quarter|morning)\b[^,.]*", "every ~(반복)", "현재"),
    (r"\b(usually|always|often|regularly|typically)\b", "빈도부사(반복)", "현재"),
    (r"\b(currently|now|at the moment)\b", "currently/now(지금)", "진행"),
]


def segments(st):
    out = []
    for part in st.split(" / "):
        m = re.match(r"^\[(.+?)\]\s*(.*)$", part)
        out.append((m.group(1), m.group(2)) if m else ("", part))
    return out


def main_clause(st):
    """주절 성분 추출: 주어, 동사, 그 뒤 성분들."""
    segs = segments(st)
    labels = [l for l, _ in segs]
    if "동사" not in labels:
        return None
    vi = labels.index("동사")
    subj = next((t for l, t in reversed(segs[:vi]) if l.startswith("주어")), None)
    rest = []
    for l, t in segs[vi + 1:]:
        if l in BOUNDARY or l.startswith("주어"):
            break
        rest.append((l, t))
    return {"S": subj, "V": segs[vi][1], "rest": rest, "segs": segs}


def pick(rest, *prefixes):
    for l, t in rest:
        if any(l.startswith(p) for p in prefixes):
            return t
    return None


def q(text):
    return f"'{text}'" if text else ""


def form_code(fm):
    m = re.match(r"(명령문 · )?(\d)형식( 수동태)?", fm)
    if fm.startswith("1형식 (There"):
        return "T"
    if fm.startswith("2형식 (가주어"):
        return "IT"
    if not m:
        return None
    code = m.group(2)
    if m.group(3):
        return "P" + code
    return ("I" if m.group(1) else "") + code


def why_form(item, mc):
    fm = item["fm"]
    code = form_code(fm)
    if code is None or mc is None:
        return f"빈칸이 있는 절을 기준으로 나눈 구조예요: {fm}."
    S, V, rest = mc["S"], mc["V"], mc["rest"]
    O = pick(rest, "목적어", "직접목적어", "명사절")
    C = pick(rest, "보어")
    IO = pick(rest, "간접목적어")
    OC = pick(rest, "목적격 보어")
    imp = code.startswith("I")
    base = code.lstrip("I")
    lead = "주어 you가 생략된 명령문으로, " if imp else ""
    if base == "1":
        return f"{lead}동사 {q(V)} 뒤에 목적어나 보어 없이 수식어(부사·전치사구)만 와요 → 1형식."
    if base == "2":
        return f"{lead}동사 {q(V)} 뒤의 {q(C) or '형용사·명사'}는 주어의 상태·정체를 설명하는 보어예요(주어 = 보어) → 2형식."
    if base == "3":
        return f"{lead}동사 {q(V)} 뒤의 {q(O) or '명사(구·절)'}는 '~을/를'에 해당하는 목적어예요 → 3형식."
    if base == "4":
        return f"{lead}동사 {q(V)} 뒤에 간접목적어 {q(IO)}(~에게)와 직접목적어 {q(O)}(~을/를)가 함께 와요 → 4형식."
    if base == "5":
        return f"{lead}목적어 {q(O)} 뒤의 {q(OC)}는 목적어의 상태·동작을 설명하는 목적격 보어예요 → 5형식."
    if code == "P3":
        return f"동사 {q(V)} 뒤에 목적어가 없는 수동태예요. 능동태로 바꾸면 지금의 주어가 목적어 자리로 가는 3형식 문장이라 '3형식 수동태'로 봐요."
    if code == "P4":
        return f"수동태인데도 동사 {q(V)} 뒤에 목적어가 하나 남아 있어요. '~에게 …을 주다'류의 4형식 동사가 수동태가 된 형태예요."
    if code == "P5":
        return f"동사 {q(V)} 뒤에 to부정사·명사·형용사 같은 보어가 이어지는 수동태예요. 능동태의 '목적어 + 목적격 보어'(5형식)에서 목적어가 주어로 나간 형태예요."
    if code == "T":
        return "There + be동사 + 주어는 '~이 있다'는 존재를 나타내는 1형식이에요. There는 주어가 아니라서 동사는 뒤의 진짜 주어에 수를 맞춰요."
    if code == "IT":
        return "It은 뜻이 없는 가주어이고 진짜 주어(to부정사·that절)는 뒤로 갔어요. It + be + 보어 구조라 2형식이에요."
    return fm


def why_voice(item, mc):
    tn_main = item["tn"][0]
    code = form_code(item["fm"]) or ""
    if mc is None:
        return "빈칸이 있는 절의 동사를 기준으로 판단해요."
    S, V, rest = mc["S"], mc["V"], mc["rest"]
    agent = next((t for l, t in rest if t.startswith("by ") and l.startswith("수식어")), None)
    if "형용사 보어" in tn_main:
        return "be동사 뒤의 과거분사가 동작이 아니라 상태를 나타내는 형용사 보어로 쓰였어요. 그래서 수동태가 아니라 2형식 문장으로 봐요."
    if "수동" in tn_main or code.startswith("P"):
        extra = f" 동작을 하는 쪽(행위자)은 {q(agent)}로 나와 있어요." if agent else ""
        obj = " 동사 뒤에 목적어가 없는 것도 이 때문이에요." if code == "P3" else ""
        return f"주어 {q(S)} → 동작을 직접 '하는' 쪽이 아니라 '받는(되는)' 대상이에요. 그래서 수동태(be + p.p.)를 썼어요.{obj}{extra}"
    words = re.sub(r"\(.*?\)", " ", V).lower().split()
    if words and words[0] == "please":
        return "명령문은 듣는 사람(you)에게 직접 하라고 하는 말이라 능동태 동사원형을 써요."
    if words and words[-1] in BE:
        return "be동사가 주어의 상태를 나타내는 문장이라, 능동·수동을 따지는 '동작'이 아니에요."
    O = pick(rest, "목적어", "직접목적어", "명사절", "간접목적어")
    if O:
        return f"주어 {q(S) or '(생략된 you)'} → 동작을 직접 하는 주체이고, 동사 뒤에 목적어({O})까지 있으니 능동태예요."
    if code in ("2", "I2"):
        return "보어로 상태를 설명하는 2형식 동사(remain, become, seem 등)라 수동태로 쓰지 않아요 → 능동태."
    return f"주어 {q(S)} → 스스로 하는 동작이고, 동사가 목적어를 받지 않는 자동사라 수동태로 쓸 수 없어요 → 능동태."

def cue_in(sentence, tense):
    """시제 종류와 맞는 단서만 고른다 (관계절 속 last year가 현재시제 단서로 나오지 않게)."""
    family = {"완료": "완료" in tense, "과거": tense.startswith("과거") and "완료" not in tense,
              "미래": tense.startswith("미래"), "현재": tense.startswith("현재") and "완료" not in tense,
              "진행": "진행" in tense or tense.startswith("현재")}
    found = []
    for pattern, label, kind in CUES:
        if not family.get(kind):
            continue
        m = re.search(pattern, sentence, re.IGNORECASE)
        if m:
            found.append(f"{label} → '{m.group(0)}'")
    return found


def why_tense(item, sentence):
    tn_main = item["tn"][0].replace("주절: ", "")
    if tn_main.startswith("명령문"):
        return "명령문은 주어 you를 생략하고 동사원형으로 시작해요. 시제 변화가 없어요."
    if tn_main.startswith("가정법 과거완료"):
        return "과거 사실과 반대되는 가정이라 가정법 과거완료예요. if절(또는 도치절)은 had p.p., 주절은 would have p.p.로 짝을 맞춰요."
    if tn_main.startswith("가정법 과거"):
        return "현재 사실과 반대되는 가정이라 가정법 과거예요. if절(또는 도치절·without)은 과거형(be동사는 were), 주절은 would + 동사원형으로 짝을 맞춰요."
    m = re.match(r"조동사 (\w+)", tn_main)
    if m:
        modal = m.group(1)
        meaning = MODAL_MEANING.get(modal, "")
        passive = " 수동이면 be + p.p.를 써요." if "수동" in tn_main else ""
        return f"조동사 {modal}: {meaning}. 조동사 뒤에는 시제·인칭과 상관없이 동사원형이 와요.{passive}"
    passive_form = next((f for k, f in PASSIVE_FORMS if tn_main.startswith(k)), None)
    for key, text in TENSE_WHY:
        if tn_main.startswith(key):
            if passive_form:
                text += f" 여기에 수동이 더해져 형태는 {passive_form}예요."
            cues = cue_in(sentence, tn_main)
            cue = f" 단서: {'; '.join(cues[:2])}." if cues else ""
            return text + cue
    return tn_main


def explain(item):
    sentence = item["q"].replace(BLANK, item["c"][item["a"]])
    mc = main_clause(item["st"])
    vo = why_voice(item, mc)
    if "수동태(be + p.p.)" in vo:
        label = "수동태"
    elif "형용사 보어" in vo or "be동사가 주어의 상태" in vo:
        label = "능동·수동 구분 없음 (상태를 나타내는 문장)"
    elif "빈칸이 있는 절" in vo:
        label = "절별로 판단"
    else:
        label = "능동태"
    return {"fm": why_form(item, mc), "vl": label, "vo": vo, "tn": why_tense(item, sentence)}


def main():
    sample = int(sys.argv[sys.argv.index("--sample") + 1]) if "--sample" in sys.argv else 0
    for f in sorted(QDIR.glob("*.json")):
        items = json.loads(f.read_text(encoding="utf-8"))
        for i, item in enumerate(items):
            item["why"] = explain(item)
            if sample and i < sample:
                s = item["q"].replace(BLANK, f"[{item['c'][item['a']]}]")
                print(f"\n[{f.stem} #{i}] {s}\n  형식: {item['fm']}\n   왜: {item['why']['fm']}\n   태: {item['why']['vo']}\n  시제: {item['tn'][0]}\n   왜: {item['why']['tn']}")
        if not sample:
            f.write_text("[\n" + ",\n".join(json.dumps(q, ensure_ascii=False) for q in items) + "\n]\n", encoding="utf-8")
    if not sample:
        print("why 생성 완료")


if __name__ == "__main__":
    main()
