import {
  CAMERA_FOV,
  GLOBE_RADIUS,
  SCENE_SCALE,
  SatelliteRecord,
} from "@/lib/satellite-math";

/**
 * Dialable satellite point sizing.
 *
 * Default + zoomed-in: full CLASS_PIXELS.
 * Past opening fit: smooth shrink toward MIN_SCALE (no band snaps).
 * True scale: characteristic length in meters → scene units (usually invisible).
 */
export const SIZE_SCALE = 1;
/** Phones only — Mac/iPad stay at full size (finer look). Dial down to match. */
export const PHONE_SIZE_SCALE = 0.7;

export type SizeClass = "iss" | "station" | "nav" | "mega";

/** Short side &lt; 600 CSS px ≈ phone; iPad/Mac stay out. */
export function isPhonePointViewport(): boolean {
  if (typeof window === "undefined") return false;
  return Math.min(window.innerWidth, window.innerHeight) < 600;
}

/** Pixel size for default through zoomed-in (before SIZE_SCALE). */
const CLASS_PIXELS: Record<SizeClass, number> = {
  iss: 4.2,
  station: 2.6,
  nav: 2,
  mega: 1.3,
};

/** Floor scale when fully zoomed out (1 = no shrink). */
const MIN_SCALE: Record<SizeClass, number> = {
  iss: 0.95,
  station: 0.85,
  nav: 0.72,
  mega: 0.36,
};

/**
 * Rough longest dimension (meters) for pedagogical true scale.
 * Points are still an approximation — real craft are not spheres.
 */
const TRUE_LENGTH_M: Record<SizeClass, number> = {
  iss: 109,
  station: 55,
  nav: 5,
  mega: 3,
};

/** Shrink begins slightly past opening fit; finishes toward max zoom. */
const SHRINK_START_RATIO = 1.05;
const SHRINK_END_RATIO = 1.55;

function isIss(satellite: SatelliteRecord): boolean {
  return satellite.id === "25544";
}

export function getSizeClass(
  constellationId: string,
  satellite: SatelliteRecord,
): SizeClass {
  if (isIss(satellite)) return "iss";
  if (constellationId === "stations") return "station";
  if (
    constellationId === "starlink" ||
    constellationId === "oneweb" ||
    constellationId === "iridium" ||
    constellationId === "kuiper" ||
    constellationId === "qianfan" ||
    constellationId === "planet" ||
    constellationId === "spire" ||
    constellationId === "globalstar" ||
    constellationId === "debris" ||
    constellationId === "rocket" ||
    constellationId === "unknown"
  ) {
    return "mega";
  }
  return "nav";
}

function smoothstep(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/**
 * 1 at default/zoomed-in, 0 when fully zoomed out.
 * Continuous — pair with size lerp in the field renderer.
 */
export function resolveZoomScale(
  cameraDistance: number,
  fitCameraDistance: number,
  maxCameraDistance: number,
): number {
  const fit = Math.max(fitCameraDistance, 0.001);
  const start = fit * SHRINK_START_RATIO;
  const end = Math.max(fit * SHRINK_END_RATIO, maxCameraDistance * 0.92);
  if (cameraDistance <= start) return 1;
  if (cameraDistance >= end) return 0;
  return 1 - smoothstep((cameraDistance - start) / (end - start));
}

export function resolvePointSize(
  sizeClass: SizeClass,
  zoomScale = 1,
): number {
  const minScale = MIN_SCALE[sizeClass];
  const scale = minScale + (1 - minScale) * zoomScale;
  const phoneScale = isPhonePointViewport() ? PHONE_SIZE_SCALE : 1;
  return CLASS_PIXELS[sizeClass] * scale * SIZE_SCALE * phoneScale;
}

/** World-unit point size for true scale (pair with sizeAttenuation). */
export function resolveTrueScalePointSize(sizeClass: SizeClass): number {
  return (TRUE_LENGTH_M[sizeClass] / 1000) * SCENE_SCALE;
}

/** Seconds to animate exaggerated ↔ true (shrink/grow for teaching). */
export const TRUE_SCALE_TRANSITION_SEC = 1.15;

/** Representative Starlink-shell altitude for mega teaching math. */
export const MEGA_TEACH_ALT_KM = 550;

export function smoothstep01(t: number): number {
  return smoothstep(t);
}

/**
 * How many times larger drawn mega points are vs true projected size
 * at the current camera distance (side-on LEO shell).
 */
export function resolveMegaMagnification(options: {
  cameraDistance: number;
  fitCameraDistance: number;
  maxCameraDistance: number;
  viewportHeightPx: number;
  trueScale?: boolean;
}): number {
  if (options.trueScale) return 1;

  const zoomScale = resolveZoomScale(
    options.cameraDistance,
    options.fitCameraDistance,
    options.maxCameraDistance,
  );
  const drawnPx = resolvePointSize("mega", zoomScale);
  const satRadius = GLOBE_RADIUS + MEGA_TEACH_ALT_KM * SCENE_SCALE;
  const camToSat = Math.hypot(options.cameraDistance, satRadius);
  const world = resolveTrueScalePointSize("mega");
  const halfFovRad = ((CAMERA_FOV * Math.PI) / 180) / 2;
  const vh = Math.max(options.viewportHeightPx, 1);
  const truePx =
    (world * (vh / 2)) / (Math.max(camToSat, 0.05) * Math.tan(halfFovRad));

  return Math.max(1, drawnPx / Math.max(truePx, 1e-12));
}

/** Compact chip label, e.g. "~2,400×". */
export function formatMagnification(magnification: number): string {
  const n = Math.max(1, magnification);
  if (n < 10) return `~${Math.round(n)}×`;
  if (n < 100) return `~${Math.round(n)}×`;
  if (n < 1000) return `~${(Math.round(n / 10) * 10).toLocaleString()}×`;
  if (n < 10000) return `~${(Math.round(n / 100) * 100).toLocaleString()}×`;
  return `~${(Math.round(n / 1000) * 1000).toLocaleString()}×`;
}
