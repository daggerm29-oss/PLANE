import { useEffect, useRef } from "react";
import * as Cesium from "cesium";
import "cesium/Build/Cesium/Widgets/widgets.css";
import {
  angularDistance,
  bearingDeg,
  destination,
  EARTH_R,
  type FollowTarget,
  type ModelSpec,
} from "../lib/tracked-entity";

Cesium.Ion.defaultAccessToken =
  "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJqdGkiOiI0YjdkMmFmMS04ZmU2LTQ4NDYtYTIwMS1hOTg5NGM2NzEzNGYiLCJpZCI6Mzk3MjQyLCJpYXQiOjE3NzI1Mzk5NDV9.sQ4V9RmCN2-xnXW2WZDxSAgaZTZFn9pohwFD9YzmWoU";

interface Props {
  target: FollowTarget;
  model: ModelSpec;
  /** When true, play the zoom-out + fade and then call onExited. */
  exiting: boolean;
  onExited: () => void;
}

const INTRO_MS = 2600;
const EXIT_MS = 1500;
const SMOOTH_TAU = 0.35;
/** Never dead-reckon further than this past the last real sample. */
const MAX_EXTRAPOLATE_S = 20;

const TILESET_NIGHT_SHADER = new Cesium.CustomShader({
  lightingModel: Cesium.LightingModel.UNLIT,
  fragmentShaderText: `
    void fragmentMain(FragmentInput fsInput, inout czm_modelMaterial material) {
      vec3 c = material.diffuse;
      float gray = dot(c, vec3(0.299, 0.587, 0.114));
      gray = pow(gray, 1.5) * 0.65;
      material.diffuse = vec3(gray * 0.2, gray * 0.8, gray * 1.0);
      material.alpha = 1.0;
    }
  `,
});

interface Sample {
  lat: number;
  lon: number;
  altM: number;
  headingDeg: number;
  speedMs: number;
  t: number;
}

const easeInOut = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/**
 * Generic photorealistic Cesium follow-cam for aircraft, ships and satellites.
 * Positions are dead-reckoned between feed samples (heading + speed) and then
 * exponentially smoothed, so the model glides continuously instead of
 * jumping every poll. The camera is driven manually each frame (chase view
 * with drag-to-orbit and wheel zoom) so intro / exit zooms can be animated.
 */
export function CinematicTracker({ target, model, exiting, onExited }: Props) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const sampleRef = useRef<Sample | null>(null);
  const exitStartRef = useRef<number | null>(null);
  const onExitedRef = useRef(onExited);
  onExitedRef.current = onExited;

  // Ingest new samples, deriving heading/speed from movement when missing.
  useEffect(() => {
    const now = performance.now();
    const prev = sampleRef.current;
    let heading = target.headingDeg;
    let speed = target.speedMs;
    if (prev && (heading === undefined || speed === undefined)) {
      const ang = angularDistance(prev.lat, prev.lon, target.lat, target.lon);
      const dt = (now - prev.t) / 1000;
      if (ang > 1e-9 && dt > 0.2) {
        heading ??= bearingDeg(prev.lat, prev.lon, target.lat, target.lon);
        speed ??= (ang * (EARTH_R + target.altM)) / dt;
      }
    }
    sampleRef.current = {
      lat: target.lat,
      lon: target.lon,
      altM: target.altM,
      headingDeg: heading ?? prev?.headingDeg ?? 0,
      speedMs: speed ?? prev?.speedMs ?? 0,
      t: now,
    };
  }, [target.lat, target.lon, target.altM, target.headingDeg, target.speedMs]);

  useEffect(() => {
    if (exiting && exitStartRef.current === null) {
      exitStartRef.current = performance.now();
      if (wrapRef.current) wrapRef.current.style.opacity = "0";
    }
  }, [exiting]);

  useEffect(() => {
    const container = containerRef.current;
    const wrap = wrapRef.current;
    if (!container || !wrap) return;

    let cancelled = false;
    let viewer: Cesium.Viewer | null = null;
    const cleanups: Array<() => void> = [];

    const init = async () => {
      viewer = new Cesium.Viewer(container, {
        animation: false,
        baseLayerPicker: false,
        fullscreenButton: false,
        geocoder: false,
        homeButton: false,
        infoBox: false,
        sceneModePicker: false,
        selectionIndicator: false,
        timeline: false,
        navigationHelpButton: false,
        navigationInstructionsInitiallyVisible: false,
        baseLayer: false,
      });
      const scene = viewer.scene;
      scene.globe.show = false;
      scene.backgroundColor = Cesium.Color.BLACK;
      if (scene.skyAtmosphere) scene.skyAtmosphere.show = false;
      scene.fog.enabled = false;
      scene.screenSpaceCameraController.enableInputs = false;

      const fixedTime = Cesium.JulianDate.fromIso8601("2024-06-15T22:30:00Z");
      viewer.clock.currentTime = fixedTime;
      viewer.clock.shouldAnimate = false;

      try {
        const tileset = await Cesium.createGooglePhotorealistic3DTileset();
        if (cancelled) return;
        tileset.customShader = TILESET_NIGHT_SHADER;
        scene.primitives.add(tileset);
      } catch (e) {
        console.error("[worldview] Google 3D tiles unavailable", e);
      }
      if (cancelled) return;

      // ── Display state: dead-reckoned + smoothed once per frame ──
      const s0 = sampleRef.current!;
      const display = { lat: s0.lat, lon: s0.lon, alt: s0.altM, heading: s0.headingDeg };
      let groundOffset = 0;
      let lastGroundSample = 0;
      let lastFrame = performance.now();

      const displayPosition = () =>
        Cesium.Cartesian3.fromDegrees(display.lon, display.lat, display.alt + groundOffset);

      const entity = viewer.entities.add({
        position: new Cesium.CallbackPositionProperty(displayPosition, false),
        orientation: new Cesium.CallbackProperty(
          () =>
            Cesium.Transforms.headingPitchRollQuaternion(
              displayPosition(),
              new Cesium.HeadingPitchRoll(Cesium.Math.toRadians(display.heading - 90), 0, 0),
            ),
          false,
        ),
        model: {
          uri: model.url,
          scale: model.scale,
          minimumPixelSize: model.minimumPixelSize,
          maximumScale: 20_000,
          shadows: Cesium.ShadowMode.DISABLED,
          color: Cesium.Color.WHITE,
        },
      });

      // ── Motion trail ──
      const trail: Cesium.Cartesian3[] = [];
      let lastTrailPush = 0;
      viewer.entities.add({
        polyline: {
          positions: new Cesium.CallbackProperty(() => [...trail, displayPosition()], false),
          width: 2.5,
          material: new Cesium.PolylineGlowMaterialProperty({
            glowPower: 0.25,
            color: Cesium.Color.fromCssColorString(model.trailColor).withAlpha(0.7),
          }),
          arcType: Cesium.ArcType.NONE,
        },
      });

      // ── Aircraft nav lights ──
      if (model.navLights) {
        const lights: Array<{ fwd: number; rt: number; up: number; color: Cesium.Color; strobe?: boolean }> = [
          { fwd: 0, rt: -28, up: 0, color: Cesium.Color.RED },
          { fwd: 0, rt: 28, up: 0, color: Cesium.Color.LIME },
          { fwd: -22, rt: 0, up: 4, color: Cesium.Color.WHITE, strobe: true },
          { fwd: 0, rt: 0, up: -3, color: Cesium.Color.RED, strobe: true },
        ];
        for (const l of lights) {
          viewer.entities.add({
            position: new Cesium.CallbackPositionProperty(() => {
              const p = displayPosition();
              const h = Cesium.Math.toRadians(display.heading);
              const offset = new Cesium.Cartesian3(
                l.fwd * Math.sin(h) + l.rt * Math.cos(h),
                l.fwd * Math.cos(h) - l.rt * Math.sin(h),
                l.up,
              );
              return Cesium.Matrix4.multiplyByPoint(
                Cesium.Transforms.eastNorthUpToFixedFrame(p),
                offset,
                new Cesium.Cartesian3(),
              );
            }, false),
            point: {
              pixelSize: 11,
              color: new Cesium.CallbackProperty(
                () => (!l.strobe || performance.now() % 900 < 110 ? l.color : l.color.withAlpha(0.05)),
                false,
              ),
              disableDepthTestDistance: Number.POSITIVE_INFINITY,
              scaleByDistance: new Cesium.NearFarScalar(50, 1.3, 6000, 0.4),
            },
          });
        }
      }

      // ── Camera state: chase heading offset, pitch, range ──
      let orbitOffset = 0;
      let pitch = Cesium.Math.toRadians(model.orbitalView ? -20 : -22);
      let range = model.cameraRange;
      const introStart = performance.now();
      const introFrom = Math.min(model.maxRange, model.cameraRange * 30);
      let exitFired = false;

      const onFrame = () => {
        if (!viewer || viewer.isDestroyed()) return;
        const now = performance.now();
        const dt = Math.min((now - lastFrame) / 1000, 0.1);
        lastFrame = now;

        const s = sampleRef.current;
        if (s) {
          const elapsed = Math.min((now - s.t) / 1000, MAX_EXTRAPOLATE_S);
          const travel = (s.speedMs * elapsed) / (EARTH_R + s.altM);
          const predicted = travel > 0 ? destination(s.lat, s.lon, s.headingDeg, travel) : s;
          const k = 1 - Math.exp(-dt / SMOOTH_TAU);
          let dLon = predicted.lon - display.lon;
          if (dLon > 180) dLon -= 360;
          if (dLon < -180) dLon += 360;
          // Snap on large discontinuities (e.g. satellite resync) instead of sweeping.
          if (Math.abs(dLon) > 5 || Math.abs(predicted.lat - display.lat) > 5) {
            display.lat = predicted.lat;
            display.lon = predicted.lon;
          } else {
            display.lat += (predicted.lat - display.lat) * k;
            display.lon += dLon * k;
          }
          display.alt += (s.altM - display.alt) * k;
          const dh = ((s.headingDeg - display.heading + 540) % 360) - 180;
          display.heading = (display.heading + dh * k + 360) % 360;
        }

        if (model.clampToGround && now - lastGroundSample > 1000) {
          lastGroundSample = now;
          const h = scene.sampleHeight(
            Cesium.Cartographic.fromDegrees(display.lon, display.lat),
            [entity],
          );
          if (h !== undefined && Number.isFinite(h)) groundOffset = h + 2;
        }

        if (now - lastTrailPush > 500) {
          lastTrailPush = now;
          trail.push(displayPosition());
          if (trail.length > 240) trail.shift();
        }

        let r = range;
        const introT = Math.min(1, (now - introStart) / INTRO_MS);
        if (introT < 1) r = introFrom + (range - introFrom) * easeInOut(introT);
        const exitStart = exitStartRef.current;
        if (exitStart !== null) {
          const exitT = Math.min(1, (now - exitStart) / EXIT_MS);
          r = r + (Math.min(model.maxRange, r * 40) - r) * easeInOut(exitT);
          if (exitT >= 1 && !exitFired) {
            exitFired = true;
            onExitedRef.current();
          }
        }

        const pos = displayPosition();
        const camHeading = Cesium.Math.toRadians(display.heading) + orbitOffset;
        scene.camera.lookAt(pos, new Cesium.HeadingPitchRange(camHeading, pitch, r));
        scene.light = new Cesium.DirectionalLight({
          direction: Cesium.Cartesian3.clone(scene.camera.directionWC),
          intensity: 2.5,
        });
      };
      scene.preRender.addEventListener(onFrame);
      cleanups.push(() => scene.preRender.removeEventListener(onFrame));

      // ── Manual orbit / zoom input ──
      let dragging = false;
      let lastX = 0;
      let lastY = 0;
      const onDown = (e: PointerEvent) => {
        dragging = true;
        lastX = e.clientX;
        lastY = e.clientY;
        container.setPointerCapture(e.pointerId);
        container.style.cursor = "grabbing";
      };
      const onMove = (e: PointerEvent) => {
        if (!dragging) return;
        orbitOffset += (e.clientX - lastX) * 0.006;
        pitch = Cesium.Math.clamp(pitch - (e.clientY - lastY) * 0.005, -Cesium.Math.PI_OVER_TWO + 0.02, 0.35);
        lastX = e.clientX;
        lastY = e.clientY;
      };
      const onUp = (e: PointerEvent) => {
        dragging = false;
        container.style.cursor = "grab";
        if (container.hasPointerCapture(e.pointerId)) container.releasePointerCapture(e.pointerId);
      };
      const onWheel = (e: WheelEvent) => {
        e.preventDefault();
        range = Cesium.Math.clamp(range * Math.exp(e.deltaY * 0.0012), model.minRange, model.maxRange);
      };
      container.style.cursor = "grab";
      container.addEventListener("pointerdown", onDown);
      container.addEventListener("pointermove", onMove);
      container.addEventListener("pointerup", onUp);
      container.addEventListener("pointercancel", onUp);
      container.addEventListener("wheel", onWheel, { passive: false });
      cleanups.push(() => {
        container.removeEventListener("pointerdown", onDown);
        container.removeEventListener("pointermove", onMove);
        container.removeEventListener("pointerup", onUp);
        container.removeEventListener("pointercancel", onUp);
        container.removeEventListener("wheel", onWheel);
      });

      requestAnimationFrame(() => {
        if (!cancelled && exitStartRef.current === null) wrap.style.opacity = "1";
      });
    };

    init().catch((e) => {
      console.error("[worldview] Cesium tracker init failed", e);
      onExitedRef.current();
    });

    return () => {
      cancelled = true;
      for (const fn of cleanups) fn();
      try {
        if (viewer && !viewer.isDestroyed()) viewer.destroy();
      } catch {
        /* already torn down */
      }
    };
    // Rebuild only when the model changes (i.e. a different entity kind).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [model.url]);

  return (
    <div
      ref={wrapRef}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 5,
        opacity: 0,
        transition: `opacity ${exiting ? EXIT_MS : 900}ms ease`,
        background: "#000005",
      }}
    >
      <div ref={containerRef} style={{ position: "absolute", inset: 0, touchAction: "none" }} />
    </div>
  );
}
