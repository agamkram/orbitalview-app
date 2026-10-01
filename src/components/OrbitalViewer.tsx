"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  CARD_CAMERA_DISTANCE,
  CARD_CONSTELLATION_IDS,
  isCardPreview,
} from "@/lib/card-preview";
import { CONSTELLATIONS } from "@/lib/constellations";
import {
  isPortraitPhone,
  measurePortraitDockLayout,
  readVisualViewportSize,
  syncPwaFillHeight,
  waitForStableViewport,
  type PortraitDockLayout,
} from "@/lib/ios-home-screen";
import { DEFAULT_PLAYBACK_SPEED, HOUR_MS } from "@/lib/playback-speed";
import {
  computeDesktopViewOffsetY,
  computeEarthFitCameraDistance,
  computeFitCameraDistance,
  computeMaxOrbitalRadiusScene,
  DESKTOP_EARTH_FIT_MARGIN,
  DEFAULT_EARTH_CAMERA_DISTANCE,
  DEFAULT_MAX_CAMERA_DISTANCE,
  parseOmmRecord,
  SatelliteRecord,
  SerializedSatellite,
} from "@/lib/satellite-math";
import { ConstellationLegend } from "./ConstellationLegend";
import { EARTH_TEXTURE_URL } from "./Earth";
import { OrbitalScene } from "./OrbitalScene";
import { ScaleTeachControls } from "./ScaleTeachControls";
import { TimeControls } from "./TimeControls";

function buildInitialVisibility(cardMode: boolean) {
  return Object.fromEntries(
    CONSTELLATIONS.map((constellation) => [
      constellation.id,
      cardMode
        ? (CARD_CONSTELLATION_IDS as readonly string[]).includes(constellation.id)
        : true,
    ]),
  );
}

export function OrbitalViewer() {
  const searchParams = useSearchParams();
  const cardMode = isCardPreview(searchParams);
  const [satellites, setSatellites] = useState<SatelliteRecord[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [speed, setSpeed] = useState(DEFAULT_PLAYBACK_SPEED);
  const [offsetHours, setOffsetHours] = useState(0);
  const [simTime, setSimTime] = useState(() => Date.now());
  const [visibleConstellations, setVisibleConstellations] = useState(() =>
    buildInitialVisibility(cardMode),
  );
  const [earthReady, setEarthReady] = useState(false);
  const [legendOpen, setLegendOpen] = useState(false);
  const [trueScale, setTrueScale] = useState(false);
  const [cameraDistance, setCameraDistance] = useState(DEFAULT_EARTH_CAMERA_DISTANCE);

  const baseTimeRef = useRef(Date.now());
  const simTimeRef = useRef(Date.now());
  const offsetHoursRef = useRef(0);
  const speedRef = useRef(speed);
  const scrubbingRef = useRef(false);
  const scrubAnchorRef = useRef<number | null>(null);
  const scrubUiFrameRef = useRef<number | null>(null);

  speedRef.current = speed;

  const syncSimTime = useCallback((hours: number) => {
    offsetHoursRef.current = hours;
    simTimeRef.current = baseTimeRef.current + hours * HOUR_MS;
    setSimTime(simTimeRef.current);
  }, []);

  const handleUiUpdate = useCallback((hours: number) => {
    setOffsetHours(hours);
    setSimTime(simTimeRef.current);
  }, []);

  const [viewportAspect, setViewportAspect] = useState(() =>
    typeof window === "undefined" ? 1 : window.innerWidth / window.innerHeight,
  );
  const [uiMounted, setUiMounted] = useState(false);
  const [portraitPhone, setPortraitPhone] = useState(false);
  const [desktopViewport, setDesktopViewport] = useState(false);
  const [landscapeDockHeight, setLandscapeDockHeight] = useState(0);
  const [portraitDockLayout, setPortraitDockLayout] = useState<PortraitDockLayout | null>(
    null,
  );
  const portraitDockRef = useRef<HTMLDivElement>(null);
  const landscapeDockRef = useRef<HTMLDivElement>(null);

  const updatePortraitDock = useCallback(() => {
    const portrait = isPortraitPhone();
    setPortraitPhone(portrait);
    setDesktopViewport(
      window.matchMedia("(min-width: 1024px) and (pointer: fine)").matches,
    );

    if (!portrait || !portraitDockRef.current) {
      setPortraitDockLayout((prev) => (prev === null ? prev : null));
      return;
    }

    const dockHeight = portraitDockRef.current.offsetHeight;
    const next = measurePortraitDockLayout(dockHeight);
    setPortraitDockLayout((prev) => {
      if (prev === null) return next;
      if (prev.mode === "bottom" && next.mode === "bottom") return prev;
      if (
        prev.mode === "top" &&
        next.mode === "top" &&
        prev.top === next.top
      ) {
        return prev;
      }
      return next;
    });
  }, []);

  const updateLandscapeDock = useCallback(() => {
    if (isPortraitPhone() || !landscapeDockRef.current) {
      setLandscapeDockHeight(0);
      return;
    }

    setLandscapeDockHeight(landscapeDockRef.current.offsetHeight);
  }, []);

  useEffect(() => {
    let layoutReady = false;
    let layoutShownAt = 0;
    let cancelled = false;

    const updateViewport = (force = false) => {
      if (!force && layoutReady && performance.now() - layoutShownAt < 350) return;
      // Bug B: re-lock PWA fill height before measuring aspect / docks.
      syncPwaFillHeight();
      setViewportAspect(window.innerWidth / window.innerHeight);
      updatePortraitDock();
      updateLandscapeDock();
    };

    // Bug C: pick the dock orientation in the same commit that reveals it,
    // so the first painted dock is already the right one.
    updateViewport(true);
    setUiMounted(true);

    void (async () => {
      syncPwaFillHeight();
      await waitForStableViewport(readVisualViewportSize);
      if (cancelled) return;
      updateViewport(true);
      layoutReady = true;
      layoutShownAt = performance.now();
      // Late settles after iOS chrome animation.
      window.setTimeout(() => {
        if (!cancelled) updateViewport(true);
      }, 100);
      window.setTimeout(() => {
        if (!cancelled) updateViewport(true);
      }, 400);
    })();

    const onResize = () => updateViewport();
    const onOrientationChange = () => {
      updateViewport(true);
      window.setTimeout(() => updateViewport(true), 50);
      window.setTimeout(() => updateViewport(true), 300);
    };
    const onPageShow = () => updateViewport(true);

    window.addEventListener("resize", onResize);
    window.addEventListener("orientationchange", onOrientationChange);
    window.visualViewport?.addEventListener("resize", onResize);
    window.addEventListener("pageshow", onPageShow);

    return () => {
      cancelled = true;
      window.removeEventListener("resize", onResize);
      window.removeEventListener("orientationchange", onOrientationChange);
      window.visualViewport?.removeEventListener("resize", onResize);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [updatePortraitDock, updateLandscapeDock]);

  useEffect(() => {
    if (portraitPhone || !landscapeDockRef.current) return;

    const dock = landscapeDockRef.current;
    const observer = new ResizeObserver(() => updateLandscapeDock());

    observer.observe(dock);
    updateLandscapeDock();

    return () => observer.disconnect();
  }, [portraitPhone, updateLandscapeDock]);

  useEffect(() => {
    if (!portraitPhone || !portraitDockRef.current) return;

    const dock = portraitDockRef.current;
    const observer = new ResizeObserver(() => updatePortraitDock());

    observer.observe(dock);
    updatePortraitDock();
    const frame = requestAnimationFrame(updatePortraitDock);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [portraitPhone, updatePortraitDock]);

  const activeConstellations = useMemo(
    () =>
      cardMode
        ? CONSTELLATIONS.filter((constellation) =>
            (CARD_CONSTELLATION_IDS as readonly string[]).includes(constellation.id),
          )
        : CONSTELLATIONS,
    [cardMode],
  );

  const cardCameraPosition = useMemo(
    (): [number, number, number] => [0, 0, CARD_CAMERA_DISTANCE],
    [],
  );

  const { fitCameraDistance, maxCameraDistance } = useMemo(() => {
    if (cardMode) {
      return {
        fitCameraDistance: CARD_CAMERA_DISTANCE,
        maxCameraDistance: CARD_CAMERA_DISTANCE,
      };
    }

    const earthFitMargin =
      desktopViewport && !portraitPhone ? DESKTOP_EARTH_FIT_MARGIN : undefined;

    const earthFitDistance = computeEarthFitCameraDistance(
      undefined,
      earthFitMargin,
      viewportAspect,
    );

    if (satellites.length === 0) {
      return {
        fitCameraDistance: earthFitDistance,
        maxCameraDistance: DEFAULT_MAX_CAMERA_DISTANCE,
      };
    }

    const maxOrbitalRadius = computeMaxOrbitalRadiusScene(satellites);
    const isPortrait = viewportAspect < 1;
    const padding = isPortrait ? 1.22 : 1.15;
    const orbitFit = computeFitCameraDistance(
      maxOrbitalRadius,
      undefined,
      padding,
      viewportAspect,
    );

    return {
      fitCameraDistance: earthFitDistance,
      maxCameraDistance: Math.max(orbitFit * 1.08, DEFAULT_MAX_CAMERA_DISTANCE),
    };
  }, [cardMode, satellites, viewportAspect, desktopViewport, portraitPhone]);

  const desktopViewOffsetY = useMemo(() => {
    if (cardMode || !desktopViewport || portraitPhone || landscapeDockHeight <= 0) {
      return 0;
    }

    const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
    return computeDesktopViewOffsetY(landscapeDockHeight, viewportHeight);
  }, [cardMode, desktopViewport, portraitPhone, landscapeDockHeight]);

  useEffect(() => {
    let cancelled = false;

    async function loadSatellites() {
      try {
        setError(null);
        setWarning(null);

        const results = await Promise.allSettled(
          activeConstellations.map(async (constellation) => {
            const response = await fetch(`/api/satellites?group=${constellation.id}`);
            const raw = await response.text();

            let payload: {
              satellites: SerializedSatellite[];
              count: number;
              error?: string;
            };

            try {
              payload = JSON.parse(raw) as typeof payload;
            } catch {
              throw new Error(
                "Server not ready yet. Wait a few seconds, then refresh the page.",
              );
            }

            if (!response.ok) {
              throw new Error(payload.error ?? `Failed to load ${constellation.name}`);
            }

            return {
              constellationId: constellation.id,
              satellites: payload.satellites,
              count: payload.count,
            };
          }),
        );

        if (cancelled) return;

        const responses = results.flatMap((result) =>
          result.status === "fulfilled" ? [result.value] : [],
        );
        const failures = results
          .map((result, index) =>
            result.status === "rejected"
              ? `${activeConstellations[index].name}: ${
                  result.reason instanceof Error ? result.reason.message : "failed"
                }`
              : null,
          )
          .filter((message): message is string => message !== null);

        if (responses.length === 0) {
          throw new Error(failures[0] ?? "Failed to load satellites");
        }

        const parsed = responses
          .flatMap((result) => result.satellites)
          .map((satellite) => parseOmmRecord(satellite.omm, satellite.constellationId))
          .filter((satellite): satellite is SatelliteRecord => satellite !== null);

        setSatellites(parsed);
        setCounts(
          Object.fromEntries(
            responses.map((result) => [result.constellationId, result.count]),
          ),
        );

        if (failures.length > 0) {
          setWarning(`Some groups could not be loaded: ${failures.join("; ")}`);
        }
      } catch (fetchError) {
        if (cancelled) return;
        setError(
          fetchError instanceof Error ? fetchError.message : "Failed to load satellites",
        );
      }
    }

    void loadSatellites();

    return () => {
      cancelled = true;
    };
  }, [activeConstellations]);

  // Warm the browser cache for the globe texture so useTexture resolves from
  // it, letting Earth and the satellites reveal in the same frame.
  useEffect(() => {
    const image = new window.Image();
    const done = () => setEarthReady(true);

    image.onload = done;
    image.onerror = done;
    image.src = EARTH_TEXTURE_URL;

    return () => {
      image.onload = null;
      image.onerror = null;
    };
  }, []);

  const handleScrubStart = useCallback(() => {
    scrubbingRef.current = true;
    scrubAnchorRef.current = Date.now();
  }, []);

  const handleScrubChange = useCallback((hours: number) => {
    const anchor = scrubAnchorRef.current ?? Date.now();
    offsetHoursRef.current = hours;
    simTimeRef.current = anchor + hours * HOUR_MS;
    setOffsetHours(hours);

    if (scrubUiFrameRef.current === null) {
      scrubUiFrameRef.current = requestAnimationFrame(() => {
        setSimTime(simTimeRef.current);
        scrubUiFrameRef.current = null;
      });
    }
  }, []);

  const handleScrubEnd = useCallback(
    (hours: number) => {
      if (scrubUiFrameRef.current !== null) {
        cancelAnimationFrame(scrubUiFrameRef.current);
        scrubUiFrameRef.current = null;
      }

      scrubbingRef.current = false;
      scrubAnchorRef.current = null;
      baseTimeRef.current = Date.now();
      syncSimTime(hours);
      setOffsetHours(hours);
    },
    [syncSimTime],
  );

  const handleReset = useCallback(() => {
    baseTimeRef.current = Date.now();
    syncSimTime(0);
    setOffsetHours(0);
  }, [syncSimTime]);

  const toggleConstellation = useCallback((id: string) => {
    setVisibleConstellations((current) => ({
      ...current,
      [id]: !current[id],
    }));
  }, []);

  const timeControlProps = {
    simTime,
    offsetHours,
    speed,
    onScrubStart: handleScrubStart,
    onScrubChange: handleScrubChange,
    onScrubEnd: handleScrubEnd,
    onSpeedChange: setSpeed,
    onReset: handleReset,
  };

  const landscapeTimeControlsDock = (
    <div
      ref={landscapeDockRef}
      className="time-controls-gradient absolute inset-x-0 bottom-0 bg-gradient-to-t from-[#02040a]/80 via-[#02040a]/35 to-transparent"
    >
      <TimeControls {...timeControlProps} />
    </div>
  );

  // The dock must mount before it can be measured. Until then its slot is
  // unknown, and bottom:0 would sit under the Safari toolbar — so reserve the
  // space without painting it.
  const portraitDockStyle =
    portraitDockLayout === null
      ? { bottom: 0, top: "auto" as const, visibility: "hidden" as const }
      : portraitDockLayout.mode === "top"
        ? { top: portraitDockLayout.top, bottom: "auto" as const }
        : { bottom: 0, top: "auto" as const };

  const portraitTimeControlsDock = (
    <div
      id="ov-time-dock"
      ref={portraitDockRef}
      className="time-controls-gradient pointer-events-none fixed inset-x-0 z-[10000] bg-gradient-to-t from-[#02040a]/80 via-[#02040a]/35 to-transparent"
      style={portraitDockStyle}
    >
      <TimeControls {...timeControlProps} />
    </div>
  );

  return (
    <div id="ov-root" className="text-white" data-ov-catalog={satellites.length > 0 ? "ready" : "pending"}>
      <div className="absolute inset-0">
        {!cardMode || satellites.length > 0 ? (
          <OrbitalScene
            satellites={satellites}
            visibleConstellations={visibleConstellations}
            speedRef={speedRef}
            baseTimeRef={baseTimeRef}
            offsetHoursRef={offsetHoursRef}
            simTimeRef={simTimeRef}
            scrubbingRef={scrubbingRef}
            onUiUpdate={handleUiUpdate}
            fitCameraDistance={fitCameraDistance}
            maxCameraDistance={maxCameraDistance}
            cameraPosition={cardMode ? cardCameraPosition : undefined}
            viewOffsetY={desktopViewOffsetY}
            cardMode={cardMode}
            trueScale={trueScale}
            onCameraDistance={setCameraDistance}
            contentReady={earthReady && satellites.length > 0}
          />
        ) : null}
      </div>

      {!cardMode ? (
        <header className="app-chrome" aria-label="OrbitalView">
          <h1 className="app-title">OrbitalView</h1>
        </header>
      ) : null}

      {!cardMode ? (
        <ConstellationLegend
          counts={counts}
          visibleConstellations={visibleConstellations}
          open={legendOpen}
          onOpenChange={setLegendOpen}
          onToggle={toggleConstellation}
        />
      ) : null}

      {!cardMode ? (
        <ScaleTeachControls
          trueScale={trueScale}
          onTrueScaleChange={setTrueScale}
          cameraDistance={cameraDistance}
          fitCameraDistance={fitCameraDistance}
          maxCameraDistance={maxCameraDistance}
        />
      ) : null}

      <div className="pointer-events-none absolute inset-0 z-10">
        {!cardMode && warning ? (
          <div className="pointer-events-auto absolute left-1/2 top-[calc(0.375in+env(safe-area-inset-top,0px)+0.35rem)] z-30 max-w-md -translate-x-1/2 rounded-full border border-amber-400/25 bg-amber-950/80 px-3 py-1.5 text-center text-xs text-amber-100">
            {warning}
          </div>
        ) : null}

        {!cardMode && trueScale ? (
          <div className="pointer-events-none absolute left-1/2 top-[calc(0.375in+env(safe-area-inset-top,0px)+2.75rem)] z-30 w-[min(24rem,calc(100vw-2rem))] -translate-x-1/2 rounded-xl border border-white/10 bg-black/[0.02] px-3 py-1.5 text-center text-xs leading-snug text-white/85 backdrop-blur-sm">
            <span className="block font-medium text-white/85">
              Shrinking to true size
            </span>
            <span className="mt-0.5 block line-clamp-3 text-white/85">
              Satellite dots are drawn far larger than real so you can see them
              (see Mag). Real craft are ~3&nbsp;m; Earth is ~12,700&nbsp;km — so
              they vanish.
            </span>
          </div>
        ) : null}

        {!cardMode && uiMounted && !portraitPhone ? landscapeTimeControlsDock : null}
      </div>

      {!cardMode && uiMounted && portraitPhone
        ? createPortal(portraitTimeControlsDock, document.body)
        : null}

      {error ? (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#02040a]/85 backdrop-blur-sm">
          <div className="max-w-md rounded-2xl border border-red-400/20 bg-black/75 px-6 py-4 text-center">
            <p className="text-sm text-red-200">{error}</p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mt-4 rounded-full bg-white/10 px-4 py-2 text-sm hover:bg-white/15"
            >
              Retry
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}