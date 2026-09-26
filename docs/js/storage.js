// 학습 기록은 이 기기의 브라우저(localStorage)에만 저장된다.
// 브라우저 데이터를 지우면 사라지므로 설정 화면의 '백업'을 가끔 해둘 것.
import { emptyHistory } from "./engine.js";

const KEY = "part5-trainer.v1";

export const DEFAULT_SETTINGS = { autoAdvance: true, showTimer: true, scale: 1, autoWords: true };

export function defaultState() {
  return { history: emptyHistory(), inProgress: null, settings: { ...DEFAULT_SETTINGS }, flags: [], words: {}, notePdfs: {} };
}

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultState();
    return normalize(JSON.parse(raw));
  } catch {
    return defaultState();
  }
}

export function save(state) {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

function normalize(data) {
  const base = defaultState();
  return {
    history: {
      attempts: Array.isArray(data?.history?.attempts) ? data.history.attempts : [],
      tests: Array.isArray(data?.history?.tests) ? data.history.tests : [],
    },
    inProgress: data?.inProgress ?? null,
    settings: { ...base.settings, ...(data?.settings ?? {}) },
    flags: Array.isArray(data?.flags) ? data.flags : [],
    words: data?.words && typeof data.words === "object" && !Array.isArray(data.words) ? data.words : {},
    notePdfs: data?.notePdfs && typeof data.notePdfs === "object" ? data.notePdfs : {}, // 날짜 -> 오답노트 PDF 만든 시각
  };
}

// 파일로 내려받기 (백업·Anki 단어 파일)
export function downloadFile(name, text, type) {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function today() {
  const d = new Date();
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, "0")}${String(d.getDate()).padStart(2, "0")}`;
}

export function exportBackup(state) {
  downloadFile(`part5-backup-${today()}.json`, JSON.stringify({ app: "part5-trainer", exported: Date.now(), ...state }), "application/json");
}

export async function importBackup(file) {
  const data = JSON.parse(await file.text());
  if (data?.app !== "part5-trainer") throw new Error("이 앱의 백업 파일이 아닙니다.");
  return normalize(data);
}
