/* Bolt Ranger — pure game logic (no THREE.js, no DOM).
 * Everything here is deterministic and unit-testable in Node. */

// ── Upgrade math ────────────────────────────────────────────────────────────
export const DMG_TABLE   = [1, 1.25, 1.5];
export const CD_TABLE    = [1, 0.85, 0.70];
export const SPEED_TABLE = [1, 1.25, 1.5];

export const dmgMult   = (lvl) => DMG_TABLE[Math.max(0, Math.min(2, lvl))];
export const cdMult    = (lvl) => CD_TABLE[Math.max(0, Math.min(2, lvl))];
export const speedMult = (lvl) => SPEED_TABLE[Math.max(0, Math.min(2, lvl))];

// ── Angle helpers ───────────────────────────────────────────────────────────
export function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

// Aim/facing angle from a 2D axis (joystick / movement vector).
// Matches the convention used for rendering (atan2(-x, -z)).
export function axisToAngle(x, z) {
  return Math.atan2(-x, -z);
}

// ── Movement input resolution ───────────────────────────────────────────────
// Returns a normalized-ish movement vector and its magnitude.
export function resolveMoveAxis(joy, keys, deadzone = 0.08) {
  let nx = 0, nz = 0;
  if (joy.active && (Math.abs(joy.axisX) > deadzone || Math.abs(joy.axisY) > deadzone)) {
    nx = joy.axisX; nz = joy.axisY;
  } else {
    nx = (keys.right ? 1 : 0) - (keys.left ? 1 : 0);
    nz = (keys.back ? 1 : 0) - (keys.fwd ? 1 : 0);
  }
  const mag = Math.hypot(nx, nz);
  if (mag > 1) { nx /= mag; nz /= mag; }
  return { nx, nz, mag };
}

// ── Jump / dash decision ────────────────────────────────────────────────────
// Edge-triggered: call once per queued jump press. Pure decision, no state mutation.
// Returns 'jump' | 'dash' | 'none'.
export function jumpDecision({ jumpsLeft, dashActive, hasDash, moving }) {
  if (dashActive) return 'none';
  if (jumpsLeft > 0) return 'jump';
  if (jumpsLeft === 0 && hasDash && moving) return 'dash';
  return 'none';
}

// ── Vertical collision (ground + platforms) ─────────────────────────────────
// platforms: [{x, z, hw, hd, top}]. Returns the resolved vertical state.
// `vy` is current vertical velocity; landing zeroes it and refills jumps.
export function resolveVertical(pos, vy, platforms, halfR, jumpMax) {
  // Platforms first (may be above ground).
  for (const pl of platforms) {
    if (vy <= 0.5 &&
        pos.y <= pl.top + 0.25 && pos.y >= pl.top - 2.2 &&
        Math.abs(pos.x - pl.x) < pl.hw + halfR &&
        Math.abs(pos.z - pl.z) < pl.hd + halfR) {
      return { y: pl.top, vy: 0, onGround: true, jumpsLeft: jumpMax };
    }
  }
  if (pos.y <= 0) {
    return { y: 0, vy: 0, onGround: true, jumpsLeft: jumpMax };
  }
  return { y: pos.y, vy, onGround: false, jumpsLeft: null };
}

// ── Arena boundary clamp ────────────────────────────────────────────────────
export function clampToArena(x, z, maxR) {
  const d = Math.hypot(x, z);
  if (d > maxR) {
    const s = maxR / d;
    return { x: x * s, z: z * s, clamped: true };
  }
  return { x, z, clamped: false };
}

// ── Smooth acceleration toward a target velocity ─────────────────────────────
export function approach(current, target, dt, accel, ref) {
  const k = Math.min(1, dt * accel / Math.max(0.001, ref));
  return current + (target - current) * k;
}

// ── Enemy AI intent ─────────────────────────────────────────────────────────
// type: 'chaser' | 'dormant' | 'sniper' | 'boss'
// Returns { move: -1|0|1 along the player direction, shoot: bool, contact: bool }.
export function enemyIntent({ type, dist, alert, reach = 1.9 }) {
  if (!alert) return { move: 0, shoot: false, contact: false };
  if (type === 'sniper') {
    if (dist < 16) return { move: -1, shoot: dist < 45, contact: false };
    if (dist > 30) return { move: 1, shoot: false, contact: false };
    return { move: 0, shoot: dist < 45, contact: false };
  }
  // chaser / dormant(awake) / boss
  if (dist > reach) return { move: 1, shoot: dist < 50, contact: false };
  return { move: 0, shoot: false, contact: true };
}

// Wake condition for non-chaser enemies.
export function shouldWake({ type, dist, damaged }) {
  if (type === 'chaser' || type === 'boss') return true;
  if (damaged) return true;
  const range = type === 'dormant' ? 12 : 26;
  return dist < range;
}

// ── Shop affordability / lock state ─────────────────────────────────────────
export function shopItemState(item, { bolts, owned, boughtReq }) {
  if (owned) return 'owned';
  if (item.req && !boughtReq) return 'locked';
  if (bolts < item.price) return 'unaffordable';
  return 'buyable';
}
