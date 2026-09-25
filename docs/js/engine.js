// 출제·채점·약점 분석 로직 (화면과 무관한 순수 함수 — tests/engine.test.mjs 로 검증)
//
// 원칙: 한 번 채점한 문제는 어떤 테스트에도 다시 나오지 않는다.
// 약점 테스트도 틀린 문제를 반복하지 않고, 약한 '유형'의 새 문제를 낸다.

export const TEST_SIZE = 30;
const RECENCY_DECAY = 0.85; // 같은 유형에서 최근 풀이일수록 가중치가 크다
const WEAK_MAX_PER_SUBTYPE = 6; // 약점 테스트 한 번에 한 유형이 너무 몰리지 않도록

// --- 난수 (테스트에서 재현 가능하도록 시드 사용) ----------------------------

export function makeRng(seed = Date.now()) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(list, rng) {
  const a = [...list];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// --- 문제 은행 색인 -----------------------------------------------------------

export function indexBank(bank) {
  const byId = new Map();
  const bySubtype = new Map();
  const subtypes = new Map(); // code -> { code, name, group, groupName }
  for (const g of bank.taxonomy.groups) {
    for (const s of g.subtypes) {
      subtypes.set(s.code, { code: s.code, name: s.name, group: g.code, groupName: g.name, w: s.w ?? 1 });
      bySubtype.set(s.code, []);
    }
  }
  for (const q of bank.questions) {
    byId.set(q.id, q);
    if (bySubtype.has(q.t)) bySubtype.get(q.t).push(q);
  }
  const rules = new Map((bank.rules ?? []).map((r) => [r.id, r]));
  return { byId, bySubtype, subtypes, groups: bank.taxonomy.groups, rules };
}

export function seenIds(history) {
  return new Set(history.attempts.map((a) => a.id));
}

// --- 유형별 통계 --------------------------------------------------------------

export function subtypeStats(index, history) {
  const seen = seenIds(history);
  const stats = new Map();
  for (const [code, info] of index.subtypes) {
    const all = index.bySubtype.get(code);
    const seenCount = all.filter((q) => seen.has(q.id)).length;
    stats.set(code, {
      ...info,
      total: all.length,
      seen: seenCount,
      unseen: all.length - seenCount,
      attempts: 0,
      correct: 0,
      mastery: 0.5,
    });
  }
  // 최근 풀이부터 가중치를 줄여가며 합산 -> 예전에 틀렸어도 요즘 맞히면 약점에서 빠진다
  const newestFirst = [...history.attempts].sort((a, b) => b.ts - a.ts);
  const weight = new Map();
  for (const at of newestFirst) {
    const s = stats.get(at.t);
    if (!s) continue;
    const k = weight.get(at.t) ?? { w: 0, cw: 0, n: 0 };
    const w = RECENCY_DECAY ** k.n;
    k.w += w;
    k.cw += at.ok ? w : 0;
    k.n += 1;
    weight.set(at.t, k);
    s.attempts += 1;
    s.correct += at.ok ? 1 : 0;
  }
  for (const [code, k] of weight) {
    // 베이지안 보정: 1~2문제만 풀고 0%/100%로 단정하지 않도록
    stats.get(code).mastery = (k.cw + 1) / (k.w + 2);
  }
  return stats;
}

export function weakRanking(stats, minAttempts = 3) {
  return [...stats.values()]
    .filter((s) => s.attempts >= minAttempts)
    .sort((a, b) => a.mastery - b.mastery);
}

// --- 출제 ---------------------------------------------------------------------

function takeUnseen(index, code, seen, taken, rng) {
  const pool = index.bySubtype.get(code).filter((q) => !seen.has(q.id) && !taken.has(q.id));
  if (!pool.length) return null;
  const q = pool[Math.floor(rng() * pool.length)];
  taken.add(q.id);
  return q.id;
}

function scaledQuotas(groups, size) {
  const base = groups.reduce((sum, g) => sum + g.quota, 0);
  const quotas = groups.map((g) => Math.floor((g.quota * size) / base));
  let rest = size - quotas.reduce((a, b) => a + b, 0);
  for (let i = 0; rest > 0; i = (i + 1) % groups.length, rest--) quotas[i] += 1;
  return quotas;
}

// 여러 유형에서 돌아가며 한 문제씩: 덜 풀어본 유형부터
function roundRobin(index, codes, count, seen, taken, rng, stats) {
  const order = shuffle(codes, rng).sort((a, b) => (stats.get(a)?.seen ?? 0) - (stats.get(b)?.seen ?? 0));
  const ids = [];
  let active = order;
  while (ids.length < count && active.length) {
    const next = [];
    for (const code of active) {
      if (ids.length >= count) break;
      const id = takeUnseen(index, code, seen, taken, rng);
      if (id) {
        ids.push(id);
        next.push(code);
      }
    }
    active = next;
  }
  return ids;
}

// 출제 빈도 가중치(w)에 비례해 유형을 고른다. 한 테스트에서 같은 유형을 뽑을수록 가중치를 낮춰 한쪽으로 쏠리지 않게 한다.
function weightedPick(index, codes, count, seen, taken, rng) {
  const picked = new Map();
  const exhausted = new Set();
  const ids = [];
  while (ids.length < count) {
    const open = codes.filter((c) => !exhausted.has(c));
    if (!open.length) break;
    const weightOf = (c) => (index.subtypes.get(c)?.w ?? 1) / (1 + (picked.get(c) ?? 0));
    const total = open.reduce((sum, c) => sum + weightOf(c), 0);
    let r = rng() * total;
    let code = open[open.length - 1];
    for (const c of open) {
      r -= weightOf(c);
      if (r <= 0) {
        code = c;
        break;
      }
    }
    const id = takeUnseen(index, code, seen, taken, rng);
    if (!id) {
      exhausted.add(code);
      continue;
    }
    ids.push(id);
    picked.set(code, (picked.get(code) ?? 0) + 1);
  }
  return ids;
}

/** 종합 테스트: 실제 시험처럼 유형 묶음별 비율(quota)과 세부 유형 출제 빈도(w)를 반영해 새 문제만 출제 */
export function buildComprehensive(index, history, rng, size = TEST_SIZE) {
  const seen = seenIds(history);
  const taken = new Set();
  const ids = [];
  const quotas = scaledQuotas(index.groups, size);
  index.groups.forEach((g, i) => {
    const codes = g.subtypes.map((s) => s.code);
    ids.push(...weightedPick(index, codes, quotas[i], seen, taken, rng));
  });
  if (ids.length < size) {
    // 어떤 묶음의 새 문제가 바닥나면 다른 묶음에서 채운다
    ids.push(...weightedPick(index, [...index.subtypes.keys()], size - ids.length, seen, taken, rng));
  }
  return { ids: shuffle(ids, rng), shortfall: size - ids.length };
}

/** 약점 테스트: 정답률이 낮은 유형일수록 많이 뽑되, 전부 새 문제 */
export function buildWeak(index, history, rng, size = TEST_SIZE) {
  const seen = seenIds(history);
  const stats = subtypeStats(index, history);
  const candidates = [...stats.values()].filter((s) => s.attempts > 0 && s.unseen > 0);
  if (!candidates.length) return { ids: [], focus: [], shortfall: size, reason: "no-history" };

  const taken = new Set();
  const counts = new Map();
  const ids = [];
  const weightOf = (s) => (1 - s.mastery) ** 2 + 0.02;
  while (ids.length < size) {
    const open = candidates.filter((s) => (counts.get(s.code) ?? 0) < WEAK_MAX_PER_SUBTYPE && s.unseen > (counts.get(s.code) ?? 0));
    if (!open.length) break;
    const total = open.reduce((sum, s) => sum + weightOf(s), 0);
    let r = rng() * total;
    let pick = open[open.length - 1];
    for (const s of open) {
      r -= weightOf(s);
      if (r <= 0) {
        pick = s;
        break;
      }
    }
    const id = takeUnseen(index, pick.code, seen, taken, rng);
    if (!id) {
      counts.set(pick.code, WEAK_MAX_PER_SUBTYPE); // 더 뽑을 게 없음
      continue;
    }
    ids.push(id);
    counts.set(pick.code, (counts.get(pick.code) ?? 0) + 1);
  }
  const picked = new Map();
  for (const id of ids) {
    const t = index.byId.get(id).t;
    picked.set(t, (picked.get(t) ?? 0) + 1);
  }
  const focus = [...picked]
    .map(([code, count]) => ({ code, name: stats.get(code).name, count, mastery: stats.get(code).mastery }))
    .sort((a, b) => a.mastery - b.mastery);
  return { ids: shuffle(ids, rng), focus, shortfall: size - ids.length };
}

/** 유형 골라 풀기 */
export function buildByTypes(index, history, codes, rng, size = TEST_SIZE) {
  const seen = seenIds(history);
  const stats = subtypeStats(index, history);
  const ids = roundRobin(index, codes, size, seen, new Set(), rng, stats);
  return { ids: shuffle(ids, rng), shortfall: size - ids.length };
}

// --- 시험지·채점 --------------------------------------------------------------

/** 보기 순서를 섞어서 위치로 답을 기억하지 못하게 한다. order[표시 위치] = 원래 보기 인덱스 */
export function createTest(mode, ids, rng, now = Date.now()) {
  return {
    id: `t${now}`,
    mode,
    created: now,
    items: ids.map((id) => ({ id, order: shuffle([0, 1, 2, 3], rng) })),
    answers: {}, // 문항 번호 -> 표시 위치
    current: 0,
  };
}

export function gradeTest(index, test, now = Date.now()) {
  const results = test.items.map((item, i) => {
    const q = index.byId.get(item.id);
    const shown = test.answers[i];
    const chosen = shown === undefined ? null : item.order[shown];
    return { id: item.id, t: q.t, chosen, ok: chosen === q.a };
  });
  const score = results.filter((r) => r.ok).length;
  // o: 시험에서 보여준 보기 순서 (해설 화면에서 같은 순서로 보여주기 위해)
  const attempts = results.map((r, i) => ({ id: r.id, t: r.t, ok: r.ok, ch: r.chosen, o: test.items[i].order, ts: now, test: test.id }));
  return { results, score, attempts, record: { id: test.id, mode: test.mode, ts: now, started: test.created, n: results.length, score } };
}

export function emptyHistory() {
  return { attempts: [], tests: [] };
}
