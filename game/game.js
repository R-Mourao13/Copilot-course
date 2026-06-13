/* Bolt Ranger 3D v3 — gráficos melhorados, colisão com plataformas, joystick de mira,
 * sistema de objetivos antes do boss, loja por categorias, mais parafusos e power-ups.
 */
import * as THREE from 'three';

(() => {
  'use strict';

  const canvas = document.getElementById('game');

  // ─── Constantes ───────────────────────────────────────────────────────────
  const ARENA_R   = 55;
  const GRAVITY   = 36;
  const BASE_SPEED = 14;
  const JUMP_V    = 15;
  const CAM_OFF   = new THREE.Vector3(0, 12, 17);

  // ─── Estado global ────────────────────────────────────────────────────────
  const S = { MENU:'menu', PLAY:'play', SHOP:'shop', OVER:'over' };
  let state = S.MENU;
  let wave = 1, bolts_total = 0, lastTime = 0, clock_t = 0;
  let shopTab = 'vida';

  // Objetivos / chefe
  let terminals = [], objActivated = 0, objPhase = false, bossSpawned = false, boss = null;
  const OBJ_TOTAL = 3;

  // Dash
  let dashActive = false, dashT = 0;
  const dashDir = new THREE.Vector2();

  // ─── Upgrades (persistentes por jogo) ────────────────────────────────────
  const upg = {
    dmgLevel: 0,   // 0→1→2 : ×1, ×1.25, ×1.5
    cdLevel:  0,   // 0→1→2 : ×1, ×0.85, ×0.7
    spLevel:  0,   // 0→1→2 : ×1, ×1.25, ×1.5
    jumpMax:  2,   // 2 ou 3
    hasDash:  false,
    hasRegen: false,
  };
  function dmgMult()  { return [1, 1.25, 1.5][upg.dmgLevel]; }
  function cdMult()   { return [1, 0.85, 0.70][upg.cdLevel];  }
  function curSpeed() { return BASE_SPEED * [1, 1.25, 1.5][upg.spLevel]; }

  function resetUpgrades() {
    upg.dmgLevel = 0; upg.cdLevel = 0; upg.spLevel = 0;
    upg.jumpMax  = 2; upg.hasDash = false; upg.hasRegen = false;
  }

  // ─── Input ────────────────────────────────────────────────────────────────
  const inp = { fwd:false, back:false, left:false, right:false, jump:false, swap:false };
  const joy    = { active:false, id:null, cx:0, cy:0, axisX:0, axisY:0, radius:50 };
  const aimJoy = { active:false, id:null, cx:0, cy:0, axisX:0, axisY:0, radius:50 };

  // ─── Áudio (Web Audio API sintetizado) ───────────────────────────────────
  let actx = null;
  function initAudio() {
    if (!actx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) try { actx = new AC(); } catch(e) {}
    }
    if (actx?.state === 'suspended') actx.resume();
  }
  function tone(freq, dur, type='square', vol=0.1, slide=null) {
    if (!actx) return;
    const t = actx.currentTime;
    const o = actx.createOscillator(), g = actx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(1,slide), t+dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.0001, t+dur);
    o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t+dur+0.02);
  }
  const sfx = {
    shoot:     () => tone(680,0.08,'square',0.07,240),
    melee:     () => tone(220,0.12,'sawtooth',0.10,90),
    hit:       () => tone(420,0.04,'square',0.05,300),
    die:       () => tone(380,0.22,'sawtooth',0.10,70),
    bolt:      () => tone(900,0.07,'sine',0.10,1400),
    jump:      () => tone(320,0.13,'square',0.08,620),
    dash:      () => tone(600,0.15,'square',0.10,200),
    hurt:      () => tone(200,0.20,'sawtooth',0.15,70),
    buy:       () => { tone(700,0.08,'sine',0.10,1000); setTimeout(()=>tone(1000,0.1,'sine',0.10,1300),70); },
    activate:  () => { tone(880,0.10,'sine',0.12,1200); setTimeout(()=>tone(1200,0.12,'sine',0.10,1600),110); },
    allObj:    () => { [440,554,659,880].forEach((f,i)=>setTimeout(()=>tone(f,0.18,'sine',0.12),i*90)); },
    waveClear: () => { tone(523,0.12,'triangle',0.10); setTimeout(()=>tone(784,0.18,'triangle',0.10),120); },
    bossSpawn: () => { tone(55,0.8,'sawtooth',0.22,44); setTimeout(()=>tone(110,0.5,'square',0.14,80),350); },
    bossDie:   () => { tone(300,0.5,'sawtooth',0.18,50); setTimeout(()=>tone(180,0.6,'square',0.14,40),260); },
  };

  // ─── Armas ────────────────────────────────────────────────────────────────
  const WEP = {
    wrench: { name:'Chave-inglesa', melee:true,  baseDmg:40, cd:0.34, color:0xcfd6f0, owned:true,  range:5.5 },
    blaster:{ name:'Blaster',       melee:false, baseDmg:22, cd:0.22, speed:55, color:0x38d6ff, owned:true, pellets:1, spread:0 },
    spread: { name:'Espingarda',    melee:false, baseDmg:15, cd:0.55, speed:48, color:0x7cfc8a, owned:false, price:140, pellets:5, spread:0.45, desc:'5 projéteis em leque', cat:'arma' },
    pyro:   { name:'Pyrocitor',     melee:false, baseDmg:16, cd:0.09, speed:62, color:0xff8a3d, owned:false, price:220, pellets:1, spread:0.10, desc:'Disparo rápido contínuo', cat:'arma' },
    plasma: { name:'Canhão Plasma', melee:false, baseDmg:90, cd:1.20, speed:38, color:0xcc44ff, owned:false, price:380, pellets:1, spread:0,    desc:'Dano em área (raio 5)', area:5, cat:'arma' },
  };
  const WORDER = ['wrench','blaster','spread','pyro','plasma'];
  function wepDmg(key) { return WEP[key].baseDmg * dmgMult(); }
  function wepCd(key)  { return WEP[key].cd * cdMult();  }

  // ─── Three.js ─────────────────────────────────────────────────────────────
  let renderer, scene, camera;
  let player, playerGun, aimIndicator;
  let enemies=[], bullets=[], eBullets=[], bolts=[], crates=[], particles=[];
  let platCols=[];
  const tmp  = new THREE.Vector3();
  const tmp2 = new THREE.Vector3();

  function initThree() {
    renderer = new THREE.WebGLRenderer({ canvas, antialias:true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x090e20);
    scene.fog = new THREE.FogExp2(0x090e20, 0.011);
    camera = new THREE.PerspectiveCamera(60,1,0.1,400);
    camera.position.set(0,12,17);
    // Luzes
    scene.add(new THREE.HemisphereLight(0x9fb4ff,0x1a2040,0.85));
    const dir = new THREE.DirectionalLight(0xffeedd,1.2);
    dir.position.set(24,46,20); dir.castShadow=true;
    dir.shadow.mapSize.set(1024,1024);
    Object.assign(dir.shadow.camera,{near:1,far:130,left:-70,right:70,top:70,bottom:-70});
    scene.add(dir);
    // luz ambiente colorida
    const pt = new THREE.PointLight(0x3355ff,1.2,80);
    pt.position.set(0,30,0); scene.add(pt);
    buildArena(); buildPlatforms();
    player = buildPlayer(); scene.add(player);
    resize();
  }

  // ─── Arena ────────────────────────────────────────────────────────────────
  function buildArena() {
    // chão hexagonal (círculo)
    const gMat = new THREE.MeshStandardMaterial({color:0x1a2248,roughness:0.9,metalness:0.12});
    const ground = new THREE.Mesh(new THREE.CircleGeometry(ARENA_R,80),gMat);
    ground.rotation.x = -Math.PI/2; ground.receiveShadow=true; scene.add(ground);
    // padrão grelha
    const grid = new THREE.GridHelper(ARENA_R*2,44,0x38d6ff,0x222a55);
    grid.material.opacity=0.28; grid.material.transparent=true; scene.add(grid);
    // muros: cilindros arredondados ao longo do perímetro
    const wMat = new THREE.MeshStandardMaterial({color:0x252f60,roughness:0.65,metalness:0.35,emissive:0x06082a});
    const segs=32;
    for(let i=0;i<segs;i++) {
      const a = i/segs*Math.PI*2;
      const post = new THREE.Mesh(new THREE.CylinderGeometry(1.2,1.4,6,8),wMat);
      post.position.set(Math.cos(a)*ARENA_R,3,Math.sin(a)*ARENA_R);
      post.castShadow=true; post.receiveShadow=true; scene.add(post);
      // rebordo luminoso no topo dos pilares
      const cap = new THREE.Mesh(new THREE.CylinderGeometry(0.4,0.4,0.3,8),
        new THREE.MeshStandardMaterial({color:0x38d6ff,emissive:0x1a5566}));
      cap.position.set(Math.cos(a)*ARENA_R,6.2,Math.sin(a)*ARENA_R); scene.add(cap);
    }
  }

  // ─── Plataformas ──────────────────────────────────────────────────────────
  function buildPlatforms() {
    const defs = [
      {x:13,  z:-7,  w:8, d:7, top:3.5},
      {x:-15, z:-11, w:7, d:7, top:5},
      {x:1,   z:-24, w:10,d:6, top:6.5},
      {x:22,  z:13,  w:7, d:7, top:3.5},
      {x:-21, z:15,  w:8, d:7, top:5},
      {x:-2,  z:25,  w:8, d:7, top:3.5},
    ];
    const bMat = new THREE.MeshStandardMaterial({color:0x2e3b72,roughness:0.68,metalness:0.25});
    const eMat = new THREE.MeshStandardMaterial({color:0x5fd0ff,emissive:0x1a4d5a,roughness:0.35});
    platCols=[];
    for(const d of defs) {
      const h=d.top;
      const bl = new THREE.Mesh(new THREE.BoxGeometry(d.w,h,d.d),bMat);
      bl.position.set(d.x,h/2,d.z); bl.castShadow=true; bl.receiveShadow=true; scene.add(bl);
      // rebordo
      const rim=new THREE.Mesh(new THREE.BoxGeometry(d.w+0.3,0.22,d.d+0.3),eMat);
      rim.position.set(d.x,d.top+0.1,d.z); scene.add(rim);
      platCols.push({x:d.x,z:d.z,hw:d.w/2+0.55,hd:d.d/2+0.55,top:d.top});
    }
  }

  // ─── Jogador ──────────────────────────────────────────────────────────────
  function buildPlayer() {
    const g = new THREE.Group();
    // corpo (cápsula)
    const bodyM = new THREE.MeshStandardMaterial({color:0xe8842a,roughness:0.55,metalness:0.1});
    const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.55,0.9,6,14),bodyM);
    body.position.y=1.15; body.castShadow=true; g.add(body);
    // pernas
    const legM = new THREE.MeshStandardMaterial({color:0xa05e1a,roughness:0.7});
    for(const sx of[-1,1]) {
      const leg=new THREE.Mesh(new THREE.CapsuleGeometry(0.22,0.65,4,8),legM);
      leg.position.set(sx*0.3,0.32,0); g.add(leg);
    }
    // cabeça
    const headM = new THREE.MeshStandardMaterial({color:0xcaa15a,roughness:0.65});
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.68,20,16),headM);
    head.position.y=2.3; head.castShadow=true; g.add(head);
    // orelhas Lombax
    const earM = new THREE.MeshStandardMaterial({color:0xcaa15a,roughness:0.65});
    for(const sx of[-1,1]) {
      const ear=new THREE.Mesh(new THREE.ConeGeometry(0.19,0.9,6),earM);
      ear.position.set(sx*0.46,3.0,-0.05); ear.rotation.z=sx*0.28; g.add(ear);
    }
    // viseira
    const visor=new THREE.Mesh(new THREE.BoxGeometry(0.85,0.28,0.18),
      new THREE.MeshStandardMaterial({color:0x38d6ff,emissive:0x1a6b88,roughness:0.25}));
    visor.position.set(0,2.32,-0.6); g.add(visor);
    // mochila Clank (mais detalhada)
    const packG = new THREE.Group();
    packG.add(new THREE.Mesh(new THREE.BoxGeometry(0.9,1.1,0.55),
      new THREE.MeshStandardMaterial({color:0x7c8db5,roughness:0.5,metalness:0.45})));
    const eye2=new THREE.Mesh(new THREE.SphereGeometry(0.18,8,8),
      new THREE.MeshStandardMaterial({color:0x38d6ff,emissive:0x1a5566}));
    eye2.position.set(0,0.28,-0.3); packG.add(eye2);
    packG.position.set(0,1.35,0.72); packG.children[0].castShadow=true; g.add(packG);
    // arma
    playerGun = new THREE.Mesh(new THREE.BoxGeometry(0.38,0.38,1.7),
      new THREE.MeshStandardMaterial({color:0x38d6ff,emissive:0x16566b,roughness:0.35,metalness:0.6}));
    playerGun.position.set(0.72,1.2,-0.55); playerGun.castShadow=true; g.add(playerGun);
    // Indicador de mira (anel + seta no chão)
    aimIndicator = new THREE.Group();
    const ring=new THREE.Mesh(new THREE.TorusGeometry(1.4,0.08,8,36),
      new THREE.MeshBasicMaterial({color:0xff8a3d,transparent:true,opacity:0.6}));
    ring.rotation.x=Math.PI/2; aimIndicator.add(ring);
    const arrow=new THREE.Mesh(new THREE.ConeGeometry(0.22,0.7,6),
      new THREE.MeshBasicMaterial({color:0xff8a3d,transparent:true,opacity:0.8}));
    arrow.rotation.x=Math.PI/2; arrow.position.set(0,0,-1.4); aimIndicator.add(arrow);
    aimIndicator.position.y=0.12; aimIndicator.visible=false; g.add(aimIndicator);

    g.position.set(0,0,0);
    g.userData = {
      vy:0, onGround:true, jumpsLeft:2, jumpHeld:false,
      aimAngle:0, facing:0,
      hp:100, maxHp:100, weaponIdx:1,
      fireCd:0, swapCd:0, invuln:0, meleeT:0,
      regenT:0,
    };
    return g;
  }

  // ─── Inimigos ─────────────────────────────────────────────────────────────
  function makeEnemy(x,z,tough,n) {
    const hp = tough ? 100+n*12 : 50+n*6;
    const col = tough ? 0x9a2236 : 0x3a4275;
    const mat = new THREE.MeshStandardMaterial({color:col,roughness:0.55,metalness:0.3,emissive:0x000000});
    const g = new THREE.Group();
    // corpo cilíndrico
    const body=new THREE.Mesh(new THREE.CapsuleGeometry(0.7,0.7,6,12),mat);
    body.position.y=1.2; body.castShadow=true; g.add(body);
    // cabeça
    const headC = tough ? 0xff4040 : 0x5588ee;
    const head=new THREE.Mesh(new THREE.SphereGeometry(0.55,14,12),
      new THREE.MeshStandardMaterial({color:headC,roughness:0.5,metalness:0.2}));
    head.position.y=2.3; head.castShadow=true; g.add(head);
    // olho
    const eye=new THREE.Mesh(new THREE.SphereGeometry(0.22,10,8),
      new THREE.MeshStandardMaterial({color:tough?0xffd23a:0xff5e7a,emissive:tough?0x886600:0x661024}));
    eye.position.set(0,0,-0.55); head.add(eye);
    // pernas
    const lMat=new THREE.MeshStandardMaterial({color:tough?0x5a1020:0x252d52,roughness:0.7});
    for(const sx of[-1,1]) {
      const leg=new THREE.Mesh(new THREE.CapsuleGeometry(0.18,0.55,4,8),lMat);
      leg.position.set(sx*0.32,0.28,0); g.add(leg);
    }
    g.position.set(x,0,z);
    g.userData={hp,maxHp:hp,tough,shootCd:1+Math.random()*2,hitFlash:0,mat,
      vy:0,onGround:true};
    scene.add(g); return g;
  }

  // ─── Chefe ────────────────────────────────────────────────────────────────
  function spawnBoss() {
    bossSpawned=true;
    const hp=400+wave*160;
    const mat=new THREE.MeshStandardMaterial({color:0x7a1030,roughness:0.45,metalness:0.5,emissive:0x1a0008});
    const g=new THREE.Group();
    // corpo principal
    const body=new THREE.Mesh(new THREE.CapsuleGeometry(2.0,1.8,8,16),mat);
    body.position.y=2.8; body.castShadow=true; g.add(body);
    // cabeça grande
    const head=new THREE.Mesh(new THREE.SphereGeometry(1.4,20,16),
      new THREE.MeshStandardMaterial({color:0x5a0820,roughness:0.5,metalness:0.4,emissive:0x0a0005}));
    head.position.y=5.2; head.castShadow=true; g.add(head);
    // dois olhos
    for(const sx of[-1,1]) {
      const eye=new THREE.Mesh(new THREE.SphereGeometry(0.45,12,10),
        new THREE.MeshStandardMaterial({color:0xffd23a,emissive:0xaa7700}));
      eye.position.set(sx*0.55,5.4,-1.25); g.add(eye);
    }
    // braços
    const armMat=new THREE.MeshStandardMaterial({color:0x6a0a28,roughness:0.5,metalness:0.4});
    for(const sx of[-1,1]) {
      const arm=new THREE.Mesh(new THREE.CapsuleGeometry(0.45,1.4,6,10),armMat);
      arm.position.set(sx*2.6,3.0,0); arm.rotation.z=sx*0.5; g.add(arm);
      const fist=new THREE.Mesh(new THREE.SphereGeometry(0.55,10,8),armMat);
      fist.position.set(sx*3.4,2.2,0); g.add(fist);
    }
    // espigões no topo
    const spkM=new THREE.MeshStandardMaterial({color:0xff4040,emissive:0x440000,metalness:0.6});
    for(let i=0;i<8;i++) {
      const a=i/8*Math.PI*2;
      const sp=new THREE.Mesh(new THREE.ConeGeometry(0.3,1.6,6),spkM);
      sp.position.set(Math.cos(a)*1.8,6.8,Math.sin(a)*1.8); g.add(sp);
    }
    // luz pontual dramática
    const bLight=new THREE.PointLight(0xff2040,4,30);
    bLight.position.set(0,4,0); g.add(bLight);

    g.position.set(0,0,-30);
    g.userData={isBoss:true,hp,maxHp:hp,tough:true,shootCd:2,hitFlash:0,mat,
      vy:0,onGround:true,radius:2.8};
    scene.add(g); enemies.push(g); boss=g;
    elBossBar.classList.remove('hidden'); updateBossBar();
    sfx.bossSpawn();
    notify('⚠️ CHEFE APARECEU! ⚠️');
  }

  // ─── Terminais de objetivo ─────────────────────────────────────────────────
  let termMeshes=[];
  function buildObjectives() {
    for(const m of termMeshes) scene.remove(m);
    termMeshes=[]; terminals=[]; objActivated=0;
    updateObjHUD();
    // posições fixas espalhadas pela arena
    const positions=[
      {x:18,z:10},{x:-20,z:-14},{x:3,z:-28}
    ];
    for(const p of positions) {
      const g=new THREE.Group();
      // base
      const base=new THREE.Mesh(new THREE.CylinderGeometry(1.2,1.4,0.5,12),
        new THREE.MeshStandardMaterial({color:0x223355,roughness:0.7,metalness:0.4}));
      base.position.y=0.25; g.add(base);
      // cristal (OctahedronGeometry)
      const crys=new THREE.Mesh(new THREE.OctahedronGeometry(0.9,0),
        new THREE.MeshStandardMaterial({color:0xcc44ff,emissive:0x6600aa,roughness:0.2,metalness:0.5}));
      crys.position.y=1.5; crys.castShadow=true; g.add(crys);
      // luz
      const pt=new THREE.PointLight(0xcc44ff,2.5,10);
      pt.position.y=1.5; g.add(pt);
      g.position.set(p.x,0,p.z);
      g.userData={activated:false,crys,pt,light:pt};
      scene.add(g); termMeshes.push(g); terminals.push(g);
    }
    elObjLabel.classList.remove('hidden');
  }

  function updateObjHUD() {
    elObjCount.textContent=objActivated;
  }

  // ─── Caixotes ─────────────────────────────────────────────────────────────
  function makeCrate(x,z) {
    const g=new THREE.Group();
    const box=new THREE.Mesh(new THREE.BoxGeometry(1.7,1.7,1.7),
      new THREE.MeshStandardMaterial({color:0x8a6a36,roughness:0.85}));
    box.position.y=0.85; box.castShadow=true; box.receiveShadow=true; g.add(box);
    // reforços em X
    const lineMat=new THREE.MeshBasicMaterial({color:0x5e4621});
    for(const ax of[0,1]) {
      const bar=new THREE.Mesh(new THREE.BoxGeometry(ax?0.06:1.72, ax?1.72:0.06, 0.06),lineMat);
      bar.position.y=0.85; g.add(bar);
    }
    g.position.set(x,0,z); scene.add(g); return g;
  }

  // ─── Bolts ────────────────────────────────────────────────────────────────
  let boltGeo,boltMat;
  function makeBolt(x,y,z) {
    if(!boltGeo) {
      boltGeo=new THREE.CylinderGeometry(0.4,0.4,0.18,8);
      boltMat=new THREE.MeshStandardMaterial({color:0xffce3a,emissive:0x9a7400,metalness:0.6,roughness:0.25});
    }
    const m=new THREE.Mesh(boltGeo,boltMat); m.position.set(x,y,z);
    m.userData={vy:6+Math.random()*5,vx:(Math.random()-0.5)*9,vz:(Math.random()-0.5)*9};
    scene.add(m); return m;
  }
  function dropBolts(x,y,z,n) {
    for(let k=0;k<n;k++) bolts.push(makeBolt(x+(Math.random()-0.5)*2,y,z+(Math.random()-0.5)*2));
  }

  // ─── Partículas ───────────────────────────────────────────────────────────
  function spawnPfx(pos,n,col) {
    for(let i=0;i<n;i++) {
      const m=new THREE.Mesh(new THREE.OctahedronGeometry(0.15+Math.random()*0.15,0),
        new THREE.MeshBasicMaterial({color:col}));
      m.position.copy(pos);
      m.userData={vx:(Math.random()-.5)*16,vy:Math.random()*14,vz:(Math.random()-.5)*16,life:0.45+Math.random()*0.35};
      scene.add(m); particles.push(m);
    }
  }

  // ─── Projéteis inimigo ─────────────────────────────────────────────────────
  function spawnEB(x,y,z,dir,spd,dmg,col=0xff5e7a) {
    const m=new THREE.Mesh(new THREE.SphereGeometry(0.28,8,6),new THREE.MeshBasicMaterial({color:col}));
    m.position.set(x,y,z);
    m.userData={vel:dir.clone().normalize().multiplyScalar(spd),dmg,life:3.8};
    scene.add(m); eBullets.push(m);
  }

  // ─── Limpar cena ──────────────────────────────────────────────────────────
  function clearScene() {
    for(const arr of[enemies,bullets,eBullets,bolts,crates,particles]) {
      for(const o of arr) scene.remove(o); arr.length=0;
    }
    for(const m of termMeshes) scene.remove(m);
    termMeshes=[]; terminals=[];
  }

  // ─── Colisão Y (jogador e inimigos partilham) ─────────────────────────────
  function resolveYCols(pos,ud,halfR=0.7) {
    // chão
    if(pos.y<=0) { pos.y=0; ud.vy=0; ud.onGround=true; ud.jumpsLeft=upg.jumpMax; return; }
    // plataformas
    for(const pl of platCols) {
      if(ud.vy<=0 && pos.y<=pl.top && pos.y>=pl.top-1.1 &&
         Math.abs(pos.x-pl.x)<pl.hw+halfR && Math.abs(pos.z-pl.z)<pl.hd+halfR) {
        pos.y=pl.top; ud.vy=0; ud.onGround=true; ud.jumpsLeft=upg.jumpMax; return;
      }
    }
    ud.onGround=false;
  }

  // ─── Início de onda ───────────────────────────────────────────────────────
  function startWave(n) {
    clearScene(); boss=null; bossSpawned=false; objPhase=false; objActivated=0;
    elBossBar.classList.add('hidden'); elObjLabel.classList.add('hidden');
    const count=4+n;
    for(let i=0;i<count;i++) {
      const a=Math.random()*Math.PI*2, r=18+Math.random()*(ARENA_R-22);
      const tough=Math.random()<Math.min(0.12+n*0.06,0.55);
      enemies.push(makeEnemy(Math.cos(a)*r,Math.sin(a)*r,tough,n));
    }
    for(let i=0;i<8;i++) {
      const a=Math.random()*Math.PI*2, r=8+Math.random()*(ARENA_R-14);
      crates.push(makeCrate(Math.cos(a)*r,Math.sin(a)*r));
    }
    player.position.set(0,0,0); player.userData.vy=0;
    updateHUD();
  }

  // ─── Loop principal ───────────────────────────────────────────────────────
  function frame(t) {
    const dt=Math.min((t-lastTime)/1000,0.05);
    lastTime=t; clock_t+=dt;
    if(state===S.PLAY) update(dt);
    updateCamera(dt);
    renderer.render(scene,camera);
    requestAnimationFrame(frame);
  }

  // ─── Update ───────────────────────────────────────────────────────────────
  function update(dt) {
    const pd=player.userData;

    // ── Movimento ──
    let nx=0,nz=0;
    if(joy.active&&(Math.abs(joy.axisX)>0.1||Math.abs(joy.axisY)>0.1)) {
      nx=joy.axisX; nz=joy.axisY;
    } else {
      nx=(inp.right?1:0)-(inp.left?1:0);
      nz=(inp.back?1:0)-(inp.fwd?1:0);
    }
    const mag=Math.hypot(nx,nz);
    if(mag>1){nx/=mag;nz/=mag;}
    const spd=curSpeed();
    player.position.x+=nx*spd*dt;
    player.position.z+=nz*spd*dt;
    if(mag>0.06) pd.facing=Math.atan2(-nx,-nz);

    // ── Dash ──
    if(dashActive) {
      dashT-=dt;
      player.position.x+=dashDir.x*32*dt;
      player.position.z+=dashDir.y*32*dt;
      if(dashT<=0) dashActive=false;
    }
    if(inp.jump&&!pd.jumpHeld&&pd.jumpsLeft===0&&upg.hasDash&&mag>0.1&&!dashActive) {
      dashActive=true; dashT=0.18;
      dashDir.set(nx,nz).normalize(); sfx.dash();
    }
    pd.jumpHeld=inp.jump;

    // ── Salto / gravidade ──
    if(inp.jump&&!pd.jumpHeld&&pd.jumpsLeft>0&&!dashActive) {
      pd.vy=JUMP_V; pd.jumpsLeft--; sfx.jump();
    }
    const prevY=player.position.y;
    pd.vy-=GRAVITY*dt;
    player.position.y+=pd.vy*dt;
    resolveYCols(player.position,pd,0.7);
    if(player.position.y<=0&&prevY>0) { /* aterrou */ }

    // limites arena
    const d2=Math.hypot(player.position.x,player.position.z);
    if(d2>ARENA_R-2){const s=(ARENA_R-2)/d2;player.position.x*=s;player.position.z*=s;}

    // ── Mira (joystick direito) ──
    const aimMag=Math.hypot(aimJoy.axisX,aimJoy.axisY);
    let firing=false;
    if(aimMag>0.15) {
      pd.aimAngle=Math.atan2(-aimJoy.axisX,-aimJoy.axisY);
      pd.facing=pd.aimAngle;
      firing=true;
    } else {
      // mira segue movimento; ou teclado Z
      if(mag>0.05) pd.aimAngle=pd.facing;
    }
    if(inp.fire) { firing=true; }

    // Indicador de mira
    aimIndicator.visible=(aimMag>0.1||inp.fire);
    aimIndicator.rotation.y=pd.aimAngle;

    // suavizar rotação visual
    player.rotation.y=lerpAngle(player.rotation.y,pd.facing,Math.min(1,dt*14));

    // ── Cooldowns ──
    pd.fireCd-=dt; pd.swapCd-=dt; pd.invuln-=dt; pd.meleeT-=dt;
    if(pd.meleeT>0) playerGun.rotation.x=-Math.sin(pd.meleeT/0.18*Math.PI)*1.5;
    else playerGun.rotation.x=0;

    // ── Regen ──
    if(upg.hasRegen) {
      pd.regenT-=dt;
      if(pd.regenT<=0) { pd.regenT=1; pd.hp=Math.min(pd.maxHp,pd.hp+1); updateHUD(); }
    }

    // ── Trocar arma ──
    if(inp.swap&&pd.swapCd<=0) {
      pd.swapCd=0.3;
      do { pd.weaponIdx=(pd.weaponIdx+1)%WORDER.length; }
      while(!WEP[WORDER[pd.weaponIdx]].owned);
      updateGunLook(); updateHUD();
    }

    // ── Disparar ──
    if(firing&&pd.fireCd<=0) fireWeapon(pd.aimAngle);

    updateBullets(dt); updateEnemies(dt); updateBolts(dt);
    updateParticles(dt); updateTerminals(dt);

    if(boss) updateBossBar();
    if(pd.hp<=0){gameOver();return;}

    // ── Progressão de onda ──
    if(!objPhase&&!bossSpawned&&enemies.length===0) {
      // limpa todos → mostra terminais
      objPhase=true; buildObjectives();
      notify('🔮 Ativa os 3 terminais para enfrentar o CHEFE!');
    }
    if(objPhase&&!bossSpawned&&objActivated>=OBJ_TOTAL) {
      spawnBoss();
    }
    if(bossSpawned&&enemies.length===0) openShop();
  }

  // ─── Terminais update ──────────────────────────────────────────────────────
  function updateTerminals(dt) {
    for(const t of terminals) {
      if(t.userData.activated) {
        t.userData.crys.rotation.y+=dt*1.5;
        continue;
      }
      // pulsar
      const s=1+0.12*Math.sin(clock_t*3+t.position.x);
      t.userData.crys.scale.setScalar(s);
      t.userData.crys.rotation.y+=dt*0.8;
      // activar se jogador perto
      if(player.position.distanceTo(t.position)<3.2) {
        t.userData.activated=true;
        t.userData.crys.material.color.setHex(0x44ff88);
        t.userData.crys.material.emissive.setHex(0x007722);
        t.userData.light.color.setHex(0x44ff88);
        objActivated++; updateObjHUD();
        sfx.activate();
        notify(`🔮 Terminal ${objActivated}/${OBJ_TOTAL} ativado!`);
        if(objActivated>=OBJ_TOTAL) sfx.allObj();
      }
    }
  }

  // ─── Disparar ─────────────────────────────────────────────────────────────
  function fireWeapon(aimAngle) {
    const pd=player.userData;
    const key=WORDER[pd.weaponIdx];
    const w=WEP[key];
    pd.fireCd=wepCd(key);

    const muzzle=new THREE.Vector3(-Math.sin(aimAngle)*1.2,1.3,-Math.cos(aimAngle)*1.2).add(player.position);

    if(w.melee) {
      pd.meleeT=0.18; sfx.melee();
      for(const e of enemies.slice())
        if(e.position.distanceTo(player.position)<w.range) damageEnemy(e,wepDmg(key));
      for(const c of crates.slice())
        if(c.position.distanceTo(player.position)<w.range) breakCrate(c);
      spawnPfx(muzzle,5,w.color); return;
    }

    const baseDir=new THREE.Vector3(-Math.sin(aimAngle),0,-Math.cos(aimAngle));
    const pellets=w.pellets||1;
    for(let i=0;i<pellets;i++) {
      const off=pellets>1?(i/(pellets-1)-0.5)*w.spread:(Math.random()-0.5)*(w.spread||0);
      const dir=baseDir.clone().applyAxisAngle(new THREE.Vector3(0,1,0),off);
      const m=new THREE.Mesh(new THREE.SphereGeometry(0.28,6,6),
        new THREE.MeshBasicMaterial({color:w.color}));
      m.position.copy(muzzle);
      m.userData={vel:dir.multiplyScalar(w.speed),dmg:wepDmg(key),life:1.8,area:w.area||0};
      scene.add(m); bullets.push(m);
    }
    sfx.shoot(); spawnPfx(muzzle,3,w.color);
  }

  // ─── Balas ────────────────────────────────────────────────────────────────
  function updateBullets(dt) {
    for(let i=bullets.length-1;i>=0;i--) {
      const b=bullets[i]; b.position.addScaledVector(b.userData.vel,dt); b.userData.life-=dt;
      let hit=false;
      for(const e of enemies) {
        const hr=(e.userData.radius||0.9)+0.5;
        if(b.position.distanceTo(e.position)<hr) {
          if(b.userData.area>0) {
            // dano em área
            for(const e2 of enemies) if(e2.position.distanceTo(b.position)<b.userData.area) damageEnemy(e2,b.userData.dmg);
            spawnPfx(b.position,20,0xcc44ff);
          } else { damageEnemy(e,b.userData.dmg); }
          hit=true; break;
        }
      }
      if(!hit) for(const c of crates) {
        if(b.position.distanceTo(new THREE.Vector3(c.position.x,0.85,c.position.z))<1.5)
          { breakCrate(c); hit=true; break; }
      }
      if(hit||b.userData.life<=0||Math.hypot(b.position.x,b.position.z)>ARENA_R+5)
        { scene.remove(b); bullets.splice(i,1); }
    }
    // balas inimigas
    for(let i=eBullets.length-1;i>=0;i--) {
      const b=eBullets[i]; b.position.addScaledVector(b.userData.vel,dt); b.userData.life-=dt;
      const pd=player.userData;
      if(pd.invuln<=0&&b.position.distanceTo(tmp.copy(player.position).setY(1.2))<1.2)
        { hurtPlayer(b.userData.dmg); scene.remove(b); eBullets.splice(i,1); continue; }
      if(b.userData.life<=0) { scene.remove(b); eBullets.splice(i,1); }
    }
  }

  // ─── Inimigos update ──────────────────────────────────────────────────────
  function updateEnemies(dt) {
    const pd=player.userData;
    for(let i=enemies.length-1;i>=0;i--) {
      const e=enemies[i]; const ed=e.userData;
      if(ed.hitFlash>0) { ed.hitFlash-=dt; ed.mat.emissive.setHex(ed.hitFlash>0?0xffffff:0x000000); }

      // gravidade + colisão plataformas
      ed.vy-=GRAVITY*dt;
      e.position.y+=ed.vy*dt;
      resolveYCols(e.position,ed,ed.isBoss?2.0:0.7);

      // movimento horizontal
      const reach=ed.isBoss?4.5:1.9;
      tmp.copy(player.position).sub(e.position); tmp.y=0;
      const dist=tmp.length();
      if(dist>reach) {
        tmp.normalize();
        const sp=ed.isBoss?(2.5+wave*0.2):(ed.tough?4.5:6.5)+wave*0.35;
        e.position.x+=tmp.x*sp*dt; e.position.z+=tmp.z*sp*dt;
        e.rotation.y=Math.atan2(tmp.x,tmp.z);
      } else if(pd.invuln<=0) {
        hurtPlayer(ed.isBoss?26:ed.tough?18:12);
      }

      // limites arena
      const edist=Math.hypot(e.position.x,e.position.z);
      if(edist>ARENA_R-3){const s=(ARENA_R-3)/edist;e.position.x*=s;e.position.z*=s;}

      // disparo
      ed.shootCd-=dt;
      if(ed.shootCd<=0&&dist<65) {
        if(ed.isBoss) {
          ed.shootCd=1.6;
          // rajada circular de 14
          for(let s=0;s<14;s++) {
            const a=s/14*Math.PI*2+clock_t*0.5;
            spawnEB(e.position.x,e.position.y+3,e.position.z,new THREE.Vector3(Math.sin(a),0,Math.cos(a)),22,14,0xff8a3d);
          }
          // tiro dirigido rápido
          const aim=tmp2.copy(player.position).setY(1.4).sub(tmp.copy(e.position).setY(e.position.y+3));
          spawnEB(e.position.x,e.position.y+3,e.position.z,aim,38,20,0xffd23a);
        } else {
          ed.shootCd=1.5+Math.random()*1.8;
          const aim=tmp2.copy(player.position).setY(1.2).sub(tmp.copy(e.position).setY(e.position.y+1.2));
          spawnEB(e.position.x,e.position.y+1.2,e.position.z,aim,28,ed.tough?17:11);
        }
      }

      if(ed.hp<=0) {
        if(ed.isBoss) {
          sfx.bossDie(); elBossBar.classList.add('hidden'); boss=null;
          dropBolts(e.position.x,1,e.position.z,50);
          spawnPfx(e.position,50,0xff8a3d);
          notify('CHEFE DERROTADO! 🏆');
        } else {
          sfx.die();
          dropBolts(e.position.x,1,e.position.z,ed.tough?20:10);
          spawnPfx(e.position,16,ed.tough?0xff8a3d:0xff5e7a);
        }
        scene.remove(e); enemies.splice(i,1);
      }
    }
  }

  // ─── Bolts update ─────────────────────────────────────────────────────────
  function updateBolts(dt) {
    for(let i=bolts.length-1;i>=0;i--) {
      const b=bolts[i]; const bd=b.userData;
      b.rotation.y+=dt*5; bd.vy-=GRAVITY*dt;
      b.position.x+=bd.vx*dt; b.position.z+=bd.vz*dt; b.position.y+=bd.vy*dt;
      if(b.position.y<0.3){b.position.y=0.3;bd.vy*=-0.3;bd.vx*=0.7;bd.vz*=0.7;}
      tmp.copy(player.position).setY(1).sub(b.position);
      const d=tmp.length();
      if(d<7){tmp.normalize();b.position.addScaledVector(tmp,22*dt);}
      if(d<1.3){bolts_total++;scene.remove(b);bolts.splice(i,1);updateHUD();sfx.bolt();}
    }
  }

  // ─── Partículas update ────────────────────────────────────────────────────
  function updateParticles(dt) {
    for(let i=particles.length-1;i>=0;i--) {
      const p=particles[i]; const u=p.userData;
      u.life-=dt; u.vy-=32*dt;
      p.position.x+=u.vx*dt; p.position.y+=u.vy*dt; p.position.z+=u.vz*dt;
      p.scale.setScalar(Math.max(0.01,u.life*2.8));
      if(u.life<=0){scene.remove(p);particles.splice(i,1);}
    }
  }

  // ─── Dano / quebrar ───────────────────────────────────────────────────────
  function damageEnemy(e,dmg) {
    e.userData.hp-=dmg; e.userData.hitFlash=0.1;
    e.userData.mat.emissive.setHex(0xffffff); sfx.hit();
  }
  function breakCrate(c) {
    const idx=crates.indexOf(c); if(idx===-1)return;
    crates.splice(idx,1); scene.remove(c);
    dropBolts(c.position.x,1,c.position.z,14);
    spawnPfx(new THREE.Vector3(c.position.x,1,c.position.z),10,0xcaa15a);
  }
  function hurtPlayer(dmg) {
    const pd=player.userData; pd.hp=Math.max(0,pd.hp-dmg); pd.invuln=0.8;
    updateHUD(); sfx.hurt();
  }

  // ─── Câmara ───────────────────────────────────────────────────────────────
  function updateCamera(dt) {
    tmp.copy(player.position).add(CAM_OFF);
    camera.position.lerp(tmp,Math.min(1,dt*7));
    camera.lookAt(player.position.x,player.position.y+1.6,player.position.z);
  }
  function updateGunLook() {
    const w=WEP[WORDER[player.userData.weaponIdx]];
    playerGun.material.color.setHex(w.color);
    playerGun.material.emissive.setHex(w.melee?0x333344:0x16566b);
    playerGun.scale.z=w.melee?0.65:1;
  }

  // ─── Utils ────────────────────────────────────────────────────────────────
  function lerpAngle(a,b,t){let d=b-a;while(d>Math.PI)d-=Math.PI*2;while(d<-Math.PI)d+=Math.PI*2;return a+d*t;}

  // ─── HUD DOM ──────────────────────────────────────────────────────────────
  const elHealth  = document.getElementById('health-fill');
  const elBolts   = document.getElementById('bolts-count');
  const elWave    = document.getElementById('wave-label');
  const elWeapon  = document.getElementById('weapon-label');
  const elBossBar = document.getElementById('boss-bar');
  const elBossFill= document.getElementById('boss-health-fill');
  const elObjLabel= document.getElementById('objective-label');
  const elObjCount= document.getElementById('obj-count');
  const elNotif   = document.getElementById('notification');
  let notifTimer  = null;

  function updateBossBar() {
    if(!boss)return;
    elBossFill.style.width=Math.max(0,boss.userData.hp/boss.userData.maxHp*100)+'%';
  }
  function updateHUD() {
    const pd=player.userData;
    elHealth.style.width=(pd.hp/pd.maxHp*100)+'%';
    elBolts.textContent=bolts_total;
    elWave.textContent='Onda '+wave;
    elWeapon.textContent=WEP[WORDER[pd.weaponIdx]].name;
  }
  function notify(msg,dur=2.8) {
    elNotif.textContent=msg; elNotif.classList.add('show');
    clearTimeout(notifTimer);
    notifTimer=setTimeout(()=>elNotif.classList.remove('show'),dur*1000);
  }

  // ─── Loja ────────────────────────────────────────────────────────────────
  const SHOP_ITEMS = {
    vida: [
      {id:'heal',    name:'Reparar armadura', desc:'Recupera toda a vida',           price:60,  action:()=>{ const pd=player.userData; pd.hp=pd.maxHp; } },
      {id:'maxhp1',  name:'Vida máx +25',     desc:'Aumenta a vida máxima',           price:90,  action:()=>{ const pd=player.userData; pd.maxHp+=25; pd.hp+=25; } },
      {id:'maxhp2',  name:'Vida máx +50',     desc:'Aumenta ainda mais a vida máxima',price:180, req:'maxhp1', action:()=>{ const pd=player.userData; pd.maxHp+=50; pd.hp+=50; } },
      {id:'regen',   name:'Regeneração',       desc:'+1 HP por segundo (passivo)',     price:160, once:true, action:()=>{ upg.hasRegen=true; } },
    ],
    arma: [
      {id:'spread',  name:WEP.spread.name, desc:WEP.spread.desc, price:WEP.spread.price, weapon:'spread' },
      {id:'pyro',    name:WEP.pyro.name,   desc:WEP.pyro.desc,   price:WEP.pyro.price,   weapon:'pyro'   },
      {id:'plasma',  name:WEP.plasma.name, desc:WEP.plasma.desc, price:WEP.plasma.price, weapon:'plasma' },
      {id:'dmg1',    name:'Dano +25%',     desc:'Todos os danos aumentam 25%',  price:110, req:null,  action:()=>{ upg.dmgLevel=Math.min(2,upg.dmgLevel+1); } },
      {id:'dmg2',    name:'Dano +50%',     desc:'Todos os danos aumentam 50%',  price:200, req:'dmg1', action:()=>{ upg.dmgLevel=Math.min(2,upg.dmgLevel+1); } },
      {id:'cd1',     name:'Cadência +15%', desc:'Reduz cooldown de disparo',    price:120, action:()=>{ upg.cdLevel=Math.min(2,upg.cdLevel+1); } },
      {id:'cd2',     name:'Cadência +30%', desc:'Reduz ainda mais o cooldown',  price:210, req:'cd1', action:()=>{ upg.cdLevel=Math.min(2,upg.cdLevel+1); } },
    ],
    movimento: [
      {id:'jump3',   name:'Triplo salto',  desc:'Ganha um 3.º salto no ar',     price:90,  once:true, action:()=>{ upg.jumpMax=3; } },
      {id:'dash',    name:'Dash',          desc:'Carrega salto em movimento para dar um dash', price:150, once:true, action:()=>{ upg.hasDash=true; } },
      {id:'spd1',    name:'Velocidade +25%',desc:'Move-te mais depressa',       price:100, action:()=>{ upg.spLevel=Math.min(2,upg.spLevel+1); } },
      {id:'spd2',    name:'Velocidade +50%',desc:'Move-te muito mais depressa', price:190, req:'spd1', action:()=>{ upg.spLevel=Math.min(2,upg.spLevel+1); } },
    ],
  };
  // rastrear o que foi comprado
  const bought = new Set();

  function openShop() { state=S.SHOP; sfx.waveClear(); renderShop(); show('shop',true); }

  function renderShop() {
    document.getElementById('shop-bolts').textContent=bolts_total;
    const container=document.getElementById('shop-items');
    container.innerHTML='';
    const items=SHOP_ITEMS[shopTab]||[];
    for(const u of items) {
      const isWeapon=!!u.weapon;
      const owned=isWeapon?WEP[u.weapon].owned:bought.has(u.id);
      const maxed=!isWeapon&&u.req&&!bought.has(u.req);
      const isOnce=u.once&&bought.has(u.id);
      const div=document.createElement('div'); div.className='shop-item';
      div.innerHTML=`<div class="info"><div class="name">${u.name}</div><div class="desc">${u.desc||''}</div></div>`;
      const btn=document.createElement('button'); btn.className='buy-btn';
      if(owned||isOnce) { btn.textContent='✓ Comprado'; btn.classList.add('owned'); btn.disabled=true; }
      else if(maxed)    { btn.textContent='Bloqueado'; btn.disabled=true; }
      else {
        btn.textContent=u.price+' ⚙️';
        btn.disabled=bolts_total<u.price;
        btn.onclick=()=>{
          if(bolts_total<u.price)return;
          bolts_total-=u.price;
          if(isWeapon) WEP[u.weapon].owned=true;
          if(u.action) u.action();
          bought.add(u.id);
          sfx.buy(); updateHUD(); renderShop();
        };
      }
      div.appendChild(btn); container.appendChild(div);
    }
  }

  function nextWave() { wave++; startWave(wave); show('shop',false); state=S.PLAY; }

  function gameOver() {
    state=S.OVER;
    document.getElementById('final-wave').textContent=wave;
    document.getElementById('final-bolts').textContent=bolts_total;
    show('gameover',true);
  }

  function startGame() {
    initAudio(); bolts_total=0; wave=1;
    for(const k of Object.keys(WEP)) WEP[k].owned=(k==='wrench'||k==='blaster');
    bought.clear(); resetUpgrades();
    Object.assign(player.userData,{
      vy:0,onGround:true,jumpsLeft:2,jumpHeld:false,
      aimAngle:0,facing:0,hp:100,maxHp:100,weaponIdx:1,
      fireCd:0,swapCd:0,invuln:0,meleeT:0,regenT:0,
    });
    player.rotation.y=0; updateGunLook();
    startWave(wave);
    show('overlay',false); show('shop',false); show('gameover',false);
    state=S.PLAY;
  }

  function show(id,v) { document.getElementById(id).classList.toggle('hidden',!v); }

  // ─── Input teclado ────────────────────────────────────────────────────────
  const KM={ArrowUp:'fwd',w:'fwd',W:'fwd',ArrowDown:'back',s:'back',S:'back',
    ArrowLeft:'left',a:'left',A:'left',ArrowRight:'right',d:'right',D:'right',
    ' ':'jump',z:'fire',Z:'fire',c:'swap',C:'swap'};
  window.addEventListener('keydown',e=>{if(KM[e.key]){inp[KM[e.key]]=true;e.preventDefault();}});
  window.addEventListener('keyup',  e=>{if(KM[e.key]){inp[KM[e.key]]=false;e.preventDefault();}});

  // ─── Botões touch (swap/jump) ─────────────────────────────────────────────
  function bindButtons() {
    document.querySelectorAll('.ctrl').forEach(btn=>{
      const act=btn.dataset.act;
      if(!act)return;
      const on=e=>{e.preventDefault();inp[act]=true;};
      const off=e=>{e.preventDefault();inp[act]=false;};
      btn.addEventListener('touchstart',on,{passive:false});
      btn.addEventListener('touchend',off,{passive:false});
      btn.addEventListener('touchcancel',off,{passive:false});
      btn.addEventListener('mousedown',on);
      btn.addEventListener('mouseup',off);
      btn.addEventListener('mouseleave',off);
    });
  }

  // ─── Joystick genérico ────────────────────────────────────────────────────
  function makeJoystick(baseEl,thumbEl,joyObj,onActive) {
    function setCenter(){const r=baseEl.getBoundingClientRect();joyObj.cx=r.left+r.width/2;joyObj.cy=r.top+r.height/2;joyObj.radius=r.width/2-8;}
    function moveTo(cx,cy){let dx=cx-joyObj.cx,dy=cy-joyObj.cy;const d=Math.hypot(dx,dy),m=joyObj.radius;if(d>m){dx=dx/d*m;dy=dy/d*m;}joyObj.axisX=dx/m;joyObj.axisY=dy/m;thumbEl.style.transform=`translate(${dx}px,${dy}px)`;}
    function start(cx,cy,id){joyObj.active=true;joyObj.id=id;setCenter();moveTo(cx,cy);if(onActive)onActive(true);}
    function end(){joyObj.active=false;joyObj.id=null;joyObj.axisX=0;joyObj.axisY=0;thumbEl.style.transform='translate(0px,0px)';if(onActive)onActive(false);}
    baseEl.addEventListener('touchstart',e=>{e.preventDefault();const t=e.changedTouches[0];start(t.clientX,t.clientY,t.identifier);},{passive:false});
    document.addEventListener('touchmove',e=>{if(!joyObj.active)return;for(const t of e.changedTouches)if(t.identifier===joyObj.id){e.preventDefault();moveTo(t.clientX,t.clientY);}},{passive:false});
    const te=e=>{for(const t of e.changedTouches)if(t.identifier===joyObj.id)end();};
    document.addEventListener('touchend',te);document.addEventListener('touchcancel',te);
    baseEl.addEventListener('mousedown',e=>{start(e.clientX,e.clientY,'mouse');const mm=ev=>moveTo(ev.clientX,ev.clientY);const mu=()=>{end();document.removeEventListener('mousemove',mm);document.removeEventListener('mouseup',mu);};document.addEventListener('mousemove',mm);document.addEventListener('mouseup',mu);});
  }

  // ─── Shop tabs ────────────────────────────────────────────────────────────
  function bindShopTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn=>{
      btn.addEventListener('click',()=>{
        shopTab=btn.dataset.tab;
        document.querySelectorAll('.tab-btn').forEach(b=>b.classList.toggle('active',b===btn));
        renderShop();
      });
    });
  }

  // ─── Botões menu ─────────────────────────────────────────────────────────
  document.getElementById('start-btn').addEventListener('click',startGame);
  document.getElementById('restart-btn').addEventListener('click',startGame);
  document.getElementById('next-wave-btn').addEventListener('click',nextWave);

  // ─── Resize ───────────────────────────────────────────────────────────────
  function resize() {
    const w=window.innerWidth,h=window.innerHeight;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
    renderer.setSize(w,h,false);
    camera.aspect=w/h; camera.updateProjectionMatrix();
  }
  window.addEventListener('resize',resize);
  window.addEventListener('orientationchange',()=>setTimeout(resize,200));

  // ─── Init ─────────────────────────────────────────────────────────────────
  initThree();
  bindButtons();
  makeJoystick(document.getElementById('joystick'),   document.getElementById('joy-thumb'),  joy);
  makeJoystick(document.getElementById('aim-joystick'),document.getElementById('aim-thumb'), aimJoy);
  bindShopTabs();
  updateHUD();
  requestAnimationFrame(t=>{lastTime=t;frame(t);});
  if('serviceWorker'in navigator) navigator.serviceWorker.register('sw.js').catch(()=>{});
})();
