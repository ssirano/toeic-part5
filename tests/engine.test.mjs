// node --test tests/
import assert from "node:assert/strict";
import { test } from "node:test";

import {
  buildByTypes,
  buildComprehensive,
  buildWeak,
  createTest,
  emptyHistory,
  gradeTest,
  indexBank,
  makeRng,
  subtypeStats,
  weakRanking,
} from "../docs/js/engine.js";

// 실제 taxonomy와 같은 모양의 가짜 은행: 묶음 3개, 유형마다 문제 n개
function fakeBank(perSubtype = 20) {
  const taxonomy = {
    groups: [
      { code: "voc", name: "어휘", quota: 10, subtypes: [{ code: "voc-a", name: "A" }, { code: "voc-b", name: "B" }] },
      { code: "pos", name: "품사", quota: 6, subtypes: [{ code: "pos-a", name: "C" }, { code: "pos-b", name: "D" }] },
      { code: "verb", name: "동사", quota: 4, subtypes: [{ code: "verb-a", name: "E" }] },
    ],
  };
  const questions = [];
  for (const g of taxonomy.groups)
    for (const s of g.subtypes)
      for (let i = 0; i < perSubtype; i++) questions.push({ id: `${s.code}-${i}`, t: s.code, a: i % 4 });
  return { taxonomy, questions };
}

// 테스트를 풀었다고 치고 기록에 반영. correctFor(q) -> 맞힐지 여부
function solve(index, history, ids, correctFor, now) {
  const t = createTest("x", ids, makeRng(1), now);
  t.items.forEach((item, i) => {
    const q = index.byId.get(item.id);
    const want = correctFor(q) ? q.a : (q.a + 1) % 4;
    t.answers[i] = item.order.indexOf(want);
  });
  const graded = gradeTest(index, t, now);
  history.attempts.push(...graded.attempts);
  history.tests.push(graded.record);
  return graded;
}

test("종합 테스트는 30문제, 묶음 비율을 따르고 중복이 없다", () => {
  const index = indexBank(fakeBank());
  const { ids, shortfall } = buildComprehensive(index, emptyHistory(), makeRng(7), 20);
  assert.equal(ids.length, 20);
  assert.equal(shortfall, 0);
  assert.equal(new Set(ids).size, 20);
  const group = (id) => index.subtypes.get(index.byId.get(id).t).group;
  const count = (g) => ids.filter((id) => group(id) === g).length;
  assert.deepEqual([count("voc"), count("pos"), count("verb")], [10, 6, 4]);
});

test("한 번 채점한 문제는 다시 출제되지 않는다", () => {
  const index = indexBank(fakeBank(20)); // 총 100문제
  const history = emptyHistory();
  const all = new Set();
  for (let round = 0; round < 5; round++) {
    const { ids } = buildComprehensive(index, history, makeRng(round), 20);
    for (const id of ids) {
      assert.ok(!all.has(id), `재출제됨: ${id}`);
      all.add(id);
    }
    solve(index, history, ids, () => true, 1000 + round);
  }
  assert.equal(all.size, 100);
  const after = buildComprehensive(index, history, makeRng(99), 20);
  assert.equal(after.ids.length, 0);
  assert.equal(after.shortfall, 20);
});

test("묶음의 새 문제가 바닥나면 다른 묶음에서 채운다", () => {
  const index = indexBank(fakeBank(20));
  const history = emptyHistory();
  // 동사 20문제를 모두 풀어버림
  solve(index, history, index.bySubtype.get("verb-a").map((q) => q.id), () => true, 1);
  const { ids, shortfall } = buildComprehensive(index, history, makeRng(3), 20);
  assert.equal(ids.length, 20);
  assert.equal(shortfall, 0);
  assert.ok(ids.every((id) => index.byId.get(id).t !== "verb-a"));
});

test("보기 순서를 섞어도 채점은 원래 정답 기준", () => {
  const index = indexBank(fakeBank(4));
  const t = createTest("x", ["voc-a-0", "voc-a-1"], makeRng(5));
  t.answers[0] = t.items[0].order.indexOf(index.byId.get("voc-a-0").a); // 정답
  // 1번은 무응답
  const g = gradeTest(index, t);
  assert.equal(g.score, 1);
  assert.equal(g.results[1].chosen, null);
  assert.equal(g.results[1].ok, false);
});

test("약점 테스트는 약한 유형 위주의 새 문제로 구성된다", () => {
  const index = indexBank(fakeBank(40));
  const history = emptyHistory();
  // pos-a만 전부 틀리고 나머지는 전부 맞힘
  const first = buildComprehensive(index, history, makeRng(11), 30).ids;
  solve(index, history, first, (q) => q.t !== "pos-a", 10);
  const second = buildComprehensive(index, history, makeRng(12), 30).ids;
  solve(index, history, second, (q) => q.t !== "pos-a", 20);

  const stats = subtypeStats(index, history);
  assert.equal(weakRanking(stats)[0].code, "pos-a");

  const seenBefore = new Set(history.attempts.map((a) => a.id));
  const weak = buildWeak(index, history, makeRng(13), 30);
  assert.ok(weak.ids.every((id) => !seenBefore.has(id)), "약점 테스트에 푼 문제가 섞임");
  assert.equal(weak.focus[0].code, "pos-a");
  const posA = weak.ids.filter((id) => index.byId.get(id).t === "pos-a").length;
  assert.equal(posA, 6); // 한 유형 최대치까지 몰아서 출제
  const perType = weak.focus.map((f) => f.count);
  assert.equal(Math.max(...perType), posA, "약한 유형이 가장 많이 출제돼야 함");
});

test("최근에 맞히기 시작하면 약점 순위가 내려간다", () => {
  const index = indexBank(fakeBank(40));
  const history = emptyHistory();
  const ids = index.bySubtype.get("pos-a").map((q) => q.id);
  solve(index, history, ids.slice(0, 10), () => false, 1); // 예전: 전부 틀림
  const before = subtypeStats(index, history).get("pos-a").mastery;
  solve(index, history, ids.slice(10, 20), () => true, 2); // 최근: 전부 맞힘
  const after = subtypeStats(index, history).get("pos-a").mastery;
  assert.ok(after > 0.6, `최근 성적 반영 안 됨: ${after}`);
  assert.ok(after > before);
});

test("기록이 없으면 약점 테스트 대신 안내", () => {
  const index = indexBank(fakeBank());
  const weak = buildWeak(index, emptyHistory(), makeRng(1));
  assert.equal(weak.reason, "no-history");
  assert.equal(weak.ids.length, 0);
});

test("종합 테스트는 세부 유형 가중치(w)를 반영한다", () => {
  const taxonomy = {
    groups: [{ code: "g", name: "G", quota: 30, subtypes: [{ code: "hot", name: "빈출", w: 3 }, { code: "rare", name: "드묾", w: 1 }] }],
  };
  const questions = [];
  for (const t of ["hot", "rare"]) for (let i = 0; i < 5000; i++) questions.push({ id: `${t}-${i}`, t, a: 0 });
  const index = indexBank({ taxonomy, questions });
  let hot = 0;
  let rare = 0;
  for (let seed = 0; seed < 100; seed++) {
    const { ids } = buildComprehensive(index, emptyHistory(), makeRng(seed), 30);
    for (const id of ids) index.byId.get(id).t === "hot" ? hot++ : rare++;
  }
  const ratio = hot / rare;
  // 쏠림 방지 보정 때문에 3:1보다는 완만하지만 확실히 더 많이 나와야 한다
  assert.ok(ratio > 1.4 && ratio < 3.2, `hot:rare = ${ratio.toFixed(2)}`);
});

test("유형 골라 풀기는 선택한 유형에서만 고르게", () => {
  const index = indexBank(fakeBank(20));
  const { ids } = buildByTypes(index, emptyHistory(), ["voc-b", "verb-a"], makeRng(2), 10);
  const types = ids.map((id) => index.byId.get(id).t);
  assert.equal(ids.length, 10);
  assert.equal(types.filter((t) => t === "voc-b").length, 5);
  assert.equal(types.filter((t) => t === "verb-a").length, 5);
});
