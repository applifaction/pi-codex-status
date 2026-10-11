import type { CodexUsageSnapshot, LimitWindow, RateLimit } from "./types.js";

const USAGE_URL = "https://chatgpt.com/codex/settings/usage";

export interface FormatOptions {
  box?: boolean;
  width?: number;
  now?: Date;
}

function pct(value: number | undefined): string {
  if (value === undefined || !Number.isFinite(value)) return "?%";
  return Number.isInteger(value) ? `${value}%` : `${value.toFixed(1)}%`;
}

function padLabel(label: string, width = 28): string {
  return `${label}:`.padEnd(width, " ");
}

function formatTime(date: Date): string {
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function sameLocalDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function formatReset(resetAt: number | undefined, now = new Date()): string {
  if (!resetAt) return "";
  const reset = new Date(resetAt * 1000);
  if (!Number.isFinite(reset.getTime())) return "";
  const time = formatTime(reset);
  if (sameLocalDay(reset, now)) return `resets ${time}`;
  const date = `${reset.getDate()} ${MONTHS[reset.getMonth()]}`;
  if (reset.getFullYear() === now.getFullYear()) return `resets ${time} on ${date}`;
  return `resets ${time} on ${date} ${reset.getFullYear()}`;
}

export function formatDuration(seconds: number | undefined): string {
  if (seconds === undefined || !Number.isFinite(seconds) || seconds <= 0) return "";
  const rounded = Math.round(seconds);
  const days = Math.floor(rounded / 86_400);
  const hours = Math.floor((rounded % 86_400) / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  if (days > 0) return `${days}d${hours ? `${hours}h` : ""}`;
  if (hours > 0) return `${hours}h${minutes ? `${minutes}m` : ""}`;
  return `${minutes || 1}m`;
}

type LabeledWindow = {
  label: string;
  window: LimitWindow;
};

function labeledWindows(limit: RateLimit | undefined): LabeledWindow[] {
  if (!limit) return [];
  const slots: Array<{ fallbackLabel: string; window: LimitWindow | undefined }> = [
    { fallbackLabel: "5h", window: limit.primary },
    { fallbackLabel: "7d", window: limit.secondary },
  ];

  return slots
    .filter((slot): slot is { fallbackLabel: string; window: LimitWindow } =>
      !!slot.window && (slot.window.windowSeconds === undefined || slot.window.windowSeconds > 0),
    )
    .map(({ fallbackLabel, window }) => ({
      label: formatDuration(window.windowSeconds) || fallbackLabel,
      window,
    }));
}

export function bar(leftPercent: number | undefined, width = 20): string {
  const left = Math.max(0, Math.min(100, leftPercent ?? 0));
  const filled = Math.max(0, Math.min(width, Math.round((left / 100) * width)));
  return `[${"█".repeat(filled)}${"░".repeat(width - filled)}]`;
}

function formatWindow(label: string, window: LimitWindow | undefined, now: Date): string | undefined {
  if (!window) return undefined;
  const reset = formatReset(window.resetAt, now) || (formatDuration(window.resetAfterSeconds) ? `resets in ${formatDuration(window.resetAfterSeconds)}` : "");
  const suffix = reset ? ` (${reset})` : "";
  return `${padLabel(label)}${bar(window.leftPercent)} ${pct(window.leftPercent)} left${suffix}`;
}

function formatCredits(snapshot: CodexUsageSnapshot): string | undefined {
  const credits = snapshot.credits;
  if (!credits) return undefined;
  if (credits.unlimited) return `${padLabel("Credits")}unlimited`;
  if (credits.balance !== undefined) {
    const value = Number(credits.balance);
    const shown = Number.isFinite(value) ? Math.floor(value).toLocaleString() : credits.balance;
    return `${padLabel("Credits")}${shown} credits`;
  }
  if (credits.hasCredits) return `${padLabel("Credits")}available`;
  return undefined;
}

function addLimitLines(lines: string[], limit: RateLimit, now: Date, nested = false): void {
  if (nested) lines.push(`${limit.name} limit:`);
  const windows = labeledWindows(limit);
  for (const { label, window } of windows) {
    const line = formatWindow(`${nested ? "  " : ""}${label} limit`, window, now);
    if (line) lines.push(line);
  }
  if (windows.length === 0) lines.push(`${padLabel(nested ? `  ${limit.name}` : limit.name)}no window data`);
}

function contentLines(snapshot: CodexUsageSnapshot, options: FormatOptions = {}): string[] {
  const now = options.now ?? new Date();
  const lines: string[] = [];
  lines.push(">_ Codex usage");
  lines.push("");
  lines.push(`Visit ${USAGE_URL} for up-to-date`);
  lines.push("information on rate limits and credits");
  lines.push("");

  const accountBits: string[] = [];
  if (snapshot.account.email) accountBits.push(snapshot.account.email);
  if (snapshot.account.plan) accountBits.push(`(${snapshot.account.plan[0]?.toUpperCase()}${snapshot.account.plan.slice(1)})`);
  if (accountBits.length > 0) lines.push(`${padLabel("Account")}${accountBits.join(" ")}`);
  if (snapshot.fetchedAt) lines.push(`${padLabel("Updated")}${new Date(snapshot.fetchedAt).toLocaleString()}`);
  lines.push("");

  if (snapshot.defaultLimit) addLimitLines(lines, snapshot.defaultLimit, now);
  const credits = formatCredits(snapshot);
  if (credits) lines.push(credits);

  for (const limit of snapshot.additionalLimits) {
    lines.push("");
    addLimitLines(lines, limit, now, true);
  }

  return lines;
}

function makeBox(lines: string[], requestedWidth?: number): string {
  const contentWidth = Math.max(...lines.map((line) => line.length), 1);
  const width = Math.max(contentWidth, requestedWidth ?? 0);
  const top = `╭${"─".repeat(width + 2)}╮`;
  const bottom = `╰${"─".repeat(width + 2)}╯`;
  const body = lines.map((line) => `│ ${line.padEnd(width, " ")} │`);
  return [top, ...body, bottom].join("\n");
}

export function formatStatus(snapshot: CodexUsageSnapshot, options: FormatOptions = {}): string {
  const lines = contentLines(snapshot, options);
  return options.box === false ? lines.join("\n") : makeBox(lines, options.width);
}

function resetSeconds(window: LimitWindow | undefined, now: Date): number | undefined {
  if (!window) return undefined;
  if (window.resetAfterSeconds !== undefined) return window.resetAfterSeconds;
  if (window.resetAt !== undefined) return Math.max(0, Math.round(window.resetAt - now.getTime() / 1000));
  return undefined;
}

export function formatStatusline(snapshot: CodexUsageSnapshot, now = new Date()): string {
  const parts: string[] = [];
  const windows = labeledWindows(snapshot.defaultLimit);
  for (const { label, window } of windows) {
    parts.push(`${label}:${pct(window.leftPercent)}`);
  }

  const resetWindow = windows.reduce<LimitWindow | undefined>((selected, candidate) => {
    if (!selected) return candidate.window;
    return (candidate.window.windowSeconds ?? -1) >= (selected.windowSeconds ?? -1)
      ? candidate.window
      : selected;
  }, undefined);
  const reset = formatDuration(resetSeconds(resetWindow, now));
  if (reset) parts.push(`↺${reset}`);
  return parts.length > 0 ? parts.join(" ") : "Codex usage unavailable";
}

export function formatJson(snapshot: CodexUsageSnapshot): string {
  return JSON.stringify(snapshot, null, 2);
}
