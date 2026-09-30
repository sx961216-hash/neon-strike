export const WORLD_WIDTH = 7600;
export const WORLD_HEIGHT = 720;
export const GROUND_Y = 610;

export const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
export const lerp = (a, b, t) => a + (b - a) * t;
export const approach = (value, target, amount) => {
  if (value < target) return Math.min(value + amount, target);
  if (value > target) return Math.max(value - amount, target);
  return target;
};

export function aabbIntersects(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function normalize(x, y) {
  const magnitude = Math.hypot(x, y);
  if (magnitude < 0.00001) return { x: 0, y: 0, magnitude: 0 };
  return { x: x / magnitude, y: y / magnitude, magnitude };
}

export function getAimVector(origin, target) {
  return normalize(target.x - origin.x, target.y - origin.y);
}

export function moveAndCollide(entity, dx, dy, solids) {
  let grounded = false;
  let hitWall = false;
  let hitCeiling = false;

  entity.x += dx;
  for (const solid of solids) {
    if (!aabbIntersects(entity, solid)) continue;
    if (dx > 0) entity.x = solid.x - entity.w;
    if (dx < 0) entity.x = solid.x + solid.w;
    hitWall = true;
  }

  entity.y += dy;
  for (const solid of solids) {
    if (!aabbIntersects(entity, solid)) continue;
    if (dy > 0) {
      entity.y = solid.y - entity.h;
      grounded = true;
    } else if (dy < 0) {
      entity.y = solid.y + solid.h;
      hitCeiling = true;
    }
  }

  return { grounded, hitWall, hitCeiling };
}

export function mulberry32(seed) {
  let value = seed >>> 0;
  return function random() {
    value += 0x6d2b79f5;
    let t = value;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomRange(random, min, max) {
  return min + random() * (max - min);
}

export function generateLevel(seed = 20260930) {
  const random = mulberry32(seed);
  const gaps = [
    { x: 1160, w: 130 },
    { x: 2560, w: 150 },
    { x: 3820, w: 190 },
    { x: 5280, w: 150 }
  ];
  const solids = [];
  let cursor = 0;

  for (const gap of gaps) {
    solids.push({ x: cursor, y: GROUND_Y, w: gap.x - cursor, h: 120, kind: 'ground' });
    cursor = gap.x + gap.w;
  }
  solids.push({ x: cursor, y: GROUND_Y, w: WORLD_WIDTH - cursor + 160, h: 120, kind: 'ground' });
  solids.push({ x: 7460, y: 250, w: 34, h: 360, kind: 'wall' });

  const platformBands = [
    [560, 1020, 450],
    [1370, 1880, 380],
    [2050, 2470, 470],
    [2840, 3480, 410],
    [4110, 4850, 370],
    [5520, 6220, 430]
  ];

  for (const [start, end, baseY] of platformBands) {
    const count = random() > 0.55 ? 2 : 1;
    for (let i = 0; i < count; i += 1) {
      const margin = 80;
      const usable = end - start - margin * 2 - 190;
      const x = start + margin + random() * Math.max(40, usable);
      const w = Math.round(randomRange(random, 190, 300));
      const y = Math.round(baseY + randomRange(random, -58, 58));
      solids.push({ x: Math.round(x), y, w, h: 28, kind: 'platform' });
    }
  }

  const enemies = [
    { type: 'turret', x: 760, y: GROUND_Y - 54, w: 54, h: 54, hp: 5, maxHp: 5 },
    { type: 'trooper', x: 980, y: 416, w: 38, h: 52, hp: 3, maxHp: 3, spawnX: 980 },
    { type: 'drone', x: 1430, y: 300, w: 52, h: 38, hp: 3, maxHp: 3, spawnY: 300 },
    { type: 'trooper', x: 1770, y: GROUND_Y - 52, w: 38, h: 52, hp: 3, maxHp: 3, spawnX: 1770 },
    { type: 'turret', x: 2240, y: 416, w: 54, h: 54, hp: 6, maxHp: 6 },
    { type: 'trooper', x: 2380, y: GROUND_Y - 52, w: 38, h: 52, hp: 3, maxHp: 3, spawnX: 2380 },
    { type: 'drone', x: 2900, y: 265, w: 52, h: 38, hp: 3, maxHp: 3, spawnY: 265 },
    { type: 'trooper', x: 3190, y: 358, w: 38, h: 52, hp: 3, maxHp: 3, spawnX: 3190 },
    { type: 'turret', x: 3500, y: GROUND_Y - 54, w: 54, h: 54, hp: 6, maxHp: 6 },
    { type: 'trooper', x: 4210, y: 318, w: 38, h: 52, hp: 3, maxHp: 3, spawnX: 4210 },
    { type: 'drone', x: 4530, y: 270, w: 52, h: 38, hp: 4, maxHp: 4, spawnY: 270 },
    { type: 'trooper', x: 4830, y: GROUND_Y - 52, w: 38, h: 52, hp: 4, maxHp: 4, spawnX: 4830 },
    { type: 'turret', x: 5600, y: 378, w: 54, h: 54, hp: 7, maxHp: 7 },
    { type: 'trooper', x: 5910, y: GROUND_Y - 52, w: 38, h: 52, hp: 4, maxHp: 4, spawnX: 5910 },
    { type: 'drone', x: 6200, y: 285, w: 52, h: 38, hp: 4, maxHp: 4, spawnY: 285 }
  ];

  const pickups = [
    { type: 'health', x: 1550, y: 545, w: 30, h: 30, collected: false },
    { type: 'overdrive', x: 2920, y: 315, w: 30, h: 30, collected: false },
    { type: 'health', x: 4470, y: 300, w: 30, h: 30, collected: false },
    { type: 'overdrive', x: 5850, y: GROUND_Y - 34, w: 30, h: 30, collected: false }
  ];

  return {
    seed,
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    groundY: GROUND_Y,
    playerStart: { x: 130, y: GROUND_Y - 52 },
    solids,
    enemies,
    pickups,
    bossSpawnX: 6200,
    boss: { x: 6960, y: 350, w: 150, h: 170, hp: 100, maxHp: 100 },
    exit: { x: 7375, y: 425, w: 28, h: 185 }
  };
}

export function getBossPhase(health, maxHealth = 100) {
  const ratio = clamp(health / maxHealth, 0, 1);
  if (ratio > 0.66) return 1;
  if (ratio > 0.33) return 2;
  return 3;
}

export function radialBurst(origin, count, speed, baseAngle = 0) {
  const projectiles = [];
  for (let i = 0; i < count; i += 1) {
    const angle = baseAngle + (Math.PI * 2 * i) / count;
    projectiles.push({
      x: origin.x,
      y: origin.y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed
    });
  }
  return projectiles;
}

export function calculateScore(base, combo) {
  return Math.round(base * Math.max(1, combo));
}

export function healthColor(ratio) {
  if (ratio > 0.6) return '#42f5a7';
  if (ratio > 0.3) return '#ffd166';
  return '#ff4d6d';
}