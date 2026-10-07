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
          className="pointer-events-auto z-[100000] w-[min(240px,calc(100vw-1.5rem))] overflow-visible rounded-xl border border-white/10 bg-black/[0.02] p-2 backdrop-blur-sm"
        >
          <ul className="space-y-1">
            {sortedConstellations.map((constellation) => {
              const visible = visibleConstellations[constellation.id] ?? true;
              const count = counts[constellation.id] ?? 0;

              return (
                <li key={constellation.id}>
                  <button
                    type="button"
                    onClick={() => onToggle(constellation.id)}
                    className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-xs transition ${
                      visible ? "hover:bg-white/10" : "opacity-40 hover:opacity-65"
                    }`}
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: constellation.color }}
                    />
                    <span className="min-w-0 flex-1 truncate text-white/90">
                      {constellation.name}
                    </span>
                    <span className="font-mono text-[10px] text-white/45">
                      {count.toLocaleString()}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </>,
    document.body,
  );
}
