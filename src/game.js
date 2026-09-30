import {
  WORLD_WIDTH,
  GROUND_Y,
  aabbIntersects,
  approach,
  calculateScore,
  clamp,
  generateLevel,
  getAimVector,
  getBossPhase,
  healthColor,
  lerp,
  moveAndCollide,
  normalize,
  radialBurst
} from './core.js';
import { SoundSystem } from './audio.js';

const canvas = document.querySelector('#game');
const ctx = canvas.getContext('2d');
const sound = new SoundSystem();
const VIEW_WIDTH = 1280;
const VIEW_HEIGHT = 720;
const GRAVITY = 2100;
const MAX_FALL_SPEED = 1250;
const keys = new Set();
const virtual = new Set();
const pointer = { x: VIEW_WIDTH / 2, y: VIEW_HEIGHT / 2, active: false, shooting: false };
const query = new URLSearchParams(window.location.search);
const highScoreKey = 'neon-strike-high-score';

let highScore = Number(localStorage.getItem(highScoreKey) || 0);
let game = createGameState('title');
let lastTimestamp = performance.now();

function createPlayer(level) {
  return {
    x: level.playerStart.x,
    y: level.playerStart.y,
    w: 30,
    h: 52,
    vx: 0,
    vy: 0,
    health: 100,
    maxHealth: 100,
    grounded: false,
    coyote: 0,
    jumpsLeft: 2,
    facing: 1,
    invuln: 0,
    shootCooldown: 0,
    grenadeCooldown: 0,
    overdrive: 0,
    aim: { x: 1, y: 0 },
    muzzle: 0,
    lastSafeX: level.playerStart.x
  };
}

function cloneEnemies(enemies) {
  return enemies.map((enemy) => ({
    ...enemy,
    originX: enemy.x,
    originY: enemy.y,
    vx: 0,
    vy: 0,
    dead: false,
    flash: 0,
    shootTimer: 0.7 + Math.random() * 0.8,
    phaseTimer: 0,
    aimTimer: 0.8,
    burstTimer: 1.8
  }));
}

function createGameState(mode = 'playing', seed = 20260930) {
  const level = generateLevel(seed);
  return {
    mode,
    level,
    player: createPlayer(level),
    enemies: cloneEnemies(level.enemies),
    pickups: level.pickups.map((pickup) => ({ ...pickup })),
    bullets: [],
    enemyBullets: [],
    grenades: [],
    particles: [],
    cameraX: 0,
    shake: 0,
    time: 0,
    titleTime: 0,
    kills: 0,
    score: 0,
    shotsFired: 0,
    combo: 1,
    comboTimer: 0,
    bossSpawned: false,
    bossDefeated: false,
    exitOpen: false,
    victoryTimer: 0,
    hintTimer: 7,
    seed
  };
}

function isDown(...codes) {
  return codes.some((code) => keys.has(code) || virtual.has(code));
}

function startGame() {
  sound.unlock().then(() => {
    sound.startMusic();
    game = createGameState('playing', Date.now() % 2147483647);
    pointer.shooting = false;
    canvas.focus();
  });
}

function togglePause() {
  if (game.mode === 'playing') {
    game.mode = 'paused';
    pointer.shooting = false;
    sound.stopMusic();
  } else if (game.mode === 'paused') {
    game.mode = 'playing';
    sound.startMusic();
  }
}

function tryJump() {
  if (game.mode !== 'playing') return;
  const player = game.player;
  if (player.grounded || player.coyote > 0) {
    player.vy = -760;
    player.grounded = false;
    player.coyote = 0;
    player.jumpsLeft = 1;
    sound.play('jump');
  } else if (player.jumpsLeft > 0) {
    player.vy = -690;
    player.jumpsLeft -= 1;
    sound.play('jump');
    emitParticles(player.x + player.w / 2, player.y + player.h, '#43e8ff', 8, { speed: 100, life: 0.3 });
  }
}

function updatePointer(event) {
  const rect = canvas.getBoundingClientRect();
  pointer.x = ((event.clientX - rect.left) / rect.width) * VIEW_WIDTH;
  pointer.y = ((event.clientY - rect.top) / rect.height) * VIEW_HEIGHT;
  pointer.active = true;
}

function onPointerDown(event) {
  updatePointer(event);
  if (game.mode === 'title' || game.mode === 'gameover' || game.mode === 'victory') {
    startGame();
    return;
  }
  if (game.mode === 'paused') {
    togglePause();
    return;
  }
  if (event.button === 0 && game.mode === 'playing') pointer.shooting = true;
}

function firePlayerWeapon() {
  const player = game.player;
  if (player.shootCooldown > 0 || game.mode !== 'playing') return;
  const aim = player.aim;
  const angle = Math.atan2(aim.y, aim.x);
  const shots = player.overdrive > 0 ? [-0.055, 0, 0.055] : [0];
  const muzzleX = player.x + player.w / 2 + aim.x * 25;
  const muzzleY = player.y + 22 + aim.y * 20;

  for (const spread of shots) {
    const shotAngle = angle + spread;
    game.bullets.push({
      x: muzzleX,
      y: muzzleY,
      w: 8,
      h: 8,
      vx: Math.cos(shotAngle) * 1050,
      vy: Math.sin(shotAngle) * 1050,
      life: 1.35,
      damage: 1,
      color: player.overdrive > 0 ? '#ffd166' : '#43e8ff'
    });
  }

  player.shootCooldown = player.overdrive > 0 ? 0.09 : 0.135;
  game.shotsFired += shots.length;
  player.muzzle = 0.06;
  player.vx -= aim.x * 24;
  sound.play('shoot');
  emitParticles(muzzleX, muzzleY, player.overdrive > 0 ? '#ffd166' : '#43e8ff', 4, { speed: 150, life: 0.18 });
}

function throwGrenade() {
  const player = game.player;
  if (player.grenadeCooldown > 0 || game.mode !== 'playing') return;
  const aim = player.aim;
  game.grenades.push({
    x: player.x + player.w / 2 + aim.x * 20,
    y: player.y + 20,
    w: 13,
    h: 13,
    vx: aim.x * 470 + player.vx * 0.3,
    vy: aim.y * 330 - 360,
    timer: 1.55,
    spin: 0
  });
  player.grenadeCooldown = 2.2;
  sound.play('dash');
}
function emitParticles(x, y, color, count = 8, options = {}) {
  const speed = options.speed || 240;
  const life = options.life || 0.55;
  const gravity = options.gravity ?? 700;
  for (let i = 0; i < count; i += 1) {
    const angle = options.angle !== undefined ? options.angle + (Math.random() - 0.5) * 1.4 : Math.random() * Math.PI * 2;
    const velocity = speed * (0.35 + Math.random() * 0.65);
    game.particles.push({
      x,
      y,
      vx: Math.cos(angle) * velocity,
      vy: Math.sin(angle) * velocity,
      life,
      maxLife: life,
      size: options.size || 2 + Math.random() * 4,
      color,
      gravity
    });
  }
}

function addExplosion(x, y, radius = 105, color = '#ff8c42') {
  game.shake = Math.max(game.shake, 10);
  emitParticles(x, y, color, 28, { speed: radius * 3, life: 0.65, size: 5 });
  emitParticles(x, y, '#fff3b0', 12, { speed: radius * 2, life: 0.38, size: 3 });
  sound.play('explode');
}

function damageEnemy(enemy, damage, hitX, hitY) {
  if (enemy.dead) return;
  enemy.hp -= damage;
  enemy.flash = 0.1;
  emitParticles(hitX, hitY, '#ffcf66', 5, { speed: 150, life: 0.24, gravity: 160 });
  if (enemy.hp <= 0) destroyEnemy(enemy);
  else sound.play('hit');
}

function destroyEnemy(enemy) {
  if (enemy.dead) return;
  enemy.dead = true;
  game.kills += 1;
  game.combo = Math.min(9, game.combo + 1);
  game.comboTimer = 3.2;
  const reward = enemy.type === 'boss' ? 5000 : enemy.type === 'turret' ? 350 : 220;
  game.score += calculateScore(reward, game.combo);

  if (enemy.type === 'boss') {
    game.bossDefeated = true;
    game.exitOpen = true;
    addExplosion(enemy.x + enemy.w / 2, enemy.y + enemy.h / 2, 190, '#ff4d6d');
    for (let i = 0; i < 5; i += 1) {
      const explosionGame = game;
      setTimeout(() => { if (game === explosionGame) addExplosion(enemy.x + Math.random() * enemy.w, enemy.y + Math.random() * enemy.h, 80); }, i * 90);
    }
  } else {
    addExplosion(enemy.x + enemy.w / 2, enemy.y + enemy.h / 2, 55, '#ff6b6b');
  }
}

function damagePlayer(amount, sourceX = game.player.x) {
  const player = game.player;
  if (player.invuln > 0 || game.mode !== 'playing') return;
  player.health -= amount;
  player.invuln = 1.05;
  player.vx = player.x < sourceX ? -380 : 380;
  player.vy = -340;
  game.combo = 1;
  game.shake = Math.max(game.shake, 12);
  sound.play('hit');
  emitParticles(player.x + player.w / 2, player.y + player.h / 2, '#ff4d6d', 14, { speed: 280, life: 0.45 });

  if (player.health <= 0) {
    player.health = 0;
    game.mode = 'gameover';
    pointer.shooting = false;
    sound.stopMusic();
    highScore = Math.max(highScore, game.score);
    localStorage.setItem(highScoreKey, String(highScore));
  }
}

function updatePlayer(dt) {
  const player = game.player;
  const axis = (isDown('KeyD', 'ArrowRight', 'right') ? 1 : 0) - (isDown('KeyA', 'ArrowLeft', 'left') ? 1 : 0);
  const acceleration = player.grounded ? 2200 : 1350;
  const maxSpeed = 390;
  player.vx = approach(player.vx, axis * maxSpeed, acceleration * dt);
  if (axis === 0 && player.grounded) player.vx = approach(player.vx, 0, 2500 * dt);
  if (axis !== 0) player.facing = axis;

  if (pointer.active) {
    const target = { x: pointer.x + game.cameraX, y: pointer.y };
    const aim = getAimVector({ x: player.x + player.w / 2, y: player.y + 22 }, target);
    if (aim.magnitude > 0) player.aim = aim;
  } else {
    const vertical = (isDown('ArrowDown') ? 1 : 0) - (isDown('ArrowUp') ? 1 : 0);
    const aim = normalize(player.facing, vertical * 0.72);
    player.aim = aim.magnitude ? aim : { x: player.facing, y: 0 };
  }

  player.vy = Math.min(MAX_FALL_SPEED, player.vy + GRAVITY * dt);
  const wasGrounded = player.grounded;
  const collision = moveAndCollide(player, player.vx * dt, player.vy * dt, game.level.solids);
  player.grounded = collision.grounded || (player.vy >= 0 && wasGrounded && player.y + player.h >= GROUND_Y - 0.5 && player.y + player.h <= GROUND_Y + 3);
  player.coyote = player.grounded ? 0.11 : Math.max(0, player.coyote - dt);
  if (player.grounded) {
    player.jumpsLeft = 2;
    player.lastSafeX = player.x;
  }

  player.x = clamp(player.x, 0, WORLD_WIDTH + 120);
  player.invuln = Math.max(0, player.invuln - dt);
  player.shootCooldown = Math.max(0, player.shootCooldown - dt);
  player.grenadeCooldown = Math.max(0, player.grenadeCooldown - dt);
  player.overdrive = Math.max(0, player.overdrive - dt);
  player.muzzle = Math.max(0, player.muzzle - dt);

  if (isDown('KeyJ', 'KeyZ', 'shoot') || pointer.shooting) firePlayerWeapon();

  if (player.y > VIEW_HEIGHT + 220) {
    player.health -= 25;
    player.invuln = 1.2;
    player.x = Math.max(60, player.lastSafeX - 90);
    player.y = 80;
    player.vx = 0;
    player.vy = 0;
    game.shake = 14;
    sound.play('hit');
    if (player.health <= 0) {
      player.health = 0;
      game.mode = 'gameover';
      pointer.shooting = false;
      sound.stopMusic();
      highScore = Math.max(highScore, game.score);
      localStorage.setItem(highScoreKey, String(highScore));
    }
  }
}

function enemyShoot(enemy, angle, speed, color = '#ff5876', size = 12, damage = 14) {
  const originX = enemy.x + enemy.w / 2;
  const originY = enemy.y + enemy.h / 2;
  game.enemyBullets.push({
    x: originX,
    y: originY,
    w: size,
    h: size,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    damage,
    life: 4.5,
    color
  });
  sound.play('enemyShoot');
  emitParticles(originX, originY, color, 3, { speed: 70, life: 0.2, gravity: 0 });
}

function spawnBoss() {
  game.bossSpawned = true;
  const boss = {
    ...game.level.boss,
    originX: game.level.boss.x,
    originY: game.level.boss.y,
    type: 'boss',
    vx: 0,
    vy: 0,
    dead: false,
    flash: 0,
    shootTimer: 0.8,
    phaseTimer: 0,
    aimTimer: 0.6,
    burstTimer: 1.5
  };
  game.enemies.push(boss);
  game.shake = 18;
  sound.play('boss');
}

function updateEnemies(dt) {
  const player = game.player;
  for (const enemy of game.enemies) {
    if (enemy.dead) continue;
    enemy.flash = Math.max(0, enemy.flash - dt);
    const distanceX = player.x - enemy.x;
    const distanceY = player.y - enemy.y;
    const distance = Math.hypot(distanceX, distanceY);
    if (distance > 1500) continue;

    if (enemy.type === 'trooper') {
      enemy.x += Math.sign(Math.cos(game.time * 0.9 + enemy.originX)) * 55 * dt;
      if (Math.abs(enemy.x - enemy.originX) > 130) enemy.x = enemy.originX + Math.sign(enemy.x - enemy.originX) * 130;
      enemy.y = Math.max(enemy.y, GROUND_Y - enemy.h);
      enemy.shootTimer -= dt;
      if (distance < 690 && enemy.shootTimer <= 0) {
        const angle = Math.atan2(player.y + player.h / 2 - (enemy.y + enemy.h / 2), player.x + player.w / 2 - (enemy.x + enemy.w / 2));
        enemyShoot(enemy, angle, 420, '#ff5876', 11, 13);
        enemy.shootTimer = 1.25 + Math.random() * 0.55;
      }
    }

    if (enemy.type === 'drone') {
      const targetY = enemy.originY + Math.sin(game.time * 2.2 + enemy.originX) * 45;
      enemy.x = approach(enemy.x, Math.max(enemy.originX - 105, Math.min(enemy.originX + 105, player.x - 160)), 190 * dt);
      enemy.y = approach(enemy.y, targetY, 170 * dt);
      enemy.shootTimer -= dt;
      if (distance < 850 && enemy.shootTimer <= 0) {
        const angle = Math.atan2(player.y + player.h / 2 - (enemy.y + enemy.h / 2), player.x + player.w / 2 - (enemy.x + enemy.w / 2));
        enemyShoot(enemy, angle, 390, '#ffb347', 12, 15);
        enemy.shootTimer = 1.7 + Math.random() * 0.5;
      }
    }

    if (enemy.type === 'turret') {
      enemy.shootTimer -= dt;
      if (distance < 860 && enemy.shootTimer <= 0) {
        const angle = Math.atan2(player.y + player.h / 2 - (enemy.y + enemy.h / 2), player.x + player.w / 2 - (enemy.x + enemy.w / 2));
        for (const spread of [-0.08, 0.08]) enemyShoot(enemy, angle + spread, 460, '#ff8c42', 11, 15);
        enemy.shootTimer = 1.8;
      }
    }

    if (enemy.type === 'boss') {
      const phase = getBossPhase(enemy.hp, enemy.maxHp);
      enemy.x = enemy.originX + Math.sin(game.time * 0.8) * 55;
      enemy.y = enemy.originY + Math.sin(game.time * 1.35) * 65;
      enemy.aimTimer -= dt;
      enemy.burstTimer -= dt;

      if (enemy.aimTimer <= 0) {
        const angle = Math.atan2(player.y - enemy.y, player.x - enemy.x);
        const shots = phase === 3 ? 5 : phase === 2 ? 3 : 2;
        for (let i = 0; i < shots; i += 1) {
          const spread = (i - (shots - 1) / 2) * 0.11;
          enemyShoot(enemy, angle + spread, 510, '#ff4d6d', 13, 16);
        }
        enemy.aimTimer = phase === 3 ? 0.72 : phase === 2 ? 1.05 : 1.35;
      }

      if (enemy.burstTimer <= 0) {
        const count = phase === 3 ? 14 : phase === 2 ? 10 : 8;
        for (const shot of radialBurst({ x: enemy.x + enemy.w / 2, y: enemy.y + enemy.h / 2 }, count, 275 + phase * 12)) {
          game.enemyBullets.push({ ...shot, w: 11, h: 11, damage: 13, life: 4.4, color: '#ff7b54' });
        }
        sound.play('enemyShoot');
        enemy.burstTimer = phase === 3 ? 1.7 : phase === 2 ? 2.2 : 2.8;
      }
    }
  }
}

function updatePlayerBullets(dt) {
  game.bullets = game.bullets.filter((bullet) => {
    bullet.x += bullet.vx * dt;
    bullet.y += bullet.vy * dt;
    bullet.life -= dt;
    if (bullet.life <= 0 || bullet.x < -100 || bullet.x > WORLD_WIDTH + 100) return false;

    for (const enemy of game.enemies) {
      if (enemy.dead || !aabbIntersects(bullet, enemy)) continue;
      damageEnemy(enemy, bullet.damage, bullet.x + bullet.w / 2, bullet.y + bullet.h / 2);
      return false;
    }
    return true;
  });
}
function updateEnemyBullets(dt) {
  game.enemyBullets = game.enemyBullets.filter((bullet) => {
    bullet.x += bullet.vx * dt;
    bullet.y += bullet.vy * dt;
    bullet.life -= dt;
    if (bullet.life <= 0 || bullet.x < -120 || bullet.x > WORLD_WIDTH + 120 || bullet.y < -180 || bullet.y > 900) return false;
    if (aabbIntersects(bullet, game.player)) {
      damagePlayer(bullet.damage, bullet.x);
      return false;
    }
    return true;
  });
}

function explodeGrenade(grenade) {
  const bounds = { x: grenade.x - 105, y: grenade.y - 105, w: 210, h: 210 };
  addExplosion(grenade.x + grenade.w / 2, grenade.y + grenade.h / 2, 105);
  for (const enemy of game.enemies) {
    if (!enemy.dead && aabbIntersects(bounds, enemy)) damageEnemy(enemy, 8, enemy.x + enemy.w / 2, enemy.y + enemy.h / 2);
  }
}

function updateGrenades(dt) {
  game.grenades = game.grenades.filter((grenade) => {
    grenade.timer -= dt;
    grenade.spin += dt * 12;
    grenade.vy += GRAVITY * 0.72 * dt;
    grenade.x += grenade.vx * dt;
    grenade.y += grenade.vy * dt;
    const hitSolid = game.level.solids.some((solid) => aabbIntersects(grenade, solid));
    if (hitSolid || grenade.timer <= 0 || grenade.y > 850) {
      explodeGrenade(grenade);
      return false;
    }
    return true;
  });
}

function updatePickups() {
  for (const pickup of game.pickups) {
    if (pickup.collected || !aabbIntersects(pickup, game.player)) continue;
    pickup.collected = true;
    if (pickup.type === 'health') {
      game.player.health = Math.min(game.player.maxHealth, game.player.health + 35);
      emitParticles(pickup.x + 15, pickup.y + 15, '#42f5a7', 16, { speed: 220, life: 0.65 });
    } else {
      game.player.overdrive = 12;
      emitParticles(pickup.x + 15, pickup.y + 15, '#ffd166', 22, { speed: 260, life: 0.75 });
    }
    game.score += 150;
    sound.play('pickup');
  }
}

function updateParticles(dt) {
  game.particles = game.particles.filter((particle) => {
    particle.life -= dt;
    if (particle.life <= 0) return false;
    particle.vy += particle.gravity * dt;
    particle.x += particle.vx * dt;
    particle.y += particle.vy * dt;
    particle.vx *= Math.pow(0.92, dt * 60);
    return true;
  });
}

function update(dt) {
  if (game.mode !== 'playing') {
    game.titleTime += dt;
    return;
  }

  game.time += dt;
  game.hintTimer = Math.max(0, game.hintTimer - dt);
  game.comboTimer -= dt;
  if (game.comboTimer <= 0) game.combo = 1;

  updatePlayer(dt);
  updatePlayerBullets(dt);
  updateEnemies(dt);
  updateEnemyBullets(dt);
  updateGrenades(dt);
  updatePickups();
  updateParticles(dt);

  if (!game.bossSpawned && game.player.x > game.level.bossSpawnX) spawnBoss();

  const targetCamera = clamp(game.player.x + game.player.w / 2 - VIEW_WIDTH * 0.4, 0, WORLD_WIDTH - VIEW_WIDTH + 260);
  game.cameraX = lerp(game.cameraX, targetCamera, 1 - Math.exp(-7 * dt));
  game.shake = Math.max(0, game.shake - 34 * dt);

  if (game.exitOpen && game.player.x + game.player.w > game.level.exit.x - 20) {
    game.mode = 'victory';
    pointer.shooting = false;
    sound.stopMusic();
    sound.play('victory');
    highScore = Math.max(highScore, game.score);
    localStorage.setItem(highScoreKey, String(highScore));
  }
}

function roundRect(context, x, y, w, h, radius) {
  const r = Math.min(radius, w / 2, h / 2);
  context.beginPath();
  context.moveTo(x + r, y);
  context.arcTo(x + w, y, x + w, y + h, r);
  context.arcTo(x + w, y + h, x, y + h, r);
  context.arcTo(x, y + h, x, y, r);
  context.arcTo(x, y, x + w, y, r);
  context.closePath();
}

function drawBackground() {
  const sky = ctx.createLinearGradient(0, 0, 0, VIEW_HEIGHT);
  sky.addColorStop(0, '#060714');
  sky.addColorStop(0.58, '#101a38');
  sky.addColorStop(0.78, '#56254c');
  sky.addColorStop(1, '#f06b45');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);

  ctx.save();
  for (let i = 0; i < 90; i += 1) {
    const x = ((i * 173 - game.cameraX * 0.05) % (VIEW_WIDTH + 160)) - 80;
    const y = (i * 71) % 330;
    const pulse = 0.25 + 0.7 * Math.abs(Math.sin(game.time * 0.45 + i));
    ctx.globalAlpha = pulse;
    ctx.fillStyle = i % 7 === 0 ? '#ffca80' : '#d8e8ff';
    ctx.fillRect(x, y, i % 5 === 0 ? 2 : 1, i % 5 === 0 ? 2 : 1);
  }
  ctx.restore();

  const cityOffset = -(game.cameraX * 0.15) % 230;
  ctx.fillStyle = '#080c1c';
  for (let i = -2; i < 9; i += 1) {
    const x = cityOffset + i * 230;
    const h = 150 + ((i + 20) % 4) * 45;
    ctx.fillRect(x, 430 - h, 160, h);
    ctx.fillStyle = '#13203b';
    for (let row = 0; row < 4; row += 1) {
      for (let col = 0; col < 3; col += 1) {
        if ((i * 7 + row * 3 + col) % 4 === 0) ctx.fillRect(x + 24 + col * 42, 430 - h + 25 + row * 38, 16, 8);
      }
    }
    ctx.fillStyle = '#080c1c';
  }

  const cityOffset2 = -(game.cameraX * 0.28) % 170;
  ctx.fillStyle = '#0a1330';
  for (let i = -2; i < 12; i += 1) {
    const x = cityOffset2 + i * 170;
    const h = 95 + ((i + 9) % 5) * 28;
    ctx.fillRect(x, 500 - h, 110, h);
    ctx.fillStyle = '#1e335c';
    ctx.fillRect(x + 12, 500 - h + 18, 8, 34);
    ctx.fillRect(x + 72, 500 - h + 34, 8, 42);
    ctx.fillStyle = '#0a1330';
  }

  ctx.globalAlpha = 0.24;
  ctx.strokeStyle = '#6fd6ff';
  ctx.lineWidth = 1;
  for (let i = 0; i < 48; i += 1) {
    const x = (i * 137 + game.time * 110) % (VIEW_WIDTH + 120) - 60;
    const y = (i * 83 + game.time * 260) % VIEW_HEIGHT;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x - 24, y + 55);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;

  const haze = ctx.createLinearGradient(0, 380, 0, VIEW_HEIGHT);
  haze.addColorStop(0, 'rgba(0,0,0,0)');
  haze.addColorStop(1, 'rgba(8,5,18,0.85)');
  ctx.fillStyle = haze;
  ctx.fillRect(0, 350, VIEW_WIDTH, 370);
}

function drawPlatforms() {
  for (const solid of game.level.solids) {
    const gradient = ctx.createLinearGradient(solid.x, solid.y, solid.x, solid.y + solid.h);
    gradient.addColorStop(0, solid.kind === 'ground' ? '#1a2948' : '#17243d');
    gradient.addColorStop(1, '#070b17');
    ctx.fillStyle = gradient;
    ctx.fillRect(solid.x, solid.y, solid.w, solid.h);
    ctx.strokeStyle = solid.kind === 'ground' ? '#43e8ff' : '#ff9f43';
    ctx.lineWidth = 2;
    ctx.shadowColor = ctx.strokeStyle;
    ctx.shadowBlur = 12;
    ctx.beginPath();
    ctx.moveTo(solid.x, solid.y + 1);
    ctx.lineTo(solid.x + solid.w, solid.y + 1);
    ctx.stroke();
    ctx.shadowBlur = 0;

    ctx.strokeStyle = 'rgba(98, 149, 214, 0.14)';
    ctx.lineWidth = 1;
    for (let x = solid.x + 30; x < solid.x + solid.w; x += 60) {
      ctx.beginPath();
      ctx.moveTo(x, solid.y + 15);
      ctx.lineTo(x + 18, solid.y + solid.h);
      ctx.stroke();
    }
  }
}

function drawPickups() {
  for (const pickup of game.pickups) {
    if (pickup.collected) continue;
    const bob = Math.sin(game.time * 3 + pickup.x) * 6;
    const color = pickup.type === 'health' ? '#42f5a7' : '#ffd166';
    ctx.save();
    ctx.translate(pickup.x + pickup.w / 2, pickup.y + pickup.h / 2 + bob);
    ctx.rotate(game.time * 1.8);
    ctx.shadowColor = color;
    ctx.shadowBlur = 18;
    ctx.fillStyle = color;
    if (pickup.type === 'health') {
      ctx.fillRect(-6, -15, 12, 30);
      ctx.fillRect(-15, -6, 30, 12);
    } else {
      ctx.beginPath();
      ctx.moveTo(0, -18);
      ctx.lineTo(14, 0);
      ctx.lineTo(0, 18);
      ctx.lineTo(-14, 0);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
}
function drawEnemies() {
  for (const enemy of game.enemies) {
    if (enemy.dead) continue;
    ctx.save();
    ctx.translate(enemy.x, enemy.y);
    if (enemy.flash > 0) ctx.globalAlpha = 0.55;
    const hitColor = enemy.flash > 0 ? '#ffffff' : '#ff5876';
    ctx.shadowColor = hitColor;
    ctx.shadowBlur = 14;

    if (enemy.type === 'drone') {
      ctx.fillStyle = hitColor;
      ctx.beginPath();
      ctx.moveTo(enemy.w / 2, 0);
      ctx.lineTo(enemy.w, enemy.h / 2);
      ctx.lineTo(enemy.w / 2, enemy.h);
      ctx.lineTo(0, enemy.h / 2);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#1af0ff';
      ctx.fillRect(16, 13, 20, 10);
      ctx.shadowBlur = 0;
      ctx.strokeStyle = hitColor;
      ctx.beginPath();
      ctx.moveTo(-8, 10);
      ctx.lineTo(enemy.w + 8, 10);
      ctx.stroke();
    } else if (enemy.type === 'turret') {
      ctx.fillStyle = '#172640';
      ctx.fillRect(0, 20, enemy.w, enemy.h - 20);
      ctx.fillStyle = hitColor;
      ctx.fillRect(6, 8, enemy.w - 12, 28);
      ctx.fillStyle = '#0b1222';
      ctx.fillRect(18, 12, 18, 12);
      ctx.strokeStyle = hitColor;
      ctx.lineWidth = 5;
      ctx.beginPath();
      ctx.moveTo(enemy.w / 2, 17);
      ctx.lineTo(enemy.w / 2 + Math.cos(game.time * 1.4) * 28, 17 + Math.sin(game.time * 1.4) * 18);
      ctx.stroke();
    } else if (enemy.type === 'boss') {
      ctx.fillStyle = '#190f2e';
      ctx.fillRect(0, 0, enemy.w, enemy.h);
      ctx.strokeStyle = hitColor;
      ctx.lineWidth = 5;
      ctx.strokeRect(5, 5, enemy.w - 10, enemy.h - 10);
      ctx.fillStyle = hitColor;
      ctx.fillRect(22, 25, enemy.w - 44, 48);
      ctx.fillStyle = '#ffcf5c';
      ctx.fillRect(45, 42, enemy.w - 90, 12);
      ctx.fillStyle = '#43e8ff';
      ctx.fillRect(18, 95, 35, 48);
      ctx.fillRect(enemy.w - 53, 95, 35, 48);
      ctx.fillStyle = '#0a0712';
      ctx.fillRect(36, 116, 78, 20);
    } else {
      ctx.fillStyle = '#151d35';
      ctx.fillRect(4, 16, enemy.w - 8, enemy.h - 16);
      ctx.fillStyle = hitColor;
      ctx.fillRect(7, 3, enemy.w - 14, 17);
      ctx.fillStyle = '#43e8ff';
      ctx.fillRect(11, 7, enemy.w - 22, 7);
      ctx.fillStyle = '#101828';
      ctx.fillRect(3, 28, 9, 24);
      ctx.fillRect(enemy.w - 12, 28, 9, 24);
    }
    ctx.restore();

    if (enemy.type !== 'boss' && enemy.maxHp > 3) {
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.fillRect(enemy.x, enemy.y - 10, enemy.w, 5);
      ctx.fillStyle = healthColor(enemy.hp / enemy.maxHp);
      ctx.fillRect(enemy.x, enemy.y - 10, enemy.w * clamp(enemy.hp / enemy.maxHp, 0, 1), 5);
    }
  }
}

function drawPlayer() {
  const player = game.player;
  if (player.invuln > 0 && Math.floor(player.invuln * 16) % 2 === 0) return;
  const aimAngle = Math.atan2(player.aim.y, player.aim.x);
  ctx.save();
  ctx.translate(player.x + player.w / 2, player.y + player.h / 2);
  ctx.shadowColor = '#43e8ff';
  ctx.shadowBlur = 16;
  ctx.fillStyle = '#102a46';
  ctx.fillRect(-13, -22, 26, 42);
  ctx.fillStyle = '#43e8ff';
  ctx.fillRect(-9, -27, 18, 15);
  ctx.fillStyle = '#f2fbff';
  ctx.fillRect(-6, -23, 12, 5);
  ctx.fillStyle = '#1af0ff';
  ctx.fillRect(-15, -10, 6, 25);
  ctx.fillRect(9, -10, 6, 25);
  ctx.fillStyle = '#0b1528';
  ctx.fillRect(-13, 17, 10, 12);
  ctx.fillRect(3, 17, 10, 12);

  ctx.rotate(aimAngle);
  ctx.fillStyle = player.overdrive > 0 ? '#ffd166' : '#e7fbff';
  ctx.fillRect(4, -4, 32, 8);
  if (player.muzzle > 0) {
    ctx.fillStyle = '#fff3b0';
    ctx.beginPath();
    ctx.moveTo(35, -10);
    ctx.lineTo(54, 0);
    ctx.lineTo(35, 10);
    ctx.closePath();
    ctx.fill();
  }
  ctx.restore();
}

function drawProjectiles() {
  for (const bullet of game.bullets) {
    ctx.shadowColor = bullet.color;
    ctx.shadowBlur = 15;
    ctx.fillStyle = bullet.color;
    ctx.beginPath();
    ctx.arc(bullet.x + bullet.w / 2, bullet.y + bullet.h / 2, bullet.w / 2, 0, Math.PI * 2);
    ctx.fill();
  }
  for (const bullet of game.enemyBullets) {
    ctx.shadowColor = bullet.color;
    ctx.shadowBlur = 16;
    ctx.fillStyle = bullet.color;
    ctx.beginPath();
    ctx.arc(bullet.x + bullet.w / 2, bullet.y + bullet.h / 2, bullet.w / 2, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.shadowBlur = 0;
  for (const grenade of game.grenades) {
    ctx.save();
    ctx.translate(grenade.x + grenade.w / 2, grenade.y + grenade.h / 2);
    ctx.rotate(grenade.spin);
    ctx.fillStyle = '#ffd166';
    ctx.fillRect(-7, -7, 14, 14);
    ctx.fillStyle = '#ff6b6b';
    ctx.fillRect(-3, -10, 6, 20);
    ctx.restore();
  }
}

function drawParticles() {
  for (const particle of game.particles) {
    ctx.globalAlpha = clamp(particle.life / particle.maxLife, 0, 1);
    ctx.fillStyle = particle.color;
    ctx.fillRect(particle.x, particle.y, particle.size, particle.size);
  }
  ctx.globalAlpha = 1;
}

function drawExit() {
  if (!game.exitOpen) return;
  const exit = game.level.exit;
  ctx.save();
  ctx.shadowColor = '#42f5a7';
  ctx.shadowBlur = 24;
  ctx.fillStyle = '#42f5a7';
  ctx.fillRect(exit.x, exit.y + Math.sin(game.time * 3) * 5, exit.w, exit.h);
  ctx.fillStyle = 'rgba(66,245,167,0.18)';
  ctx.fillRect(exit.x - 24, exit.y - 18, exit.w + 48, exit.h + 36);
  ctx.restore();
}

function drawCrosshair() {
  if (!pointer.active || game.mode !== 'playing') return;
  ctx.save();
  ctx.translate(pointer.x, pointer.y);
  ctx.strokeStyle = '#ffd166';
  ctx.lineWidth = 2;
  ctx.shadowColor = '#ffd166';
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.arc(0, 0, 13, 0, Math.PI * 2);
  ctx.moveTo(-20, 0);
  ctx.lineTo(-7, 0);
  ctx.moveTo(20, 0);
  ctx.lineTo(7, 0);
  ctx.moveTo(0, -20);
  ctx.lineTo(0, -7);
  ctx.moveTo(0, 20);
  ctx.lineTo(0, 7);
  ctx.stroke();
  ctx.restore();
}

function drawWorld() {
  ctx.save();
  const shakeX = game.shake ? (Math.random() - 0.5) * game.shake : 0;
  const shakeY = game.shake ? (Math.random() - 0.5) * game.shake : 0;
  ctx.translate(-game.cameraX + shakeX, shakeY);
  drawPlatforms();
  drawExit();
  drawPickups();
  drawEnemies();
  drawProjectiles();
  drawParticles();
  drawPlayer();
  ctx.restore();
}

function drawHud() {
  const player = game.player;
  ctx.save();
  roundRect(ctx, 24, 22, 330, 74, 14);
  ctx.fillStyle = 'rgba(4, 9, 22, 0.78)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(67,232,255,0.5)';
  ctx.stroke();
  ctx.fillStyle = '#dffaff';
  ctx.font = '700 18px "Segoe UI", sans-serif';
  ctx.fillText('OPERATIVE', 42, 49);
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.fillRect(42, 63, 260, 15);
  ctx.fillStyle = healthColor(player.health / player.maxHealth);
  ctx.fillRect(42, 63, 260 * clamp(player.health / player.maxHealth, 0, 1), 15);
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 14px "Segoe UI", sans-serif';
  ctx.fillText(`${Math.ceil(player.health)} / ${player.maxHealth}`, 150, 76);

  ctx.textAlign = 'right';
  ctx.fillStyle = '#ffffff';
  ctx.font = '800 28px "Segoe UI", sans-serif';
  ctx.fillText(String(game.score).padStart(7, '0'), VIEW_WIDTH - 34, 52);
  ctx.font = '600 14px "Segoe UI", sans-serif';
  ctx.fillStyle = '#9fc9ff';
  ctx.fillText(`HIGH SCORE ${String(highScore).padStart(7, '0')}`, VIEW_WIDTH - 34, 77);
  if (game.combo > 1) {
    ctx.fillStyle = '#ffd166';
    ctx.font = '800 22px "Segoe UI", sans-serif';
    ctx.fillText(`COMBO x${game.combo}`, VIEW_WIDTH - 34, 109);
  }

  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(4, 9, 22, 0.72)';
  roundRect(ctx, 24, 112, 235, 38, 12);
  ctx.fill();
  ctx.fillStyle = player.overdrive > 0 ? '#ffd166' : '#7893b8';
  ctx.font = '700 15px "Segoe UI", sans-serif';
  ctx.fillText(player.overdrive > 0 ? `OVERDRIVE ${player.overdrive.toFixed(1)}s` : 'OVERDRIVE READY', 41, 137);

  const progress = clamp(player.x / game.level.width, 0, 1);
  ctx.fillStyle = 'rgba(3, 8, 18, 0.8)';
  roundRect(ctx, VIEW_WIDTH / 2 - 190, 28, 380, 18, 9);
  ctx.fill();
  ctx.fillStyle = '#43e8ff';
  roundRect(ctx, VIEW_WIDTH / 2 - 184, 34, 368 * progress, 6, 3);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = '700 13px "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  const objective = game.bossDefeated ? 'REACH THE EXTRACTION BEACON' : game.bossSpawned ? 'DESTROY THE WARDEN' : 'BREACH THE SKYLINE';
  ctx.fillText(objective, VIEW_WIDTH / 2, 72);

  const boss = game.enemies.find((enemy) => enemy.type === 'boss' && !enemy.dead);
  if (boss) {
    ctx.fillStyle = 'rgba(4, 6, 14, 0.86)';
    roundRect(ctx, VIEW_WIDTH / 2 - 250, VIEW_HEIGHT - 65, 500, 34, 10);
    ctx.fill();
    ctx.fillStyle = '#ff4d6d';
    roundRect(ctx, VIEW_WIDTH / 2 - 238, VIEW_HEIGHT - 53, 476 * clamp(boss.hp / boss.maxHp, 0, 1), 10, 5);
    ctx.fill();
    ctx.fillStyle = '#ffffff';
    ctx.font = '800 13px "Segoe UI", sans-serif';
    ctx.fillText('THE WARDEN', VIEW_WIDTH / 2, VIEW_HEIGHT - 69);
  }

  if (game.hintTimer > 0 && game.mode === 'playing') {
    ctx.globalAlpha = clamp(game.hintTimer, 0, 1);
    ctx.fillStyle = 'rgba(3, 7, 16, 0.74)';
    roundRect(ctx, VIEW_WIDTH / 2 - 285, 102, 570, 46, 12);
    ctx.fill();
    ctx.fillStyle = '#dffaff';
    ctx.font = '600 15px "Segoe UI", sans-serif';
    ctx.fillText('A/D move  •  SPACE jump  •  mouse/J fire  •  K grenade  •  P pause', VIEW_WIDTH / 2, 131);
  }
  ctx.restore();
}

function drawOverlay(title, lines, accent = '#43e8ff') {
  ctx.save();
  ctx.fillStyle = 'rgba(2, 4, 12, 0.72)';
  ctx.fillRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
  ctx.textAlign = 'center';
  ctx.shadowColor = accent;
  ctx.shadowBlur = 28;
  ctx.fillStyle = '#f4fbff';
  ctx.font = '900 72px "Segoe UI", sans-serif';
  ctx.fillText(title, VIEW_WIDTH / 2, 250);
  ctx.shadowBlur = 0;
  ctx.font = '600 19px "Segoe UI", sans-serif';
  ctx.fillStyle = '#b8d9ff';
  lines.forEach((line, index) => ctx.fillText(line, VIEW_WIDTH / 2, 320 + index * 34));
  ctx.restore();
}
function render() {
  ctx.clearRect(0, 0, VIEW_WIDTH, VIEW_HEIGHT);
  drawBackground();
  drawWorld();
  drawCrosshair();
  drawHud();

  if (game.mode === 'title') {
    drawOverlay('NEON STRIKE', [
      'SKYLINE BREACH',
      'Click or press ENTER to deploy',
      'A/D move • SPACE jump • mouse/J fire • K grenade',
      'P pause • R restart • rapid kills build combo'
    ]);
  } else if (game.mode === 'paused') {
    drawOverlay('PAUSED', ['Press P or ESC to continue', 'R restart  •  M mute']);
  } else if (game.mode === 'gameover') {
    drawOverlay('MISSION FAILED', [`Score ${game.score}  •  Kills ${game.kills}`, 'Click or press ENTER to retry'], '#ff4d6d');
  } else if (game.mode === 'victory') {
    drawOverlay('EXTRACTION COMPLETE', [`Final score ${game.score}  •  Kills ${game.kills}`, 'Click or press ENTER to run again'], '#42f5a7');
  }
}

function frame(timestamp) {
  const dt = Math.min(0.033, Math.max(0, (timestamp - lastTimestamp) / 1000));
  lastTimestamp = timestamp;
  update(dt);
  render();
  requestAnimationFrame(frame);
}

function bindVirtualButton(button) {
  const action = button.dataset.action;
  const press = (event) => {
    event.preventDefault();
    virtual.add(action);
    if (action === 'jump') tryJump();
    if (action === 'grenade') throwGrenade();
    if (game.mode === 'title' || game.mode === 'gameover' || game.mode === 'victory') startGame();
  };
  const release = (event) => {
    event.preventDefault();
    virtual.delete(action);
  };
  button.addEventListener('pointerdown', press);
  button.addEventListener('pointerup', release);
  button.addEventListener('pointercancel', release);
  button.addEventListener('pointerleave', release);
}

canvas.addEventListener('pointerdown', onPointerDown);
canvas.addEventListener('pointermove', updatePointer);
canvas.addEventListener('pointerup', () => { pointer.shooting = false; });
canvas.addEventListener('pointerleave', () => { pointer.shooting = false; });
canvas.addEventListener('contextmenu', (event) => event.preventDefault());

window.addEventListener('keydown', (event) => {
  if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.code)) event.preventDefault();
  if (event.repeat) return;
  keys.add(event.code);
  if (event.code === 'Space' || event.code === 'ArrowUp' || event.code === 'KeyW') tryJump();
  if (event.code === 'KeyK' || event.code === 'KeyX') throwGrenade();
  if ((event.code === 'Enter' || event.code === 'Space') && (game.mode === 'title' || game.mode === 'gameover' || game.mode === 'victory')) startGame();
  if (event.code === 'KeyP' || event.code === 'Escape') togglePause();
  if (event.code === 'KeyR' && game.mode !== 'title') startGame();
  if (event.code === 'KeyM') {
    sound.setMuted(!sound.muted);
    document.querySelector('#mute-button').textContent = sound.muted ? 'Sound: Off' : 'Sound: On';
  }
});

window.addEventListener('keyup', (event) => keys.delete(event.code));
window.addEventListener('blur', () => {
  keys.clear();
  pointer.shooting = false;
  if (game.mode === 'playing') togglePause();
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden && game.mode === 'playing') togglePause();
});

document.querySelector('#pause-button').addEventListener('click', togglePause);
document.querySelector('#mute-button').addEventListener('click', (event) => {
  sound.setMuted(!sound.muted);
  event.currentTarget.textContent = sound.muted ? 'Sound: Off' : 'Sound: On';
});
document.querySelector('#restart-button').addEventListener('click', startGame);
document.querySelectorAll('[data-action]').forEach(bindVirtualButton);

if (query.get('autostart') === '1') {
  game = createGameState('playing', Number(query.get('seed') || 20260930));
  sound.unlock().then(() => sound.startMusic());
}

if (query.get('debug') === '1') {
  window.__neonStrikeDebug = {
    snapshot: () => ({
      mode: game.mode,
      playerX: game.player.x,
      playerY: game.player.y,
      health: game.player.health,
      score: game.score,
      bullets: game.bullets.length,
      shotsFired: game.shotsFired,
      enemyBullets: game.enemyBullets.length,
      enemies: game.enemies.filter((enemy) => !enemy.dead).length,
      solids: game.level.solids.length,
      time: game.time
    })
  };
}

requestAnimationFrame(frame);