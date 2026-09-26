// node --test tests/words.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { indexBank } from "../docs/js/engine.js";
import { addWord, ankiText, autoCollect, boldWord, dateKey, noteWords, relatedSolved, ruleCounts, wordFrom, worstRules, wrongByDate } from "../docs/js/words.js";

const bank = JSON.parse(readFileSync(new URL("../docs/questions.json", import.meta.url)));
const index = indexBank(bank);
const vocVerb = bank.questions.find((q) => q.t === "voc-verb" && q.cm);
const prepCombo = bank.questions.find((q) => q.t === "voc-prepcombo");
const grammar = bank.questions.find((q) => q.t === "pos-noun");

test("모든 문제에 풀이 공식이 있고, 모든 공식이 문제에 쓰인다", () => {
  const counts = ruleCounts(index);
  for (const q of bank.questions) assert.ok(q.r.length && q.r.every((r) => index.rules.has(r)), q.id);
  for (const id of index.rules.keys()) assert.ok(counts.get(id) > 0, id);
});

test("단어장 항목: 해설 어휘·보기 뜻·짝꿍 표현", () => {
  assert.deepEqual(wordFrom(vocVerb, "c", vocVerb.a), { w: vocVerb.c[vocVerb.a], m: vocVerb.cm[vocVerb.a], qid: vocVerb.id });
  assert.equal(wordFrom(grammar, "c", 0), null); // 문법 문제 보기는 단어장 대상 아님
  const k = wordFrom(prepCombo, "k");
  assert.ok(k.w && k.m && !k.w.includes("("), prepCombo.k);
  const words = {};
  assert.equal(addWord(words, wordFrom(vocVerb, "v", 0), "star"), true);
  assert.equal(addWord(words, { ...wordFrom(vocVerb, "v", 0), w: vocVerb.v[0][0].toUpperCase() }, "star"), false); // 대소문자 무시 중복
});

test("틀린 어휘 문제만 정답·내 오답 보기를 자동 수집", () => {
  const words = {};
  const wrong = (vocVerb.a + 1) % 4;
  const added = autoCollect(words, index, [
    { id: vocVerb.id, ok: false, ch: wrong },
    { id: grammar.id, ok: false, ch: 0 },
    { id: prepCombo.id, ok: false, ch: 0 },
    { id: bank.questions.find((q) => q.t === "voc-adj").id, ok: true, ch: 0 },
  ]);
  assert.equal(added, 3);
  assert.deepEqual(Object.values(words).map((e) => e.w).sort(), [vocVerb.c[vocVerb.a], vocVerb.c[wrong], wordFrom(prepCombo, "k").w].sort());
});

test("Anki 파일: 머리글 + 한 줄에 탭 2개, 예문 속 단어 굵게", () => {
  const e = { ...wordFrom(vocVerb, "c", vocVerb.a), ts: 1 };
  const lines = ankiText([e], index).trim().split("\n");
  assert.equal(lines[0], "#separator:tab");
  const row = lines.at(-1).split("\t");
  assert.equal(row.length, 3);
  assert.match(row[0], new RegExp(`<b>${e.w}</b>`, "i"));
  assert.ok(row[1].includes(e.m));
  assert.equal(boldWord("They comply with it.", "comply with"), "They <b>comply with</b> it.");
  assert.equal(boldWord("She is responsible for it.", "be responsible for"), "She is <b>responsible for</b> it.");
});

test("많이 틀린 공식: 틀린 횟수 순", () => {
  const history = {
    attempts: [
      { id: grammar.id, ok: false },
      { id: grammar.id, ok: false },
      { id: vocVerb.id, ok: false },
      { id: vocVerb.id, ok: true },
    ],
    tests: [],
  };
  const worst = worstRules(index, history);
  assert.equal(worst[0].rule.id, grammar.r[0]);
  assert.equal(worst[0].wrong, 2);
});

test("모든 공식에 예문 3개 이상, [핵심] 표시", () => {
  for (const r of index.rules.values()) {
    assert.ok(r.x.length >= 3, r.id);
    for (const [en, ko] of r.x) assert.ok(/\[.+?\]/.test(en) && ko, `${r.id}: ${en}`);
  }
});

test("날짜별 오답: 같은 날 같은 문제는 한 번, 최근 날짜부터", () => {
  const day1 = new Date(2026, 8, 25, 10).getTime();
  const day2 = new Date(2026, 8, 26, 22).getTime();
  const history = {
    attempts: [
      { id: grammar.id, ok: false, ts: day1 },
      { id: vocVerb.id, ok: true, ts: day1 },
      { id: vocVerb.id, ok: false, ts: day2 },
      { id: vocVerb.id, ok: false, ts: day2 + 1 },
    ],
    tests: [],
  };
  const days = wrongByDate(index, history);
  assert.deepEqual([...days.keys()], ["2026-09-26", "2026-09-25"]);
  assert.equal(days.get("2026-09-26").length, 1);
  assert.equal(dateKey(day1), "2026-09-25");
});

test("같은 공식의 '풀었던 문제'는 이미 푼 문제에서만 고른다", () => {
  const rule = grammar.r[0];
  const sameRule = bank.questions.filter((q) => q.id !== grammar.id && q.r.includes(rule));
  assert.equal(relatedSolved(index, { attempts: [], tests: [] }, grammar), null);
  const history = { attempts: [{ id: sameRule[0].id, ok: true, ts: 1 }], tests: [] };
  assert.equal(relatedSolved(index, history, grammar).id, sameRule[0].id);
  assert.equal(relatedSolved(index, history, grammar, new Set([sameRule[0].id])), null);
});

test("오답노트 단어: 짝꿍 + 해설 어휘 + 정답·내 오답 보기, 중복 없이", () => {
  const wrong = (vocVerb.a + 1) % 4;
  const words = noteWords(vocVerb, wrong).map(([w]) => w.toLowerCase());
  assert.ok(words.includes(vocVerb.c[wrong].toLowerCase()));
  assert.equal(new Set(words).size, words.length);
});
