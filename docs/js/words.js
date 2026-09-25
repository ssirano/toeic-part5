// 내 단어장·Anki 내보내기·풀이 공식 통계 (화면과 무관한 순수 함수 — tests/words.test.mjs 로 검증)
//
// 단어장은 state.words = { 소문자 단어: { w, m, qid, src, ts, learned, exported } }.
// qid로 원래 문제를 찾아 예문(정답을 채운 문장)·해석·짝꿍 표현을 보여준다.

const BLANK = "-------";

export const wordKey = (w) => String(w).trim().toLowerCase();

// 문제 속 단어 하나 -> 단어장 항목. kind: "v" 해설 어휘 i번 / "c" 보기 i번(뜻이 있는 어휘 문제만) / "k" 짝꿍 표현
export function wordFrom(q, kind, i) {
  if (kind === "v" && q.v?.[i]) return { w: q.v[i][0], m: q.v[i][1], qid: q.id };
  if (kind === "c" && q.cm?.[i]) return { w: q.c[i], m: q.cm[i], qid: q.id };
  if (kind === "k" && q.k) {
    const m = q.k.match(/^(.*?)\s*\((.+)\)\s*$/); // "comply with (~을 준수하다)"
    return m ? { w: m[1], m: m[2], qid: q.id } : { w: q.k, m: "", qid: q.id };
  }
  return null;
}

export function addWord(words, entry, src, now = Date.now()) {
  const key = wordKey(entry.w);
  if (!key || words[key]) return false;
  words[key] = { w: entry.w, m: entry.m, qid: entry.qid, src, ts: now, learned: false, exported: false };
  return true;
}

// 틀린 어휘 문제에서 정답과 내가 고른 오답 보기를 단어장에 넣는다 (보기 뜻이 없는 유형은 짝꿍 표현)
export function autoCollect(words, index, attempts, now = Date.now()) {
  let added = 0;
  for (const a of attempts) {
    const q = index.byId.get(a.id);
    if (a.ok || !q || !q.t.startsWith("voc-")) continue;
    const picks = q.cm ? [wordFrom(q, "c", q.a), a.ch !== null && a.ch !== undefined ? wordFrom(q, "c", a.ch) : null] : [wordFrom(q, "k")];
    for (const e of picks) if (e && addWord(words, e, "auto", now)) added++;
  }
  return added;
}

export const filledSentence = (q) => q.q.replace(BLANK, q.c[q.a]);

const escHtml = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);

// 이미 HTML 이스케이프된 문장에서 단어(구)를 굵게. "be responsible for"처럼 문장에 그대로 없으면 be를 빼고 다시 찾는다
export function boldWord(htmlSentence, w) {
  const tries = [w, w.replace(/^be\s+/i, ""), w.split(/\s+/)[0]].map((t) => escHtml(t.trim())).filter((t) => t.length > 1);
  for (const t of tries) {
    const re = new RegExp(`(^|[^A-Za-z])(${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})(?![A-Za-z])`, "i");
    if (re.test(htmlSentence)) return htmlSentence.replace(re, "$1<b>$2</b>");
  }
  return htmlSentence;
}

// Anki 가져오기용 텍스트(탭 구분). 1열 앞면·2열 뒷면·3열 태그 — 가져올 때 노트 유형 '기본(Basic)'을 고르면 된다
export function ankiText(entries, index) {
  const cell = (s) => String(s).replace(/[\t\r\n]+/g, " ");
  const lines = ["#separator:tab", "#html:true", "#tags column:3"];
  for (const e of entries) {
    const q = index.byId.get(e.qid);
    const sentence = q ? boldWord(escHtml(filledSentence(q)), e.w) : "";
    const front = `<b>${escHtml(e.w)}</b>${sentence ? `<br><br><span style="font-size:85%">${sentence}</span>` : ""}`;
    const back = [
      escHtml(e.m),
      q?.k ? `짝꿍: ${escHtml(q.k)}` : "",
      q ? `<span style="font-size:85%">${escHtml(q.tr)}</span>` : "",
    ]
      .filter(Boolean)
      .join("<br><br>");
    lines.push([front, back, `part5 ${q?.t ?? ""}`.trim()].map(cell).join("\t"));
  }
  return lines.join("\n") + "\n";
}

// 공식별 풀이 수·틀린 수 (모든 풀이 기록 기준)
export function ruleStats(index, history) {
  const stats = new Map();
  for (const a of history.attempts) {
    const q = index.byId.get(a.id);
    for (const r of q?.r ?? []) {
      const s = stats.get(r) ?? { n: 0, wrong: 0 };
      s.n += 1;
      if (!a.ok) s.wrong += 1;
      stats.set(r, s);
    }
  }
  return stats;
}

// 많이 틀린 공식: 틀린 횟수 -> 오답률 순
export function worstRules(index, history, limit = 5) {
  return [...ruleStats(index, history)]
    .filter(([id, s]) => s.wrong > 0 && index.rules.has(id))
    .sort((a, b) => b[1].wrong - a[1].wrong || b[1].wrong / b[1].n - a[1].wrong / a[1].n)
    .slice(0, limit)
    .map(([id, s]) => ({ rule: index.rules.get(id), ...s }));
}

// 공식마다 연결된 문제 수
export function ruleCounts(index) {
  const counts = new Map();
  for (const q of index.byId.values()) for (const r of q.r ?? []) counts.set(r, (counts.get(r) ?? 0) + 1);
  return counts;
}
