import assert from "node:assert/strict";
import test from "node:test";
import { bar, formatReset, formatStatus, formatStatusline } from "../dist/format.js";
import { parseCodexRateLimitHeaders } from "../dist/rate-limits.js";
import { normalizeWindow } from "../dist/usage.js";

test("bar renders left percentage", () => {
  assert.equal(bar(95, 20), "[███████████████████░]");
  assert.equal(bar(0, 5), "[░░░░░]");
  assert.equal(bar(100, 5), "[█████]");
});

test("formatReset uses local same-day time", () => {
  const now = new Date(2026, 4, 6, 12, 0, 0);
  const reset = new Date(2026, 4, 6, 18, 43, 0).getTime() / 1000;
  assert.equal(formatReset(reset, now), "resets 18:43");
});

test("formatReset includes date for later days", () => {
  const now = new Date(2026, 4, 6, 12, 0, 0);
  const reset = new Date(2026, 4, 12, 19, 18, 0).getTime() / 1000;
  assert.equal(formatReset(reset, now), "resets 19:18 on 12 May");
});

test("statusline includes compact left percentages and weekly reset", () => {
  const snapshot = {
    schemaVersion: 1,
    source: "api",
    fetchedAt: "2026-05-06T12:00:00.000Z",
    account: { plan: "pro" },
    defaultLimit: {
      id: "codex",
      name: "Codex",
      primary: { usedPercent: 5, leftPercent: 95, resetAt: new Date(2026, 4, 6, 18, 43, 0).getTime() / 1000 },
      secondary: { usedPercent: 3, leftPercent: 97, resetAt: new Date(2026, 4, 12, 6, 0, 0).getTime() / 1000 },
    },
    additionalLimits: [],
    credits: { balance: "553.4500" },
  };
  assert.equal(formatStatusline(snapshot, new Date(2026, 4, 6, 12, 0, 0)), "5h:95% 7d:97% ↺5d18h");
});

test("parses x-codex rate-limit headers", () => {
  const snapshot = parseCodexRateLimitHeaders({
    "x-codex-primary-used-percent": "5",
    "x-codex-primary-window-minutes": "300",
    "x-codex-secondary-used-percent": "3",
    "x-codex-bengalfox-primary-used-percent": "12",
    "x-codex-bengalfox-limit-name": "GPT-5.3-Codex-Spark",
    "x-codex-credits-has-credits": "true",
    "x-codex-credits-balance": "553.45",
  });
  assert.equal(snapshot.defaultLimit.primary.leftPercent, 95);
  assert.equal(snapshot.defaultLimit.secondary.leftPercent, 97);
  assert.equal(snapshot.additionalLimits[0].name, "GPT-5.3-Codex-Spark");
  assert.equal(snapshot.additionalLimits[0].primary.leftPercent, 88);
  assert.equal(snapshot.credits.balance, "553.45");
});

test("does not synthesize 100% left when a used-percent header is missing", () => {
  const snapshot = parseCodexRateLimitHeaders({
    "x-codex-primary-used-percent": "15",
    "x-codex-primary-window-minutes": "10080",
    "x-codex-secondary-window-minutes": "300",
    "x-codex-secondary-reset-at": "1785903166",
  });

  assert.equal(snapshot.defaultLimit.primary.leftPercent, 85);
  assert.equal(snapshot.defaultLimit.secondary, undefined);
});

test("drops inactive zero-duration windows", () => {
  const snapshot = parseCodexRateLimitHeaders({
    "x-codex-primary-used-percent": "15",
    "x-codex-primary-window-minutes": "10080",
    "x-codex-secondary-used-percent": "0",
    "x-codex-secondary-window-minutes": "0",
  });

  assert.equal(snapshot.defaultLimit.secondary, undefined);
  assert.equal(normalizeWindow({ used_percent: 0, limit_window_seconds: 0 }), undefined);
});

test("labels a primary seven-day window by duration", () => {
  const snapshot = {
    schemaVersion: 1,
    source: "api",
    fetchedAt: "2026-07-29T12:00:00.000Z",
    account: { plan: "pro" },
    defaultLimit: {
      id: "codex",
      name: "Codex",
      primary: { usedPercent: 15, leftPercent: 85, windowSeconds: 604800 },
    },
    additionalLimits: [],
  };

  assert.equal(formatStatusline(snapshot), "7d:85%");
  const status = formatStatus(snapshot, { box: false });
  assert.match(status, /7d limit:\s+.*85% left/);
  assert.doesNotMatch(status, /5h limit:/);
});
