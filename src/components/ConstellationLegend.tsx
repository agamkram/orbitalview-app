"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { CONSTELLATIONS } from "@/lib/constellations";
import { measureHomeScreenInsets } from "@/lib/ios-home-screen";

interface ConstellationLegendProps {
  counts: Record<string, number>;
  visibleConstellations: Record<string, boolean>;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onToggle: (id: string) => void;
  onSetAll: (visible: boolean) => void;
}

/** Gap from Constellations button bottom edge to panel top — keep tight. */
const PANEL_GAP = 34;
/** Sit just under the Michroma title chrome (0.375in ≈ 36px content row). */
const TITLE_CLEARANCE = 36;
const DESKTOP_TOP = 10;

function isDesktopPointer() {
  return (
    navigator.maxTouchPoints === 0 &&
    window.matchMedia("(hover: hover) and (pointer: fine)").matches
  );
}

function getEdgeInset(wide: boolean) {
  const { top, right } = measureHomeScreenInsets();
  const baseRight = wide ? 20 : 12;
  const baseTop = isDesktopPointer() ? DESKTOP_TOP : 0;
  // Clear the fixed app title, stay tight under it.
  const resolvedTop = Math.max(baseTop, top) + TITLE_CLEARANCE;

  return {
    top: resolvedTop,
    right: Math.max(baseRight, right),
    panelTop: resolvedTop + PANEL_GAP,
  };
}

export function ConstellationLegend({
  counts,
  visibleConstellations,
  open,
  onOpenChange,
  onToggle,
  onSetAll,
}: ConstellationLegendProps) {
  const [mounted, setMounted] = useState(false);
  const [edgeInset, setEdgeInset] = useState({ top: 0, right: 12, panelTop: PANEL_GAP });

  useEffect(() => {
    setMounted(true);

    const updateInsets = () => {
      const wide = window.matchMedia("(min-width: 640px)").matches;
      setEdgeInset(getEdgeInset(wide));
    };

    updateInsets();
    window.addEventListener("resize", updateInsets);
    window.visualViewport?.addEventListener("resize", updateInsets);
    window.visualViewport?.addEventListener("scroll", updateInsets);

    return () => {
      window.removeEventListener("resize", updateInsets);
      window.visualViewport?.removeEventListener("resize", updateInsets);
      window.visualViewport?.removeEventListener("scroll", updateInsets);
    };
  }, []);

  // Close on outside tap without a full-screen blocker (that kills zoom).
  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      const target = event.target as Node;
      const btn = document.getElementById("ov-constellation-btn");
      const panel = document.getElementById("ov-constellation-panel");
      if (btn?.contains(target) || panel?.contains(target)) return;
      onOpenChange(false);
    };

    document.addEventListener("pointerdown", onPointerDown, true);
    return () => document.removeEventListener("pointerdown", onPointerDown, true);
  }, [open, onOpenChange]);

  const sortedConstellations = useMemo(
    () =>
      [...CONSTELLATIONS].sort(
        (a, b) => (counts[b.id] ?? 0) - (counts[a.id] ?? 0),
      ),
    [counts],
  );

  if (!mounted) return null;

  const allOn = CONSTELLATIONS.every(
    (constellation) => visibleConstellations[constellation.id] ?? true,
  );
  const noneOn = CONSTELLATIONS.every(
    (constellation) => !(visibleConstellations[constellation.id] ?? true),
  );

  const fixedStyle = {
    right: edgeInset.right,
  } as const;

  return createPortal(
    <>
      <button
        id="ov-constellation-btn"
        type="button"
        onClick={() => onOpenChange(!open)}
        style={{ ...fixedStyle, top: edgeInset.top }}
        className="pointer-events-auto z-[100000] rounded-full border border-white/10 bg-black/[0.02] px-3 py-1.5 text-xs text-white/85 backdrop-blur-sm hover:bg-black/10"
        aria-expanded={open}
        aria-label={open ? "Hide constellations" : "Show constellations"}
      >
        {open ? "Hide" : "Constellations"}
      </button>

      {open ? (
        <div
          id="ov-constellation-panel"
          style={{ ...fixedStyle, top: edgeInset.panelTop }}
          className="pointer-events-auto z-[100000] w-max max-w-[calc(100vw-1.5rem)] overflow-visible rounded-xl border border-white/10 bg-black/[0.02] px-[3px] pt-2 pb-[2px] backdrop-blur-sm"
        >
          <div className="mb-1.5 flex items-center justify-end gap-1.5 px-0.5">
            <button
              type="button"
              onClick={() => onSetAll(true)}
              className={`rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none ${
                allOn
                  ? "border-white/35 bg-white/20 text-white"
                  : "border-white/10 text-white/40 hover:text-white/70"
              }`}
              aria-label="Select all constellations"
              aria-pressed={allOn}
            >
              All
            </button>
            <button
              type="button"
              onClick={() => onSetAll(false)}
              className={`rounded-full border px-2 py-0.5 text-[11px] font-medium leading-none ${
                noneOn
                  ? "border-white/35 bg-white/20 text-white"
                  : "border-white/10 text-white/40 hover:text-white/70"
              }`}
              aria-label="Deselect all constellations"
              aria-pressed={noneOn}
            >
              None
            </button>
          </div>
          <table className="border-separate border-spacing-y-[3px] text-xs">
            <tbody>
              {sortedConstellations.map((constellation) => {
                const visible = visibleConstellations[constellation.id] ?? true;
                const count = counts[constellation.id] ?? 0;

                return (
                  <tr
                    key={constellation.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => onToggle(constellation.id)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onToggle(constellation.id);
                      }
                    }}
                    className={`rounded-lg transition ${
                      visible ? "hover:bg-white/10" : "opacity-40 hover:opacity-65"
                    }`}
                  >
                    <td className="rounded-l-lg py-1.5 pl-2">
                      <span
                        className="block h-2.5 w-2.5 rounded-full"
                        style={{ backgroundColor: constellation.color }}
                      />
                    </td>
                    <td className="whitespace-nowrap py-1.5 pl-2 text-white/90">
                      {constellation.name}
                    </td>
                    <td className="rounded-r-lg py-1.5 pl-3 pr-2 text-right font-mono text-[10px] tabular-nums text-white/45">
                      {count.toLocaleString()}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-1 whitespace-nowrap text-center font-sans text-xs leading-none text-white/40">
            Data from space-track.org
          </p>
        </div>
      ) : null}
    </>,
    document.body,
  );
}
