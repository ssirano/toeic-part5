import {
  TEST_SIZE,
  buildByTypes,
  buildComprehensive,
  buildWeak,
  createTest,
  gradeTest,
  indexBank,
  makeRng,
  subtypeStats,
  weakRanking,
} from "./engine.js";
import { exportBackup, importBackup, load, save } from "./storage.js";

const MODES = { comp: "종합 테스트", weak: "약점 테스트", pick: "유형 선택 테스트" };
const LETTERS = ["A", "B", "C", "D"];
const BLANK = "-------";

const $app = document.getElementById("app");
const $modal = document.getElementById("modal");
const $toast = document.getElementById("toast");

let bank = null;
let index = null;
let state = load();
let view = { name: "home" };
let ui = { showGrid: false, resultFilter: "all", noteFilter: "", pick: new Set(), pickSize: TEST_SIZE };
let timerId = null;

// --- 유틸 ---------------------------------------------------------------------

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function persist() {
  if (!save(state)) toast("저장 공간이 부족해 기록을 저장하지 못했어요.");
}

function toast(msg, ms = 2400) {
  $toast.textContent = msg;
  $toast.hidden = false;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => ($toast.hidden = true), ms);
}

function modal(title, bodyHtml, buttons) {
  return new Promise((resolve) => {
    $modal.innerHTML = `<div class="box" role="dialog" aria-modal="true">
      <h3>${esc(title)}</h3><div>${bodyHtml}</div>
      <div class="actions">${buttons
        .map((b, i) => `<button data-i="${i}" class="${b.cls ?? ""}">${esc(b.label)}</button>`)
        .join("")}</div></div>`;
    $modal.hidden = false;
    $modal.onclick = (e) => {
      const btn = e.target.closest("button[data-i]");
      if (!btn && e.target !== $modal) return;
      $modal.hidden = true;
      $modal.onclick = null;
      resolve(btn ? buttons[Number(btn.dataset.i)].value : null);
    };
  });
}

function fmtTime(ms) {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function fmtDate(ts) {
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

function typeLabel(code) {
  const s = index.subtypes.get(code);
  return s ? `${s.groupName} · ${s.name}` : code;
}

function pct(x) {
  return `${Math.round(x * 100)}%`;
}

function go(name, params = {}) {
  view = { name, ...params };
  render();
  window.scrollTo(0, 0);
}

function applySettings() {
  document.documentElement.style.setProperty("--scale", state.settings.scale);
}

// --- 문제 표시 ---------------------------------------------------------------

function sentence(q, fill) {
  const [before, after] = q.q.split(BLANK).map(esc);
  const mid = fill ? `<span class="fill ${fill.cls}">${esc(fill.text)}</span>` : `<span class="blank">&nbsp;</span>`;
  return `${before}${mid}${after}`;
}

function structure(st) {
  const segs = st.split(" / ").map((part) => {
    const m = part.match(/^\[(.+?)\]\s*(.*)$/);
    return m ? `<span class="seg"><em>${esc(m[1])}</em>${esc(m[2])}</span>` : `<span class="seg">${esc(part)}</span>`;
  });
  return `<div class="structure">${segs.join("")}</div>`;
}

// 문장 형식 · 태 · 시제 — 각각 '왜 그런지'까지
function grammarBlock(q) {
  if (!q.fm) return "";
  const w = q.why ?? {};
  const [main, ...notes] = q.tn ?? [];
  const why = (text) => (text ? `<div class="why">왜? ${esc(text)}</div>` : "");
  return `<div class="section grammar">
    <div class="label">문장 형식 · 태 · 시제</div>
    <div class="gline"><span class="gtag">형식</span><div>${esc(q.fm)}${why(w.fm)}</div></div>
    <div class="gline"><span class="gtag">태</span><div>${esc(w.vl ?? "")}${why(w.vo)}</div></div>
    <div class="gline"><span class="gtag">시제</span><div>${esc(main ?? "")}${why(w.tn)}${
      notes.length ? `<ul class="notes">${notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ul>` : ""
    }</div></div>
    <div class="gline"><span class="gtag">빈칸</span><div>${esc(q.sl)}</div></div>
  </div>`;
}

function reviewCard(q, chosen, num, order = [0, 1, 2, 3]) {
  const ok = chosen === q.a;
  const status = chosen === null || chosen === undefined ? "무응답" : ok ? "정답" : "오답";
  const flagged = state.flags.includes(q.id);
  // 시험 때 본 순서 그대로 (A)~(D)를 붙인다
  const opts = order
    .map((i, pos) => {
      const cls = i === q.a ? "correct" : i === chosen ? "mine" : "";
      const mark = i === q.a ? " ✓" : i === chosen ? " (내 답)" : "";
      return `<li class="${cls}">(${LETTERS[pos]}) ${esc(q.c[i])}${mark}</li>`;
    })
    .join("");
  const vocab = q.v.map(([w, m]) => `<tr><td>${esc(w)}</td><td>${esc(m)}</td></tr>`).join("");
  return `<article class="review ${ok ? "" : "wrong"}">
    <header>
      ${num ? `<b>${num}.</b>` : ""}
      <span class="chip">${esc(typeLabel(q.t))}</span>
      <span class="chip ${ok ? "" : "bad"}">${ok ? "✅" : "❌"} ${status}</span>
      <span class="spacer"></span>
      <button class="ghost small" data-action="flag" data-id="${q.id}">${flagged ? "🚩 신고됨" : "오류 신고"}</button>
    </header>
    <div class="qtext">${sentence(q, { cls: "ok", text: q.c[q.a] })}</div>
    <ol class="opts">${opts}</ol>
    <div class="section"><div class="label">해석</div>${esc(q.tr)}</div>
    ${grammarBlock(q)}
    <div class="section"><div class="label">문장 구조</div>${structure(q.st)}</div>
    <div class="section"><div class="label">해설</div>${esc(q.ex)}</div>
    <div class="tip">💡 ${esc(q.tip)}</div>
    <div class="section"><div class="label">어휘</div><table class="vocab">${vocab}</table></div>
  </article>`;
}

// --- 화면: 홈 -----------------------------------------------------------------

function renderHome() {
  const stats = subtypeStats(index, state.history);
  const total = index.byId.size;
  const seen = [...stats.values()].reduce((s, x) => s + x.seen, 0);
  const attempts = state.history.attempts.length;
  const correct = state.history.attempts.filter((a) => a.ok).length;
  const weak = weakRanking(stats).slice(0, 3);
  const recent = [...state.history.tests].sort((a, b) => b.ts - a.ts).slice(0, 6);
  const ip = state.inProgress;

  return `
    <h1>Part 5 트레이너</h1>
    <p class="muted">한 번 푼 문제는 다시 나오지 않아요. 약점 테스트도 약한 유형의 새 문제로 나와요.</p>
    <div class="summary">
      <div class="stat"><span class="muted small">새 문제</span><b>${total - seen}</b></div>
      <div class="stat"><span class="muted small">푼 문제</span><b>${seen} / ${total}</b></div>
      <div class="stat"><span class="muted small">전체 정답률</span><b>${attempts ? pct(correct / attempts) : "-"}</b></div>
    </div>
    ${
      ip
        ? `<div class="banner"><div><b>풀던 테스트가 있어요</b><br><span class="small">${MODES[ip.mode]} · ${
            Object.keys(ip.answers).length
          } / ${ip.items.length} 답함</span></div><span class="spacer"></span>
           <button data-action="discard">버리기</button><button class="primary" data-action="resume">이어 풀기</button></div>`
        : ""
    }
    <div class="cards">
      <button class="card main" data-action="start-comp">
        <strong>종합 테스트</strong>
        <span class="muted">여러 유형을 실제 시험 비율로 섞은 새 문제 ${TEST_SIZE}개</span>
      </button>
      <button class="card" data-action="start-weak">
        <strong>약점 테스트</strong>
        <span class="muted">${
          weak.length
            ? `약한 유형: ${weak.map((w) => esc(w.name)).join(", ")}`
            : attempts
              ? "지금까지 틀린 유형 위주로 새 문제를 내요"
              : "종합 테스트를 풀면 약점을 찾아드려요"
        }</span>
      </button>
      <button class="card" data-action="go" data-to="pick">
        <strong>유형 골라 풀기</strong>
        <span class="muted">원하는 유형만 모아서 새 문제로</span>
      </button>
    </div>
    <div class="links">
      <button data-action="go" data-to="stats">📊 유형별 통계</button>
      <button data-action="go" data-to="notes">📒 오답 노트</button>
      <button data-action="go" data-to="settings">⚙️ 설정·백업</button>
    </div>
    ${
      recent.length
        ? `<h2>최근 테스트</h2><ul class="history-list">${recent
            .map(
              (t) => `<li><span>${fmtDate(t.ts)}</span><span class="muted">${MODES[t.mode] ?? ""}</span>
                <span class="spacer"></span><b>${t.score} / ${t.n}</b>
                <button class="ghost" data-action="open-result" data-id="${t.id}">해설 보기</button></li>`,
            )
            .join("")}</ul>`
        : ""
    }`;
}

// --- 화면: 시험 ---------------------------------------------------------------

function renderTest() {
  const t = state.inProgress;
  const i = t.current;
  const item = t.items[i];
  const q = index.byId.get(item.id);
  const answered = Object.keys(t.answers).length;
  const last = i === t.items.length - 1;
  const choices = item.order
    .map((orig, pos) => {
      const sel = t.answers[i] === pos ? "selected" : "";
      return `<button class="choice ${sel}" data-action="answer" data-pos="${pos}"><span class="letter">${LETTERS[pos]}</span><span>${esc(
        q.c[orig],
      )}</span></button>`;
    })
    .join("");
  const grid = ui.showGrid
    ? `<div class="grid">${t.items
        .map(
          (_, k) =>
            `<button data-action="jump" data-k="${k}" class="${t.answers[k] !== undefined ? "answered" : ""} ${
              k === i ? "current" : ""
            }">${k + 1}</button>`,
        )
        .join("")}</div>`
    : "";

  return `
    <div class="topbar">
      <button class="ghost" data-action="leave">✕ 나가기</button>
      <b>${MODES[t.mode]}</b>
      <span class="spacer"></span>
      ${state.settings.showTimer ? `<span class="timer" id="timer">${fmtTime(Date.now() - t.created)}</span>` : ""}
      <button class="ghost" data-action="toggle-grid">${ui.showGrid ? "문항표 닫기" : "문항표"}</button>
    </div>
    <div class="muted">문제 ${i + 1} / ${t.items.length} · ${answered}문제 답함</div>
    <div class="progress"><div style="width:${((i + 1) / t.items.length) * 100}%"></div></div>
    ${grid}
    <div class="question">${sentence(q)}</div>
    <div class="choices">${choices}</div>
    <div class="nav">
      <button data-action="prev" ${i === 0 ? "disabled" : ""}>← 이전</button>
      <span class="spacer"></span>
      ${
        last
          ? `<button class="primary" data-action="submit">채점하기</button>`
          : `<button data-action="next">다음 →</button>`
      }
    </div>`;
}

// --- 화면: 결과 ---------------------------------------------------------------

function renderResult() {
  const record = state.history.tests.find((t) => t.id === view.testId);
  const attempts = state.history.attempts.filter((a) => a.test === view.testId && index.byId.has(a.id));
  if (!record || !attempts.length) return `<p>결과를 찾을 수 없어요.</p><button data-action="go" data-to="home">홈으로</button>`;

  const wrongByType = new Map();
  for (const a of attempts) if (!a.ok) wrongByType.set(a.t, (wrongByType.get(a.t) ?? 0) + 1);
  const wrongChips = [...wrongByType]
    .sort((a, b) => b[1] - a[1])
    .map(([t, n]) => `<span class="chip bad">${esc(index.subtypes.get(t)?.name ?? t)} ${n}</span>`)
    .join("");
  const shown = attempts
    .map((a, k) => ({ a, k }))
    .filter(({ a }) => ui.resultFilter === "all" || !a.ok);
  const minutes = record.started ? fmtTime(record.ts - record.started) : null;

  return `
    <div class="topbar"><button class="ghost" data-action="go" data-to="home">← 홈</button><span class="spacer"></span>
      <span class="muted">${fmtDate(record.ts)} · ${MODES[record.mode] ?? ""}</span></div>
    <div class="score">${record.score}<small> / ${record.n}</small></div>
    <p class="muted">${minutes ? `걸린 시간 ${minutes} · ` : ""}정답률 ${pct(record.score / record.n)}</p>
    ${wrongChips ? `<h3>틀린 유형</h3><div class="chips">${wrongChips}</div>` : `<p>🎉 모두 맞혔어요!</p>`}
    <div class="links">
      <button class="primary" data-action="start-weak">약점 테스트 시작</button>
      <button data-action="start-comp">새 종합 테스트</button>
    </div>
    <div class="tabs">
      <button data-action="result-filter" data-f="all" class="${ui.resultFilter === "all" ? "on" : ""}">전체 ${attempts.length}</button>
      <button data-action="result-filter" data-f="wrong" class="${ui.resultFilter === "wrong" ? "on" : ""}">틀린 문제 ${
        attempts.filter((a) => !a.ok).length
      }</button>
    </div>
    ${shown.map(({ a, k }) => reviewCard(index.byId.get(a.id), a.ch, k + 1, a.o)).join("")}`;
}

// --- 화면: 통계 ---------------------------------------------------------------

function renderStats() {
  const stats = subtypeStats(index, state.history);
  const weak = weakRanking(stats).slice(0, 5);
  const groups = index.groups
    .map((g) => {
      const rows = g.subtypes
        .map((s) => {
          const st = stats.get(s.code);
          const m = st.attempts ? st.mastery : null;
          const level = m === null ? "" : m < 0.5 ? "weak" : m < 0.75 ? "mid" : "";
          return `<div class="row">
            <div>${esc(s.name)}<div class="muted small">푼 문제 ${st.seen}/${st.total} · 새 문제 ${st.unseen}</div></div>
            <div>${m === null ? `<span class="muted">-</span>` : `<b>${pct(m)}</b>`}</div>
            <div class="bar ${level}"><div style="width:${m === null ? 0 : m * 100}%"></div></div>
          </div>`;
        })
        .join("");
      return `<section class="group"><h3>${esc(g.name)}</h3>${rows}</section>`;
    })
    .join("");
  return `
    <div class="topbar"><button class="ghost" data-action="go" data-to="home">← 홈</button></div>
    <h1>유형별 통계</h1>
    <p class="muted small">정답률은 최근 풀이에 더 큰 비중을 둔 추정치예요. 3문제 이상 풀면 약점 순위에 들어가요.</p>
    ${weak.length ? `<h3>약한 유형</h3><div class="chips">${weak.map((w) => `<span class="chip bad">${esc(w.name)} ${pct(w.mastery)}</span>`).join("")}</div>` : ""}
    ${groups}`;
}

// --- 화면: 유형 선택 -----------------------------------------------------------

function renderPick() {
  const stats = subtypeStats(index, state.history);
  const available = [...ui.pick].reduce((s, c) => s + (stats.get(c)?.unseen ?? 0), 0);
  const groups = index.groups
    .map((g) => {
      const rows = g.subtypes
        .map((s) => {
          const st = stats.get(s.code);
          return `<label class="pick"><input type="checkbox" data-action="pick" data-code="${s.code}" ${
            ui.pick.has(s.code) ? "checked" : ""
          } ${st.unseen ? "" : "disabled"}><span>${esc(s.name)}</span><span class="spacer"></span>
            <span class="muted small">새 문제 ${st.unseen}${st.attempts ? ` · 정답률 ${pct(st.mastery)}` : ""}</span></label>`;
        })
        .join("");
      return `<section class="group"><div class="topbar"><h3>${esc(g.name)}</h3><span class="spacer"></span>
        <button class="ghost small" data-action="pick-group" data-group="${g.code}">전체 선택</button></div>${rows}</section>`;
    })
    .join("");
  return `
    <div class="topbar"><button class="ghost" data-action="go" data-to="home">← 홈</button></div>
    <h1>유형 골라 풀기</h1>
    <div class="sizes">${[10, 20, 30]
      .map((n) => `<button data-action="pick-size" data-n="${n}" class="${ui.pickSize === n ? "on" : ""}">${n}문제</button>`)
      .join("")}</div>
    ${groups}
    <div class="nav"><span class="muted">선택한 유형의 새 문제 ${available}개</span><span class="spacer"></span>
      <button class="primary" data-action="start-pick" ${ui.pick.size && available ? "" : "disabled"}>시작</button></div>`;
}

// --- 화면: 오답 노트 -----------------------------------------------------------

function renderNotes() {
  const latest = new Map(); // 문제별 가장 최근 풀이
  for (const a of state.history.attempts) {
    const prev = latest.get(a.id);
    if (!prev || a.ts >= prev.ts) latest.set(a.id, a);
  }
  let wrong = [...latest.values()].filter((a) => !a.ok && index.byId.has(a.id)).sort((a, b) => b.ts - a.ts);
  const types = [...new Set(wrong.map((a) => a.t))];
  if (ui.noteFilter) wrong = wrong.filter((a) => a.t === ui.noteFilter);
  return `
    <div class="topbar"><button class="ghost" data-action="go" data-to="home">← 홈</button></div>
    <h1>오답 노트</h1>
    <p class="muted small">복습용이에요. 여기 있는 문제는 테스트에 다시 나오지 않아요.</p>
    <div class="chips">
      <button class="chip ${ui.noteFilter ? "" : "bad"}" data-action="note-filter" data-t="">전체</button>
      ${types
        .map((t) => `<button class="chip ${ui.noteFilter === t ? "bad" : ""}" data-action="note-filter" data-t="${t}">${esc(index.subtypes.get(t)?.name ?? t)}</button>`)
        .join("")}
    </div>
    ${wrong.length ? wrong.map((a) => reviewCard(index.byId.get(a.id), a.ch, null, a.o)).join("") : `<p class="muted">틀린 문제가 없어요.</p>`}`;
}

// --- 화면: 설정 ---------------------------------------------------------------

function renderSettings() {
  const s = state.settings;
  return `
    <div class="topbar"><button class="ghost" data-action="go" data-to="home">← 홈</button></div>
    <h1>설정·백업</h1>
    <div class="setting"><div>답을 고르면 다음 문제로 자동 이동</div><span class="spacer"></span>
      <button data-action="toggle-setting" data-key="autoAdvance">${s.autoAdvance ? "켜짐" : "꺼짐"}</button></div>
    <div class="setting"><div>풀이 시간 표시</div><span class="spacer"></span>
      <button data-action="toggle-setting" data-key="showTimer">${s.showTimer ? "켜짐" : "꺼짐"}</button></div>
    <div class="setting"><div>글자 크기</div><span class="spacer"></span>
      ${[
        [1, "보통"],
        [1.12, "크게"],
        [1.25, "아주 크게"],
      ]
        .map(([v, l]) => `<button data-action="scale" data-v="${v}" class="${s.scale === v ? "primary" : ""}">${l}</button>`)
        .join("")}</div>
    <h2>백업</h2>
    <p class="muted small">기록은 이 태블릿의 브라우저에만 저장돼요. 브라우저 데이터를 지우면 사라지니 가끔 백업해 두세요.</p>
    <div class="setting"><button data-action="export">백업 파일 저장</button>
      <label><button data-action="import-click">백업 불러오기</button><input type="file" id="import" accept="application/json" hidden></label></div>
    <h2>오류 신고한 문제 (${state.flags.length})</h2>
    ${
      state.flags.length
        ? `<p class="small muted">${state.flags.map(esc).join(", ")}</p><button data-action="copy-flags">목록 복사</button>`
        : `<p class="muted small">해설 화면의 '오류 신고'로 표시한 문제가 여기 모여요.</p>`
    }
    <h2>초기화</h2>
    <button class="danger" data-action="reset">학습 기록 전체 삭제</button>
    <p class="muted small" style="margin-top:24px">문제 은행 ${index.byId.size}문제 · 버전 ${esc(bank.version)}</p>`;
}

// --- 렌더링 ---------------------------------------------------------------------

function render() {
  clearInterval(timerId);
  const screens = { home: renderHome, test: renderTest, result: renderResult, stats: renderStats, pick: renderPick, notes: renderNotes, settings: renderSettings };
  if (view.name === "test" && !state.inProgress) view = { name: "home" };
  $app.innerHTML = (screens[view.name] ?? renderHome)();
  if (view.name === "test" && state.settings.showTimer) {
    timerId = setInterval(() => {
      const el = document.getElementById("timer");
      if (el && state.inProgress) el.textContent = fmtTime(Date.now() - state.inProgress.created);
    }, 1000);
  }
}

// --- 동작 ---------------------------------------------------------------------

async function confirmReplaceInProgress() {
  if (!state.inProgress) return true;
  const choice = await modal("풀던 테스트가 있어요", "<p>새 테스트를 시작하면 풀던 테스트는 버려져요. (채점 전이라 기록에는 남지 않아요)</p>", [
    { label: "취소", value: "cancel" },
    { label: "이어 풀기", value: "resume" },
    { label: "버리고 새로 시작", value: "new", cls: "primary" },
  ]);
  if (choice === "resume") go("test");
  return choice === "new";
}

function startTest(mode, ids, shortfall) {
  if (!ids.length) {
    modal("새 문제가 없어요", "<p>이 조건으로 낼 수 있는 새 문제를 모두 풀었어요. 다른 유형을 선택하거나 문제 은행이 추가되길 기다려 주세요.</p>", [
      { label: "확인", value: 1 },
    ]);
    return;
  }
  state.inProgress = createTest(mode, ids, makeRng());
  persist();
  go("test");
  if (shortfall > 0) toast(`새 문제가 부족해서 ${ids.length}문제로 구성했어요.`, 3500);
}

async function startComp() {
  if (!(await confirmReplaceInProgress())) return;
  const { ids, shortfall } = buildComprehensive(index, state.history, makeRng());
  startTest("comp", ids, shortfall);
}

async function startWeak() {
  const weak = buildWeak(index, state.history, makeRng());
  if (weak.reason === "no-history") {
    const c = await modal("아직 약점을 알 수 없어요", "<p>종합 테스트를 한 번 풀면 유형별 정답률로 약점을 찾아드려요.</p>", [
      { label: "닫기", value: 0 },
      { label: "종합 테스트 시작", value: 1, cls: "primary" },
    ]);
    if (c) startComp();
    return;
  }
  const list = weak.focus
    .slice(0, 8)
    .map((f) => `<li>${esc(f.name)} <b>${f.count}문제</b> <span class="muted small">(정답률 ${pct(f.mastery)})</span></li>`)
    .join("");
  const go_ = await modal("이번 약점 테스트", `<p>약한 유형일수록 많이 출제돼요. 모두 처음 보는 문제예요.</p><ul>${list}</ul>`, [
    { label: "취소", value: 0 },
    { label: "시작", value: 1, cls: "primary" },
  ]);
  if (!go_ || !(await confirmReplaceInProgress())) return;
  startTest("weak", weak.ids, weak.shortfall);
}

async function startPick() {
  if (!(await confirmReplaceInProgress())) return;
  const { ids, shortfall } = buildByTypes(index, state.history, [...ui.pick], makeRng(), ui.pickSize);
  startTest("pick", ids, shortfall);
}

function answer(pos) {
  const t = state.inProgress;
  const i = t.current;
  t.answers[i] = pos;
  persist();
  render();
  if (state.settings.autoAdvance && i < t.items.length - 1) {
    setTimeout(() => {
      if (state.inProgress === t && t.current === i) {
        t.current = i + 1;
        persist();
        render();
      }
    }, 280);
  }
}

async function submit() {
  const t = state.inProgress;
  const missing = t.items.length - Object.keys(t.answers).length;
  if (missing) {
    const c = await modal("안 푼 문제가 있어요", `<p>${missing}문제를 아직 안 풀었어요. 안 푼 문제는 오답으로 처리돼요.</p>`, [
      { label: "계속 풀기", value: 0 },
      { label: "채점하기", value: 1, cls: "primary" },
    ]);
    if (!c) {
      const first = t.items.findIndex((_, k) => t.answers[k] === undefined);
      t.current = first;
      ui.showGrid = true;
      render();
      return;
    }
  }
  const graded = gradeTest(index, t);
  state.history.attempts.push(...graded.attempts);
  state.history.tests.push(graded.record);
  state.inProgress = null;
  persist();
  ui.resultFilter = "all";
  go("result", { testId: graded.record.id });
}

const actions = {
  go: (el) => go(el.dataset.to),
  "start-comp": startComp,
  "start-weak": startWeak,
  "start-pick": startPick,
  resume: () => go("test"),
  async discard() {
    const c = await modal("풀던 테스트 버리기", "<p>채점 전이라 기록에 남지 않고, 문제들은 다음에 다시 나올 수 있어요.</p>", [
      { label: "취소", value: 0 },
      { label: "버리기", value: 1, cls: "primary" },
    ]);
    if (!c) return;
    state.inProgress = null;
    persist();
    render();
  },
  answer: (el) => answer(Number(el.dataset.pos)),
  prev: () => {
    state.inProgress.current -= 1;
    persist();
    render();
  },
  next: () => {
    state.inProgress.current += 1;
    persist();
    render();
  },
  jump: (el) => {
    state.inProgress.current = Number(el.dataset.k);
    persist();
    render();
  },
  "toggle-grid": () => {
    ui.showGrid = !ui.showGrid;
    render();
  },
  leave: () => {
    toast("진행 상황이 저장됐어요. 홈에서 이어 풀 수 있어요.");
    go("home");
  },
  submit,
  "open-result": (el) => {
    ui.resultFilter = "all";
    go("result", { testId: el.dataset.id });
  },
  "result-filter": (el) => {
    ui.resultFilter = el.dataset.f;
    render();
  },
  "note-filter": (el) => {
    ui.noteFilter = el.dataset.t;
    render();
  },
  flag: (el) => {
    const id = el.dataset.id;
    state.flags = state.flags.includes(id) ? state.flags.filter((f) => f !== id) : [...state.flags, id];
    persist();
    el.textContent = state.flags.includes(id) ? "🚩 신고됨" : "오류 신고";
    if (state.flags.includes(id)) toast("신고한 문제는 설정 화면에서 모아볼 수 있어요.");
  },
  pick: (el) => {
    const code = el.dataset.code;
    ui.pick.has(code) ? ui.pick.delete(code) : ui.pick.add(code);
    render();
  },
  "pick-group": (el) => {
    const g = index.groups.find((x) => x.code === el.dataset.group);
    const stats = subtypeStats(index, state.history);
    const codes = g.subtypes.map((s) => s.code).filter((c) => stats.get(c).unseen);
    const allOn = codes.every((c) => ui.pick.has(c));
    codes.forEach((c) => (allOn ? ui.pick.delete(c) : ui.pick.add(c)));
    render();
  },
  "pick-size": (el) => {
    ui.pickSize = Number(el.dataset.n);
    render();
  },
  "toggle-setting": (el) => {
    state.settings[el.dataset.key] = !state.settings[el.dataset.key];
    persist();
    render();
  },
  scale: (el) => {
    state.settings.scale = Number(el.dataset.v);
    persist();
    applySettings();
    render();
  },
  export: () => exportBackup(state),
  "import-click": () => document.getElementById("import").click(),
  "copy-flags": async () => {
    try {
      await navigator.clipboard.writeText(state.flags.join("\n"));
      toast("복사했어요.");
    } catch {
      toast("복사하지 못했어요. 목록을 길게 눌러 복사하세요.");
    }
  },
  async reset() {
    const c = await modal("학습 기록 전체 삭제", "<p>모든 풀이 기록과 통계가 지워지고, 푼 문제도 다시 새 문제가 돼요. 되돌릴 수 없어요.</p>", [
      { label: "취소", value: 0 },
      { label: "삭제", value: 1, cls: "danger" },
    ]);
    if (!c) return;
    state.history = { attempts: [], tests: [] };
    state.inProgress = null;
    persist();
    toast("기록을 삭제했어요.");
    go("home");
  },
};

$app.addEventListener("click", (e) => {
  const el = e.target.closest("[data-action]");
  if (!el || el.disabled) return;
  if (el.tagName === "INPUT") return; // 체크박스는 change에서 처리
  const fn = actions[el.dataset.action];
  if (fn) fn(el);
});

$app.addEventListener("change", async (e) => {
  const el = e.target;
  if (el.matches("input[data-action]")) {
    actions[el.dataset.action]?.(el);
  } else if (el.id === "import" && el.files[0]) {
    try {
      state = await importBackup(el.files[0]);
      persist();
      applySettings();
      toast("백업을 불러왔어요.");
      go("home");
    } catch (err) {
      toast(`불러오지 못했어요: ${err.message}`, 4000);
    }
  }
});

// 키보드(외장 키보드·PC 확인용): 1~4 또는 A~D 선택, ←/→ 이동
document.addEventListener("keydown", (e) => {
  if (view.name !== "test" || !state.inProgress || !$modal.hidden) return;
  const key = e.key.toLowerCase();
  const pos = "1234".indexOf(key) >= 0 ? "1234".indexOf(key) : "abcd".indexOf(key);
  if (pos >= 0) answer(pos);
  else if (e.key === "ArrowLeft" && state.inProgress.current > 0) actions.prev();
  else if (e.key === "ArrowRight" && state.inProgress.current < state.inProgress.items.length - 1) actions.next();
});

// --- 시작 ---------------------------------------------------------------------

async function init() {
  applySettings();
  try {
    const res = await fetch("questions.json", { cache: "no-cache" });
    bank = await res.json();
  } catch {
    $app.innerHTML = `<p class="loading">문제를 불러오지 못했어요. 인터넷 연결을 확인하고 새로고침하세요.</p>`;
    return;
  }
  index = indexBank(bank);
  // 문제 은행이 바뀌어 풀던 테스트의 문제가 사라졌으면 정리
  if (state.inProgress && !state.inProgress.items.every((it) => index.byId.has(it.id))) {
    state.inProgress = null;
    persist();
  }
  render();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("sw.js").catch(() => {});
}

init();
