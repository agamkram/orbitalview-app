"use client";

import { OrbitControls } from "@react-three/drei";
import { Canvas } from "@react-three/fiber";
import { memo, Suspense } from "react";

import { CARD_EARTH_ROTATION_Y } from "@/lib/card-preview";
import {
  CAMERA_FOV,
  CAMERA_MIN_DISTANCE,
  SatelliteRecord,
} from "@/lib/satellite-math";
import { CameraDistanceReporter } from "./CameraDistanceReporter";
import { CameraFit } from "./CameraFit";
import { Earth } from "./Earth";
import { SatelliteField } from "./SatelliteField";
import { SceneClock } from "./SceneClock";
import { Starfield } from "./Starfield";

interface OrbitalSceneProps {
  satellites: SatelliteRecord[];
  visibleConstellations: Record<string, boolean>;
  speedRef: React.RefObject<number>;
  baseTimeRef: React.RefObject<number>;
  offsetHoursRef: React.RefObject<number>;
  simTimeRef: React.RefObject<number>;
  scrubbingRef: React.RefObject<boolean>;
  onUiUpdate: (offsetHours: number) => void;
  fitCameraDistance: number;
  maxCameraDistance: number;
  cameraPosition?: [number, number, number];
  viewOffsetY?: number;
  cardMode?: boolean;
  trueScale?: boolean;
  onCameraDistance?: (distance: number) => void;
  contentReady?: boolean;
}

export const OrbitalScene = memo(function OrbitalScene({
  satellites,
  visibleConstellations,
  speedRef,
  baseTimeRef,
  offsetHoursRef,
  simTimeRef,
  scrubbingRef,
  onUiUpdate,
  fitCameraDistance,
  maxCameraDistance,
  cameraPosition,
  viewOffsetY = 0,
  cardMode = false,
  trueScale = false,
  onCameraDistance,
  contentReady = true,
}: OrbitalSceneProps) {
  return (
    <Canvas
      frameloop="always"
      camera={{
        position: cameraPosition ?? [0, 0, fitCameraDistance],
        fov: CAMERA_FOV,
        near: 0.1,
        far: 200,
      }}
      dpr={[1, 1.5]}
      gl={{ antialias: true }}
      style={{ touchAction: "none" }}
    >
      <CameraFit
        distance={fitCameraDistance}
        position={cameraPosition}
        viewOffsetY={viewOffsetY}
      />
      {onCameraDistance ? (
        <CameraDistanceReporter onDistance={onCameraDistance} />
      ) : null}
      <SceneClock
        speedRef={speedRef}
        baseTimeRef={baseTimeRef}
        offsetHoursRef={offsetHoursRef}
        simTimeRef={simTimeRef}
        scrubbingRef={scrubbingRef}
        onUiUpdate={onUiUpdate}
      />
      <ambientLight intensity={cardMode ? 0.62 : 0.35} />
      <directionalLight
        position={cardMode ? [6, 2, 5] : [8, 4, 2]}
        intensity={cardMode ? 1.05 : 1.4}
      />
      <Starfield />
      {/* Earth's texture suspends. The boundary keeps that from reaching the
          page, which would hide the whole UI; holding the globe and the dots
          together keeps them from popping in separately. */}
      <Suspense fallback={null}>
        {contentReady ? (
          <>
            <Earth rotationY={cardMode ? CARD_EARTH_ROTATION_Y : 0} />
            <SatelliteField
              satellites={satellites}
              visibleConstellations={visibleConstellations}
              simTimeRef={simTimeRef}
              scrubbingRef={scrubbingRef}
              fitCameraDistance={fitCameraDistance}
              maxCameraDistance={maxCameraDistance}
              trueScale={trueScale}
            />
          </>
        ) : null}
      </Suspense>
      <OrbitControls
        enablePan={false}
        minDistance={CAMERA_MIN_DISTANCE}
        maxDistance={maxCameraDistance}
        rotateSpeed={0.45}
        zoomSpeed={0.7}
        enableDamping
        dampingFactor={0.08}
      />
    </Canvas>
  );
});