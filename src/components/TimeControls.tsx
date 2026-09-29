"use client";

import {
  SPEED_SLIDER_MAX,
  sliderIndexToSpeed,
  speedToSliderIndex,
} from "@/lib/playback-speed";

interface TimeControlsProps {
  simTime: number;
  offsetHours: number;
  speed: number;
  onScrubStart: () => void;
  onScrubChange: (hours: number) => void;
  onScrubEnd: (hours: number) => void;
  onSpeedChange: (speed: number) => void;
  onReset: () => void;
}

function formatLocalTime(timestamp: number) {
  return new Date(timestamp).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "short",
  });
}

export function TimeControls({
  simTime,
  offsetHours,
  speed,
  onScrubStart,
  onScrubChange,
  onScrubEnd,
  onSpeedChange,
  onReset,
}: TimeControlsProps) {
  return (
    <div className="time-controls-shell pointer-events-auto w-full px-3 pb-[max(0.35rem,env(safe-area-inset-bottom))] pt-1 short-landscape:px-2 short-landscape:pb-1 short-landscape:pt-0.5 tall:px-5 tall:pt-2 desktop:px-4 desktop:pb-1 desktop:pt-1">
      <div className="mx-auto max-w-3xl rounded-xl border border-white/10 bg-black/[0.02] px-3 py-1.5 backdrop-blur-sm short-landscape:px-2 short-landscape:py-1 tall:py-2 desktop:px-2.5 desktop:py-1">
        <div className="mb-0 flex items-center justify-between gap-2 text-[10px] text-white/50 desktop:mb-0.5">
          <span suppressHydrationWarning className="font-mono text-white/75">
            {formatLocalTime(simTime)}
          </span>
          <span>
            {offsetHours >= 0 ? "+" : ""}
            {offsetHours.toFixed(1)}h
          </span>
        </div>

        <input
          type="range"
          min={-12}
          max={12}
          step="any"
          value={offsetHours}
          onPointerDown={onScrubStart}
          onPointerUp={(event) => onScrubEnd(Number(event.currentTarget.value))}
          onPointerCancel={(event) => onScrubEnd(Number(event.currentTarget.value))}
          onInput={(event) => onScrubChange(Number(event.currentTarget.value))}
          className="time-slider mt-0.5 w-full"
          aria-label="Time offset in hours"
        />

        <div className="mt-1.5 flex items-center gap-2 short-landscape:mt-1 short-landscape:gap-1.5 desktop:mt-0.5 desktop:gap-1.5">
          <button
            type="button"
            onClick={onReset}
            className="shrink-0 rounded-full border border-white/15 px-2.5 py-0.5 text-xs text-white/85 hover:bg-white/10 short-landscape:px-2 short-landscape:py-0 tall:px-3 tall:py-1 desktop:px-2 desktop:py-0"
          >
            Now
          </button>

          <input
            type="range"
            min={0}
            max={SPEED_SLIDER_MAX}
            step={1}
            value={speedToSliderIndex(speed)}
            onInput={(event) =>
              onSpeedChange(sliderIndexToSpeed(Number(event.currentTarget.value)))
            }
            className="time-slider min-w-0 flex-1"
            aria-label="Playback speed"
          />

          <span
            aria-live="polite"
            className="shrink-0 min-w-[2.75rem] rounded-md border border-white/10 bg-black/[0.02] px-1.5 py-0.5 text-center font-mono text-xs text-white short-landscape:min-w-[2.25rem] short-landscape:px-1 tall:min-w-[3rem] tall:px-2 tall:py-1 desktop:min-w-[2.5rem] desktop:px-1.5 desktop:py-0"
          >
            {speed}×
          </span>
        </div>
      </div>
    </div>
  );
}
