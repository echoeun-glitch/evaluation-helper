/* 평가 입력기 — AI 의견 생성 서버 (Firebase Functions 2세대)
 *
 * POST /generateOpinions  {subject, grade, name, activity, criteria}
 *   200 → {text: "<JSON 문자열>", remaining: <오늘 남은 횟수>}
 *   4xx/5xx → {message: "<사용자에게 보여 줄 안내>"}
 *
 * Claude API 키는 Secret Manager의 ANTHROPIC_API_KEY에 둡니다(코드·저장소에 넣지 않음).
 */
import { onRequest } from "firebase-functions/v2/https";
import { defineSecret, defineInt } from "firebase-functions/params";
import { logger } from "firebase-functions";
import { initializeApp } from "firebase-admin/app";
import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { createHash } from "node:crypto";
import Anthropic from "@anthropic-ai/sdk";
import {
  ALLOWED_ORIGINS, OPINION_SCHEMA, buildPrompt, validateInput, normalizeOpinions, clientIp, kstDay,
} from "./lib.js";

const ANTHROPIC_API_KEY = defineSecret("ANTHROPIC_API_KEY");
/* 하루 사용 한도 — 배포할 때 물어보며, functions/.env 에 적어 둘 수도 있습니다. */
const DAILY_LIMIT_PER_USER = defineInt("DAILY_LIMIT_PER_USER", { default: 30 });
const DAILY_LIMIT_TOTAL = defineInt("DAILY_LIMIT_TOTAL", { default: 300 });

const MODEL = "claude-opus-5-5";

initializeApp();
const db = getFirestore();

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

async function callClaude(input) {
  const client = new Anthropic({ apiKey: ANTHROPIC_API_KEY.value(), timeout: 100_000, maxRetries: 1 });
  const res = await client.beta.messages.create({
    model: MODEL,
    max_tokens: 16000,
    output_config: {
      effort: "low", // 짧은 문장 생성이라 낮은 effort로 빠르게
      format: { type: "json_schema", schema: OPINION_SCHEMA },
    },
    // 안전 분류기가 거절하면 서버가 알아서 다른 모델로 다시 시도
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    messages: [{ role: "user", content: buildPrompt(input) }],
  });
  if (res.stop_reason === "refusal") return { error: "AI가 이 요청에 답하지 않았습니다. 평가 기준 문구를 바꿔 다시 시도해 주세요.", status: 422 };
  if (res.stop_reason === "max_tokens") return { error: "답이 너무 길어 중간에 끊겼습니다. 다시 생성해 주세요.", status: 502 };
  const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  const ops = normalizeOpinions(text);
  if (!ops) return { error: "결과 형식을 읽지 못했습니다. 다시 생성해 주세요.", status: 502 };
  logger.info("generated", { model: res.model, usage: res.usage });
  return { ops };
}

export const generateOpinions = onRequest(
  {
    region: "asia-northeast3",
    secrets: [ANTHROPIC_API_KEY],
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

    const { value: input, error } = validateInput(req.body);
    if (error) { res.status(400).json({ message: error }); return; }

    const day = kstDay();
    const userKey = createHash("sha256").update(clientIp(req)).digest("hex").slice(0, 32);
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
      const out = await callClaude(input);
      if (out.error) { await release(day, userKey); res.status(out.status).json({ message: out.error }); return; }
      res.json({ text: JSON.stringify(out.ops), remaining });
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
