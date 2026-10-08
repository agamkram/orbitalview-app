"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { CONSTELLATION_BY_ID } from "@/lib/constellations";
import {
  lerpPositionBuffers,
  SatelliteRecord,
  writeSatellitePosition,
} from "@/lib/satellite-math";
import {
  getSizeClass,
  isPhonePointViewport,
  resolvePointSize,
  resolveTrueScalePointSize,
  resolveZoomScale,
  SizeClass,
  smoothstep01,
  TRUE_SCALE_TRANSITION_SEC,
} from "@/lib/satellite-point-size";

const PROPAGATE_INTERVAL_MS = 50;
const SNAP_TIME_JUMP_MS = 5_000;
const CAMERA_SIZE_EPSILON = 0.15;
const SIZE_FOLLOW_RATE = 10;
const SIZE_SETTLE_EPSILON = 0.02;

interface RenderGroup {
  key: string;
  constellationId: string;
  color: string;
  sizeClass: SizeClass;
  satellites: SatelliteRecord[];
  previous: Float32Array;
  target: Float32Array;
  display: Float32Array;
}

interface SatelliteFieldProps {
  satellites: SatelliteRecord[];
  visibleConstellations: Record<string, boolean>;
  simTimeRef: React.RefObject<number>;
  scrubbingRef: React.RefObject<boolean>;
  fitCameraDistance: number;
  maxCameraDistance: number;
  trueScale?: boolean;
}

function buildGroups(satelliteList: SatelliteRecord[]): RenderGroup[] {
  const grouped = new Map<string, RenderGroup>();

  for (const satellite of satelliteList) {
    const meta = CONSTELLATION_BY_ID[satellite.constellationId];
    if (!meta) continue;

    const sizeClass = getSizeClass(satellite.constellationId, satellite);
    const key = `${satellite.constellationId}:${sizeClass}`;

    let group = grouped.get(key);
    if (!group) {
      group = {
        key,
        constellationId: satellite.constellationId,
        color: meta.color,
        sizeClass,
        satellites: [],
        previous: new Float32Array(),
        target: new Float32Array(),
        display: new Float32Array(),
      };
      grouped.set(key, group);
    }

    group.satellites.push(satellite);
  }

  for (const group of grouped.values()) {
    const length = group.satellites.length;
    group.previous = new Float32Array(length * 3);
    group.target = new Float32Array(length * 3);
    group.display = new Float32Array(length * 3);
  }

  return Array.from(grouped.values());
}

export function SatelliteField({
  satellites,
  visibleConstellations,
  simTimeRef,
  scrubbingRef,
  fitCameraDistance,
  maxCameraDistance,
  trueScale = false,
}: SatelliteFieldProps) {
  const { camera } = useThree();
  const pointsRefs = useRef<Map<string, THREE.Object3D>>(new Map());
  const groups = useMemo(() => buildGroups(satellites), [satellites]);
  const groupsRef = useRef(groups);
  groupsRef.current = groups;

  const propagateDateRef = useRef(new Date(0));
  const lastPropagateRef = useRef(0);
  const blendRef = useRef(1);
  const lastSimTimeRef = useRef(simTimeRef.current);
  const lastCameraDistanceRef = useRef(-1);
  const lastPhoneViewportRef = useRef(isPhonePointViewport());
  const sizeTargetRef = useRef<Map<string, number>>(new Map());
  /** 0 = exaggerated (visible), 1 = true scale (vanished). Animates on toggle. */
  const trueScaleMixRef = useRef(trueScale ? 1 : 0);
  const trueScaleRef = useRef(trueScale);
  trueScaleRef.current = trueScale;
  const fitDistanceRef = useRef(fitCameraDistance);
  const maxDistanceRef = useRef(maxCameraDistance);
  fitDistanceRef.current = fitCameraDistance;
  maxDistanceRef.current = maxCameraDistance;
  const visibleRef = useRef(visibleConstellations);
  visibleRef.current = visibleConstellations;
  const wasShownRef = useRef<Map<string, boolean>>(new Map());
  const snapKeysRef = useRef(new Set<string>());

  const seedPositions = useCallback(
    (groupList: RenderGroup[]) => {
      propagateDateRef.current.setTime(simTimeRef.current);
      lastSimTimeRef.current = simTimeRef.current;
      blendRef.current = 1;

      for (const group of groupList) {
        for (let i = 0; i < group.satellites.length; i += 1) {
          writeSatellitePosition(
            group.satellites[i].satrec,
            propagateDateRef.current,
            group.target,
            i,
          );
        }
        group.previous.set(group.target);
        group.display.set(group.target);
      }
    },
    [simTimeRef],
  );

  const syncSizeTargets = useCallback(
    (cameraDistance: number, groupList: RenderGroup[]) => {
      const zoomScale = resolveZoomScale(
        cameraDistance,
        fitDistanceRef.current,
        maxDistanceRef.current,
      );
      for (const group of groupList) {
        sizeTargetRef.current.set(
          group.key,
          resolvePointSize(group.sizeClass, zoomScale),
        );
      }
      lastCameraDistanceRef.current = cameraDistance;
      lastPhoneViewportRef.current = isPhonePointViewport();
    },
    [],
  );

  useLayoutEffect(() => {
    seedPositions(groups);
    syncSizeTargets(camera.position.length(), groups);

    const mix = trueScaleMixRef.current;
    const visualT = smoothstep01(mix);
    const atTrue = visualT >= 1 - 1e-6;

    for (const group of groups) {
      const node = pointsRefs.current.get(group.key) as THREE.Points | undefined;
      if (!node) continue;

      const geometry = node.geometry as THREE.BufferGeometry;
      geometry.setAttribute("position", new THREE.BufferAttribute(group.display, 3));
      const positionAttr = geometry.attributes.position;
      if (positionAttr) positionAttr.needsUpdate = true;

      const material = node.material as THREE.PointsMaterial;
      const exaggerated =
        sizeTargetRef.current.get(group.key) ?? resolvePointSize(group.sizeClass);
      // Opacity fade — mobile GPUs clamp point size to ~1px, so size alone won't vanish.
      material.transparent = true;
      material.opacity = atTrue ? 0 : 1 - visualT;
      if (atTrue) {
        material.sizeAttenuation = true;
        material.size = resolveTrueScalePointSize(group.sizeClass);
      } else {
        material.sizeAttenuation = false;
        material.size = exaggerated * (1 - visualT);
      }
    }
  }, [camera, groups, seedPositions, syncSizeTargets]);

  useFrame((_, delta) => {
    const activeGroups = groupsRef.current;
    if (activeGroups.length === 0) return;

    const simTime = simTimeRef.current;
    const now = performance.now();
    const simTimeChanged = simTime !== lastSimTimeRef.current;
    const timeJumpMs = Math.abs(simTime - lastSimTimeRef.current);
    const isScrubbing = scrubbingRef.current;
    const shouldSnap = isScrubbing || timeJumpMs >= SNAP_TIME_JUMP_MS;
    const shown = (group: RenderGroup) =>
      visibleRef.current[group.constellationId] ?? true;
    const snapKeys = snapKeysRef.current;
    snapKeys.clear();
    for (const group of activeGroups) {
      const on = shown(group);
      const was = wasShownRef.current.get(group.key);
      if (on && was === false) snapKeys.add(group.key);
      wasShownRef.current.set(group.key, on);
    }

    const shouldPropagate =
      simTimeChanged &&
      (shouldSnap || now - lastPropagateRef.current >= PROPAGATE_INTERVAL_MS);

    if (shouldPropagate || snapKeys.size > 0) {
      if (shouldPropagate) {
        lastPropagateRef.current = now;
        lastSimTimeRef.current = simTime;
      }
      propagateDateRef.current.setTime(simTime);

      let anyBlended = false;
      for (const group of activeGroups) {
        if (!shown(group)) continue;
        const snapThis = shouldSnap || snapKeys.has(group.key);
        if (!shouldPropagate && !snapThis) continue;

        if (!snapThis) {
          group.previous.set(group.target);
        }
        for (let i = 0; i < group.satellites.length; i += 1) {
          writeSatellitePosition(
            group.satellites[i].satrec,
            propagateDateRef.current,
            group.target,
            i,
          );
        }
        if (snapThis) {
          group.previous.set(group.target);
          group.display.set(group.target);
        } else {
          anyBlended = true;
        }
      }

      if (shouldPropagate) {
        blendRef.current = shouldSnap || !anyBlended ? 1 : 0;
      }
    }

    const blend = blendRef.current;
    const isBlending = blend < 1;

    if (isBlending) {
      blendRef.current = Math.min(1, blend + delta / (PROPAGATE_INTERVAL_MS / 1000));

      for (const group of activeGroups) {
        if (!shown(group)) continue;
        lerpPositionBuffers(group.previous, group.target, group.display, blend);
      }
    }

    const wantTrue = trueScaleRef.current;
    const mixTarget = wantTrue ? 1 : 0;
    let mix = trueScaleMixRef.current;
    let scaleTransitioning = false;
    if (mix !== mixTarget) {
      const step = delta / TRUE_SCALE_TRANSITION_SEC;
      mix = mix < mixTarget ? Math.min(mixTarget, mix + step) : Math.max(mixTarget, mix - step);
      trueScaleMixRef.current = mix;
      scaleTransitioning = mix !== mixTarget;
    }
    const visualT = smoothstep01(mix);
    const atTrue = visualT >= 1 - 1e-6;

    const cameraDistance = camera.position.length();
    const phoneViewport = isPhonePointViewport();
    if (
      !atTrue &&
      (Math.abs(cameraDistance - lastCameraDistanceRef.current) >= CAMERA_SIZE_EPSILON ||
        phoneViewport !== lastPhoneViewportRef.current)
    ) {
      syncSizeTargets(cameraDistance, activeGroups);
    }

    let sizeSettling = scaleTransitioning;
    for (const group of activeGroups) {
      if (!shown(group)) continue;
      const node = pointsRefs.current.get(group.key) as THREE.Points | undefined;
      if (!node) continue;
      const material = node.material as THREE.PointsMaterial;
      const exaggerated =
        sizeTargetRef.current.get(group.key) ?? resolvePointSize(group.sizeClass);

      material.transparent = true;
      const opacityTarget = atTrue ? 0 : 1 - visualT;
      if (material.opacity !== opacityTarget) material.opacity = opacityTarget;

      if (atTrue) {
        if (!material.sizeAttenuation) material.sizeAttenuation = true;
        const target = resolveTrueScalePointSize(group.sizeClass);
        if (material.size !== target) material.size = target;
        continue;
      }

      if (material.sizeAttenuation) material.sizeAttenuation = false;
      const target = exaggerated * (1 - visualT);
      if (scaleTransitioning) {
        material.size = target;
        continue;
      }
      const deltaSize = target - material.size;
      if (Math.abs(deltaSize) > SIZE_SETTLE_EPSILON) {
        material.size += deltaSize * Math.min(1, delta * SIZE_FOLLOW_RATE);
        sizeSettling = true;
      } else if (Math.abs(deltaSize) > 1e-4) {
        material.size = target;
      }
    }

    if (!isBlending && !shouldPropagate && snapKeys.size === 0 && !sizeSettling) return;

    for (const group of activeGroups) {
      if (!shown(group)) continue;
      const node = pointsRefs.current.get(group.key) as THREE.Points | undefined;
      if (!node) continue;

      if (isBlending || shouldPropagate || snapKeys.has(group.key)) {
        const positionAttr = node.geometry.attributes.position;
        if (positionAttr) positionAttr.needsUpdate = true;
      }
    }
  });

  return (
    <>
      {groups.map((group) => (
        <points
          key={group.key}
          ref={(node) => {
            if (node) pointsRefs.current.set(group.key, node as THREE.Object3D);
            else pointsRefs.current.delete(group.key);
          }}
          visible={visibleConstellations[group.constellationId] ?? true}
          frustumCulled={false}
        >
          <bufferGeometry />
          <pointsMaterial
            color={group.color}
            size={resolvePointSize(group.sizeClass)}
            sizeAttenuation={false}
            transparent
            opacity={1}
            toneMapped={false}
            depthTest
            depthWrite={false}
          />
        </points>
      ))}
    </>
  );
}
