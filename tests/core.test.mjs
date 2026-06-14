import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  dmgMult, cdMult, speedMult, lerpAngle, axisToAngle,
  resolveMoveAxis, jumpDecision, resolveVertical, clampToArena,
  approach, enemyIntent, shouldWake, shopItemState,
  wavePlan, clamp, decay,
} from '../game/core.js';

test('upgrade multipliers clamp to table bounds', () => {
  assert.equal(dmgMult(0), 1);
  assert.equal(dmgMult(2), 1.5);
  assert.equal(dmgMult(5), 1.5);   // clamps high
  assert.equal(dmgMult(-3), 1);    // clamps low
  assert.equal(cdMult(1), 0.85);
  assert.equal(speedMult(2), 1.5);
});

test('lerpAngle takes the short way around the circle', () => {
  // from ~PI to ~-PI should move a tiny step, not wrap the long way
  const a = Math.PI - 0.1, b = -Math.PI + 0.1;
  const r = lerpAngle(a, b, 0.5);
  assert.ok(Math.abs(r) > Math.PI - 0.2, `expected near +/-PI, got ${r}`);
});

test('axisToAngle convention', () => {
  assert.ok(Math.abs(axisToAngle(0, -1) - 0) < 1e-9);        // forward
  assert.ok(Math.abs(axisToAngle(-1, 0) - Math.PI / 2) < 1e-9); // left
});

test('resolveMoveAxis prefers joystick when active', () => {
  const r = resolveMoveAxis({ active: true, axisX: 1, axisY: 0 }, {});
  assert.equal(r.nx, 1); assert.equal(r.nz, 0); assert.equal(r.mag, 1);
});

test('resolveMoveAxis falls back to keys and normalizes diagonal', () => {
  const r = resolveMoveAxis({ active: false, axisX: 0, axisY: 0 }, { right: true, back: true });
  assert.ok(Math.abs(Math.hypot(r.nx, r.nz) - 1) < 1e-9, 'diagonal normalized to length 1');
});

test('resolveMoveAxis honours deadzone', () => {
  const r = resolveMoveAxis({ active: true, axisX: 0.03, axisY: 0.03 }, {});
  assert.equal(r.mag, 0);
});

test('jumpDecision: ground jump available', () => {
  assert.equal(jumpDecision({ jumpsLeft: 2, dashActive: false, hasDash: false, moving: true }), 'jump');
});

test('jumpDecision: air jump still works (double jump)', () => {
  assert.equal(jumpDecision({ jumpsLeft: 1, dashActive: false, hasDash: false, moving: false }), 'jump');
});

test('jumpDecision: out of jumps with dash + movement → dash', () => {
  assert.equal(jumpDecision({ jumpsLeft: 0, dashActive: false, hasDash: true, moving: true }), 'dash');
});

test('jumpDecision: out of jumps, no dash → nothing', () => {
  assert.equal(jumpDecision({ jumpsLeft: 0, dashActive: false, hasDash: false, moving: true }), 'none');
});

test('jumpDecision: never act while dashing', () => {
  assert.equal(jumpDecision({ jumpsLeft: 2, dashActive: true, hasDash: true, moving: true }), 'none');
});

test('resolveVertical lands on ground and refills jumps', () => {
  const r = resolveVertical({ x: 0, y: -0.5, z: 0 }, -5, [], 0.6, 2);
  assert.equal(r.y, 0); assert.equal(r.vy, 0); assert.equal(r.onGround, true); assert.equal(r.jumpsLeft, 2);
});

test('resolveVertical lands on a platform top within bounds', () => {
  const plat = [{ x: 0, z: 0, hw: 4, hd: 4, top: 6 }];
  const r = resolveVertical({ x: 0, y: 5.9, z: 0 }, -3, plat, 0.6, 3);
  assert.equal(r.y, 6); assert.equal(r.onGround, true); assert.equal(r.jumpsLeft, 3);
});

test('resolveVertical ignores platform when rising fast', () => {
  const plat = [{ x: 0, z: 0, hw: 4, hd: 4, top: 6 }];
  const r = resolveVertical({ x: 0, y: 5.9, z: 0 }, 10, plat, 0.6, 2);
  assert.equal(r.onGround, false);
});

test('resolveVertical stays airborne above everything', () => {
  const r = resolveVertical({ x: 0, y: 12, z: 0 }, -2, [], 0.6, 2);
  assert.equal(r.onGround, false); assert.equal(r.jumpsLeft, null);
});

test('clampToArena pulls points back to the radius', () => {
  const r = clampToArena(100, 0, 50);
  assert.ok(Math.abs(r.x - 50) < 1e-9); assert.equal(r.clamped, true);
  const inside = clampToArena(10, 10, 50);
  assert.equal(inside.clamped, false);
});

test('approach moves toward target and converges', () => {
  let v = 0;
  for (let i = 0; i < 200; i++) v = approach(v, 14, 1 / 60, 55, 14);
  assert.ok(Math.abs(v - 14) < 0.1, `converged to ${v}`);
});

test('enemyIntent: dormant asleep does nothing', () => {
  const r = enemyIntent({ type: 'dormant', dist: 5, alert: false });
  assert.deepEqual(r, { move: 0, shoot: false, contact: false });
});

test('enemyIntent: sniper retreats when too close', () => {
  assert.equal(enemyIntent({ type: 'sniper', dist: 10, alert: true }).move, -1);
  assert.equal(enemyIntent({ type: 'sniper', dist: 40, alert: true }).move, 1);
  assert.equal(enemyIntent({ type: 'sniper', dist: 22, alert: true }).move, 0);
});

test('enemyIntent: chaser closes and reports contact', () => {
  assert.equal(enemyIntent({ type: 'chaser', dist: 20, alert: true }).move, 1);
  assert.equal(enemyIntent({ type: 'chaser', dist: 1, alert: true, reach: 1.9 }).contact, true);
});

test('shouldWake: chaser always awake; dormant by proximity; damage wakes any', () => {
  assert.equal(shouldWake({ type: 'chaser', dist: 99, damaged: false }), true);
  assert.equal(shouldWake({ type: 'dormant', dist: 20, damaged: false }), false);
  assert.equal(shouldWake({ type: 'dormant', dist: 8, damaged: false }), true);
  assert.equal(shouldWake({ type: 'sniper', dist: 99, damaged: true }), true);
});

test('wavePlan scales enemy count and caps tough chance', () => {
  assert.equal(wavePlan(1).count, 5);
  assert.equal(wavePlan(10).count, 14);
  assert.ok(wavePlan(1).toughChance < wavePlan(5).toughChance);
  assert.equal(wavePlan(100).toughChance, 0.5); // capped
});

test('clamp bounds values', () => {
  assert.equal(clamp(5, 0, 3), 3);
  assert.equal(clamp(-1, 0, 3), 0);
  assert.equal(clamp(2, 0, 3), 2);
});

test('decay never goes below zero', () => {
  assert.equal(decay(1, 0.5, 1), 0.5);
  assert.equal(decay(0.1, 1, 1), 0);
});

test('shopItemState reflects affordability, ownership and locks', () => {
  assert.equal(shopItemState({ price: 100 }, { bolts: 50, owned: false }), 'unaffordable');
  assert.equal(shopItemState({ price: 100 }, { bolts: 150, owned: false }), 'buyable');
  assert.equal(shopItemState({ price: 100 }, { bolts: 150, owned: true }), 'owned');
  assert.equal(shopItemState({ price: 100, req: 'x' }, { bolts: 999, owned: false, boughtReq: false }), 'locked');
  assert.equal(shopItemState({ price: 100, req: 'x' }, { bolts: 999, owned: false, boughtReq: true }), 'buyable');
});
