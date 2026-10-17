import type { Ship } from "./ShipsLayer";
import type { SatPosition } from "./SatelliteLayer";
import type { EntityKind } from "../lib/tracked-entity";

export interface PanelAircraft {
  hex: string;
  flight?: string;
  lat?: number;
  lon?: number;
  alt_baro?: number | string;
  gs?: number;
  track?: number;
  squawk?: string;
  t?: string;
  desc?: string;
  r?: string;
}

export type PanelEntity =
  | { kind: "aircraft"; data: PanelAircraft; military: boolean }
  | { kind: "ship"; data: Ship }
  | { kind: "satellite"; data: SatPosition };

interface Props {
  entity: PanelEntity | null;
  /** True when this entity is currently in the cinematic 3D view. */
  tracking: boolean;
  /** False when the entity dropped out of the feed — show last-known values. */
  live: boolean;
  onTrack: () => void;
  onExitTrack: () => void;
  onClose: () => void;
}

type Row = { label: string; value: string; accent?: boolean };
interface Section { title: string; rows: Row[] }

const FONT = "'Share Tech Mono','Courier New',monospace";

const fmtCoord = (v: number | undefined, pos: string, neg: string) =>
  v === undefined || !Number.isFinite(v) ? "—" : `${Math.abs(v).toFixed(4)}° ${v >= 0 ? pos : neg}`;
const fmtNum = (v: unknown, digits = 0, unit = "") =>
  typeof v === "number" && Number.isFinite(v) ? `${v.toLocaleString(undefined, { maximumFractionDigits: digits })}${unit}` : "—";
const fmtHeading = (v: unknown) =>
  typeof v === "number" && Number.isFinite(v) ? `${Math.round(v).toString().padStart(3, "0")}°` : "—";

function describe(entity: PanelEntity): { title: string; subtitle: string; accent: string; kindLabel: string; sections: Section[] } {
  if (entity.kind === "aircraft") {
    const a = entity.data;
    const alt = a.alt_baro === "ground" ? "GROUND" : fmtNum(typeof a.alt_baro === "number" ? a.alt_baro : Number(a.alt_baro), 0, " ft");
    return {
      title: a.flight?.trim() || a.hex.toUpperCase(),
      subtitle: a.desc || a.t || "Unknown airframe",
      accent: entity.military ? "#ff6b35" : "#00ffff",
      kindLabel: entity.military ? "MILITARY AIRCRAFT" : "CIVIL AIRCRAFT",
      sections: [
        { title: "POSITION", rows: [
          { label: "LAT", value: fmtCoord(a.lat, "N", "S") },
          { label: "LON", value: fmtCoord(a.lon, "E", "W") },
          { label: "ALTITUDE", value: alt, accent: true },
        ] },
        { title: "MOVEMENT", rows: [
          { label: "GROUND SPEED", value: fmtNum(a.gs, 0, " kts"), accent: true },
          { label: "TRACK", value: fmtHeading(a.track) },
        ] },
        { title: "INTEL", rows: [
          { label: "ICAO HEX", value: a.hex.toUpperCase() },
          { label: "REGISTRATION", value: a.r || "—" },
          { label: "TYPE", value: a.t || "—" },
          { label: "SQUAWK", value: a.squawk || "—", accent: a.squawk === "7700" || a.squawk === "7500" || a.squawk === "7600" },
        ] },
      ],
    };
  }

  if (entity.kind === "ship") {
    const s = entity.data;
    const gap = s.is_gap === true || s.source === "DARK_FLEET";
    const accent = gap ? "#ff9500" : s.category === "TANKER" ? "#ff3b30" : s.category === "MILITARY" ? "#3a8dff" : "#ffffff";
    const intel: Row[] = [
      { label: "MMSI", value: String(s.mmsi) },
      { label: "CATEGORY", value: s.category || "—" },
      { label: "SOURCE", value: s.source || "—" },
    ];
    if (s.dwt) intel.push({ label: "DWT", value: fmtNum(s.dwt, 0, " t") });
    if (s.est_barrels) intel.push({ label: "EST. CARGO", value: fmtNum(s.est_barrels, 0, " bbl"), accent: true });
    if (s.destination) intel.push({ label: "DESTINATION", value: String(s.destination) });
    if (s.status) intel.push({ label: "STATUS", value: String(s.status) });
    if (gap && s.time_went_dark) intel.push({ label: "WENT DARK", value: new Date(s.time_went_dark).toUTCString().slice(5, 22) + "Z", accent: true });
    if (typeof s.last_updated === "number") {
      const ms = s.last_updated > 1e12 ? s.last_updated : s.last_updated * 1000;
      intel.push({ label: "LAST AIS", value: new Date(ms).toUTCString().slice(17, 25) + "Z" });
    }
    return {
      title: (s.vessel_name || s.ship_name || `MMSI ${s.mmsi}`).toString().toUpperCase(),
      subtitle: gap ? "AIS GAP CANDIDATE — transponder silent" : s.category === "TANKER" ? "Crude / product tanker" : "Maritime contact",
      accent,
      kindLabel: gap ? "DARK VESSEL" : "VESSEL",
      sections: [
        { title: gap ? "LAST KNOWN POSITION" : "POSITION", rows: [
          { label: "LAT", value: fmtCoord(s.lat, "N", "S") },
          { label: "LON", value: fmtCoord(s.lon, "E", "W") },
        ] },
        { title: "MOVEMENT", rows: [
          { label: "SPEED (SOG)", value: fmtNum(s.sog ?? (s.last_sog as number | undefined), 1, " kts"), accent: true },
          { label: "COURSE (COG)", value: fmtHeading(s.cog ?? s.last_cog) },
        ] },
        { title: "INTEL", rows: intel },
      ],
    };
  }

  const p = entity.data;
  return {
    title: p.name,
    subtitle: p.intelClass,
    accent: p.color || "#7df9ff",
    kindLabel: "SATELLITE",
    sections: [
      { title: "POSITION (NADIR)", rows: [
        { label: "LAT", value: fmtCoord(p.lat, "N", "S") },
        { label: "LON", value: fmtCoord(p.lon, "E", "W") },
        { label: "ALTITUDE", value: fmtNum(p.altKm, 1, " km"), accent: true },
      ] },
      { title: "MOVEMENT", rows: [
        { label: "VELOCITY", value: fmtNum(p.velocityKms, 2, " km/s"), accent: true },
        { label: "ORBIT", value: p.isGeo ? "GEOSTATIONARY" : p.altKm < 2000 ? "LEO" : p.altKm < 35_000 ? "MEO" : "HEO" },
      ] },
      { title: "INTEL", rows: [
        { label: "NORAD ID", value: p.noradId },
        { label: "ORIGIN", value: p.origin },
        { label: "CLASS", value: p.intelClass },
      ] },
    ],
  };
}

export function entityKindOf(e: PanelEntity | null): EntityKind | null {
  return e?.kind ?? null;
}

export function EntityInfoPanel({ entity, tracking, live, onTrack, onExitTrack, onClose }: Props) {
  if (!entity) return null;
  const { title, subtitle, accent, kindLabel, sections } = describe(entity);

  return (
    <aside
      aria-label={`${kindLabel} details`}
      style={{
        position: "absolute",
        top: 14,
        right: 14,
        zIndex: 30,
        width: 280,
        maxHeight: "calc(100vh - 28px)",
        overflowY: "auto",
        background: "rgba(2,4,8,0.9)",
        backdropFilter: "blur(20px)",
        WebkitBackdropFilter: "blur(20px)",
        border: `1px solid ${accent}55`,
        borderRadius: 2,
        boxShadow: `0 0 24px ${accent}22, inset 0 0 14px ${accent}10`,
        fontFamily: FONT,
        color: "#d8f6ff",
        userSelect: "text",
      }}
      className="glow-scroll"
    >
      <header style={{ padding: "12px 14px 10px", borderBottom: `1px solid ${accent}25` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
          <span style={{ fontSize: 8, letterSpacing: "0.22em", color: accent, display: "flex", alignItems: "center", gap: 6 }}>
            <span
              aria-hidden="true"
              style={{
                width: 6, height: 6, borderRadius: "50%",
                background: live ? accent : "rgba(255,255,255,0.3)",
                boxShadow: live ? `0 0 8px ${accent}` : "none",
                animation: live ? "pulse-glow 1.6s ease-in-out infinite" : "none",
              }}
            />
            {kindLabel} {live ? "· LIVE" : "· SIGNAL LOST"}
          </span>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close details panel"
            style={{ background: "none", border: "none", color: "rgba(216,246,255,0.5)", cursor: "pointer", fontFamily: FONT, fontSize: 12, padding: 2 }}
          >
            ✕
          </button>
        </div>
        <h2 style={{ margin: 0, fontSize: 16, letterSpacing: "0.08em", color: "#ffffff", fontWeight: 400, wordBreak: "break-word" }}>{title}</h2>
        <p style={{ margin: "3px 0 0", fontSize: 9, letterSpacing: "0.08em", color: "rgba(216,246,255,0.55)" }}>{subtitle}</p>
      </header>

      {sections.map((sec) => (
        <section key={sec.title} style={{ padding: "10px 14px", borderBottom: `1px solid ${accent}15` }}>
          <h3 style={{ margin: "0 0 6px", fontSize: 8, letterSpacing: "0.22em", color: `${accent}aa`, fontWeight: 400 }}>{sec.title}</h3>
          <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "auto 1fr", rowGap: 4, columnGap: 10 }}>
            {sec.rows.map((r) => (
              <div key={r.label} style={{ display: "contents" }}>
                <dt style={{ fontSize: 9, letterSpacing: "0.1em", color: "rgba(216,246,255,0.45)" }}>{r.label}</dt>
                <dd style={{ margin: 0, fontSize: 10, textAlign: "right", color: r.accent ? accent : "#e8fbff", fontVariantNumeric: "tabular-nums", wordBreak: "break-word" }}>{r.value}</dd>
              </div>
            ))}
          </dl>
        </section>
      ))}

      <div style={{ padding: 12 }}>
        <button
          type="button"
          onClick={tracking ? onExitTrack : onTrack}
          style={{
            width: "100%",
            padding: "9px 10px",
            background: tracking ? `${accent}22` : "transparent",
            border: `1px solid ${accent}`,
            color: accent,
            fontFamily: FONT,
            fontSize: 10,
            letterSpacing: "0.25em",
            cursor: "pointer",
            boxShadow: `0 0 14px ${accent}30`,
          }}
        >
          {tracking ? "◂ EXIT 3D VIEW" : "▸ TRACK IN 3D"}
        </button>
        <p style={{ margin: "7px 0 0", fontSize: 8, letterSpacing: "0.08em", color: "rgba(216,246,255,0.35)", textAlign: "center" }}>
          {tracking ? "DRAG TO ORBIT · SCROLL TO ZOOM · ESC TO EXIT" : "TIP: DOUBLE-CLICK A CONTACT TO TRACK"}
        </p>
      </div>
    </aside>
  );
}
