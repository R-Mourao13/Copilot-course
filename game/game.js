/* Bolt Ranger 3D — arena de ação 3D inspirada em Ratchet & Clank.
 * Three.js (local em vendor/), câmara em terceira pessoa, controlos touch (joystick
 * + botões) e teclado. Reutiliza o HUD/loja/overlays do index.html.
 */
import * as THREE from 'three';

(() => {
  'use strict';

  const canvas = document.getElementById('game');

  // ---------- Constantes ----------
  const ARENA_R = 55;          // raio da arena
  const GRAVITY = 38;          // unidades/s²
  const MOVE_SPEED = 14;       // unidades/s
  const JUMP_V = 15;           // velocidade de salto
  const CAM_OFFSET = new THREE.Vector3(0, 11, 15);

  // ---------- Estado ----------
  const State = { MENU: 'menu', PLAY: 'play', SHOP: 'shop', OVER: 'over' };
  let state = State.MENU;
  let wave = 1;
  let bolts_total = 0;
  let lastTime = 0;

  const input = { fwd: false, back: false, left: false, right: false, jump: false, fire: false, swap: false };
  const joy = { active: false, id: null, cx: 0, cy: 0, axisX: 0, axisY: 0, radius: 50 };

  // ---------- Armas ----------
  const WEAPONS = {
    wrench:  { name: 'Chave-inglesa', melee: true,  dmg: 40, cooldown: 0.34, color: 0xcfd6f0, owned: true,  range: 5 },
    blaster: { name: 'Blaster',       melee: false, dmg: 22, cooldown: 0.22, speed: 55, color: 0x38d6ff, owned: true, pellets: 1, spread: 0 },
    spread:  { name: 'Espingarda',    melee: false, dmg: 15, cooldown: 0.55, speed: 48, color: 0x7cfc8a, owned: false, price: 120, pellets: 5, spread: 0.45, desc: '5 projéteis em leque' },
    pyro:    { name: 'Pyrocitor',     melee: false, dmg: 16, cooldown: 0.09, speed: 62, color: 0xff8a3d, owned: false, price: 200, pellets: 1, spread: 0.08, desc: 'Disparo rápido e contínuo' },
  };
  const WEAPON_ORDER = ['wrench', 'blaster', 'spread', 'pyro'];

  // ---------- Three.js base ----------
  let renderer, scene, camera;
  let player, playerGun;
  let enemies = [], bullets = [], enemyBullets = [], bolts = [], crates = [], particles = [];
  const tmp = new THREE.Vector3();
  const clock = { t: 0 };

  function initThree() {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b1026);
    scene.fog = new THREE.Fog(0x0b1026, 60, 120);

    camera = new THREE.PerspectiveCamera(60, 1, 0.1, 400);
    camera.position.set(0, 12, 16);

    // luzes
    const hemi = new THREE.HemisphereLight(0x9fb4ff, 0x202845, 0.9);
    scene.add(hemi);
    const dir = new THREE.DirectionalLight(0xffffff, 1.1);
    dir.position.set(20, 40, 18);
    dir.castShadow = true;
    dir.shadow.mapSize.set(1024, 1024);
    dir.shadow.camera.near = 1; dir.shadow.camera.far = 120;
    dir.shadow.camera.left = -70; dir.shadow.camera.right = 70;
    dir.shadow.camera.top = 70; dir.shadow.camera.bottom = -70;
    scene.add(dir);

    buildArena();
    player = buildPlayer();
    scene.add(player);

    resize();
  }

  function buildArena() {
    // chão
    const groundMat = new THREE.MeshStandardMaterial({ color: 0x222a55, roughness: 0.95, metalness: 0.1 });
    const ground = new THREE.Mesh(new THREE.CircleGeometry(ARENA_R, 64), groundMat);
    ground.rotation.x = -Math.PI / 2;
    ground.receiveShadow = true;
    scene.add(ground);

    // grelha
    const grid = new THREE.GridHelper(ARENA_R * 2, 36, 0x38d6ff, 0x2c356b);
    grid.material.opacity = 0.35; grid.material.transparent = true;
    scene.add(grid);

    // muro circular (segmentos)
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x2c356b, roughness: 0.7, metalness: 0.3, emissive: 0x0a1430 });
    const segs = 40;
    for (let i = 0; i < segs; i++) {
      const a = i / segs * Math.PI * 2;
      const post = new THREE.Mesh(new THREE.BoxGeometry(2, 4, 9), wallMat);
      post.position.set(Math.cos(a) * ARENA_R, 2, Math.sin(a) * ARENA_R);
      post.lookAt(0, 2, 0);
      post.castShadow = true; post.receiveShadow = true;
      scene.add(post);
    }
  }

  function buildPlayer() {
    const g = new THREE.Group();
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(1.4, 1.6, 1),
      new THREE.MeshStandardMaterial({ color: 0xe8842a, roughness: 0.6 })
    );
    body.position.y = 1.1; body.castShadow = true; g.add(body);

    const head = new THREE.Mesh(
      new THREE.SphereGeometry(0.7, 20, 16),
      new THREE.MeshStandardMaterial({ color: 0xcaa15a, roughness: 0.7 })
    );
    head.position.y = 2.3; head.castShadow = true; g.add(head);

    // orelhas estilo Lombax
    const earMat = new THREE.MeshStandardMaterial({ color: 0xcaa15a, roughness: 0.7 });
    for (const sx of [-1, 1]) {
      const ear = new THREE.Mesh(new THREE.ConeGeometry(0.22, 0.9, 8), earMat);
      ear.position.set(sx * 0.45, 2.95, -0.1);
      ear.rotation.z = sx * 0.3; g.add(ear);
    }
    // viseira
    const visor = new THREE.Mesh(
      new THREE.BoxGeometry(0.9, 0.3, 0.2),
      new THREE.MeshStandardMaterial({ color: 0x38d6ff, emissive: 0x1a6b88, roughness: 0.3 })
    );
    visor.position.set(0, 2.35, -0.6); g.add(visor);

    // mochila Clank
    const pack = new THREE.Mesh(
      new THREE.BoxGeometry(0.8, 1, 0.5),
      new THREE.MeshStandardMaterial({ color: 0x7c8db5, roughness: 0.5, metalness: 0.4 })
    );
    pack.position.set(0, 1.3, 0.65); pack.castShadow = true; g.add(pack);

    // arma
    playerGun = new THREE.Mesh(
      new THREE.BoxGeometry(0.4, 0.4, 1.6),
      new THREE.MeshStandardMaterial({ color: 0x38d6ff, emissive: 0x16566b, roughness: 0.4, metalness: 0.5 })
    );
    playerGun.position.set(0.7, 1.2, -0.6); playerGun.castShadow = true; g.add(playerGun);

    g.position.set(0, 0, 0);
    g.userData = {
      vy: 0, onGround: true, jumpsLeft: 2, jumpHeld: false,
      facing: 0, hp: 100, maxHp: 100, weaponIdx: 1,
      fireCd: 0, swapCd: 0, invuln: 0, meleeT: 0,
    };
    return g;
  }

  // ---------- Inimigos / objetos ----------
  function makeEnemy(x, z, tough, n) {
    const hp = tough ? 90 + n * 10 : 45 + n * 5;
    const mat = new THREE.MeshStandardMaterial({ color: tough ? 0xb23a48 : 0x4a5285, roughness: 0.6, metalness: 0.3, emissive: 0x000000 });
    const m = new THREE.Mesh(new THREE.BoxGeometry(1.6, 2, 1.6), mat);
    m.position.set(x, 1, z); m.castShadow = true;
    const eye = new THREE.Mesh(
      new THREE.SphereGeometry(0.35, 12, 10),
      new THREE.MeshStandardMaterial({ color: tough ? 0xffd23a : 0xff5e7a, emissive: tough ? 0x886600 : 0x661024 })
    );
    eye.position.set(0, 0.4, -0.85); m.add(eye);
    m.userData = { hp, maxHp: hp, tough, shootCd: 1 + Math.random() * 2, hitFlash: 0, mat };
    scene.add(m);
    return m;
  }

  function makeCrate(x, z) {
    const m = new THREE.Mesh(
      new THREE.BoxGeometry(1.6, 1.6, 1.6),
      new THREE.MeshStandardMaterial({ color: 0x8a6a36, roughness: 0.9 })
    );
    m.position.set(x, 0.8, z); m.castShadow = true; m.receiveShadow = true;
    scene.add(m);
    return m;
  }

  let boltGeo, boltMat;
  function makeBolt(x, y, z) {
    if (!boltGeo) {
      boltGeo = new THREE.CylinderGeometry(0.45, 0.45, 0.2, 8);
      boltMat = new THREE.MeshStandardMaterial({ color: 0xffce3a, emissive: 0x9a7400, metalness: 0.6, roughness: 0.3 });
    }
    const m = new THREE.Mesh(boltGeo, boltMat);
    m.position.set(x, y, z);
    m.userData = { vy: 6 + Math.random() * 4, vx: (Math.random() - 0.5) * 8, vz: (Math.random() - 0.5) * 8 };
    scene.add(m);
    return m;
  }

  function spawnParticles(pos, n, colorHex) {
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(
        new THREE.BoxGeometry(0.25, 0.25, 0.25),
        new THREE.MeshBasicMaterial({ color: colorHex })
      );
      m.position.copy(pos);
      m.userData = {
        vx: (Math.random() - 0.5) * 14, vy: Math.random() * 12, vz: (Math.random() - 0.5) * 14,
        life: 0.4 + Math.random() * 0.3,
      };
      scene.add(m);
      particles.push(m);
    }
  }

  function clearScene() {
    for (const arr of [enemies, bullets, enemyBullets, bolts, crates, particles]) {
      for (const o of arr) scene.remove(o);
      arr.length = 0;
    }
  }

  // ---------- Ondas ----------
  function startWave(n) {
    clearScene();
    const count = 3 + n;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 20 + Math.random() * (ARENA_R - 25);
      const tough = Math.random() < Math.min(0.15 + n * 0.05, 0.5);
      enemies.push(makeEnemy(Math.cos(a) * r, Math.sin(a) * r, tough, n));
    }
    for (let i = 0; i < 6; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 10 + Math.random() * (ARENA_R - 15);
      crates.push(makeCrate(Math.cos(a) * r, Math.sin(a) * r));
    }
    player.position.set(0, 0, 0);
    player.userData.vy = 0;
    updateHUD();
  }

  // ---------- Loop ----------
  function frame(t) {
    const dt = Math.min((t - lastTime) / 1000, 0.05);
    lastTime = t; clock.t += dt;
    if (state === State.PLAY) update(dt);
    updateCamera(dt);
    renderer.render(scene, camera);
    requestAnimationFrame(frame);
  }

  function update(dt) {
    const pd = player.userData;

    // direção de movimento
    let nx, nz;
    if (joy.active && (Math.abs(joy.axisX) > 0.12 || Math.abs(joy.axisY) > 0.12)) {
      nx = joy.axisX; nz = joy.axisY;
    } else {
      nx = (input.right ? 1 : 0) - (input.left ? 1 : 0);
      nz = (input.back ? 1 : 0) - (input.fwd ? 1 : 0);
    }
    const mag = Math.hypot(nx, nz);
    if (mag > 1) { nx /= mag; nz /= mag; }

    player.position.x += nx * MOVE_SPEED * dt;
    player.position.z += nz * MOVE_SPEED * dt;

    // virar para a direção do movimento
    if (mag > 0.05) {
      pd.facing = Math.atan2(-nx, -nz);
    }

    // salto / gravidade
    if (input.jump && !pd.jumpHeld && pd.jumpsLeft > 0) {
      pd.vy = JUMP_V; pd.jumpsLeft--; pd.onGround = false;
    }
    pd.jumpHeld = input.jump;
    pd.vy -= GRAVITY * dt;
    player.position.y += pd.vy * dt;
    if (player.position.y <= 0) { player.position.y = 0; pd.vy = 0; pd.onGround = true; pd.jumpsLeft = 2; }

    // limites da arena
    const dist = Math.hypot(player.position.x, player.position.z);
    if (dist > ARENA_R - 2) {
      const s = (ARENA_R - 2) / dist;
      player.position.x *= s; player.position.z *= s;
    }

    // suavizar rotação
    player.rotation.y = lerpAngle(player.rotation.y, pd.facing, Math.min(1, dt * 12));

    // cooldowns
    pd.fireCd -= dt; pd.swapCd -= dt; pd.invuln -= dt; pd.meleeT -= dt;
    if (pd.meleeT > 0) playerGun.rotation.x = -Math.sin(pd.meleeT / 0.18 * Math.PI) * 1.4;
    else playerGun.rotation.x = 0;

    // trocar arma
    if (input.swap && pd.swapCd <= 0) {
      pd.swapCd = 0.3;
      do { pd.weaponIdx = (pd.weaponIdx + 1) % WEAPON_ORDER.length; }
      while (!WEAPONS[WEAPON_ORDER[pd.weaponIdx]].owned);
      updateGunLook();
      updateHUD();
    }

    // disparar
    if (input.fire && pd.fireCd <= 0) fireWeapon();

    updateBullets(dt);
    updateEnemies(dt);
    updateBolts(dt);
    updateParticles(dt);

    if (pd.hp <= 0) { gameOver(); return; }
    if (enemies.length === 0) openShop();
  }

  function nearestEnemy(from, maxDist) {
    let best = null, bd = maxDist * maxDist;
    for (const e of enemies) {
      const d = e.position.distanceToSquared(from);
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }

  function fireWeapon() {
    const pd = player.userData;
    const w = WEAPONS[WEAPON_ORDER[pd.weaponIdx]];
    pd.fireCd = w.cooldown;

    const muzzle = new THREE.Vector3(0, 1.4, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), player.rotation.y).add(player.position);

    if (w.melee) {
      pd.meleeT = 0.18;
      for (const e of enemies.slice()) {
        if (e.position.distanceTo(player.position) < w.range) damageEnemy(e, w.dmg);
      }
      for (const c of crates.slice()) {
        if (c.position.distanceTo(player.position) < w.range) breakCrate(c);
      }
      spawnParticles(muzzle, 4, w.color);
      return;
    }

    // direção: auto-mira ao inimigo mais próximo, senão para a frente
    const target = nearestEnemy(player.position, 45);
    let baseDir;
    if (target) {
      baseDir = target.position.clone().add(new THREE.Vector3(0, 1, 0)).sub(muzzle).normalize();
      pd.facing = Math.atan2(target.position.x - player.position.x, target.position.z - player.position.z) + Math.PI;
    } else {
      baseDir = new THREE.Vector3(-Math.sin(player.rotation.y), 0, -Math.cos(player.rotation.y));
    }

    const pellets = w.pellets || 1;
    for (let i = 0; i < pellets; i++) {
      const off = pellets > 1 ? (i / (pellets - 1) - 0.5) * w.spread : (Math.random() - 0.5) * (w.spread || 0);
      const dir = baseDir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), off);
      const m = new THREE.Mesh(
        new THREE.SphereGeometry(0.3, 8, 8),
        new THREE.MeshBasicMaterial({ color: w.color })
      );
      m.position.copy(muzzle);
      m.userData = { vel: dir.multiplyScalar(w.speed), dmg: w.dmg, life: 1.6 };
      scene.add(m);
      bullets.push(m);
    }
    spawnParticles(muzzle, 3, w.color);
  }

  function updateBullets(dt) {
    for (let i = bullets.length - 1; i >= 0; i--) {
      const b = bullets[i];
      b.position.addScaledVector(b.userData.vel, dt);
      b.userData.life -= dt;
      let hit = false;
      for (const e of enemies) {
        if (b.position.distanceTo(e.position) < 1.4) { damageEnemy(e, b.userData.dmg); hit = true; break; }
      }
      if (!hit) for (const c of crates) {
        if (b.position.distanceTo(c.position) < 1.4) { breakCrate(c); hit = true; break; }
      }
      if (hit || b.userData.life <= 0 || Math.hypot(b.position.x, b.position.z) > ARENA_R + 5) {
        scene.remove(b); bullets.splice(i, 1);
      }
    }
    for (let i = enemyBullets.length - 1; i >= 0; i--) {
      const b = enemyBullets[i];
      b.position.addScaledVector(b.userData.vel, dt);
      b.userData.life -= dt;
      const pd = player.userData;
      if (pd.invuln <= 0 && b.position.distanceTo(tmp.copy(player.position).setY(1.2)) < 1.3) {
        hurtPlayer(b.userData.dmg); scene.remove(b); enemyBullets.splice(i, 1); continue;
      }
      if (b.userData.life <= 0) { scene.remove(b); enemyBullets.splice(i, 1); }
    }
  }

  function updateEnemies(dt) {
    const pd = player.userData;
    for (let i = enemies.length - 1; i >= 0; i--) {
      const e = enemies[i];
      const ed = e.userData;
      if (ed.hitFlash > 0) { ed.hitFlash -= dt; ed.mat.emissive.setHex(ed.hitFlash > 0 ? 0xffffff : 0x000000); }

      // mover na direção do jogador
      tmp.copy(player.position).sub(e.position); tmp.y = 0;
      const d = tmp.length();
      if (d > 1.8) {
        tmp.normalize();
        const sp = (ed.tough ? 4 : 6) + wave * 0.4;
        e.position.addScaledVector(tmp, sp * dt);
        e.rotation.y = Math.atan2(tmp.x, tmp.z);
      } else if (pd.invuln <= 0) {
        hurtPlayer(ed.tough ? 16 : 10);
      }

      // disparo
      ed.shootCd -= dt;
      if (ed.shootCd <= 0 && d < 40) {
        ed.shootCd = 1.6 + Math.random() * 1.6;
        const dir = player.position.clone().setY(1.2).sub(e.position.clone().setY(1)).normalize();
        const m = new THREE.Mesh(
          new THREE.SphereGeometry(0.28, 8, 8),
          new THREE.MeshBasicMaterial({ color: 0xff5e7a })
        );
        m.position.copy(e.position).setY(1);
        m.userData = { vel: dir.multiplyScalar(26), dmg: ed.tough ? 16 : 10, life: 3 };
        scene.add(m); enemyBullets.push(m);
      }

      if (ed.hp <= 0) {
        const n = ed.tough ? 9 : 4;
        for (let k = 0; k < n; k++) bolts.push(makeBolt(e.position.x, 1, e.position.z));
        spawnParticles(e.position, 14, ed.tough ? 0xff8a3d : 0xff5e7a);
        scene.remove(e); enemies.splice(i, 1);
      }
    }
  }

  function updateBolts(dt) {
    for (let i = bolts.length - 1; i >= 0; i--) {
      const b = bolts[i];
      const bd = b.userData;
      b.rotation.y += dt * 6; b.rotation.x += dt * 3;
      bd.vy -= GRAVITY * dt;
      b.position.x += bd.vx * dt; b.position.z += bd.vz * dt; b.position.y += bd.vy * dt;
      if (b.position.y < 0.4) { b.position.y = 0.4; bd.vy *= -0.35; bd.vx *= 0.7; bd.vz *= 0.7; }
      // íman
      tmp.copy(player.position).setY(1).sub(b.position);
      const d = tmp.length();
      if (d < 6) { tmp.normalize(); b.position.addScaledVector(tmp, 18 * dt); }
      if (d < 1.4) { bolts_total++; scene.remove(b); bolts.splice(i, 1); updateHUD(); }
    }
  }

  function updateParticles(dt) {
    for (let i = particles.length - 1; i >= 0; i--) {
      const p = particles[i]; const u = p.userData;
      u.life -= dt; u.vy -= 30 * dt;
      p.position.x += u.vx * dt; p.position.y += u.vy * dt; p.position.z += u.vz * dt;
      const s = Math.max(0.01, u.life * 2.5);
      p.scale.setScalar(s);
      if (u.life <= 0 || p.position.y < 0) { scene.remove(p); particles.splice(i, 1); }
    }
  }

  function damageEnemy(e, dmg) {
    e.userData.hp -= dmg;
    e.userData.hitFlash = 0.1;
    e.userData.mat.emissive.setHex(0xffffff);
  }

  function breakCrate(c) {
    const idx = crates.indexOf(c); if (idx === -1) return;
    crates.splice(idx, 1); scene.remove(c);
    for (let k = 0; k < 5; k++) bolts.push(makeBolt(c.position.x, 1, c.position.z));
    spawnParticles(c.position, 8, 0xcaa15a);
  }

  function hurtPlayer(dmg) {
    const pd = player.userData;
    pd.hp = Math.max(0, pd.hp - dmg);
    pd.invuln = 0.8;
    updateHUD();
  }

  // ---------- Câmara ----------
  function updateCamera(dt) {
    const target = tmp.copy(player.position).add(CAM_OFFSET);
    camera.position.lerp(target, Math.min(1, dt * 6));
    camera.lookAt(player.position.x, player.position.y + 1.5, player.position.z);
  }

  function updateGunLook() {
    const w = WEAPONS[WEAPON_ORDER[player.userData.weaponIdx]];
    playerGun.material.color.setHex(w.color);
    playerGun.material.emissive.setHex(w.melee ? 0x333344 : 0x16566b);
    playerGun.scale.z = w.melee ? 0.7 : 1;
  }

  // ---------- Utils ----------
  function lerpAngle(a, b, t) {
    let d = b - a;
    while (d > Math.PI) d -= Math.PI * 2;
    while (d < -Math.PI) d += Math.PI * 2;
    return a + d * t;
  }

  // ---------- HUD / DOM ----------
  const elHealth = document.getElementById('health-fill');
  const elBolts = document.getElementById('bolts-count');
  const elWave = document.getElementById('wave-label');
  const elWeapon = document.getElementById('weapon-label');

  function updateHUD() {
    const pd = player.userData;
    elHealth.style.width = (pd.hp / pd.maxHp * 100) + '%';
    elBolts.textContent = bolts_total;
    elWave.textContent = 'Onda ' + wave;
    elWeapon.textContent = WEAPONS[WEAPON_ORDER[pd.weaponIdx]].name;
  }

  // ---------- Fluxo ----------
  function startGame() {
    bolts_total = 0; wave = 1;
    WEAPONS.spread.owned = false; WEAPONS.pyro.owned = false;
    Object.assign(player.userData, {
      vy: 0, onGround: true, jumpsLeft: 2, jumpHeld: false,
      facing: 0, hp: 100, maxHp: 100, weaponIdx: 1,
      fireCd: 0, swapCd: 0, invuln: 0, meleeT: 0,
    });
    player.rotation.y = 0;
    updateGunLook();
    startWave(wave);
    show('overlay', false); show('shop', false); show('gameover', false);
    state = State.PLAY;
  }

  function openShop() { state = State.SHOP; renderShop(); show('shop', true); }

  function renderShop() {
    document.getElementById('shop-bolts').textContent = bolts_total;
    const container = document.getElementById('shop-items');
    container.innerHTML = '';
    const pd = player.userData;
    const upgrades = [
      { name: 'Reparar armadura', desc: 'Recupera toda a vida', price: 60, action: () => { pd.hp = pd.maxHp; } },
      { name: WEAPONS.spread.name, desc: WEAPONS.spread.desc, price: WEAPONS.spread.price, weapon: 'spread' },
      { name: WEAPONS.pyro.name, desc: WEAPONS.pyro.desc, price: WEAPONS.pyro.price, weapon: 'pyro' },
      { name: 'Vida máxima +25', desc: 'Aumenta a vida máxima', price: 90, action: () => { pd.maxHp += 25; pd.hp += 25; } },
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
          updateHUD(); renderShop();
        };
      }
      div.appendChild(btn);
      container.appendChild(div);
    }
  }

  function nextWave() { wave++; startWave(wave); show('shop', false); state = State.PLAY; }

  function gameOver() {
    state = State.OVER;
    document.getElementById('final-wave').textContent = wave;
    document.getElementById('final-bolts').textContent = bolts_total;
    show('gameover', true);
  }

  function show(id, visible) { document.getElementById(id).classList.toggle('hidden', !visible); }

  // ---------- Input: teclado ----------
  const keyMap = {
    ArrowUp: 'fwd', w: 'fwd', W: 'fwd',
    ArrowDown: 'back', s: 'back', S: 'back',
    ArrowLeft: 'left', a: 'left', A: 'left',
    ArrowRight: 'right', d: 'right', D: 'right',
    ' ': 'jump',
    z: 'fire', Z: 'fire',
    c: 'swap', C: 'swap',
  };
  window.addEventListener('keydown', (e) => { if (keyMap[e.key]) { input[keyMap[e.key]] = true; e.preventDefault(); } });
  window.addEventListener('keyup', (e) => { if (keyMap[e.key]) { input[keyMap[e.key]] = false; e.preventDefault(); } });

  // ---------- Input: botões touch ----------
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

  // ---------- Input: joystick analógico (2 eixos) ----------
  function bindJoystick() {
    const base = document.getElementById('joystick');
    const thumb = document.getElementById('joy-thumb');
    function setCenter() {
      const r = base.getBoundingClientRect();
      joy.cx = r.left + r.width / 2; joy.cy = r.top + r.height / 2; joy.radius = r.width / 2 - 8;
    }
    function moveTo(cx, cy) {
      let dx = cx - joy.cx, dy = cy - joy.cy;
      const dist = Math.hypot(dx, dy), max = joy.radius;
      if (dist > max) { dx = dx / dist * max; dy = dy / dist * max; }
      joy.axisX = dx / max; joy.axisY = dy / max;
      thumb.style.transform = `translate(${dx}px, ${dy}px)`;
    }
    function start(cx, cy, id) { joy.active = true; joy.id = id; setCenter(); moveTo(cx, cy); }
    function end() { joy.active = false; joy.id = null; joy.axisX = 0; joy.axisY = 0; thumb.style.transform = 'translate(0px,0px)'; }

    base.addEventListener('touchstart', (e) => { e.preventDefault(); const t = e.changedTouches[0]; start(t.clientX, t.clientY, t.identifier); }, { passive: false });
    document.addEventListener('touchmove', (e) => {
      if (!joy.active) return;
      for (const t of e.changedTouches) if (t.identifier === joy.id) { e.preventDefault(); moveTo(t.clientX, t.clientY); }
    }, { passive: false });
    const te = (e) => { for (const t of e.changedTouches) if (t.identifier === joy.id) end(); };
    document.addEventListener('touchend', te);
    document.addEventListener('touchcancel', te);
    base.addEventListener('mousedown', (e) => {
      start(e.clientX, e.clientY, 'mouse');
      const mm = (ev) => moveTo(ev.clientX, ev.clientY);
      const mu = () => { end(); document.removeEventListener('mousemove', mm); document.removeEventListener('mouseup', mu); };
      document.addEventListener('mousemove', mm); document.addEventListener('mouseup', mu);
    });
  }

  // ---------- Botões de menu ----------
  document.getElementById('start-btn').addEventListener('click', startGame);
  document.getElementById('restart-btn').addEventListener('click', startGame);
  document.getElementById('next-wave-btn').addEventListener('click', nextWave);

  // ---------- Resize ----------
  function resize() {
    const w = window.innerWidth, h = window.innerHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  window.addEventListener('resize', resize);
  window.addEventListener('orientationchange', () => setTimeout(resize, 200));

  // ---------- Init ----------
  initThree();
  bindTouch();
  bindJoystick();
  updateHUD();
  requestAnimationFrame((t) => { lastTime = t; frame(t); });

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
