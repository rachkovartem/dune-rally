// server/poseTrust.ts
import type { PoseMsg } from '../shared/protocol';
import { POSE_SNAP_DISTANCE } from './arenaSim';

// A car goes faster than its engine's top speed only down a slope or in a fall.
export const POSE_SPEED_ALLOWANCE = 1.25;
// The distance a pose may run ahead of the server copy per second, as a share of the speed cap.
export const POSE_DISTANCE_PER_SPEED = 1.5;
// Room for the R reset lift and for the client's own fall-through and border recovery.
export const POSE_DISTANCE_MARGIN = 5;

export interface PoseCheck {
  pose: PoseMsg;
  /** Where the server copy of this car is now. */
  serverPosition: { x: number; y: number; z: number };
  /** Since the last pose from this client that passed this check (or since the car was placed). */
  secondsSinceAccepted: number;
  /** The engine's top speed of this player's car, m/s. */
  topSpeed: number;
}

/** The farthest a pose may be from the server copy: a car cannot have driven further than this. */
export function plausiblePoseDistance(check: Pick<PoseCheck, 'secondsSinceAccepted' | 'topSpeed'>): number {
  const speedCap = check.topSpeed * POSE_SPEED_ALLOWANCE;
  const seconds = Math.max(0, check.secondsSinceAccepted);
  return Math.max(POSE_SNAP_DISTANCE, POSE_DISTANCE_PER_SPEED * speedCap * seconds) + POSE_DISTANCE_MARGIN;
}

/**
 * The pose the server may apply, or null when it is further from the server copy than the car could
 * have driven: the client would otherwise move its copy anywhere on the map in one message. The
 * velocity is capped at the car's own speed cap, so a snap cannot throw the copy across the map either.
 */
export function trustedPose(check: PoseCheck): PoseMsg | null {
  const { pose, serverPosition } = check;
  const distance = Math.hypot(pose.x - serverPosition.x, pose.y - serverPosition.y, pose.z - serverPosition.z);
  if (distance > plausiblePoseDistance(check)) return null;
  const speedCap = check.topSpeed * POSE_SPEED_ALLOWANCE;
  const speed = Math.hypot(pose.vx, pose.vy, pose.vz);
  if (speed <= speedCap) return pose;
  const scale = speedCap / speed;
  return { ...pose, vx: pose.vx * scale, vy: pose.vy * scale, vz: pose.vz * scale };
}
