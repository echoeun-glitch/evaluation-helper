/* 의견 생성 서버의 순수 로직 (네트워크·Firebase 없이 테스트 가능) */

export const LEVELS = ["최상", "상", "중", "하"];
export const PER_LEVEL = 8;

/* 요청을 받을 웹 주소. 다른 사이트에서 이 서버를 쓰지 못하게 막습니다. */
export const ALLOWED_ORIGINS = [
  "https://echoeun-glitch.github.io",
  "http://localhost:5000",
  "http://127.0.0.1:5000",
  "http://localhost:8080",
  "http://127.0.0.1:8080",
];

const LIMITS = { subject: 30, grade: 10, name: 60, activity: 600, criteria: 1500 };

/* 요청 본문을 검사하고 정리합니다. 문제가 있으면 {error}를 돌려줍니다. */
export function validateInput(body) {
  if (!body || typeof body !== "object") return { error: "요청 형식이 올바르지 않습니다." };
  const out = {};
  for (const [k, max] of Object.entries(LIMITS)) {
    const v = body[k] == null ? "" : body[k];
    if (typeof v !== "string") return { error: "요청 형식이 올바르지 않습니다." };
    const t = v.replace(/\s+/g, " ").trim();
    if (t.length > max) return { error: `입력이 너무 깁니다. (${k} ${max}자 이하)` };
    out[k] = t;
  }
  if (!out.criteria) return { error: "평가 기준을 먼저 입력해 주세요." };
  if (!out.subject) return { error: "과목을 선택해 주세요." };
  return { value: out };
}

/* 웹앱의 buildPrompt()와 같은 규칙. 형식은 구조화 출력으로 강제하므로 JSON 안내는 짧게 둡니다. */
export function buildPrompt({ subject, grade, name, activity, criteria }) {
  return `당신은 초등학교 ${grade || ""} ${subject} 교과를 가르치는 교사입니다. 학교생활기록부 '교과학습발달상황(세부능력 및 특기사항)'에 쓸 평가 의견을 만듭니다.

과목: ${subject}
평가 영역: ${name || "(이름 없음)"}
주요 활동: ${activity || "(없음)"}
평가 기준: ${criteria}

규칙:
- 주요 활동이 있으면 의견에 그 활동 이름이나 장면을 자연스럽게 녹여 구체적으로 씁니다.
- 성취 수준 "최상", "상", "중", "하" 각각 서로 다른 의견을 정확히 8개씩 씁니다.
- 의견 하나는 반드시 정확히 두 문장입니다. 각 문장은 마침표로 끝납니다.
- 생활기록부 문체: 명사형 종결("~함.", "~임.", "~보임.", "~필요함." 등). 학생 이름이나 "학생은", "이 학생은" 같은 주어는 쓰지 않습니다.
- 평가 기준의 구체적인 지식·기능·태도 요소를 근거로 관찰 가능한 행동을 서술합니다.
- 최상·상은 강점 중심, 중은 성취와 보완점, 하는 노력과 성장 가능성을 긍정적으로 서술하되 부정적·비하 표현은 쓰지 않습니다.
- 같은 수준 안에서 첫 어절과 표현이 겹치지 않게 다양하게 씁니다. 의견 하나는 60~110자 정도.

수준별 의견 목록을 JSON으로 답하세요.`;
}

/* 구조화 출력용 JSON 스키마 */
export const OPINION_SCHEMA = {
  type: "object",
  properties: Object.fromEntries(LEVELS.map((l) => [l, { type: "array", items: { type: "string" } }])),
  required: LEVELS,
  additionalProperties: false,
};

/* 모델 답(JSON 문자열)을 수준별 의견 배열로 정리합니다. */
export function normalizeOpinions(text) {
  let o;
  try { o = JSON.parse(text); } catch { return null; }
  if (!o || typeof o !== "object") return null;
  const ops = {};
  for (const lv of LEVELS) {
    ops[lv] = (Array.isArray(o[lv]) ? o[lv] : [])
      .map((s) => String(s).replace(/\s+/g, " ").trim())
      .filter(Boolean)
      .slice(0, PER_LEVEL);
  }
  return LEVELS.some((l) => ops[l].length) ? ops : null;
}

/* 요청자 IP (Cloud Run 앞단이 붙이는 x-forwarded-for의 첫 값) */
export function clientIp(req) {
  const xf = req.headers?.["x-forwarded-for"];
  const first = (Array.isArray(xf) ? xf[0] : xf || "").split(",")[0].trim();
  return first || req.ip || "unknown";
}

/* 한국 시간 기준 날짜 (하루 사용 횟수 집계용) */
export function kstDay(now = new Date()) {
  return new Date(now.getTime() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}
