import test from 'node:test';
import assert from 'node:assert/strict';
import {
  WORLD_WIDTH,
  aabbIntersects,
  calculateScore,
  clamp,
  generateLevel,
  getAimVector,
  getBossPhase,
  moveAndCollide,
  normalize,
  radialBurst
} from '../src/core.js';

test('clamp constrains values to the expected range', () => {
  assert.equal(clamp(-4, 0, 10), 0);
  assert.equal(clamp(5, 0, 10), 5);
  assert.equal(clamp(14, 0, 10), 10);
});

test('aabbIntersects detects overlap without treating touching edges as a collision', () => {
  assert.equal(aabbIntersects({ x: 0, y: 0, w: 10, h: 10 }, { x: 9, y: 8, w: 10, h: 10 }), true);
  assert.equal(aabbIntersects({ x: 0, y: 0, w: 10, h: 10 }, { x: 10, y: 0, w: 10, h: 10 }), false);
});

test('moveAndCollide resolves horizontal and vertical movement', () => {
  const entity = { x: 0, y: 0, w: 20, h: 20, vx: 0, vy: 0 };
  const solids = [{ x: 50, y: 0, w: 30, h: 30 }, { x: 0, y: 80, w: 100, h: 20 }];
  const wallHit = moveAndCollide(entity, 45, 0, solids);
  assert.equal(wallHit.hitWall, true);
  assert.equal(entity.x, 30);
  const groundHit = moveAndCollide(entity, 0, 85, solids);
  assert.equal(groundHit.grounded, true);
  assert.equal(entity.y, 60);
});

test('normalize and getAimVector return stable unit vectors', () => {
  const normalized = normalize(3, 4);
  assert.equal(normalized.x, 0.6);
  assert.equal(normalized.y, 0.8);
  assert.equal(normalized.magnitude, 5);
  const aim = getAimVector({ x: 10, y: 10 }, { x: 10, y: 20 });
  assert.equal(aim.x, 0);
  assert.equal(aim.y, 1);
});

test('generateLevel is deterministic and contains required game objects', () => {
  const first = generateLevel(42);
  const second = generateLevel(42);
  assert.deepEqual(first.solids, second.solids);
  assert.deepEqual(first.enemies, second.enemies);
  assert.equal(first.width, WORLD_WIDTH);
  assert.ok(first.solids.length >= 10);
  assert.ok(first.enemies.some((enemy) => enemy.type === 'drone'));
  assert.ok(first.enemies.some((enemy) => enemy.type === 'trooper'));
  assert.ok(first.enemies.some((enemy) => enemy.type === 'turret'));
  assert.equal(first.boss.hp, 100);
  assert.equal(first.solids.some((solid) => solid.x === 6500 && solid.y === 230), false);
});

test('getBossPhase switches at the designed health thresholds', () => {
  assert.equal(getBossPhase(100), 1);
  assert.equal(getBossPhase(66), 2);
  assert.equal(getBossPhase(33), 3);
  assert.equal(getBossPhase(-10), 3);
});

test('radialBurst creates the requested number of projectiles', () => {
  const shots = radialBurst({ x: 0, y: 0 }, 8, 100);
  assert.equal(shots.length, 8);
  assert.ok(Math.abs(Math.hypot(shots[0].vx, shots[0].vy) - 100) < 0.001);
});

test('combo scoring scales and rounds predictably', () => {
  assert.equal(calculateScore(220, 1), 220);
  assert.equal(calculateScore(220, 4), 880);
  assert.equal(calculateScore(101, 1.5), 152);
});