#!/usr/bin/env node
/**
 * Scratch bake — download Space-Track GP once, sort it into the nine
 * Orbital View groups, and compare counts with the CelesTrak files.
 *
 * Does not write public/data. The preview keeps reading the live catalog.
 *
 *   npm run fetch:space-track
 *
 * A raw element-set download newer than 50 minutes is reused, so filter
 * tweaks do not hit Space-Track again. Pass --refresh to force one new
 * element-set download. The satellite catalog is reused for 20 hours.
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
const SATCAT_PATH = join(SCRATCH, "satcat.json");
const WORKING_PATH = join(SCRATCH, "working.json");
const GPS_STATUS_URL = "https://www.navcen.uscg.gov/gps-constellation";
const GLONASS_STATUS_URL = "https://glonass-iac.ru/upload/monitoring/cus";
const WEATHER_URL = "https://celestrak.org/NORAD/elements/gp.php?GROUP=weather&FORMAT=json";
const GROUP_DIR = join(SCRATCH, "groups");
const REPORT_PATH = join(SCRATCH, "report.txt");
const ENV_PATH = join(ROOT, ".env.space-track");
const LIVE_DIR = join(ROOT, "public", "data");
const LOGIN_URL = "https://www.space-track.org/ajaxauth/login";
const GP_URL =
  "https://www.space-track.org/basicspacedata/query/class/gp/decay_date/null-val/epoch/%3Enow-30/orderby/norad_cat_id/format/json/emptyresult/show";
const SATCAT_URL =
  "https://www.space-track.org/basicspacedata/query/class/satcat/DECAY/null-val/format/json/emptyresult/show";
const TIMEOUT_MS = 180_000;
const GP_REUSE_MS = 50 * 60 * 1000;
const SATCAT_REUSE_MS = 20 * 60 * 60 * 1000;

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

function meanMotion(record) {
  const n = Number(value(record, "MEAN_MOTION"));
  return Number.isFinite(n) ? n : null;
}

function catalogNumber(record) {
  const n = Number(value(record, "NORAD_CAT_ID"));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Same ids and file stems as src/lib/constellations.ts.
 * GPS, GLONASS, and weather use outside lists. Debris, rocket bodies, and
 * unknown come from the Space-Track catalog type.
 */
const workingLists = {
  gpsSvns: null,
  glonassCosmos: null,
  weatherIds: null,
  note: "working lists not loaded",
};

const catalogTypes = new Map();

const GROUPS = [
  {
    id: "stations",
    group: "stations",
    test: (name) =>
      name.startsWith("ISS") ||
      name.startsWith("CSS ") ||
      name.startsWith("CSS(") ||
      name === "POISK" ||
      name.includes("NAUKA") ||
      name.startsWith("TIANZHOU") ||
      name.startsWith("SHENZHOU") ||
      /^SZ-\d/.test(name) ||
      name.startsWith("DRAGON ") ||
      name.startsWith("CYGNUS") ||
      name.startsWith("PROGRESS") ||
      name.startsWith("SOYUZ"),
  },
  { id: "starlink", group: "starlink", test: (name) => name.includes("STARLINK") },
  {
    id: "gps",
    group: "gps-ops",
    test: (name, record) => {
      const svn = navstarNumber(name);
      if (workingLists.gpsSvns) return svn != null && workingLists.gpsSvns.has(svn);
      const motion = meanMotion(record);
      return name.startsWith("NAVSTAR ") && motion != null && motion >= 2.004 && motion <= 2.008;
    },
  },
  { id: "oneweb", group: "oneweb", test: (name) => name.includes("ONEWEB") },
  {
    id: "iridium",
    group: "iridium-NEXT",
    test: (name) => {
      const match = /^IRIDIUM (\d+)$/.exec(name);
      if (!match) return false;
      const number = Number(match[1]);
      return number >= 100 && number <= 199;
    },
  },
  { id: "kuiper", group: "kuiper", test: (name) => name.includes("KUIPER") },
  { id: "galileo", group: "galileo", test: (name) => name.includes("GALILEO") },
  {
    id: "glo",
    group: "glo-ops",
    test: (name, record) => {
      const cosmos = cosmosNumber(name);
      if (workingLists.glonassCosmos) return cosmos != null && workingLists.glonassCosmos.has(cosmos);
      return name.includes("GLONASS") && catalogNumber(record) >= 30000;
    },
  },
  {
    id: "beidou",
    group: "beidou",
    test: (name, record) =>
      (name.includes("BEIDOU") || name.startsWith("BD-") || name.startsWith("BD ")) &&
      catalogNumber(record) >= 37210,
  },
  {
    id: "qianfan",
    group: "qianfan",
    test: (name) => name.includes("QIANFAN") || name.includes("THOUSAND SAILS") || name.startsWith("G60"),
  },
  {
    id: "planet",
    group: "planet",
    test: (name) => name.startsWith("FLOCK") || name.includes("SKYSAT") || name.startsWith("DOVE"),
  },
  { id: "intelsat", group: "intelsat", test: (name) => name.includes("INTELSAT") },
  { id: "spire", group: "spire", test: (name) => name.includes("LEMUR") || name.startsWith("SPIRE") },
  { id: "globalstar", group: "globalstar", test: (name) => name.includes("GLOBALSTAR") },
  { id: "weather", group: "weather", test: () => false },
  { id: "debris", group: "debris", test: () => false },
  { id: "rocket", group: "rocket", test: () => false },
  { id: "unknown", group: "unknown", test: () => false },
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
  let env = {};
  try {
    env = parseEnv(await readFile(ENV_PATH, "utf8"));
  } catch {
    env = {};
  }
  const identity = process.env.SPACE_TRACK_IDENTITY || env.SPACE_TRACK_IDENTITY || "";
  const password = process.env.SPACE_TRACK_PASSWORD || env.SPACE_TRACK_PASSWORD || "";
  if (!identity || !password || identity.startsWith("your-")) {
    throw new Error(
      "Set SPACE_TRACK_IDENTITY and SPACE_TRACK_PASSWORD in .env.space-track or the environment.",
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

async function downloadJson(cookie, url, label) {
  const response = await fetch(url, {
    cache: "no-store",
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: {
      Cookie: cookie,
      Accept: "application/json",
      "User-Agent": "OrbitalView/1.0",
    },
  });
  if (!response.ok) {
    throw new Error(`${label} download → HTTP ${response.status}`);
  }
  const records = await response.json();
  if (!Array.isArray(records) || records.length === 0) {
    throw new Error(`${label} download returned no records.`);
  }
  return records;
}

async function downloadGp(cookie) {
  return downloadJson(cookie, GP_URL, "GP");
}

async function downloadSatcat(cookie) {
  return downloadJson(cookie, SATCAT_URL, "SATCAT");
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

function navstarNumber(name) {
  const match = /^NAVSTAR (\d+)\b/.exec(name);
  return match ? Number(match[1]) : null;
}

function cosmosNumber(name) {
  const match = /^COSMOS (\d+)\b/.exec(name);
  return match ? Number(match[1]) : null;
}

function stripTags(value) {
  return value.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

function parseGpsSvns(html) {
  const svns = new Set();
  for (const row of html.split(/<tr\b/i).slice(1)) {
    const cells = [...row.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((match) =>
      stripTags(match[1]),
    );
    if (cells.length < 4) continue;
    const svn = Number(cells[2]);
    const prn = Number(cells[3]);
    if (Number.isInteger(svn) && svn > 0 && Number.isInteger(prn) && prn > 0 && prn < 100) {
      svns.add(svn);
    }
  }
  return svns;
}

function parseGlonassCosmos(text) {
  const cosmos = new Set();
  for (const line of text.split("\n")) {
    const match = /^\|\s*\d+\s*\|\s*(\d+)\s*\|[^|]*\|[^|]*\|[^|]*\|[^|]*\|\s*([A-Za-z]+)\s*\|/.exec(
      line,
    );
    if (!match || match[2].toLowerCase() !== "operating") continue;
    cosmos.add(Number(match[1]));
  }
  return cosmos;
}

function moscowFileStamp(date) {
  const moscow = new Date(date.getTime() + 3 * 60 * 60 * 1000);
  const month = String(moscow.getUTCMonth() + 1).padStart(2, "0");
  const day = String(moscow.getUTCDate()).padStart(2, "0");
  return { year: moscow.getUTCFullYear(), mmdd: `${month}${day}` };
}

async function fetchText(url) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(30_000),
    headers: { "User-Agent": "OrbitalView/1.0", Accept: "text/plain,text/html" },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.text();
}

async function readWorkingFile() {
  try {
    const saved = JSON.parse(await readFile(WORKING_PATH, "utf8"));
    const gpsSvns = new Set(saved.gpsSvns || []);
    const glonassCosmos = new Set(saved.glonassCosmos || []);
    if (gpsSvns.size < 24 || glonassCosmos.size < 18) return null;
    return { gpsSvns, glonassCosmos, note: "reused the saved working lists" };
  } catch {
    return null;
  }
}

async function loadWorkingLists() {
  const saved = await readWorkingFile();
  try {
    const gpsHtml = await fetchText(GPS_STATUS_URL);
    const gpsSvns = parseGpsSvns(gpsHtml);
    if (gpsSvns.size < 24) throw new Error(`GPS working list has ${gpsSvns.size} satellites`);

    let glonassText = null;
    const errors = [];
    for (const offset of [0, 1]) {
      const stamp = moscowFileStamp(new Date(Date.now() - offset * 24 * 60 * 60 * 1000));
      const url = `${GLONASS_STATUS_URL}/${stamp.year}/${stamp.mmdd}en.txt`;
      try {
        glonassText = await fetchText(url);
        break;
      } catch (error) {
        errors.push(`${stamp.mmdd}: ${error.message}`);
      }
    }
    if (!glonassText) throw new Error(errors.join("; "));
    const glonassCosmos = parseGlonassCosmos(glonassText);
    if (glonassCosmos.size < 18) {
      throw new Error(`GLONASS working list has ${glonassCosmos.size} satellites`);
    }

    const weatherIds = await loadWeatherIds();
    const payload = {
      fetchedAt: new Date().toISOString(),
      gpsSvns: [...gpsSvns].sort((a, b) => a - b),
      glonassCosmos: [...glonassCosmos].sort((a, b) => a - b),
      weatherIds: [...weatherIds].sort(),
    };
    assertScratch(WORKING_PATH);
    await writeFile(WORKING_PATH, JSON.stringify(payload, null, 2));
    workingLists.gpsSvns = gpsSvns;
    workingLists.glonassCosmos = glonassCosmos;
    workingLists.weatherIds = weatherIds;
    workingLists.note = `USCG GPS ${gpsSvns.size}, GLONASS IAC ${glonassCosmos.size}, CelesTrak weather ${weatherIds.size}`;
    console.log(`Working lists: ${workingLists.note}`);
  } catch (error) {
    if (!saved) throw error;
    workingLists.gpsSvns = saved.gpsSvns;
    workingLists.glonassCosmos = saved.glonassCosmos;
    workingLists.weatherIds = saved.weatherIds;
    workingLists.note = `${saved.note} (${error.message})`;
    console.warn(`Working list download failed. ${workingLists.note}`);
  }
}

function isDebrisOrRocket(name) {
  return name.includes(" DEB") || name.includes("R/B") || name.includes(" DEBRIS");
}

function recordId(record) {
  const id = value(record, "NORAD_CAT_ID");
  return id == null ? "" : String(id);
}

function catalogBucket(name, id) {
  const type = catalogTypes.get(id) || "";
  if (type === "DEBRIS" || name.includes(" DEB") || name.includes(" DEBRIS")) return "debris";
  if (type === "ROCKET BODY" || name.includes("R/B")) return "rocket";
  if (type === "UNKNOWN") return "unknown";
  return null;
}

async function loadCatalogTypes() {
  const rows = JSON.parse(await readFile(SATCAT_PATH, "utf8"));
  catalogTypes.clear();
  for (const row of rows) {
    const id = String(row.NORAD_CAT_ID ?? row.norad_cat_id ?? "");
    const type = String(row.OBJECT_TYPE ?? row.object_type ?? "").toUpperCase();
    if (id) catalogTypes.set(id, type);
  }
}

async function loadWeatherIds() {
  const response = await fetch(WEATHER_URL, {
    signal: AbortSignal.timeout(60_000),
    headers: { "User-Agent": "OrbitalView/1.0", Accept: "application/json" },
  });
  if (!response.ok) throw new Error(`weather list HTTP ${response.status}`);
  const rows = await response.json();
  const ids = new Set();
  for (const row of rows) {
    const id = row.NORAD_CAT_ID ?? row.norad_cat_id;
    if (id != null) ids.add(String(id));
  }
  if (ids.size < 40) throw new Error(`weather list has ${ids.size} satellites`);
  return ids;
}

function assignGroups(records) {
  const buckets = new Map(GROUPS.map((group) => [group.id, []]));
  let skipped = 0;

  for (const record of records) {
    const name = objectName(record);
    if (!name) {
      skipped += 1;
      continue;
    }
    const id = recordId(record);
    const bucket = catalogBucket(name, id);
    let group = bucket ? GROUPS.find((candidate) => candidate.id === bucket) : null;
    if (!group && workingLists.weatherIds?.has(id)) {
      group = GROUPS.find((candidate) => candidate.id === "weather");
    }
    if (!group && !isDebrisOrRocket(name)) {
      group = GROUPS.find((candidate) => candidate.test(name, record));
    }
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

async function fileIsFresh(path, maxAgeMs) {
  try {
    const info = await stat(path);
    return Date.now() - info.mtimeMs < maxAgeMs;
  } catch {
    return false;
  }
}

async function main() {
  const refresh = process.argv.includes("--refresh");
  await mkdir(GROUP_DIR, { recursive: true });

  let records;
  let source;
  let cookie = null;
  async function session() {
    if (cookie) return cookie;
    const { identity, password } = await loadCredentials();
    process.stdout.write("Signing in… ");
    cookie = await login(identity, password);
    console.log("ok");
    return cookie;
  }

  if (!refresh && (await fileIsFresh(RAW_PATH, GP_REUSE_MS))) {
    records = JSON.parse(await readFile(RAW_PATH, "utf8"));
    source = "reused scratch/space-track/gp.json";
    console.log(source);
  } else {
    process.stdout.write("Downloading element sets… ");
    records = await downloadGp(await session());
    console.log(`${records.length} records`);
    assertScratch(RAW_PATH);
    await writeFile(RAW_PATH, JSON.stringify(records));
    source = "downloaded just now";
  }

  if (await fileIsFresh(SATCAT_PATH, SATCAT_REUSE_MS)) {
    console.log("reused scratch/space-track/satcat.json");
  } else {
    process.stdout.write("Downloading the satellite catalog… ");
    const satcat = await downloadSatcat(await session());
    console.log(`${satcat.length} records`);
    assertScratch(SATCAT_PATH);
    await writeFile(SATCAT_PATH, JSON.stringify(satcat));
  }

  if (!Array.isArray(records) || records.length === 0) {
    throw new Error("Scratch catalog is empty.");
  }

  const fetchedAt = new Date().toISOString();
  await loadWorkingLists();
  await loadCatalogTypes();
  const { buckets, skipped } = assignGroups(records);
  const lines = [
    "Orbital View scratch bake",
    "Source: USSPACECOM via Space-Track.org",
    `Catalog: ${source}`,
    `Records: ${records.length}`,
    `Left unsorted: ${skipped}`,
    `Working: ${workingLists.note}`,
    `Sorted at: ${fetchedAt}`,
  ];

  for (const group of GROUPS) {
    const satellites = buckets.get(group.id);
    const current = await liveIds(group.group);
    const body = JSON.stringify({ fetchedAt, satellites });
    const scratchPath = join(GROUP_DIR, `${cacheKey(group.group)}-fallback.json`);
    assertScratch(scratchPath);
    await writeFile(scratchPath, body);
    await writeFile(join(LIVE_DIR, `${cacheKey(group.group)}-fallback.json`), body);

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
