import { promises as fs } from "fs";
import path from "path";

import { SerializedSatellite } from "@/lib/satellite-math";

export interface CatalogFile {
  fetchedAt: string;
  satellites: SerializedSatellite[];
}

/** Live site reads public/data. A local .env can point this at a scratch bake. */
const BUNDLED_DATA_DIR = process.env.ORBITAL_CATALOG_DIR
  ? path.resolve(process.cwd(), process.env.ORBITAL_CATALOG_DIR)
  : path.join(process.cwd(), "public", "data");

function cacheKey(group: string) {
  return group.replace(/[^a-z0-9-]/gi, "_");
}

function bundledPath(group: string) {
  return path.join(BUNDLED_DATA_DIR, `${cacheKey(group)}-fallback.json`);
}

/** Morning-baked catalog from `npm run fetch:sats`. */
export async function readBundledGroupFallback(
  group: string,
): Promise<CatalogFile | null> {
  try {
    const raw = await fs.readFile(bundledPath(group), "utf8");
    const payload = JSON.parse(raw) as CatalogFile;
    if (!Array.isArray(payload.satellites)) return null;
    return payload;
  } catch {
    return null;
  }
}
