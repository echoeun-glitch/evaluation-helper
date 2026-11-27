/* 평가 입력기 — AI 의견 생성 서버 (Firebase Functions 2세대)
 *
 * POST /generateOpinions  {accessCode, subject, grade, name, activity, criteria}
 *   200 → {text: "<JSON 문자열>", remaining: <오늘 남은 횟수>}
 *   4xx/5xx → {message: "<사용자에게 보여 줄 안내>"}   (401 + reason:"access" = 입장 코드 틀림)
 * POST /generateOpinions  {accessCode, action:"one", level, existing:[…], subject, …}  → 200 {text:"<의견 하나>", remaining}
 * POST /generateOpinions  {accessCode, action:"check"}  → 200 {ok:true}  (입장 코드 확인만, 횟수 안 셈)
 *
 * Claude API 키(ANTHROPIC_API_KEY)와 입장 코드(ACCESS_CODE)는 Secret Manager에 둡니다(코드·저장소에 넣지 않음).
 */
import { onRequest } from "firebase-functions/v2/https";
import { defineSecret, defineInt } from "firebase-functions/params";
import { logger } from "firebase-functions";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import {
  ALLOWED_ORIGINS, OPINION_SCHEMA, buildPrompt, validateInput, normalizeOpinions, clientIp, kstDay, codeMatches,
  validateOne, buildOnePrompt, ONE_SCHEMA, normalizeOne,
} from "./lib.js";

const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");
const ACCESS_CODE = defineSecret("ACCESS_CODE");
const MAX_WRONG_CODES = 20;   // 하루에 입장 코드를 이만큼 틀리면 그날은 막음 (무작정 맞혀 보기 방지)
/* 하루 사용 한도 — 배포할 때 물어보며, functions/.env 에 적어 둘 수도 있습니다. */
const DAILY_LIMIT_PER_USER = defineInt("DAILY_LIMIT_PER_USER", { default: 30 });
const DAILY_LIMIT_TOTAL = defineInt("DAILY_LIMIT_TOTAL", { default: 300 });

const MODEL = "claude-sonnet-5-5";   // Opus의 절반 요금

initializeApp();
const db = getFirestore();

/* 입장 코드 틀린 횟수 (IP 해시별, 하루) */
async function wrongCount(day, userKey) {
  const d = await db.doc(`evaluationHelperUsage/${day}_${userKey}_wrong`).get();
  return d.get("count") || 0;
}
async function addWrong(day, userKey) {
  const expireAt = new Date(Date.now() + 3 * 24 * 3600 * 1000);
  await db.doc(`evaluationHelperUsage/${day}_${userKey}_wrong`).set({ count: FieldValue.increment(1), expireAt }, { merge: true })
    .catch((e) => logger.warn("wrong-code count failed", e));
}

/* 오늘 사용량을 1 늘립니다. 한도를 넘으면 늘리지 않고 null을 돌려줍니다. */
async function reserve(day, userKey) {
  const userRef = db.doc(`evaluationHelperUsage/${day}_${userKey}`);
  const totalRef = db.doc(`evaluationHelperUsage/${day}_total`);
  return db.runTransaction(async (tx) => {
    const [u, t] = await Promise.all([tx.get(userRef), tx.get(totalRef)]);
    const used = u.get("count") || 0, total = t.get("count") || 0;
    if (used >= DAILY_LIMIT_PER_USER.value() || total >= DAILY_LIMIT_TOTAL.value()) return null;
    const expireAt = new Date(Date.now() + 3 * 24 * 3600 * 1000); // TTL 정책을 켜면 자동 삭제
    tx.set(userRef, { count: used + 1, expireAt }, { merge: true });
    tx.set(totalRef, { count: total + 1, expireAt }, { merge: true });
    return DAILY_LIMIT_PER_USER.value() - (used + 1);
  });
}
/* 생성에 실패하면 사용 횟수를 되돌립니다. */
async function release(day, userKey) {
  const dec = { count: FieldValue.increment(-1) };
  await Promise.all([
    db.doc(`evaluationHelperUsage/${day}_${userKey}`).set(dec, { merge: true }),
    db.doc(`evaluationHelperUsage/${day}_total`).set(dec, { merge: true }),
  ]).catch((e) => logger.warn("usage release failed", e));
}

async function callClaude(input, one) {
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value(), timeout: 100_000, maxRetries: 1 });
  const res = await client.beta.messages.create({
    model: MODEL,
    max_tokens: one ? 4000 : 16000,
    output_config: {
      effort: "low", // 짧은 문장 생성이라 낮은 effort로 빠르게
      format: { type: "json_schema", schema: one ? ONE_SCHEMA : OPINION_SCHEMA },
    },
    // 안전 분류기가 거절하면 서버가 알아서 다른 모델로 다시 시도
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    messages: [{ role: "user", content: one ? buildOnePrompt(input, one.level, one.existing) : buildPrompt(input) }],
  });
  if (res.stop_reason === "refusal") return { error: "AI가 이 요청에 답하지 않았습니다. 평가 기준 문구를 바꿔 다시 시도해 주세요.", status: 422 };
  if (res.stop_reason === "max_tokens") return { error: "답이 너무 길어 중간에 끊겼습니다. 다시 생성해 주세요.", status: 502 };
  const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  if (one) {
    const opinion = normalizeOne(text);
    if (!opinion) return { error: "결과 형식을 읽지 못했습니다. 다시 눌러 주세요.", status: 502 };
    logger.info("generated one", { model: res.model, usage: res.usage });
    return { opinion };
  }
  const ops = normalizeOpinions(text);
  if (!ops) return { error: "결과 형식을 읽지 못했습니다. 다시 생성해 주세요.", status: 502 };
  logger.info("generated", { model: res.model, usage: res.usage });
  return { ops };
}

export const generateOpinions = onRequest(
  {
    region: "asia-northeast3",
    secrets: [ANTHROPIC_API_KEY, ACCESS_CODE],
    cors: ALLOWED_ORIGINS,
    timeoutSeconds: 180,
    memory: "256MiB",
    maxInstances: 5,
    concurrency: 20,
  },
  async (req, res) => {
    if (req.method !== "POST") { res.status(405).json({ message: "POST로 요청해 주세요." }); return; }
    const origin = req.get("origin");
    if (origin && !ALLOWED_ORIGINS.includes(origin)) { res.status(403).json({ message: "허용되지 않은 주소입니다." }); return; }

    const day = kstDay();
    const userKey = createHash("sha256").update(clientIp(req)).digest("hex").slice(0, 32);

    /* 입장 코드 확인 */
    try {
      if (await wrongCount(day, userKey) >= MAX_WRONG_CODES) {
        res.status(429).json({ message: "입장 코드를 너무 많이 틀렸습니다. 내일 다시 시도해 주세요.", reason: "access-locked" });
        return;
      }
    } catch (e) {
      logger.error("wrong-code check failed", e);
      res.status(500).json({ message: "서버에 문제가 생겼습니다. 잠시 후 다시 시도해 주세요." });
      return;
    }
    if (!codeMatches(req.body?.accessCode, ACCESS_CODE.value())) {
      await addWrong(day, userKey);
      res.status(401).json({ message: "입장 코드가 맞지 않습니다.", reason: "access" });
      return;
    }
    if (req.body?.action === "check") { res.json({ ok: true }); return; }

    const { value: input, error } = validateInput(req.body);
    if (error) { res.status(400).json({ message: error }); return; }
    let one = null;   // 의견 하나만 새로 만들기
    if (req.body?.action === "one") {
      const v = validateOne(req.body);
      if (v.error) { res.status(400).json({ message: v.error }); return; }
      one = v.value;
    }

    let remaining;
    try {
      remaining = await reserve(day, userKey);
    } catch (e) {
      logger.error("usage check failed", e);
      res.status(500).json({ message: "서버에 문제가 생겼습니다. 잠시 후 다시 시도해 주세요." });
      return;
    }
    if (remaining === null) {
      res.status(429).json({ message: "오늘 생성 횟수를 다 썼습니다. 내일 다시 쓰거나 아래 «직접 AI에 묻기» 방법을 이용해 주세요." });
      return;
    }

    try {
      const out = await callClaude(input, one);
      if (out.error) { await release(day, userKey); res.status(out.status).json({ message: out.error }); return; }
      res.json({ text: one ? out.opinion : JSON.stringify(out.ops), remaining });
    } catch (e) {
      await release(day, userKey);
      if (e instanceof Anthropic.RateLimitError || e instanceof Anthropic.InternalServerError) {
        logger.warn("anthropic busy", { status: e.status });
        res.status(503).json({ message: "AI 서버가 바쁩니다. 잠시 후 다시 시도해 주세요." });
      } else if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) {
        logger.error("anthropic auth", { status: e.status });
        res.status(500).json({ message: "서버 설정(API 키)에 문제가 있습니다. 관리자에게 알려 주세요." });
      } else if (e instanceof Anthropic.APIConnectionTimeoutError) {
        res.status(504).json({ message: "생성 시간이 너무 오래 걸렸습니다. 다시 시도해 주세요." });
      } else if (e instanceof Anthropic.APIError) {
        logger.error("anthropic error", { status: e.status, message: e.message });
        res.status(502).json({ message: "생성하지 못했습니다. 잠시 후 다시 시도해 주세요." });
      } else {
        logger.error("unexpected", e);
        res.status(500).json({ message: "서버에 문제가 생겼습니다. 잠시 후 다시 시도해 주세요." });
      }
    }
  },
);
