import * as satellite from "satellite.js";
import type { OMMJsonObject, SatRec } from "satellite.js";

export const EARTH_RADIUS_KM = 6371.0;
export const GLOBE_RADIUS = 2;
export const SCENE_SCALE = GLOBE_RADIUS / EARTH_RADIUS_KM;
export const HIDDEN_POSITION = 9999;
export const CAMERA_MIN_DISTANCE = 2.6;
export const CAMERA_FOV = 45;
export const DEFAULT_EARTH_CAMERA_DISTANCE = 3.45;
export const DEFAULT_MAX_CAMERA_DISTANCE = 18;
/**
 * Hide / ignore props beyond this (scene units). GEO ≈ 13.2; allow HEO headroom.
 * Stale bundled TLEs can otherwise place sats on absurd fast orbits.
 */
export const MAX_PLAUSIBLE_ORBIT_RADIUS_SCENE = GLOBE_RADIUS * 10;
export const DESKTOP_EARTH_FIT_MARGIN = 0.63;

export interface SatelliteRecord {
  id: string;
  name: string;
  constellationId: string;
  satrec: SatRec;
}

export interface SerializedSatellite {
  id: string;
  name: string;
  constellationId: string;
  omm: OmmRecord;
}

export type OmmRecord = OMMJsonObject;

function propagateEci(
  satrec: SatRec,
  date: Date,
): { x: number; y: number; z: number } | null {
  const result = satellite.propagate(satrec, date);
  if (!result?.position || typeof result.position === "boolean") return null;

  const { x, y, z } = result.position;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;

  return { x, y, z };
}

function writeHidden(positions: Float32Array, offset: number) {
  positions[offset] = HIDDEN_POSITION;
  positions[offset + 1] = HIDDEN_POSITION;
  positions[offset + 2] = HIDDEN_POSITION;
}

export function parseOmmRecord(
  record: OMMJsonObject,
  constellationId: string,
): SatelliteRecord | null {
  try {
    const satrec = satellite.json2satrec(record);
    if (satrec.error) return null;

    return {
      id: String(record.NORAD_CAT_ID),
      name: record.OBJECT_NAME,
      constellationId,
      satrec,
    };
  } catch {
    return null;
  }
}

export function writeSatellitePosition(
  satrec: SatRec,
  date: Date,
  positions: Float32Array,
  index: number,
): void {
  const offset = index * 3;
  const eci = propagateEci(satrec, date);

  if (!eci) {
    writeHidden(positions, offset);
    return;
  }

  const x = eci.x * SCENE_SCALE;
  const y = eci.z * SCENE_SCALE;
  const z = -eci.y * SCENE_SCALE;
  const radius = Math.hypot(x, y, z);
  if (radius > MAX_PLAUSIBLE_ORBIT_RADIUS_SCENE) {
    writeHidden(positions, offset);
    return;
  }

  positions[offset] = x;
  positions[offset + 1] = y;
  positions[offset + 2] = z;
}

export function computeOrbitalRadiusScene(satrec: SatRec, date: Date): number | null {
  const eci = propagateEci(satrec, date);
  if (!eci) return null;

  const radius = Math.hypot(eci.x, eci.y, eci.z) * SCENE_SCALE;
  if (radius > MAX_PLAUSIBLE_ORBIT_RADIUS_SCENE) return null;
  return radius;
}

export function computeMaxOrbitalRadiusScene(
  satellites: SatelliteRecord[],
  date: Date = new Date(),
): number {
  let max = GLOBE_RADIUS;

  for (const satellite of satellites) {
    const radius = computeOrbitalRadiusScene(satellite.satrec, date);
    if (radius !== null) {
      max = Math.max(max, radius);
    }
  }

  return Math.min(max, MAX_PLAUSIBLE_ORBIT_RADIUS_SCENE);
}

/** Opening view: fit Earth inside the viewport without clipping. */
export function computeEarthFitCameraDistance(
  fovDeg = CAMERA_FOV,
  margin = 0.78,
  aspect = 1,
): number {
  const radius = GLOBE_RADIUS * 1.02;
  const halfVFovRad = (fovDeg / 2) * (Math.PI / 180);
  const halfHFovRad = Math.atan(Math.tan(halfVFovRad) * Math.max(aspect, 0.1));
  const distV = radius / (Math.tan(halfVFovRad) * margin);
  const distH = radius / (Math.tan(halfHFovRad) * margin);

  return Math.max(distV, distH, CAMERA_MIN_DISTANCE);
}

/** Shift the scene center upward to sit between the page top and a bottom UI dock. */
export function computeDesktopViewOffsetY(
  dockHeight: number,
  viewportHeight: number,
): number {
  if (dockHeight <= 0 || viewportHeight <= 0) return 0;
  return dockHeight / 2;
}

export function computeFitCameraDistance(
  maxOrbitalRadius: number,
  fovDeg = CAMERA_FOV,
  padding = 1.15,
  aspect = 1,
): number {
  const halfVFovRad = (fovDeg / 2) * (Math.PI / 180);
  const halfHFovRad = Math.atan(Math.tan(halfVFovRad) * Math.max(aspect, 0.1));
  const verticalFit = maxOrbitalRadius / Math.tan(halfVFovRad);
  const horizontalFit = maxOrbitalRadius / Math.tan(halfHFovRad);
  const fitDistance = Math.max(verticalFit, horizontalFit) * padding;

  return Math.max(CAMERA_MIN_DISTANCE + 1, fitDistance);
}