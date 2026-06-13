/* Bolt Ranger — action-platformer inspirado em Ratchet & Clank
 * Jogo HTML5 self-contained, otimizado para iPhone (touch) e teclado.
 */
(() => {
  'use strict';

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');

  // ---------- Mundo / constantes ----------
  const GRAVITY = 2200;          // px/s²
  const MOVE_SPEED = 320;        // px/s
  const JUMP_VELOCITY = -780;    // px/s
  const GROUND_H = 90;           // altura do "chão" relativo ao fundo do ecrã
  const WORLD_W = 3200;          // largura do nível

  let VIEW_W = 800, VIEW_H = 450; // tamanho lógico, recalculado no resize
  let DPR = 1;

  // ---------- Estado ----------
  const State = { MENU: 'menu', PLAY: 'play', SHOP: 'shop', OVER: 'over' };
  let state = State.MENU;
  let lastTime = 0;
  let camX = 0;
  let wave = 1;
  let shakeT = 0, shakeMag = 0;

  const input = { left: false, right: false, jump: false, fire: false, swap: false };

  // Joystick analógico (esquerda do ecrã). axis: -1 (esq) .. 1 (dir)
  const joy = { active: false, id: null, cx: 0, cy: 0, axis: 0, radius: 50 };

  // ---------- Armas ----------
  const WEAPONS = {
    wrench:  { name: 'Chave-inglesa', melee: true,  dmg: 34, cooldown: 0.32, color: '#cfd6f0', owned: true },
    blaster: { name: 'Blaster',       melee: false, dmg: 20, cooldown: 0.22, speed: 720, color: '#38d6ff', owned: true, spread: 0 },
    spread:  { name: 'Espingarda',    melee: false, dmg: 14, cooldown: 0.55, speed: 640, color: '#7CFC8A', owned: false, price: 120, pellets: 4, spread: 0.35, desc: '4 projéteis em leque' },
    pyro:    { name: 'Pyrocitor',     melee: false, dmg: 34, cooldown: 0.10, speed: 820, color: '#ff8a3d', owned: false, price: 200, spread: 0.12, desc: 'Disparo rápido e contínuo' },
  };
  const WEAPON_ORDER = ['wrench', 'blaster', 'spread', 'pyro'];

  // ---------- Entidades ----------
  let player, bullets, enemyBullets, enemies, bolts, crates, particles;
  let bolts_total = 0;

  function makePlayer() {
    return {
      x: 120, y: 0, w: 36, h: 54,
      vx: 0, vy: 0,
      onGround: false,
      facing: 1,
      hp: 100, maxHp: 100,
      weaponIdx: 1, // começa no blaster
      fireCd: 0,
      swapCd: 0,
      invuln: 0,
      meleeT: 0,
      jumpsLeft: 2,
      jumpHeld: false,
    };
  }

  function groundY() { return VIEW_H - GROUND_H; }

  // ---------- Plataformas do nível ----------
  let platforms = [];
  function buildLevel() {
    platforms = [
      { x: 360,  y: 0, w: 180, h: 18, oy: 150 },
      { x: 620,  y: 0, w: 160, h: 18, oy: 240 },
      { x: 900,  y: 0, w: 200, h: 18, oy: 180 },
      { x: 1250, y: 0, w: 180, h: 18, oy: 250 },
      { x: 1550, y: 0, w: 220, h: 18, oy: 160 },
      { x: 1950, y: 0, w: 180, h: 18, oy: 220 },
      { x: 2300, y: 0, w: 200, h: 18, oy: 150 },
      { x: 2650, y: 0, w: 200, h: 18, oy: 230 },
    ];
    // oy = distância acima do chão; y calculado no resize
    layoutPlatforms();
  }
  function layoutPlatforms() {
    for (const p of platforms) p.y = groundY() - p.oy;
  }

  // ---------- Spawn de onda ----------
  function startWave(n) {
    bullets = []; enemyBullets = []; enemies = []; bolts = []; crates = []; particles = [];
    const count = 3 + n;
    for (let i = 0; i < count; i++) {
      const ex = 500 + Math.random() * (WORLD_W - 700);
      const tough = Math.random() < Math.min(0.15 + n * 0.05, 0.5);
      enemies.push(makeEnemy(ex, tough, n));
    }
    // caixotes com bolts
    for (let i = 0; i < 6; i++) {
      const cx = 300 + Math.random() * (WORLD_W - 500);
      crates.push({ x: cx, y: groundY() - 40, w: 40, h: 40, hp: 1 });
    }
    player.x = 120; player.y = groundY() - player.h; player.vx = 0; player.vy = 0;
    camX = 0;
    updateHUD();
  }

  function makeEnemy(x, tough, n) {
    const hp = tough ? 80 + n * 8 : 40 + n * 4;
    return {
      x, y: groundY() - 50, w: 40, h: 50,
      vx: (Math.random() < 0.5 ? -1 : 1) * (40 + n * 5),
      hp, maxHp: hp,
      tough,
      shootCd: 1 + Math.random() * 2,
      hitFlash: 0,
      onGround: true,
    };
  }

  // ---------- Loop ----------
  function loop(t) {
    const dt = Math.min((t - lastTime) / 1000, 0.05);
    lastTime = t;
    if (state === State.PLAY) update(dt);
    render();
    requestAnimationFrame(loop);
  }

  // ---------- Update ----------
  function update(dt) {
    const p = player;

    // movimento horizontal (joystick analógico tem prioridade; senão teclado)
    let axis;
    if (joy.active && Math.abs(joy.axis) > 0.12) {
      axis = joy.axis;
    } else {
      axis = (input.right ? 1 : 0) - (input.left ? 1 : 0);
    }
    p.vx = axis * MOVE_SPEED;
    if (axis < -0.05) p.facing = -1;
    else if (axis > 0.05) p.facing = 1;

    // salto (com salto duplo)
    if (input.jump && !p.jumpHeld && p.jumpsLeft > 0) {
      p.vy = JUMP_VELOCITY;
      p.jumpsLeft--;
      p.onGround = false;
      spawnParticles(p.x + p.w / 2, p.y + p.h, 6, '#9fb4ff');
    }
    p.jumpHeld = input.jump;

    // gravidade
    p.vy += GRAVITY * dt;
    p.x += p.vx * dt;
    p.y += p.vy * dt;

    // limites mundo
    if (p.x < 0) p.x = 0;
    if (p.x + p.w > WORLD_W) p.x = WORLD_W - p.w;

    // colisão chão
    p.onGround = false;
    const gy = groundY() - p.h;
    if (p.y >= gy) { p.y = gy; p.vy = 0; p.onGround = true; p.jumpsLeft = 2; }

    // colisão plataformas (só de cima)
    for (const plat of platforms) {
      if (p.vy >= 0 &&
          p.x + p.w > plat.x && p.x < plat.x + plat.w &&
          p.y + p.h > plat.y && p.y + p.h < plat.y + plat.h + 24 &&
          (p.y + p.h - p.vy * dt) <= plat.y + 6) {
        p.y = plat.y - p.h; p.vy = 0; p.onGround = true; p.jumpsLeft = 2;
      }
    }

    // cooldowns
    if (p.fireCd > 0) p.fireCd -= dt;
    if (p.swapCd > 0) p.swapCd -= dt;
    if (p.invuln > 0) p.invuln -= dt;
    if (p.meleeT > 0) p.meleeT -= dt;

    // trocar arma
    if (input.swap && p.swapCd <= 0) {
      p.swapCd = 0.3;
      do {
        p.weaponIdx = (p.weaponIdx + 1) % WEAPON_ORDER.length;
      } while (!WEAPONS[WEAPON_ORDER[p.weaponIdx]].owned);
      updateHUD();
    }

    // disparar / atacar
    if (input.fire && p.fireCd <= 0) {
      fireWeapon();
    }

    // câmara
    const targetCam = clamp(p.x + p.w / 2 - VIEW_W / 2, 0, WORLD_W - VIEW_W);
    camX += (targetCam - camX) * Math.min(1, dt * 8);

    updateBullets(dt);
    updateEnemies(dt);
    updateBolts(dt);
    updateParticles(dt);

    if (shakeT > 0) shakeT -= dt;

    // fim de onda
    if (enemies.length === 0) {
      openShop();
    }

    // morte
    if (p.hp <= 0) gameOver();
  }

  function fireWeapon() {
    const p = player;
    const key = WEAPON_ORDER[p.weaponIdx];
    const w = WEAPONS[key];
    p.fireCd = w.cooldown;
    const muzzleX = p.x + p.w / 2 + p.facing * 24;
    const muzzleY = p.y + p.h * 0.4;

    if (w.melee) {
      p.meleeT = 0.18;
      shake(0.1, 4);
      // dano em arco à frente
      const reach = 60;
      for (const e of enemies) {
        const dx = (e.x + e.w / 2) - (p.x + p.w / 2);
        if (Math.sign(dx) === p.facing && Math.abs(dx) < reach && Math.abs((e.y) - p.y) < 60) {
          damageEnemy(e, w.dmg);
        }
      }
      for (const c of crates) {
        const dx = (c.x + c.w / 2) - (p.x + p.w / 2);
        if (Math.sign(dx) === p.facing && Math.abs(dx) < reach) breakCrate(c);
      }
      spawnParticles(muzzleX, muzzleY, 4, w.color);
      return;
    }

    const pellets = w.pellets || 1;
    for (let i = 0; i < pellets; i++) {
      const off = (pellets > 1) ? (i / (pellets - 1) - 0.5) * w.spread : (Math.random() - 0.5) * (w.spread || 0);
      const ang = off;
      bullets.push({
        x: muzzleX, y: muzzleY,
        vx: p.facing * w.speed * Math.cos(ang),
        vy: w.speed * Math.sin(ang),
        dmg: w.dmg, color: w.color, life: 1.2, r: 5,
      });
    }
    shake(0.05, 2);
    spawnParticles(muzzleX, muzzleY, 3, w.color);
  }

  function updateBullets(dt) {
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
      let hit = false;
      for (const e of enemies) {
        if (rectHit(b.x - b.r, b.y - b.r, b.r * 2, b.r * 2, e.x, e.y, e.w, e.h)) {
          damageEnemy(e, b.dmg); hit = true; break;
        }
      }
      if (!hit) for (const c of crates) {
        if (rectHit(b.x - b.r, b.y - b.r, b.r * 2, b.r * 2, c.x, c.y, c.w, c.h)) {
          breakCrate(c); hit = true; break;
        }
      }
      if (hit || b.life <= 0 || b.x < 0 || b.x > WORLD_W) bullets.splice(i, 1);
    }

    for (let i = enemyBullets.length - 1; i >= 0; i--) {
      const b = enemyBullets[i];
      b.x += b.vx * dt; b.y += b.vy * dt; b.life -= dt;
      const p = player;
      if (p.invuln <= 0 && rectHit(b.x - b.r, b.y - b.r, b.r * 2, b.r * 2, p.x, p.y, p.w, p.h)) {
        hurtPlayer(b.dmg);
        enemyBullets.splice(i, 1);
        continue;
      }
      if (b.life <= 0 || b.x < 0 || b.x > WORLD_W) enemyBullets.splice(i, 1);
    }
  }

  function updateEnemies(dt) {
    const p = player;
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      if (e.hitFlash > 0) e.hitFlash -= dt;
      // patrulha + perseguição
      const dx = (p.x) - e.x;
      const dist = Math.abs(dx);
      if (dist < 420) {
        e.vx = Math.sign(dx) * (60 + wave * 4);
      }
      e.x += e.vx * dt;
      if (e.x < 0) { e.x = 0; e.vx *= -1; }
      if (e.x + e.w > WORLD_W) { e.x = WORLD_W - e.w; e.vx *= -1; }

      // disparo
      e.shootCd -= dt;
      if (e.shootCd <= 0 && dist < 460) {
        e.shootCd = 1.4 + Math.random() * 1.6;
        const ang = Math.atan2((p.y + p.h / 2) - (e.y + e.h / 2), (p.x + p.w / 2) - (e.x + e.w / 2));
        const sp = 300;
        enemyBullets.push({
          x: e.x + e.w / 2, y: e.y + e.h / 2,
          vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
          dmg: e.tough ? 16 : 10, color: '#ff6b6b', life: 2.4, r: 5,
        });
      }

      // contacto
      if (p.invuln <= 0 && rectHit(p.x, p.y, p.w, p.h, e.x, e.y, e.w, e.h)) {
        hurtPlayer(e.tough ? 18 : 12);
        p.vx = Math.sign(p.x - e.x) * 200;
      }

      if (e.hp <= 0) {
        // dropa bolts
        const n = e.tough ? 8 : 4;
        for (let k = 0; k < n; k++) {
          bolts.push({ x: e.x + e.w / 2, y: e.y, vx: (Math.random() - 0.5) * 220, vy: -200 - Math.random() * 180, r: 7, t: 0 });
        }
        spawnParticles(e.x + e.w / 2, e.y + e.h / 2, 14, e.tough ? '#ff8a3d' : '#ff5e7a');
        shake(0.12, 5);
        enemies.splice(i, 1);
      }
    }
  }

  function updateBolts(dt) {
    const p = player;
    for (let i = bolts.length - 1; i >= 0; i--) {
      const b = bolts[i];
      b.t += dt;
      b.vy += GRAVITY * dt;
      b.x += b.vx * dt; b.y += b.vy * dt;
      const gy = groundY() - b.r;
      if (b.y > gy) { b.y = gy; b.vy *= -0.4; b.vx *= 0.7; }
      // íman: atrai para o jogador quando perto
      const dx = (p.x + p.w / 2) - b.x, dy = (p.y + p.h / 2) - b.y;
      const d = Math.hypot(dx, dy);
      if (d < 120) { b.x += dx / d * 360 * dt; b.y += dy / d * 360 * dt; }
      if (d < 26) {
        bolts_total += 1;
        bolts.splice(i, 1);
        updateHUD();
      }
    }
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const pa = particles[i];
      pa.life -= dt;
      pa.vy += 1400 * dt;
      pa.x += pa.vx * dt; pa.y += pa.vy * dt;
      if (pa.life <= 0) particles.splice(i, 1);
    }
  }

  function damageEnemy(e, dmg) {
    e.hp -= dmg;
    e.hitFlash = 0.1;
    spawnParticles(e.x + e.w / 2, e.y + e.h / 2, 4, '#fff');
  }

  function breakCrate(c) {
    const idx = crates.indexOf(c);
    if (idx === -1) return;
    crates.splice(idx, 1);
    for (let k = 0; k < 5; k++) {
      bolts.push({ x: c.x + c.w / 2, y: c.y, vx: (Math.random() - 0.5) * 200, vy: -220 - Math.random() * 120, r: 7, t: 0 });
    }
    spawnParticles(c.x + c.w / 2, c.y + c.h / 2, 8, '#caa15a');
  }

  function hurtPlayer(dmg) {
    const p = player;
    p.hp = Math.max(0, p.hp - dmg);
    p.invuln = 0.8;
    shake(0.18, 8);
    updateHUD();
  }

  function spawnParticles(x, y, n, color) {
    for (let i = 0; i < n; i++) {
      particles.push({
        x, y,
        vx: (Math.random() - 0.5) * 260,
        vy: (Math.random() - 0.8) * 260,
        life: 0.3 + Math.random() * 0.4,
        color, r: 2 + Math.random() * 3,
      });
    }
  }

  function shake(t, mag) { shakeT = Math.max(shakeT, t); shakeMag = mag; }

  // ---------- Render ----------
  function render() {
    ctx.save();
    ctx.scale(DPR, DPR);
    ctx.clearRect(0, 0, VIEW_W, VIEW_H);

    // fundo (gradiente espacial)
    const g = ctx.createLinearGradient(0, 0, 0, VIEW_H);
    g.addColorStop(0, '#0b1026');
    g.addColorStop(1, '#1b2350');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    drawStars();

    // shake
    let sx = 0, sy = 0;
    if (shakeT > 0) { sx = (Math.random() - 0.5) * shakeMag; sy = (Math.random() - 0.5) * shakeMag; }
    ctx.translate(-camX + sx, sy);

    drawGroundAndPlatforms();

    if (state !== State.MENU) {
      for (const c of crates) drawCrate(c);
      for (const b of bolts) drawBolt(b);
      for (const e of enemies) drawEnemy(e);
      drawPlayer();
      for (const b of bullets) drawBullet(b, b.color);
      for (const b of enemyBullets) drawBullet(b, b.color);
      for (const pa of particles) {
        ctx.globalAlpha = Math.max(0, pa.life * 2);
        ctx.fillStyle = pa.color;
        ctx.fillRect(pa.x, pa.y, pa.r, pa.r);
      }
      ctx.globalAlpha = 1;
    }

    ctx.restore();
  }

  let starField = [];
  function buildStars() {
    starField = [];
    for (let i = 0; i < 80; i++) {
      starField.push({ x: Math.random() * WORLD_W, y: Math.random() * VIEW_H * 0.8, r: Math.random() * 1.6 + 0.4, p: Math.random() });
    }
  }
  function drawStars() {
    ctx.save();
    ctx.translate(-camX * 0.3, 0);
    for (const s of starField) {
      ctx.globalAlpha = 0.4 + 0.5 * Math.abs(Math.sin(lastTime / 600 + s.p * 6));
      ctx.fillStyle = '#cdd6ff';
      ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawGroundAndPlatforms() {
    const gy = groundY();
    // chão
    ctx.fillStyle = '#2a356b';
    ctx.fillRect(0, gy, WORLD_W, GROUND_H + 40);
    ctx.fillStyle = '#38d6ff';
    ctx.fillRect(0, gy, WORLD_W, 4);
    // textura simples
    ctx.fillStyle = 'rgba(255,255,255,.04)';
    for (let x = 0; x < WORLD_W; x += 60) ctx.fillRect(x, gy + 12, 30, GROUND_H);
    // plataformas
    for (const p of platforms) {
      ctx.fillStyle = '#39477f';
      roundRect(p.x, p.y, p.w, p.h, 6); ctx.fill();
      ctx.fillStyle = '#5fd0ff';
      ctx.fillRect(p.x, p.y, p.w, 3);
    }
  }

  function drawPlayer() {
    const p = player;
    ctx.save();
    if (p.invuln > 0 && Math.floor(p.invuln * 20) % 2 === 0) ctx.globalAlpha = 0.4;
    const cx = p.x + p.w / 2;
    // mochila Clank
    ctx.fillStyle = '#7c8db5';
    roundRect(cx - p.facing * 18 - 8, p.y + 8, 16, 24, 4); ctx.fill();
    // corpo (fato laranja)
    ctx.fillStyle = '#e8842a';
    roundRect(p.x + 6, p.y + 18, p.w - 12, p.h - 18, 6); ctx.fill();
    // cabeça/capacete
    ctx.fillStyle = '#caa15a';
    ctx.beginPath(); ctx.arc(cx, p.y + 12, 13, 0, Math.PI * 2); ctx.fill();
    // orelhas (estilo Lombax)
    ctx.fillStyle = '#caa15a';
    ctx.beginPath(); ctx.ellipse(cx - 8, p.y + 2, 4, 9, -0.3, 0, Math.PI * 2); ctx.fill();
    ctx.beginPath(); ctx.ellipse(cx + 8, p.y + 2, 4, 9, 0.3, 0, Math.PI * 2); ctx.fill();
    // viseira
    ctx.fillStyle = '#38d6ff';
    ctx.fillRect(cx + p.facing * 2 - 5, p.y + 8, 12, 6);
    // arma na mão
    const key = WEAPON_ORDER[p.weaponIdx];
    const w = WEAPONS[key];
    ctx.fillStyle = w.color;
    if (w.melee) {
      const sw = p.meleeT > 0 ? 1 : 0;
      ctx.save();
      ctx.translate(cx + p.facing * 16, p.y + 28);
      ctx.rotate(p.facing * (sw ? -0.9 : 0.2));
      ctx.fillRect(0, -3, p.facing * 26, 7);
      ctx.fillRect(p.facing * 22, -7, p.facing * 8, 15);
      ctx.restore();
    } else {
      ctx.fillRect(cx + p.facing * 8, p.y + 26, p.facing * 24, 8);
    }
    ctx.restore();
  }

  function drawEnemy(e) {
    ctx.save();
    const cx = e.x + e.w / 2;
    ctx.fillStyle = e.hitFlash > 0 ? '#fff' : (e.tough ? '#b23a48' : '#4a5285');
    roundRect(e.x, e.y, e.w, e.h, 6); ctx.fill();
    // olho
    ctx.fillStyle = e.tough ? '#ffd23a' : '#ff5e7a';
    ctx.beginPath(); ctx.arc(cx, e.y + 16, 7, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#111';
    ctx.beginPath(); ctx.arc(cx + Math.sign(player.x - e.x) * 2, e.y + 16, 3, 0, Math.PI * 2); ctx.fill();
    // pernas
    ctx.fillStyle = '#2c3360';
    ctx.fillRect(e.x + 4, e.y + e.h - 6, 10, 8);
    ctx.fillRect(e.x + e.w - 14, e.y + e.h - 6, 10, 8);
    // barra de vida
    if (e.hp < e.maxHp) {
      ctx.fillStyle = 'rgba(0,0,0,.5)';
      ctx.fillRect(e.x, e.y - 10, e.w, 5);
      ctx.fillStyle = '#7CFC8A';
      ctx.fillRect(e.x, e.y - 10, e.w * (e.hp / e.maxHp), 5);
    }
    ctx.restore();
  }

  function drawBullet(b, color) {
    ctx.save();
    ctx.shadowColor = color; ctx.shadowBlur = 10;
    ctx.fillStyle = color;
    ctx.beginPath(); ctx.arc(b.x, b.y, b.r, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawBolt(b) {
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.t * 6);
    ctx.fillStyle = '#ffce3a';
    const r = b.r;
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
      const a = i / 6 * Math.PI * 2;
      ctx.lineTo(Math.cos(a) * r, Math.sin(a) * r);
    }
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = '#a87b00';
    ctx.beginPath(); ctx.arc(0, 0, r * 0.4, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function drawCrate(c) {
    ctx.fillStyle = '#8a6a36';
    roundRect(c.x, c.y, c.w, c.h, 4); ctx.fill();
    ctx.strokeStyle = '#5e4621'; ctx.lineWidth = 3;
    ctx.strokeRect(c.x + 3, c.y + 3, c.w - 6, c.h - 6);
    ctx.beginPath();
    ctx.moveTo(c.x, c.y); ctx.lineTo(c.x + c.w, c.y + c.h);
    ctx.moveTo(c.x + c.w, c.y); ctx.lineTo(c.x, c.y + c.h);
    ctx.stroke();
  }

  // ---------- Utils ----------
  function rectHit(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
  }
  function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }
  function roundRect(x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ---------- HUD / DOM ----------
  const elHealth = document.getElementById('health-fill');
  const elBolts = document.getElementById('bolts-count');
  const elWave = document.getElementById('wave-label');
  const elWeapon = document.getElementById('weapon-label');

  function updateHUD() {
    elHealth.style.width = (player.hp / player.maxHp * 100) + '%';
    elBolts.textContent = bolts_total;
    elWave.textContent = 'Onda ' + wave;
    elWeapon.textContent = WEAPONS[WEAPON_ORDER[player.weaponIdx]].name;
  }

  // ---------- Fluxo de jogo ----------
  function startGame() {
    bolts_total = 0;
    wave = 1;
    // reset propriedade das armas compráveis
    WEAPONS.spread.owned = false;
    WEAPONS.pyro.owned = false;
    player = makePlayer();
    buildLevel();
    buildStars();
    startWave(wave);
    show('overlay', false); show('shop', false); show('gameover', false);
    state = State.PLAY;
  }

  function openShop() {
    state = State.SHOP;
    renderShop();
    show('shop', true);
  }

  function renderShop() {
    document.getElementById('shop-bolts').textContent = bolts_total;
    const container = document.getElementById('shop-items');
    container.innerHTML = '';
    const upgrades = [
      { key: 'heal', name: 'Reparar armadura', desc: 'Recupera toda a vida', price: 60, action: () => { player.hp = player.maxHp; } },
      { key: 'spread', name: WEAPONS.spread.name, desc: WEAPONS.spread.desc, price: WEAPONS.spread.price, weapon: 'spread' },
      { key: 'pyro', name: WEAPONS.pyro.name, desc: WEAPONS.pyro.desc, price: WEAPONS.pyro.price, weapon: 'pyro' },
      { key: 'maxhp', name: 'Vida máxima +25', desc: 'Aumenta a vida máxima', price: 90, action: () => { player.maxHp += 25; player.hp += 25; } },
    ];
    for (const u of upgrades) {
      const owned = u.weapon && WEAPONS[u.weapon].owned;
      const div = document.createElement('div');
      div.className = 'shop-item';
      div.innerHTML = `<div class="info"><div class="name">${u.name}</div><div class="desc">${u.desc}</div></div>`;
      const btn = document.createElement('button');
      btn.className = 'buy-btn';
      if (owned) { btn.textContent = 'Comprado ✓'; btn.classList.add('owned'); btn.disabled = true; }
      else {
        btn.textContent = u.price + ' ⚙️';
        btn.disabled = bolts_total < u.price;
        btn.onclick = () => {
          if (bolts_total < u.price) return;
          bolts_total -= u.price;
          if (u.weapon) WEAPONS[u.weapon].owned = true;
          if (u.action) u.action();
          updateHUD();
          renderShop();
        };
      }
      div.appendChild(btn);
      container.appendChild(div);
    }
  }

  function nextWave() {
    wave++;
    startWave(wave);
    show('shop', false);
    state = State.PLAY;
  }

  function gameOver() {
    state = State.OVER;
    document.getElementById('final-wave').textContent = wave;
    document.getElementById('final-bolts').textContent = bolts_total;
    show('gameover', true);
  }

  function show(id, visible) {
    document.getElementById(id).classList.toggle('hidden', !visible);
  }

  // ---------- Input: teclado ----------
  const keyMap = {
    ArrowLeft: 'left', a: 'left', A: 'left',
    ArrowRight: 'right', d: 'right', D: 'right',
    ArrowUp: 'jump', ' ': 'jump', w: 'jump', W: 'jump',
    z: 'fire', Z: 'fire',
    x: 'fire', X: 'fire', // chave usa-se trocando arma; fire serve para ambas
    c: 'swap', C: 'swap',
  };
  window.addEventListener('keydown', (e) => {
    if (keyMap[e.key]) { input[keyMap[e.key]] = true; e.preventDefault(); }
  });
  window.addEventListener('keyup', (e) => {
    if (keyMap[e.key]) { input[keyMap[e.key]] = false; e.preventDefault(); }
  });

  // ---------- Input: touch ----------
  function bindTouch() {
    document.querySelectorAll('.ctrl').forEach((btn) => {
      const act = btn.dataset.act;
      const on = (e) => { e.preventDefault(); input[act] = true; };
      const off = (e) => { e.preventDefault(); input[act] = false; };
      btn.addEventListener('touchstart', on, { passive: false });
      btn.addEventListener('touchend', off, { passive: false });
      btn.addEventListener('touchcancel', off, { passive: false });
      btn.addEventListener('mousedown', on);
      btn.addEventListener('mouseup', off);
      btn.addEventListener('mouseleave', off);
    });
  }

  // ---------- Input: joystick analógico ----------
  function bindJoystick() {
    const base = document.getElementById('joystick');
    const thumb = document.getElementById('joy-thumb');

    function setCenter() {
      const r = base.getBoundingClientRect();
      joy.cx = r.left + r.width / 2;
      joy.cy = r.top + r.height / 2;
      joy.radius = r.width / 2 - 8;
    }
    function moveTo(clientX, clientY) {
      let dx = clientX - joy.cx;
      let dy = clientY - joy.cy;
      const dist = Math.hypot(dx, dy);
      const max = joy.radius;
      if (dist > max) { dx = dx / dist * max; dy = dy / dist * max; }
      joy.axis = dx / max;
      thumb.style.transform = `translate(${dx}px, ${dy}px)`;
    }
    function start(clientX, clientY, id) {
      joy.active = true; joy.id = id;
      setCenter();
      moveTo(clientX, clientY);
    }
    function end() {
      joy.active = false; joy.id = null; joy.axis = 0;
      thumb.style.transform = 'translate(0px, 0px)';
    }

    base.addEventListener('touchstart', (e) => {
      e.preventDefault();
      const t = e.changedTouches[0];
      start(t.clientX, t.clientY, t.identifier);
    }, { passive: false });
    document.addEventListener('touchmove', (e) => {
      if (!joy.active) return;
      for (const t of e.changedTouches) {
        if (t.identifier === joy.id) { e.preventDefault(); moveTo(t.clientX, t.clientY); }
      }
    }, { passive: false });
    const touchEnd = (e) => {
      for (const t of e.changedTouches) if (t.identifier === joy.id) end();
    };
    document.addEventListener('touchend', touchEnd);
    document.addEventListener('touchcancel', touchEnd);

    // rato (para testar no computador)
    base.addEventListener('mousedown', (e) => {
      start(e.clientX, e.clientY, 'mouse');
      const mm = (ev) => moveTo(ev.clientX, ev.clientY);
      const mu = () => { end(); document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); };
      document.addEventListener('mousemove', mm);
      document.addEventListener('mouseup', mu);
    });
  }

  // ---------- Botões de menu ----------
  document.getElementById('start-btn').addEventListener('click', startGame);
  document.getElementById('restart-btn').addEventListener('click', startGame);
  document.getElementById('next-wave-btn').addEventListener('click', nextWave);

  // ---------- Resize ----------
  function resize() {
    DPR = window.devicePixelRatio || 1;
    const w = window.innerWidth, h = window.innerHeight;
    canvas.width = w * DPR;
    canvas.height = h * DPR;
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
    VIEW_W = w; VIEW_H = h;
    if (platforms.length) layoutPlatforms();
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 200));

  // ---------- Init ----------
  resize();
  bindTouch();
  bindJoystick();
  buildStars();
  // jogador placeholder para o HUD não rebentar antes de começar
  player = makePlayer();
  requestAnimationFrame((t) => { lastTime = t; loop(t); });

  // service worker (PWA / offline)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
