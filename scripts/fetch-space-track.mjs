#!/usr/bin/env node
/**
 * Scratch bake — download Space-Track GP once, sort it into the nine
 * Orbital View groups, and compare counts with the CelesTrak files.
 *
 * Does not write public/data. The preview keeps reading the live catalog.
 *
 *   npm run fetch:space-track
 *
 * A raw download newer than 50 minutes is reused, so filter tweaks do not
 * hit Space-Track again. Pass --refresh to force one new download.
 *
 * Login: .env.space-track (gitignored)
 *   SPACE_TRACK_IDENTITY=...
 *   SPACE_TRACK_PASSWORD=...
 *
 * Data: USSPACECOM via Space-Track.org
 */
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SCRATCH = join(ROOT, "scratch", "space-track");
const RAW_PATH = join(SCRATCH, "gp.json");
const GROUP_DIR = join(SCRATCH, "groups");
const REPORT_PATH = join(SCRATCH, "report.txt");
const ENV_PATH = join(ROOT, ".env.space-track");
const LIVE_DIR = join(ROOT, "public", "data");
const LOGIN_URL = "https://www.space-track.org/ajaxauth/login";
const GP_URL =
  "https://www.space-track.org/basicspacedata/query/class/gp/decay_date/null-val/epoch/%3Enow-10/orderby/norad_cat_id/format/json/emptyresult/show";
const TIMEOUT_MS = 180_000;
const REUSE_MS = 50 * 60 * 1000;

const OMM_KEYS = [
  "OBJECT_NAME",
  "OBJECT_ID",
  "EPOCH",
  "MEAN_MOTION",
  "ECCENTRICITY",
  "INCLINATION",
  "RA_OF_ASC_NODE",
  "ARG_OF_PERICENTER",
  "MEAN_ANOMALY",
  "EPHEMERIS_TYPE",
  "CLASSIFICATION_TYPE",
  "NORAD_CAT_ID",
  "ELEMENT_SET_NO",
  "REV_AT_EPOCH",
  "BSTAR",
  "MEAN_MOTION_DOT",
  "MEAN_MOTION_DDOT",
];

/** Same ids and file stems as src/lib/constellations.ts and fetch-sats.mjs. */
const GROUPS = [
  {
    id: "stations",
    group: "stations",
    test: (name) =>
      name.startsWith("ISS") ||
      name.startsWith("CSS") ||
      name === "POISK" ||
      name.includes("NAUKA") ||
      name.startsWith("TIANZHOU") ||
      name.startsWith("SHENZHOU") ||
      name.startsWith("CREW DRAGON") ||
      name.startsWith("CYGNUS") ||
      name.startsWith("PROGRESS-MS") ||
      name.startsWith("PROGRESS MS") ||
      name.startsWith("SOYUZ-MS") ||
      name.startsWith("SOYUZ MS"),
  },
  { id: "starlink", group: "starlink", test: (name) => name.includes("STARLINK") },
  { id: "gps", group: "gps-ops", test: (name) => name.startsWith("GPS ") },
  { id: "oneweb", group: "oneweb", test: (name) => name.includes("ONEWEB") },
  { id: "iridium", group: "iridium-NEXT", test: (name) => /^IRIDIUM \d+$/.test(name) },
  { id: "kuiper", group: "kuiper", test: (name) => name.includes("KUIPER") },
  { id: "galileo", group: "galileo", test: (name) => name.includes("GALILEO") },
  {
    id: "glo",
    group: "glo-ops",
    test: (name) => /^COSMOS \d+/.test(name) && /\(7\d{2}K?\)/.test(name),
  },
  { id: "beidou", group: "beidou", test: (name) => name.includes("BEIDOU") },
];

function assertScratch(path) {
  if (!path.startsWith(SCRATCH)) {
    throw new Error(`Refusing to write outside the scratch folder: ${path}`);
  }
}

function cacheKey(group) {
  return group.replace(/[^a-z0-9-]/gi, "_");
}

function parseEnv(text) {
  const values = {};
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    values[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
  }
  return values;
}

async function loadCredentials() {
  let text;
  try {
    text = await readFile(ENV_PATH, "utf8");
  } catch {
    throw new Error(
      "Missing .env.space-track. Add SPACE_TRACK_IDENTITY and SPACE_TRACK_PASSWORD there.",
    );
  }
  const env = parseEnv(text);
  const identity = env.SPACE_TRACK_IDENTITY || "";
  const password = env.SPACE_TRACK_PASSWORD || "";
  if (!identity || !password || identity.startsWith("your-")) {
    throw new Error(
      "Fill in SPACE_TRACK_IDENTITY and SPACE_TRACK_PASSWORD in .env.space-track, then run this again.",
    );
  }
  return { identity, password };
}

function cookieHeader(response) {
  const parts =
    typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  if (parts.length === 0) {
    const single = response.headers.get("set-cookie");
    if (single) parts.push(single);
  }
  return parts.map((part) => part.split(";")[0]).filter(Boolean).join("; ");
}

async function login(identity, password) {
  const response = await fetch(LOGIN_URL, {
    method: "POST",
    redirect: "manual",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ identity, password }),
  });
  const cookie = cookieHeader(response);
  const body = await response.text();
  if (!cookie || /login failed|authentication failed|invalid credentials/i.test(body)) {
    throw new Error("Space-Track login failed. Check the identity and password in .env.space-track.");
  }
  return cookie;
}

async function downloadGp(cookie) {
  const response = await fetch(GP_URL, {
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      Cookie: cookie,
      Accept: "application/json",
      "User-Agent": "OrbitalView/1.0",
    },
  });
  if (!response.ok) {
    throw new Error(`GP download → HTTP ${response.status}`);
  }
  const records = await response.json();
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error("GP download returned no records.");
  }
  return records;
}

function value(record, key) {
  if (record[key] != null && record[key] !== "") return record[key];
  const lower = record[key.toLowerCase()];
  return lower == null || lower === "" ? undefined : lower;
}

function normalizeOmm(record) {
  const omm = {};
  for (const key of OMM_KEYS) {
    const field = value(record, key);
    if (field !== undefined) omm[key] = field;
  }
  return omm;
}

function objectName(record) {
  return String(value(record, "OBJECT_NAME") ?? "").trim().toUpperCase();
}

function isDebrisOrRocket(name) {
  return name.includes(" DEB") || name.includes("R/B") || name.includes(" DEBRIS");
}

function assignGroups(records) {
  const buckets = new Map(GROUPS.map((group) => [group.id, []]));
  let skipped = 0;

  for (const record of records) {
    const name = objectName(record);
    if (!name || isDebrisOrRocket(name)) {
      skipped += 1;
      continue;
    }
    const group = GROUPS.find((candidate) => candidate.test(name));
    if (!group) continue;
    const omm = normalizeOmm(record);
    if (!omm.NORAD_CAT_ID || !omm.OBJECT_NAME) continue;
    buckets.get(group.id).push({
      id: String(omm.NORAD_CAT_ID),
      name: omm.OBJECT_NAME,
      constellationId: group.id,
      omm,
    });
  }

  return { buckets, skipped };
}

async function liveIds(group) {
  try {
    const raw = await readFile(join(LIVE_DIR, `${cacheKey(group)}-fallback.json`), "utf8");
    const payload = JSON.parse(raw);
    return new Set((payload.satellites || []).map((satellite) => String(satellite.id)));
  } catch {
    return new Set();
  }
}

async function rawIsFresh() {
  try {
    const info = await stat(RAW_PATH);
    return Date.now() - info.mtimeMs < REUSE_MS;
  } catch {
    return false;
  }
}

async function main() {
  const refresh = process.argv.includes("--refresh");
  await mkdir(GROUP_DIR, { recursive: true });

  let records;
  let source;
  if (!refresh && (await rawIsFresh())) {
    records = JSON.parse(await readFile(RAW_PATH, "utf8"));
    source = "reused scratch/space-track/gp.json";
    console.log(source);
  } else {
    const { identity, password } = await loadCredentials();
    process.stdout.write("Signing in… ");
    const cookie = await login(identity, password);
    console.log("ok");
    process.stdout.write("Downloading the public catalog… ");
    records = await downloadGp(cookie);
    console.log(`${records.length} records`);
    assertScratch(RAW_PATH);
    await writeFile(RAW_PATH, JSON.stringify(records));
    source = "downloaded just now";
  }

  if (!Array.isArray(records) || records.length === 0) {
    throw new Error("Scratch catalog is empty.");
  }

  const fetchedAt = new Date().toISOString();
  const { buckets, skipped } = assignGroups(records);
  const lines = [
    "Orbital View scratch bake",
    "Source: USSPACECOM via Space-Track.org",
    `Catalog: ${source}`,
    `Records: ${records.length}`,
    `Debris and rocket bodies skipped: ${skipped}`,
    `Sorted at: ${fetchedAt}`,
    "",
    "The preview still reads public/data. These files are scratch only.",
    "",
    "Group         CelesTrak  Space-Track  In both  Only CT  Only ST",
  ];

  for (const group of GROUPS) {
    const satellites = buckets.get(group.id);
    const path = join(GROUP_DIR, `${cacheKey(group.group)}-fallback.json`);
    assertScratch(path);
    await writeFile(path, JSON.stringify({ fetchedAt, satellites }));

    const current = await liveIds(group.group);
    const next = new Set(satellites.map((satellite) => satellite.id));
    let both = 0;
    for (const id of next) if (current.has(id)) both += 1;
    const onlyCt = current.size - both;
    const onlySt = next.size - both;
    lines.push(
      `${group.id.padEnd(12)} ${String(current.size).padStart(10)} ${String(next.size).padStart(13)} ${String(both).padStart(8)} ${String(onlyCt).padStart(8)} ${String(onlySt).padStart(8)}`,
    );
  }

  lines.push("");
  lines.push("Only CT means the current globe has an object this sort missed.");
  lines.push("Only ST means the sort included an object the current globe does not draw.");
  const report = `${lines.join("\n")}\n`;
  assertScratch(REPORT_PATH);
  await writeFile(REPORT_PATH, report);
  console.log(`\n${report}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
