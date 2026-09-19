import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyResult,
  liveMaxAgeSeconds,
  normalizeObservation,
  parseObservationTime,
} from "./normalize.ts";

const NOW = Date.parse("2026-09-19T17:00:00Z");
const MAX = 3600 * 1000;
const obs = (result: number, phenomenonTime: string) => ({ result, phenomenonTime });

test("classifyResult maps red/green families and rejects the rest", () => {
  assert.equal(classifyResult(1), "r");
  assert.equal(classifyResult(4), "r"); // red-amber
  assert.equal(classifyResult(3), "g");
  assert.equal(classifyResult(6), "g"); // green flashing
  for (const other of [0, 2, 5, 9, undefined, null, "1"]) {
    assert.equal(classifyResult(other), null, String(other));
  }
});

test("parseObservationTime rejects empty, garbage, epoch 0", () => {
  assert.equal(parseObservationTime(""), null);
  assert.equal(parseObservationTime(undefined), null);
  assert.equal(parseObservationTime("not a date"), null);
  assert.equal(parseObservationTime("1970-01-01T00:00:00.000Z"), null);
  assert.equal(parseObservationTime("2026-09-19T17:00:00Z"), NOW);
});

test("no observation / epoch-0 / unparseable -> offline", () => {
  assert.deepEqual(normalizeObservation(undefined, NOW, MAX), { kind: "offline" });
  assert.deepEqual(normalizeObservation(obs(1, "1970-01-01T00:00:00.000Z"), NOW, MAX), { kind: "offline" });
  assert.deepEqual(normalizeObservation(obs(1, "garbage"), NOW, MAX), { kind: "offline" });
});

test("non red/green states are 'other', even when fresh", () => {
  assert.deepEqual(normalizeObservation(obs(0, "2026-09-19T16:59:50Z"), NOW, MAX), { kind: "other" });
  assert.deepEqual(normalizeObservation(obs(2, "2026-09-19T16:59:50Z"), NOW, MAX), { kind: "other" });
});

test("future timestamps are clamped to now, not dropped", () => {
  const r = normalizeObservation(obs(4, "2026-09-19T21:59:59Z"), NOW, MAX);
  assert.deepEqual(r, { kind: "live", state: "r", updatedAt: NOW / 1000 });
});

test("age cut-off applies to the last state change, boundary inclusive", () => {
  const fresh = normalizeObservation(obs(1, "2026-09-19T16:00:00Z"), NOW, MAX); // exactly 1 h
  assert.equal(fresh.kind, "live");
  const stale = normalizeObservation(obs(1, "2026-09-19T15:59:59Z"), NOW, MAX);
  assert.equal(stale.kind, "offline");
});

test("a long-standing red that is still inside the window stays live", () => {
  const r = normalizeObservation(obs(1, "2026-09-19T16:20:00Z"), NOW, MAX); // 40 min on red
  assert.deepEqual(r, { kind: "live", state: "r", updatedAt: Date.parse("2026-09-19T16:20:00Z") / 1000 });
});

test("liveMaxAgeSeconds: default, override, and rejection of nonsense", () => {
  assert.equal(liveMaxAgeSeconds(undefined), 3600);
  assert.equal(liveMaxAgeSeconds("900"), 900);
  assert.equal(liveMaxAgeSeconds("abc"), 3600);
  assert.equal(liveMaxAgeSeconds("5"), 3600); // below the 30 s floor
  assert.equal(liveMaxAgeSeconds(""), 3600);
});
