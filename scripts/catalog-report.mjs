#!/usr/bin/env node
/**
 * Before/after report for an Orbital catalog bake (Actions + local).
 *
 *   node scripts/catalog-report.mjs --snapshot-before /tmp/before.json
 *   node scripts/catalog-report.mjs --before /tmp/before.json --out /tmp/report.md
 *
 * Prints markdown to stdout; optional --out PATH.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const FILES = [
  ["stations", "public/data/stations-fallback.json"],
  ["starlink", "public/data/starlink-fallback.json"],
  ["gps", "public/data/gps-ops-fallback.json"],
  ["oneweb", "public/data/oneweb-fallback.json"],
  ["iridium", "public/data/iridium-NEXT-fallback.json"],
  ["kuiper", "public/data/kuiper-fallback.json"],
  ["galileo", "public/data/galileo-fallback.json"],
  ["glo", "public/data/glo-ops-fallback.json"],
  ["beidou", "public/data/beidou-fallback.json"],
  ["qianfan", "public/data/qianfan-fallback.json"],
  ["planet", "public/data/planet-fallback.json"],
  ["intelsat", "public/data/intelsat-fallback.json"],
  ["spire", "public/data/spire-fallback.json"],
  ["globalstar", "public/data/globalstar-fallback.json"],
  ["weather", "public/data/weather-fallback.json"],
  ["debris", "public/data/debris-fallback.json"],
  ["rocket", "public/data/rocket-fallback.json"],
  ["other", "public/data/other-fallback.json"],
  ["unknown", "public/data/unknown-fallback.json"],
];

function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  if (i < 0) return fallback;
  return process.argv[i + 1] ?? fallback;
}

async function readJson(p) {
  return JSON.parse(await fs.readFile(p, "utf8"));
}

async function snapshot() {
  const out = {};
  for (const [id, rel] of FILES) {
    try {
      const j = await readJson(path.join(ROOT, rel));
      out[id] = {
        fetchedAt: j.fetchedAt || "",
        n: Array.isArray(j.satellites) ? j.satellites.length : 0,
      };
    } catch {
      out[id] = { fetchedAt: "", n: 0, missing: true };
    }
  }
  return out;
}

function fmtWhen(iso) {
  if (!iso) return "—";
  try {
    return new Date(iso).toISOString().replace("T", " ").replace(/\.\d+Z$/, "Z");
  } catch {
    return String(iso);
  }
}

function buildReport(before, after, meta = {}) {
  const lines = [];
  const ok = meta.ok !== false;
  lines.push(`# Orbital catalog bake · ${ok ? "SUCCESS" : "FAIL"}`);
  lines.push("");
  if (meta.note) {
    lines.push(meta.note);
    lines.push("");
  }
  const afterTimes = Object.values(after || {})
    .map((r) => r?.fetchedAt)
    .filter(Boolean);
  const fetchedAt = afterTimes[0] || "";
  lines.push(`- Before: ${fmtWhen(Object.values(before || {})[0]?.fetchedAt)}`);
  lines.push(`- After: ${fmtWhen(fetchedAt)}`);
  if (meta.runUrl) lines.push(`- Run: ${meta.runUrl}`);
  lines.push("");
  lines.push("| Group | Before | After |");
  lines.push("| --- | ---: | ---: |");
  for (const [id] of FILES) {
    const b = before?.[id]?.n ?? "—";
    const a = after?.[id]?.n ?? "—";
    const mark = b !== a ? " ←" : "";
    lines.push(`| ${id} | ${b} | ${a}${mark} |`);
  }
  lines.push("");
  return lines.join("\n");
}

async function main() {
  const snapPath = arg("--snapshot-before");
  if (snapPath) {
    const data = await snapshot();
    await fs.writeFile(snapPath, JSON.stringify(data, null, 2));
    return;
  }

  const beforePath = arg("--before");
  const outPath = arg("--out");
  const before = beforePath ? await readJson(beforePath) : {};
  const after = await snapshot();
  const report = buildReport(before, after, {
    ok: arg("--ok") !== "false",
    note: arg("--note") || "",
    runUrl: process.env.GITHUB_RUN_URL || "",
  });
  if (outPath) await fs.writeFile(outPath, report);
  process.stdout.write(report.endsWith("\n") ? report : `${report}\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
