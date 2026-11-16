import { test } from "node:test";
import assert from "node:assert/strict";
import { validateInput, buildPrompt, normalizeOpinions, clientIp, kstDay, OPINION_SCHEMA } from "./lib.js";

test("validateInput", () => {
  assert.ok(validateInput(null).error);
  assert.equal(validateInput({ subject: "체육", criteria: "  " }).error, "평가 기준을 먼저 입력해 주세요.");
  assert.ok(validateInput({ subject: "체육", criteria: 3 }).error);
  assert.ok(validateInput({ subject: "체육", criteria: "가".repeat(1501) }).error);
  const { value } = validateInput({ subject: "체육", grade: "5학년", criteria: " 줄넘기를\n 할 수 있다 " });
  assert.deepEqual(value, { subject: "체육", grade: "5학년", name: "", activity: "", criteria: "줄넘기를 할 수 있다" });
});
test("buildPrompt", () => {
  const p = buildPrompt({ subject: "체육", grade: "5학년", name: "표현", activity: "", criteria: "리듬 표현" });
  assert.match(p, /초등학교 5학년 체육/); assert.match(p, /주요 활동: \(없음\)/); assert.match(p, /평가 기준: 리듬 표현/);
});
test("schema", () => { assert.deepEqual(OPINION_SCHEMA.required, ["최상","상","중","하"]); assert.equal(OPINION_SCHEMA.additionalProperties, false); });
test("normalizeOpinions", () => {
  assert.equal(normalizeOpinions("not json"), null);
  assert.equal(normalizeOpinions('{"최상":[]}'), null);
  const o = normalizeOpinions(JSON.stringify({ 최상: Array(10).fill(" a  b "), 상: ["x"], 중: [], 하: [""] }));
  assert.equal(o.최상.length, 8); assert.equal(o.최상[0], "a b"); assert.deepEqual(o.하, []);
});
test("clientIp / kstDay", () => {
  assert.equal(clientIp({ headers: { "x-forwarded-for": "1.2.3.4, 10.0.0.1" } }), "1.2.3.4");
  assert.equal(clientIp({ headers: {}, ip: "5.6.7.8" }), "5.6.7.8");
  assert.equal(kstDay(new Date("2026-11-08T15:30:00Z")), "2026-11-09");
});
