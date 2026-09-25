// node --test tests/words.test.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { indexBank } from "../docs/js/engine.js";
import { addWord, ankiText, autoCollect, boldWord, ruleCounts, wordFrom, worstRules } from "../docs/js/words.js";

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
