"use client";

import { useFrame, useThree } from "@react-three/fiber";
import { useCallback, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";

import { CONSTELLATION_BY_ID } from "@/lib/constellations";
import { SatelliteRecord, writeSatellitePosition } from "@/lib/satellite-math";
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

/** Sim time between SGP4 solves. A straight chord over 20 s of LEO stays sub-pixel at max zoom. */
const SEGMENT_SIM_MS = 20_000;
/** Finish solving the next segment by this fraction of the current one. */
const PREFETCH_DONE_AT = 0.75;
const CAMERA_SIZE_EPSILON = 0.15;
const SIZE_FOLLOW_RATE = 10;
const SIZE_SETTLE_EPSILON = 0.02;

interface RenderGroup {
  key: string;
  constellationId: string;
  color: string;
  sizeClass: SizeClass;
  satellites: SatelliteRecord[];
  /** Positions at segment start. */
  from: THREE.BufferAttribute;
  /** Positions at segment end. */
  to: THREE.BufferAttribute;
  /** Positions for the following segment end, solved a slice per frame. */
  next: THREE.BufferAttribute;
}

interface Segment {
  t0: number;
  t1: number;
  t2: number;
  cursorGroup: number;
  cursorIndex: number;
  solved: number;
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
  const empty = () => new THREE.BufferAttribute(new Float32Array(), 3);

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
        from: empty(),
        to: empty(),
        next: empty(),
      };
      grouped.set(key, group);
    }

    group.satellites.push(satellite);
  }

  for (const group of grouped.values()) {
    const length = group.satellites.length * 3;
    group.from = new THREE.BufferAttribute(new Float32Array(length), 3);
    group.to = new THREE.BufferAttribute(new Float32Array(length), 3);
    group.next = new THREE.BufferAttribute(new Float32Array(length), 3);
  }

  return Array.from(grouped.values());
}

function solve(
  group: RenderGroup,
  attr: THREE.BufferAttribute,
  date: Date,
  start: number,
  end: number,
) {
  const array = attr.array as Float32Array;
  for (let i = start; i < end; i += 1) {
    writeSatellitePosition(group.satellites[i].satrec, date, array, i);
  }
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

  const blendUniformRef = useRef({ value: 1 });
  const onBeforeCompile = useCallback(
    (shader: THREE.WebGLProgramParametersWithUniforms) => {
      shader.uniforms.uBlend = blendUniformRef.current;
      shader.vertexShader = shader.vertexShader
        .replace(
          "#include <common>",
          "#include <common>\nattribute vec3 targetPosition;\nuniform float uBlend;",
        )
        .replace(
          "#include <begin_vertex>",
          "vec3 transformed = mix( position, targetPosition, uBlend );",
        );
    },
    [],
  );

  const dateRef = useRef(new Date(0));
  const segmentRef = useRef<Segment>({
    t0: 0,
    t1: 0,
    t2: 0,
    cursorGroup: 0,
    cursorIndex: 0,
    solved: 0,
  });
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

  const shown = useCallback(
    (group: RenderGroup) => visibleRef.current[group.constellationId] ?? true,
    [],
  );

  const bindAttributes = useCallback((group: RenderGroup) => {
    const node = pointsRefs.current.get(group.key) as THREE.Points | undefined;
    if (!node) return;
    node.geometry.setAttribute("position", group.from);
    node.geometry.setAttribute("targetPosition", group.to);
  }, []);

  const resetSegment = useCallback((simTime: number) => {
    const segment = segmentRef.current;
    segment.t0 = simTime;
    segment.t1 = simTime;
    segment.t2 = simTime + SEGMENT_SIM_MS;
    segment.cursorGroup = 0;
    segment.cursorIndex = 0;
    segment.solved = 0;
  }, []);

  /** Solve every shown group at simTime and hold there; the next frame starts a new segment. */
  const snapAll = useCallback(
    (groupList: RenderGroup[], simTime: number) => {
      resetSegment(simTime);
      dateRef.current.setTime(simTime);
      for (const group of groupList) {
        if (!shown(group)) continue;
        solve(group, group.from, dateRef.current, 0, group.satellites.length);
        (group.to.array as Float32Array).set(group.from.array as Float32Array);
        group.from.needsUpdate = true;
        group.to.needsUpdate = true;
        bindAttributes(group);
      }
    },
    [bindAttributes, resetSegment, shown],
  );

  /** Bring a just-shown group up to the shared segment. */
  const catchUp = useCallback(
    (group: RenderGroup, groupIndex: number) => {
      const segment = segmentRef.current;
      const length = group.satellites.length;
      dateRef.current.setTime(segment.t0);
      solve(group, group.from, dateRef.current, 0, length);
      dateRef.current.setTime(segment.t1);
      solve(group, group.to, dateRef.current, 0, length);
      const nextSolved =
        groupIndex < segment.cursorGroup
          ? length
          : groupIndex === segment.cursorGroup
            ? segment.cursorIndex
            : 0;
      if (nextSolved > 0) {
        dateRef.current.setTime(segment.t2);
        solve(group, group.next, dateRef.current, 0, nextSolved);
      }
      group.from.needsUpdate = true;
      group.to.needsUpdate = true;
      bindAttributes(group);
    },
    [bindAttributes],
  );

  /** Solve the next segment end until `target` satellites (across shown groups) are done. */
  const prefetch = useCallback(
    (groupList: RenderGroup[], target: number) => {
      const segment = segmentRef.current;
      if (segment.solved >= target) return;
      dateRef.current.setTime(segment.t2);
      while (segment.solved < target && segment.cursorGroup < groupList.length) {
        const group = groupList[segment.cursorGroup];
        const length = group.satellites.length;
        if (!shown(group)) {
          segment.cursorGroup += 1;
          segment.cursorIndex = 0;
          continue;
        }
        const end = Math.min(length, segment.cursorIndex + (target - segment.solved));
        solve(group, group.next, dateRef.current, segment.cursorIndex, end);
        segment.solved += end - segment.cursorIndex;
        segment.cursorIndex = end;
        if (end >= length) {
          segment.cursorGroup += 1;
          segment.cursorIndex = 0;
        }
      }
    },
    [shown],
  );

  const rotate = useCallback(
    (groupList: RenderGroup[]) => {
      prefetch(groupList, Infinity);
      const segment = segmentRef.current;
      segment.t0 = segment.t1;
      segment.t1 = segment.t2;
      segment.t2 = segment.t1 + SEGMENT_SIM_MS;
      segment.cursorGroup = 0;
      segment.cursorIndex = 0;
      segment.solved = 0;
      for (const group of groupList) {
        const { from, to, next } = group;
        group.from = to;
        group.to = next;
        group.next = from;
        if (!shown(group)) continue;
        group.to.needsUpdate = true;
        bindAttributes(group);
      }
    },
    [bindAttributes, prefetch, shown],
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
    for (const group of groups) {
      wasShownRef.current.set(group.key, shown(group));
    }
    snapAll(groups, simTimeRef.current);
    syncSizeTargets(camera.position.length(), groups);

    const mix = trueScaleMixRef.current;
    const visualT = smoothstep01(mix);
    const atTrue = visualT >= 1 - 1e-6;

    for (const group of groups) {
      const node = pointsRefs.current.get(group.key) as THREE.Points | undefined;
      if (!node) continue;

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
  }, [camera, groups, shown, simTimeRef, snapAll, syncSizeTargets]);

  useFrame((_, delta) => {
    const activeGroups = groupsRef.current;
    if (activeGroups.length === 0) return;

    const simTime = simTimeRef.current;
    const segment = segmentRef.current;

    if (scrubbingRef.current) {
      if (simTime !== segment.t0 || segment.t1 !== segment.t0) snapAll(activeGroups, simTime);
    } else if (simTime < segment.t0 || simTime > segment.t2) {
      snapAll(activeGroups, simTime);
    } else if (simTime >= segment.t1) {
      rotate(activeGroups);
    }

    let shownCount = 0;
    for (let g = 0; g < activeGroups.length; g += 1) {
      const group = activeGroups[g];
      const on = shown(group);
      if (on && wasShownRef.current.get(group.key) === false) catchUp(group, g);
      wasShownRef.current.set(group.key, on);
      if (on) shownCount += group.satellites.length;
    }

    const span = segment.t1 - segment.t0;
    const blend = span > 0 ? Math.min(1, Math.max(0, (simTime - segment.t0) / span)) : 1;
    blendUniformRef.current.value = blend;
    if (span > 0) {
      prefetch(
        activeGroups,
        Math.ceil(shownCount * Math.min(1, blend / PREFETCH_DONE_AT)),
      );
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
      } else if (Math.abs(deltaSize) > 1e-4) {
        material.size = target;
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
            onBeforeCompile={onBeforeCompile}
          />
        </points>
      ))}
    </>
  );
}
