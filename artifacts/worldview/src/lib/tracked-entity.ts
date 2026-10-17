// Shared types + helpers for the unified selection / cinematic-tracking flow.
// A single EntityRef identifies whatever the user clicked (aircraft, ship or
// satellite); a FollowTarget is the normalised kinematic sample the Cesium
// tracker consumes regardless of entity kind.

export type EntityKind = "aircraft" | "ship" | "satellite";

export interface EntityRef {
  kind: EntityKind;
  id: string;
}

export interface FollowTarget {
  lat: number;
  lon: number;
  /** Height above the ellipsoid in metres. */
  altM: number;
  /** Course over ground in degrees (0 = north). Undefined → derived from samples. */
  headingDeg?: number;
  /** Speed in m/s. Undefined → derived from samples. */
  speedMs?: number;
}

export interface ModelSpec {
  url: string;
  scale: number;
  minimumPixelSize: number;
  /** Default camera distance (m) once the intro zoom settles. */
  cameraRange: number;
  minRange: number;
  maxRange: number;
  /** Clamp model to terrain / 3D tiles (ships). */
  clampToGround: boolean;
  /** Render with globe + imagery instead of Google 3D tiles (orbit views). */
  orbitalView: boolean;
  trailColor: string;
  /** Show aircraft nav/strobe lights. */
  navLights: boolean;
}

export const FT_TO_M = 0.3048;
export const KTS_TO_MS = 0.514444;

export function sameEntity(a: EntityRef | null, b: EntityRef | null): boolean {
  return !!a && !!b && a.kind === b.kind && a.id === b.id;
}

export function altMetersFromBaro(alt: number | string | undefined): number {
  if (alt === undefined || alt === null) return 300;
  if (alt === "ground") return 0;
  const n = Number(alt);
  return Number.isFinite(n) ? n * FT_TO_M : 300;
}

export function modelSpecFor(
  base: string,
  kind: EntityKind,
  opts: { military?: boolean; tanker?: boolean; name?: string } = {},
): ModelSpec {
  if (kind === "aircraft") {
    return {
      url: `${base}/${opts.military ? "military-aircraft.glb" : "aeroplane.glb"}`,
      scale: 2.2,
      minimumPixelSize: 96,
      cameraRange: 190,
      minRange: 40,
      maxRange: 60_000,
      clampToGround: false,
      orbitalView: false,
      trailColor: opts.military ? "#ff6b35" : "#00ffff",
      navLights: true,
    };
  }
  if (kind === "ship") {
    return {
      url: `${base}/${opts.tanker ? "tanker.glb" : "ship.glb"}`,
      scale: opts.tanker ? 130 : 100,
      minimumPixelSize: 80,
      cameraRange: 650,
      minRange: 120,
      maxRange: 80_000,
      clampToGround: true,
      orbitalView: false,
      trailColor: opts.tanker ? "#ff3b30" : "#ffffff",
      navLights: false,
    };
  }
  const isIss = /\b(ISS|ZARYA)\b/i.test(opts.name ?? "");
  return {
    url: `${base}/${isIss ? "iss.glb" : "satellite.glb"}`,
    scale: isIss ? 50 : 12,
    minimumPixelSize: 90,
    cameraRange: isIss ? 320 : 140,
    minRange: 30,
    maxRange: 9_000_000,
    clampToGround: false,
    orbitalView: true,
    trailColor: "#7df9ff",
    navLights: false,
  };
}

const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;
export const EARTH_R = 6_371_000;

/** Initial bearing (deg) from point 1 to point 2. */
export function bearingDeg(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const φ1 = toRad(lat1), φ2 = toRad(lat2), Δλ = toRad(lon2 - lon1);
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

/** Great-circle angular distance (rad). */
export function angularDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dφ = toRad(lat2 - lat1), dλ = toRad(lon2 - lon1);
  const a = Math.sin(dφ / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dλ / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Move along a great circle by `angle` radians on `headingDeg`. */
export function destination(lat: number, lon: number, headingDeg: number, angle: number): { lat: number; lon: number } {
  const φ1 = toRad(lat), λ1 = toRad(lon), θ = toRad(headingDeg);
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(angle) + Math.cos(φ1) * Math.sin(angle) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(angle) * Math.cos(φ1), Math.cos(angle) - Math.sin(φ1) * Math.sin(φ2));
  return { lat: toDeg(φ2), lon: ((toDeg(λ2) + 540) % 360) - 180 };
}
