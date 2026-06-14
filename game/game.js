/* Bolt Ranger 3D v5 — combat feel: shake, muzzle flash, hit feedback */
import * as THREE from 'three';
import {
  dmgMult as coreDmg, cdMult as coreCd, speedMult as coreSpeed,
  axisToAngle, resolveMoveAxis,
  jumpDecision, resolveVertical, clampToArena, shopItemState,
  wavePlan, decay,
} from './core.js';

(() => {
  'use strict';

  const canvas = document.getElementById('game');

  // ─── Constants ─────────────────────────────────────────────────────────────
  const ARENA_R    = 55;
  const GRAVITY    = 26;
  const BASE_SPEED = 14;
  const JUMP_V     = 20;
  const ACCEL      = 55;
  const CAM_OFF    = new THREE.Vector3(0, 14, 20);

  // ─── State ─────────────────────────────────────────────────────────────────
  const S = { MENU:'menu', PLAY:'play', SHOP:'shop', OVER:'over' };
  let state = S.MENU;
  let wave = 1, bolts_total = 0, lastTime = 0, clock_t = 0, shopTab = 'vida';
  let terminals=[], objActivated=0, objPhase=false, bossSpawned=false, boss=null;
  const OBJ_TOTAL = 3;
  let dashActive=false, dashT=0;
  let jumpQueued=0; // edge-triggered jump requests (never missed between frames)
  let shakeMag=0;   // camera shake intensity (decays each frame)
  const dashDir = new THREE.Vector2();

  // ─── Upgrades ──────────────────────────────────────────────────────────────
  const upg = { dmgLevel:0, cdLevel:0, spLevel:0, jumpMax:2, hasDash:false, hasRegen:false };
  const dmgMult  = () => coreDmg(upg.dmgLevel);
  const cdMult   = () => coreCd(upg.cdLevel);
  const curSpeed = () => BASE_SPEED * coreSpeed(upg.spLevel);
  function resetUpgrades() {
    upg.dmgLevel=0; upg.cdLevel=0; upg.spLevel=0; upg.jumpMax=2; upg.hasDash=false; upg.hasRegen=false;
  }

  // ─── Input ─────────────────────────────────────────────────────────────────
  const inp = { fwd:false, back:false, left:false, right:false, jump:false, fire:false, swap:false };
  const joy    = { active:false, id:null, cx:0, cy:0, axisX:0, axisY:0, radius:50 };
  const aimJoy = { active:false, id:null, cx:0, cy:0, axisX:0, axisY:0, radius:50 };

  // ─── Audio ─────────────────────────────────────────────────────────────────
  let actx = null;
  function initAudio() {
    if (!actx) { const AC=window.AudioContext||window.webkitAudioContext; if(AC) try{actx=new AC();}catch(e){} }
    if (actx?.state==='suspended') actx.resume();
  }
  function tone(freq,dur,type='square',vol=0.1,slide=null) {
    if (!actx) return;
    const t=actx.currentTime, o=actx.createOscillator(), g=actx.createGain();
    o.type=type; o.frequency.setValueAtTime(freq,t);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(1,slide),t+dur);
    g.gain.setValueAtTime(vol,t); g.gain.exponentialRampToValueAtTime(0.0001,t+dur);
    o.connect(g); g.connect(actx.destination); o.start(t); o.stop(t+dur+0.02);
  }
  const sfx = {
    shoot:    ()=>tone(680,0.08,'square',0.07,240),
    melee:    ()=>tone(220,0.12,'sawtooth',0.10,90),
    hit:      ()=>tone(420,0.04,'square',0.05,300),
    die:      ()=>tone(380,0.22,'sawtooth',0.10,70),
    bolt:     ()=>tone(900,0.07,'sine',0.10,1400),
    jump:     ()=>tone(320,0.13,'square',0.08,620),
    dash:     ()=>tone(600,0.15,'square',0.10,200),
    hurt:     ()=>tone(200,0.20,'sawtooth',0.15,70),
    alert:    ()=>tone(750,0.10,'square',0.07,350),
    buy:      ()=>{ tone(700,0.08,'sine',0.10,1000); setTimeout(()=>tone(1000,0.1,'sine',0.10,1300),70); },
    activate: ()=>{ tone(880,0.10,'sine',0.12,1200); setTimeout(()=>tone(1200,0.12,'sine',0.10,1600),110); },
    allObj:   ()=>{ [440,554,659,880].forEach((f,i)=>setTimeout(()=>tone(f,0.18,'sine',0.12),i*90)); },
    waveClear:()=>{ tone(523,0.12,'triangle',0.10); setTimeout(()=>tone(784,0.18,'triangle',0.10),120); },
    bossSpawn:()=>{ tone(55,0.8,'sawtooth',0.22,44); setTimeout(()=>tone(110,0.5,'square',0.14,80),350); },
    bossDie:  ()=>{ tone(300,0.5,'sawtooth',0.18,50); setTimeout(()=>tone(180,0.6,'square',0.14,40),260); },
  };

  // ─── Weapons ───────────────────────────────────────────────────────────────
  const WEP = {
    wrench:{ name:'Chave',      melee:true,  baseDmg:40, cd:0.34, color:0xcfd6f0, owned:true,  range:5.5 },
    blaster:{ name:'Blaster',   melee:false, baseDmg:22, cd:0.22, speed:55, color:0x38d6ff, owned:true,  pellets:1, spread:0 },
    spread:{ name:'Espingarda', melee:false, baseDmg:15, cd:0.55, speed:48, color:0x7cfc8a, owned:false, price:140, pellets:5, spread:0.45, desc:'5 projéteis em leque' },
    pyro:{   name:'Pyrocitor',  melee:false, baseDmg:16, cd:0.09, speed:62, color:0xff8a3d, owned:false, price:220, pellets:1, spread:0.10, desc:'Disparo rápido contínuo' },
    plasma:{ name:'Plasma',     melee:false, baseDmg:90, cd:1.20, speed:38, color:0xcc44ff, owned:false, price:380, pellets:1, spread:0,    desc:'Dano em área (raio 5)', area:5 },
  };
  const WORDER = ['wrench','blaster','spread','pyro','plasma'];
  const wepDmg = k => WEP[k].baseDmg * dmgMult();
  const wepCd  = k => WEP[k].cd * cdMult();

  // ─── Three.js ──────────────────────────────────────────────────────────────
  let renderer, scene, camera, player, playerGun, aimIndicator;
  let enemies=[], bullets=[], eBullets=[], bolts=[], crates=[], particles=[];
  let platCols=[];
  let motes=null, motePhase=null;
  let muzzleLight=null, muzzleGlow=null;
  const v3 = () => new THREE.Vector3();

  // ─── Procedural graphics helpers (CanvasTexture — no external assets) ──────
  function canvasTex(size, draw, repeat) {
    const c=document.createElement('canvas'); c.width=c.height=size;
    draw(c.getContext('2d'), size);
    const t=new THREE.CanvasTexture(c);
    t.colorSpace=THREE.SRGBColorSpace; t.anisotropy=4;
    if(repeat){t.wrapS=t.wrapT=THREE.RepeatWrapping;t.repeat.set(repeat,repeat);}
    return t;
  }
  // Brushed-metal panel with rivets and seams
  function metalTex() {
    return canvasTex(256,(g,s)=>{
      g.fillStyle='#1b2340'; g.fillRect(0,0,s,s);
      for(let i=0;i<s;i+=2){const v=200+Math.floor(Math.random()*40);g.fillStyle=`rgba(${v>>1},${v>>1},${v},0.03)`;g.fillRect(0,i,s,1);}
      g.strokeStyle='rgba(120,160,255,0.25)'; g.lineWidth=2;
      for(let i=0;i<=s;i+=64){g.beginPath();g.moveTo(i,0);g.lineTo(i,s);g.moveTo(0,i);g.lineTo(s,i);g.stroke();}
      g.fillStyle='rgba(150,190,255,0.4)';
      for(let x=32;x<s;x+=64)for(let y=32;y<s;y+=64){g.beginPath();g.arc(x,y,3,0,7);g.fill();}
    },null);
  }
  // Hex-grid energy floor
  function floorTex() {
    return canvasTex(512,(g,s)=>{
      g.fillStyle='#070c1c'; g.fillRect(0,0,s,s);
      const r=26, h=r*Math.sqrt(3);
      g.strokeStyle='rgba(56,150,255,0.30)'; g.lineWidth=2;
      for(let row=0,y=0;y<s+h;row++,y+=h*0.5){
        const xo=(row%2)?r*1.5:0;
        for(let x=xo;x<s+r*2;x+=r*3){
          g.beginPath();
          for(let k=0;k<6;k++){const a=Math.PI/3*k+Math.PI/6;const px=x+r*Math.cos(a),py=y+r*Math.sin(a);k?g.lineTo(px,py):g.moveTo(px,py);}
          g.closePath(); g.stroke();
        }
      }
      g.globalCompositeOperation='lighter';
      const grd=g.createRadialGradient(s/2,s/2,0,s/2,s/2,s/2);
      grd.addColorStop(0,'rgba(40,90,200,0.25)'); grd.addColorStop(1,'rgba(0,0,0,0)');
      g.fillStyle=grd; g.fillRect(0,0,s,s);
    },4);
  }
  // Vertical gradient sky dome
  function makeSkyTexture() {
    return canvasTex(64,(g,s)=>{
      const grd=g.createLinearGradient(0,0,0,s);
      grd.addColorStop(0,'#0a1230'); grd.addColorStop(0.55,'#0a0f24'); grd.addColorStop(1,'#140a26');
      g.fillStyle=grd; g.fillRect(0,0,s,s);
    },null);
  }
  // Soft radial glow sprite (cheap fake-bloom halo)
  let _glowTex=null;
  function glowTex() {
    if(_glowTex) return _glowTex;
    _glowTex=canvasTex(128,(g,s)=>{
      const grd=g.createRadialGradient(s/2,s/2,0,s/2,s/2,s/2);
      grd.addColorStop(0,'rgba(255,255,255,1)'); grd.addColorStop(0.25,'rgba(255,255,255,0.6)');
      grd.addColorStop(1,'rgba(255,255,255,0)');
      g.fillStyle=grd; g.fillRect(0,0,s,s);
    },null);
    return _glowTex;
  }
  function glowSprite(color,size) {
    const sp=new THREE.Sprite(new THREE.SpriteMaterial({map:glowTex(),color,blending:THREE.AdditiveBlending,depthWrite:false,transparent:true}));
    sp.scale.setScalar(size||3); return sp;
  }

  function initThree() {
    renderer = new THREE.WebGLRenderer({canvas, antialias:true});
    renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    // Cinematic tone mapping + correct colour space → "real game" look
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    scene = new THREE.Scene();
    scene.background = makeSkyTexture();
    scene.fog = new THREE.FogExp2(0x0a0f24, 0.0075);
    camera = new THREE.PerspectiveCamera(62,1,0.1,400);

    scene.add(new THREE.HemisphereLight(0x8090ff,0x1a1030,1.0));
    const sun = new THREE.DirectionalLight(0xffe8c0,1.5);
    sun.position.set(30,60,20); sun.castShadow=true;
    sun.shadow.mapSize.set(1024,1024);
    Object.assign(sun.shadow.camera,{near:1,far:160,left:-80,right:80,top:80,bottom:-80});
    scene.add(sun);
    scene.add(Object.assign(new THREE.DirectionalLight(0x4466ff,0.7),{position:new THREE.Vector3(-30,10,-20)}));
    scene.add(Object.assign(new THREE.PointLight(0x2244ff,2,120),{position:new THREE.Vector3(0,45,0)}));

    buildArena(); buildPlatforms();
    player = buildPlayer(); scene.add(player);
    // Reusable muzzle flash (light + halo), faded each frame
    muzzleLight=new THREE.PointLight(0x38d6ff,0,10); scene.add(muzzleLight);
    muzzleGlow=glowSprite(0x38d6ff,1.6); muzzleGlow.material.opacity=0; scene.add(muzzleGlow);
    resize();
  }

  // ─── Arena ─────────────────────────────────────────────────────────────────
  function buildArena() {
    // Stars
    const sPos = new Float32Array(700*3);
    for (let i=0;i<700;i++) {
      const phi=Math.random()*Math.PI*2, th=Math.random()*Math.PI, r=180+Math.random()*120;
      sPos[i*3]=r*Math.sin(th)*Math.cos(phi); sPos[i*3+1]=Math.abs(r*Math.cos(th))+10; sPos[i*3+2]=r*Math.sin(th)*Math.sin(phi);
    }
    const sGeo=new THREE.BufferGeometry(); sGeo.setAttribute('position',new THREE.BufferAttribute(sPos,3));
    scene.add(new THREE.Points(sGeo,new THREE.PointsMaterial({color:0xffffff,size:1.4,sizeAttenuation:true})));

    // Ground — hex-grid energy floor texture
    const gnd=new THREE.Mesh(new THREE.CircleGeometry(ARENA_R,80),
      new THREE.MeshStandardMaterial({map:floorTex(),color:0x8090c0,roughness:0.78,metalness:0.35,emissive:0x06112e,emissiveIntensity:0.6}));
    gnd.rotation.x=-Math.PI/2; gnd.receiveShadow=true; scene.add(gnd);

    // Glowing floor rings (concentric)
    [0.55,0.78].forEach((f,i)=>{
      const fring=new THREE.Mesh(new THREE.TorusGeometry(ARENA_R*f,0.13,8,80),
        new THREE.MeshStandardMaterial({color:i?0xff8a3d:0x38d6ff,emissive:i?0x5d2a00:0x0d4455,emissiveIntensity:1.4,roughness:0.2}));
      fring.rotation.x=Math.PI/2; fring.position.y=0.06; scene.add(fring);
    });

    // Perimeter — tech pillars + connecting beams
    const metal=metalTex();
    const wMat=new THREE.MeshStandardMaterial({map:metal,color:0x9aa8d0,roughness:0.5,metalness:0.7,emissive:0x060d20,emissiveIntensity:0.5});
    const capMatB=new THREE.MeshStandardMaterial({color:0x38d6ff,emissive:0x0d4455,roughness:0.2,metalness:0.8});
    const capMatO=new THREE.MeshStandardMaterial({color:0xff8a3d,emissive:0x3d1a00,roughness:0.2,metalness:0.6});
    const SEG=24;
    for (let i=0;i<SEG;i++) {
      const a=i/SEG*Math.PI*2, cx=Math.cos(a)*ARENA_R, cz=Math.sin(a)*ARENA_R;
      const pil=new THREE.Mesh(new THREE.CylinderGeometry(0.9,1.25,10,8),wMat);
      pil.position.set(cx,5,cz); pil.castShadow=true; scene.add(pil);
      const cap=new THREE.Mesh(new THREE.SphereGeometry(0.55,10,8),i%3===0?capMatO:capMatB);
      cap.position.set(cx,10.4,cz); scene.add(cap);
      const gl=glowSprite(i%3===0?0xff8a3d:0x38d6ff,2.6); gl.position.set(cx,10.4,cz); scene.add(gl);
      const base=new THREE.Mesh(new THREE.CylinderGeometry(1.6,1.6,0.35,8),capMatB);
      base.position.set(cx,0.18,cz); scene.add(base);
      if (i%2===0) {
        const a2=(i+1)/SEG*Math.PI*2;
        const mx=(cx+Math.cos(a2)*ARENA_R)/2, mz=(cz+Math.sin(a2)*ARENA_R)/2;
        const beam=new THREE.Mesh(new THREE.BoxGeometry(0.2,0.2,ARENA_R*0.27),
          new THREE.MeshStandardMaterial({color:0x0a1428,roughness:0.7,metalness:0.6}));
        beam.position.set(mx,9.2,mz); beam.rotation.y=a+Math.PI/SEG; scene.add(beam);
      }
    }

    // Central dais
    const cMat=new THREE.MeshStandardMaterial({color:0x192245,roughness:0.7,metalness:0.3});
    scene.add(Object.assign(new THREE.Mesh(new THREE.CylinderGeometry(7,8,0.6,12),cMat),{position:new THREE.Vector3(0,0.3,0),receiveShadow:true}));
    const cr=new THREE.Mesh(new THREE.TorusGeometry(7.5,0.18,8,48),capMatB);
    cr.rotation.x=Math.PI/2; cr.position.y=0.6; scene.add(cr);

    // Inner decorative columns
    [[32,0],[-32,0],[0,32],[0,-32],[22,22],[-22,-22],[22,-22],[-22,22]].forEach(([x,z])=>{
      const col=new THREE.Mesh(new THREE.CylinderGeometry(0.6,0.9,5,8),wMat);
      col.position.set(x,2.5,z); col.castShadow=true; scene.add(col);
      const ball=new THREE.Mesh(new THREE.SphereGeometry(0.45,10,8),capMatB);
      ball.position.set(x,5.3,z); scene.add(ball);
      const gl=glowSprite(0x38d6ff,1.8); gl.position.set(x,5.3,z); scene.add(gl);
    });

    // Floating dust motes (slow drifting atmosphere)
    const N=140, dPos=new Float32Array(N*3);
    motePhase=new Float32Array(N);
    for(let i=0;i<N;i++){
      const a=Math.random()*Math.PI*2,r=Math.random()*ARENA_R;
      dPos[i*3]=Math.cos(a)*r; dPos[i*3+1]=1+Math.random()*22; dPos[i*3+2]=Math.sin(a)*r;
      motePhase[i]=Math.random()*Math.PI*2;
    }
    const dGeo=new THREE.BufferGeometry(); dGeo.setAttribute('position',new THREE.BufferAttribute(dPos,3));
    motes=new THREE.Points(dGeo,new THREE.PointsMaterial({map:glowTex(),color:0x6fa8ff,size:0.7,transparent:true,opacity:0.55,depthWrite:false,blending:THREE.AdditiveBlending}));
    scene.add(motes);

    // Nebula light
    const neb=new THREE.PointLight(0x5500aa,1.8,160);
    neb.position.set(-20,60,-30); scene.add(neb);
  }

  // ─── Platforms ─────────────────────────────────────────────────────────────
  function buildPlatforms() {
    const defs=[
      {x:14,  z:-8,  w:9, d:8, top:4,  accent:0x38d6ff},
      {x:-16, z:-12, w:8, d:7, top:6,  accent:0xff8a3d},
      {x:1,   z:-25, w:11,d:7, top:8,  accent:0x38d6ff},
      {x:23,  z:13,  w:8, d:8, top:4,  accent:0xcc44ff},
      {x:-22, z:15,  w:9, d:8, top:6,  accent:0x38d6ff},
      {x:-2,  z:26,  w:9, d:8, top:4,  accent:0xff8a3d},
      {x:10,  z:30,  w:7, d:7, top:10, accent:0xffd23a},
    ];
    platCols=[];
    const ptex=metalTex();
    for (const d of defs) {
      const bMat=new THREE.MeshStandardMaterial({map:ptex,color:0x7c8ab5,roughness:0.55,metalness:0.6,emissive:0x050a1a,emissiveIntensity:0.5});
      const bl=new THREE.Mesh(new THREE.BoxGeometry(d.w,d.top,d.d),bMat);
      bl.position.set(d.x,d.top/2,d.z); bl.castShadow=true; bl.receiveShadow=true; scene.add(bl);
      // Chamfered glowing top deck
      const deck=new THREE.Mesh(new THREE.BoxGeometry(d.w-0.4,0.3,d.d-0.4),
        new THREE.MeshStandardMaterial({color:0x10182e,roughness:0.4,metalness:0.5}));
      deck.position.set(d.x,d.top+0.05,d.z); deck.receiveShadow=true; scene.add(deck);
      // Glowing top rim (emissive border)
      const rimMat=new THREE.MeshStandardMaterial({color:d.accent,emissive:d.accent,emissiveIntensity:1.6,roughness:0.3,metalness:0.7});
      const rim=new THREE.Mesh(new THREE.BoxGeometry(d.w+0.12,0.16,d.d+0.12),rimMat);
      rim.position.set(d.x,d.top+0.18,d.z); scene.add(rim);
      // Corner glow posts
      for(const sx of[-1,1])for(const sz of[-1,1]){
        const pst=new THREE.Mesh(new THREE.CylinderGeometry(0.12,0.12,0.5,6),rimMat);
        pst.position.set(d.x+sx*(d.w/2-0.3),d.top+0.3,d.z+sz*(d.d/2-0.3)); scene.add(pst);
      }
      // Point light + glow halo
      const pl=new THREE.PointLight(d.accent,2.2,14); pl.position.set(d.x,d.top+1.2,d.z); scene.add(pl);
      const gl=glowSprite(d.accent,3); gl.position.set(d.x,d.top+0.3,d.z); scene.add(gl);
      platCols.push({x:d.x,z:d.z,hw:d.w/2+0.35,hd:d.d/2+0.35,top:d.top});
    }
  }

  // ─── Player ────────────────────────────────────────────────────────────────
  function buildPlayer() {
    const g=new THREE.Group();
    const M=c=>new THREE.MeshStandardMaterial(c);
    // rig = everything that bobs/leans (legs stay grounded via pivots)
    const rig=new THREE.Group(); g.add(rig);
    const torso=new THREE.Group(); torso.position.y=1.15; rig.add(torso);

    // Body (tapered: narrow waist, broad chest)
    torso.add(Object.assign(new THREE.Mesh(new THREE.CapsuleGeometry(0.5,0.85,8,16),M({color:0xe8842a,roughness:0.5,metalness:0.2})),{castShadow:true}));
    // Layered chest armour
    torso.add(Object.assign(new THREE.Mesh(new THREE.CapsuleGeometry(0.46,0.42,8,12),M({color:0xc4671c,roughness:0.4,metalness:0.45})),{position:new THREE.Vector3(0,0.18,-0.1)}));
    torso.add(Object.assign(new THREE.Mesh(new THREE.SphereGeometry(0.5,12,8),M({color:0xd47820,roughness:0.45,metalness:0.4})),{position:new THREE.Vector3(0,0.42,0),scale:new THREE.Vector3(1,0.55,0.9)}));
    // Chest reactor + glow
    const core=Object.assign(new THREE.Mesh(new THREE.SphereGeometry(0.16,12,10),M({color:0x9beaff,emissive:0x38d6ff,emissiveIntensity:1.8,roughness:0.2})),{position:new THREE.Vector3(0,0.35,-0.46)});
    torso.add(core); const coreGlow=glowSprite(0x38d6ff,1.1); coreGlow.position.copy(core.position); torso.add(coreGlow);
    // Shoulder pads
    for(const sx of[-1,1]) torso.add(Object.assign(new THREE.Mesh(new THREE.SphereGeometry(0.26,10,8),M({color:0xb05818,roughness:0.4,metalness:0.5})),{position:new THREE.Vector3(sx*0.5,0.32,0),scale:new THREE.Vector3(1,0.8,1)}));

    // Head
    const head=new THREE.Group(); head.position.y=0.95; torso.add(head);
    head.add(Object.assign(new THREE.Mesh(new THREE.SphereGeometry(0.6,20,16),M({color:0xd9b06a,roughness:0.55,metalness:0.05})),{castShadow:true,scale:new THREE.Vector3(1,1.05,0.95)}));
    // Muzzle/snout
    head.add(Object.assign(new THREE.Mesh(new THREE.CapsuleGeometry(0.22,0.18,6,10),M({color:0xe8c884,roughness:0.55})),{position:new THREE.Vector3(0,-0.12,-0.5),rotation:new THREE.Euler(Math.PI/2,0,0)}));
    head.add(Object.assign(new THREE.Mesh(new THREE.SphereGeometry(0.09,8,8),M({color:0x2a1a10})),{position:new THREE.Vector3(0,-0.05,-0.74)}));
    // Eyes
    for(const sx of[-1,1]) head.add(Object.assign(new THREE.Mesh(new THREE.SphereGeometry(0.1,10,8),M({color:0x103040,emissive:0x39e0ff,emissiveIntensity:1.4})),{position:new THREE.Vector3(sx*0.24,0.08,-0.5)}));
    // Lombax ears (with inner)
    for(const sx of[-1,1]){
      const ear=new THREE.Mesh(new THREE.ConeGeometry(0.2,1.05,8),M({color:0xd9b06a,roughness:0.55}));
      ear.position.set(sx*0.42,0.7,-0.02); ear.rotation.z=sx*0.3; head.add(ear);
      const inner=new THREE.Mesh(new THREE.ConeGeometry(0.1,0.8,6),M({color:0x6a3d2a,roughness:0.7}));
      inner.position.set(sx*0.42,0.66,-0.06); inner.rotation.z=sx*0.3; head.add(inner);
    }
    // Helmet visor band
    head.add(Object.assign(new THREE.Mesh(new THREE.TorusGeometry(0.5,0.07,8,20,Math.PI),M({color:0x2a90b0,emissive:0x39e0ff,emissiveIntensity:0.8,metalness:0.7,roughness:0.3})),{position:new THREE.Vector3(0,0.18,0),rotation:new THREE.Euler(Math.PI/2,0,0)}));

    // Arms (pivot at shoulder) — left holds gun
    const armM=M({color:0xd47820,roughness:0.5,metalness:0.25});
    const handM=M({color:0x3a3f55,roughness:0.5,metalness:0.5});
    const armL=new THREE.Group(); armL.position.set(0.55,0.35,0); torso.add(armL);
    armL.add(Object.assign(new THREE.Mesh(new THREE.CapsuleGeometry(0.16,0.55,6,10),armM),{position:new THREE.Vector3(0,-0.3,0)}));
    armL.add(Object.assign(new THREE.Mesh(new THREE.SphereGeometry(0.17,10,8),handM),{position:new THREE.Vector3(0,-0.62,-0.15)}));
    const armR=new THREE.Group(); armR.position.set(-0.55,0.35,0); torso.add(armR);
    armR.add(Object.assign(new THREE.Mesh(new THREE.CapsuleGeometry(0.16,0.55,6,10),armM),{position:new THREE.Vector3(0,-0.3,0)}));
    armR.add(Object.assign(new THREE.Mesh(new THREE.SphereGeometry(0.17,10,8),handM),{position:new THREE.Vector3(0,-0.62,0)}));

    // Gun held in left hand
    playerGun=new THREE.Group(); playerGun.position.set(0,-0.62,-0.35); armL.add(playerGun);
    const barrel=Object.assign(new THREE.Mesh(new THREE.CapsuleGeometry(0.13,1.1,6,10),M({color:0x39e0ff,emissive:0x16566b,emissiveIntensity:0.6,roughness:0.3,metalness:0.7})),{rotation:new THREE.Euler(Math.PI/2,0,0),position:new THREE.Vector3(0,0,-0.4),castShadow:true});
    playerGun.add(barrel); playerGun.userData.barrelMat=barrel.material;
    playerGun.add(Object.assign(new THREE.Mesh(new THREE.TorusGeometry(0.22,0.05,6,16),M({color:0x39e0ff,emissive:0x39e0ff,emissiveIntensity:1.2})),{position:new THREE.Vector3(0,0,-0.95),rotation:new THREE.Euler(Math.PI/2,0,0)}));
    playerGun.add(Object.assign(new THREE.Mesh(new THREE.BoxGeometry(0.18,0.22,0.5),M({color:0x2a3450,roughness:0.5,metalness:0.6})),{position:new THREE.Vector3(0,0.02,0.1)}));

    // Legs with hip pivots (for walk swing) + boots
    const legM=M({color:0x8a4a16,roughness:0.6,metalness:0.25});
    const bootM=M({color:0x4a2e0c,roughness:0.8});
    const legs=[];
    for(const sx of[-1,1]){
      const hip=new THREE.Group(); hip.position.set(sx*0.26,0.78,0); rig.add(hip);
      hip.add(Object.assign(new THREE.Mesh(new THREE.CapsuleGeometry(0.2,0.6,6,10),legM),{position:new THREE.Vector3(0,-0.38,0)}));
      hip.add(Object.assign(new THREE.Mesh(new THREE.SphereGeometry(0.24,10,8),bootM),{position:new THREE.Vector3(0,-0.74,0.12),scale:new THREE.Vector3(1,0.8,1.4)}));
      legs.push(hip);
    }

    // Clank backpack
    const pack=new THREE.Group(); pack.position.set(0,0.2,0.6); torso.add(pack);
    pack.add(new THREE.Mesh(new THREE.CapsuleGeometry(0.34,0.6,6,10),M({color:0x8a9bc4,roughness:0.4,metalness:0.6})));
    pack.add(Object.assign(new THREE.Mesh(new THREE.SphereGeometry(0.3,12,10),M({color:0x9bb0d8,roughness:0.4,metalness:0.55})),{position:new THREE.Vector3(0,0.5,0)}));
    for(const sx of[-1,1]) pack.add(Object.assign(new THREE.Mesh(new THREE.SphereGeometry(0.1,10,8),M({color:0x103040,emissive:0x39e0ff,emissiveIntensity:1.5})),{position:new THREE.Vector3(sx*0.12,0.55,-0.22)}));

    // Aim indicator
    aimIndicator=new THREE.Group(); aimIndicator.position.y=0.12;
    aimIndicator.add(Object.assign(new THREE.Mesh(new THREE.TorusGeometry(1.55,0.07,8,36),new THREE.MeshBasicMaterial({color:0xff8a3d,transparent:true,opacity:0.65})),{rotation:new THREE.Euler(Math.PI/2,0,0)}));
    const arr=new THREE.Mesh(new THREE.ConeGeometry(0.25,0.78,6),new THREE.MeshBasicMaterial({color:0xff8a3d,transparent:true,opacity:0.85}));
    arr.rotation.x=Math.PI/2; arr.position.set(0,0,-1.55); aimIndicator.add(arr);
    aimIndicator.visible=false; g.add(aimIndicator);

    g.position.set(0,0,0);
    g.userData={vy:0,velX:0,velZ:0,onGround:true,jumpsLeft:2,jumpHeld:false,aimAngle:0,facing:0,hp:100,maxHp:100,weaponIdx:1,fireCd:0,swapCd:0,invuln:0,meleeT:0,regenT:0,
      parts:{rig,torso,head,armL,armR,legs,walkPhase:0}};
    return g;
  }

  // ─── Enemies ───────────────────────────────────────────────────────────────
  // type: 'chaser' rushes player, 'dormant' sleeps until close/shot, 'sniper' keeps distance
  function makeEnemy(x,z,tough,n,type) {
    type=type||'chaser';
    const hp=tough?110+n*14:55+n*7;
    const palette={
      chaser: {body:0x8a1a2a,head:0xff3030,leg:0x4a0c14,eye:0xffd23a},
      dormant:{body:0x1e2e5a,head:0x3355aa,leg:0x0e1830,eye:0x55aaff},
      sniper: {body:0x1a4428,head:0x33883a,leg:0x0c2414,eye:0x88ff44},
    }[type];
    const M=c=>new THREE.MeshStandardMaterial(c);
    const mat=M({map:metalTex(),color:palette.body,roughness:0.5,metalness:0.6,emissive:0x000000});
    const g=new THREE.Group();
    const rig=new THREE.Group(); rig.position.y=tough?0.15:0; g.add(rig);
    const sc=tough?1.25:1; rig.scale.setScalar(sc);

    // Armoured torso (chest + abdomen)
    const torso=new THREE.Group(); torso.position.y=1.25; rig.add(torso);
    torso.add(Object.assign(new THREE.Mesh(new THREE.CapsuleGeometry(0.6,0.5,8,14),mat),{castShadow:true}));
    torso.add(Object.assign(new THREE.Mesh(new THREE.BoxGeometry(0.95,0.55,0.55),M({color:palette.body,roughness:0.45,metalness:0.65,map:metalTex()})),{position:new THREE.Vector3(0,0.15,0),castShadow:true}));
    // Glowing chest vent
    torso.add(Object.assign(new THREE.Mesh(new THREE.PlaneGeometry(0.5,0.18),M({color:palette.eye,emissive:palette.eye,emissiveIntensity:1.4,side:THREE.DoubleSide})),{position:new THREE.Vector3(0,0.1,-0.29)}));
    // Shoulders
    for(const sx of[-1,1]) torso.add(Object.assign(new THREE.Mesh(new THREE.SphereGeometry(0.26,10,8),M({color:palette.leg,roughness:0.5,metalness:0.6})),{position:new THREE.Vector3(sx*0.6,0.3,0)}));

    // Head (boxy robot head with single visor eye)
    const head=new THREE.Group(); head.position.y=0.75; torso.add(head);
    head.add(Object.assign(new THREE.Mesh(new THREE.BoxGeometry(0.7,0.55,0.6),M({color:palette.head,roughness:0.45,metalness:0.4})),{castShadow:true}));
    head.add(Object.assign(new THREE.Mesh(new THREE.BoxGeometry(0.55,0.16,0.06),M({color:0x080808,emissive:palette.eye,emissiveIntensity:1.8})),{position:new THREE.Vector3(0,0.05,-0.31)}));
    const eyeGlow=glowSprite(palette.eye,0.9); eyeGlow.position.set(0,0.05,-0.34); head.add(eyeGlow);

    // Arms
    const aMat=M({color:palette.leg,roughness:0.5,metalness:0.55});
    const arms=[];
    for(const sx of[-1,1]){
      const sh=new THREE.Group(); sh.position.set(sx*0.62,0.28,0); torso.add(sh);
      sh.add(Object.assign(new THREE.Mesh(new THREE.CapsuleGeometry(0.15,0.5,6,8),aMat),{position:new THREE.Vector3(0,-0.3,0)}));
      sh.add(Object.assign(new THREE.Mesh(new THREE.SphereGeometry(0.16,8,8),M({color:0x222,metalness:0.7,roughness:0.4})),{position:new THREE.Vector3(0,-0.6,0)}));
      arms.push(sh);
    }

    // Legs with hip pivots
    const lMat=M({color:palette.leg,roughness:0.6,metalness:0.5});
    const legs=[];
    for(const sx of[-1,1]){
      const hip=new THREE.Group(); hip.position.set(sx*0.3,0.85,0); rig.add(hip);
      hip.add(Object.assign(new THREE.Mesh(new THREE.CapsuleGeometry(0.17,0.5,6,8),lMat),{position:new THREE.Vector3(0,-0.32,0)}));
      hip.add(Object.assign(new THREE.Mesh(new THREE.BoxGeometry(0.28,0.16,0.42),M({color:0x111,metalness:0.6,roughness:0.5})),{position:new THREE.Vector3(0,-0.62,0.06)}));
      legs.push(hip);
    }

    if (type==='sniper') {
      const ant=new THREE.Mesh(new THREE.CylinderGeometry(0.03,0.03,0.9,6),M({color:0x88ff88,emissive:0x22aa22,emissiveIntensity:1}));
      ant.position.set(0.2,0.6,0); head.add(ant);
      head.add(Object.assign(new THREE.Mesh(new THREE.SphereGeometry(0.08,8,8),M({color:0xaaff44,emissive:0x66cc22,emissiveIntensity:1.5})),{position:new THREE.Vector3(0.2,1.05,0)}));
    }
    let zzz=null;
    if (type==='dormant') {
      zzz=new THREE.Sprite(new THREE.SpriteMaterial({map:glowTex(),color:0x88aaff,transparent:true,opacity:0.8,depthWrite:false}));
      zzz.scale.setScalar(0.7); zzz.position.set(0.4,2.9,0); zzz.name='zzz'; g.add(zzz);
    }

    g.position.set(x,0,z);
    g.userData={hp,maxHp:hp,tough,type,alert:(type==='chaser'),shootCd:(type==='sniper'?0.8:1.5)+Math.random()*1.5,hitFlash:0,mat,vy:0,onGround:true,
      parts:{rig,torso,head,arms,legs},walkPhase:Math.random()*6,baseY:0};
    scene.add(g); return g;
  }

  // ─── Boss ──────────────────────────────────────────────────────────────────
  function spawnBoss() {
    bossSpawned=true;
    const hp=400+wave*160;
    const mat=new THREE.MeshStandardMaterial({color:0x7a1030,roughness:0.45,metalness:0.5,emissive:0x1a0008});
    const g=new THREE.Group();
    g.add(Object.assign(new THREE.Mesh(new THREE.CapsuleGeometry(2.0,1.8,8,16),mat),{position:new THREE.Vector3(0,2.8,0),castShadow:true}));
    g.add(Object.assign(new THREE.Mesh(new THREE.SphereGeometry(1.4,20,16),new THREE.MeshStandardMaterial({color:0x5a0820,roughness:0.5,metalness:0.4,emissive:0x0a0005})),{position:new THREE.Vector3(0,5.2,0),castShadow:true}));
    for (const sx of[-1,1]) {
      g.add(Object.assign(new THREE.Mesh(new THREE.SphereGeometry(0.45,12,10),new THREE.MeshStandardMaterial({color:0xffd23a,emissive:0xaa7700})),{position:new THREE.Vector3(sx*0.55,5.4,-1.25)}));
      const arm=new THREE.Mesh(new THREE.CapsuleGeometry(0.45,1.4,6,10),new THREE.MeshStandardMaterial({color:0x6a0a28,roughness:0.5,metalness:0.4}));
      arm.position.set(sx*2.6,3.0,0); arm.rotation.z=sx*0.5; g.add(arm);
    }
    const spkM=new THREE.MeshStandardMaterial({color:0xff4040,emissive:0x440000,metalness:0.6});
    for (let i=0;i<8;i++){const a=i/8*Math.PI*2; const sp=new THREE.Mesh(new THREE.ConeGeometry(0.3,1.6,6),spkM); sp.position.set(Math.cos(a)*1.8,6.8,Math.sin(a)*1.8); g.add(sp);}
    g.add(Object.assign(new THREE.PointLight(0xff2040,5,35),{position:new THREE.Vector3(0,4,0)}));
    const bg=glowSprite(0xff3050,6); bg.position.set(0,4.5,0); g.add(bg);
    g.position.set(0,0,-30);
    g.userData={isBoss:true,hp,maxHp:hp,tough:true,type:'chaser',alert:true,shootCd:2,hitFlash:0,mat,vy:0,onGround:true,radius:2.8};
    scene.add(g); enemies.push(g); boss=g;
    elBossBar.classList.remove('hidden'); updateBossBar(); sfx.bossSpawn();
    shake(1.2); notify('⚠️ CHEFE APARECEU! ⚠️');
  }

  // ─── Terminals ─────────────────────────────────────────────────────────────
  let termMeshes=[];
  function buildObjectives() {
    for (const m of termMeshes) scene.remove(m);
    termMeshes=[]; terminals=[]; objActivated=0; updateObjHUD();
    [{x:18,z:10},{x:-20,z:-14},{x:3,z:-28}].forEach(p=>{
      const g=new THREE.Group();
      g.add(Object.assign(new THREE.Mesh(new THREE.CylinderGeometry(1.2,1.4,0.5,12),new THREE.MeshStandardMaterial({color:0x223355,roughness:0.7,metalness:0.4})),{position:new THREE.Vector3(0,0.25,0)}));
      const crys=new THREE.Mesh(new THREE.OctahedronGeometry(0.9,0),new THREE.MeshStandardMaterial({color:0xcc44ff,emissive:0xaa22ff,emissiveIntensity:1.4,roughness:0.15,metalness:0.5}));
      crys.position.y=1.5; crys.castShadow=true; g.add(crys);
      // Floating energy ring around the base
      g.add(Object.assign(new THREE.Mesh(new THREE.TorusGeometry(1.5,0.06,8,32),new THREE.MeshStandardMaterial({color:0xcc44ff,emissive:0xcc44ff,emissiveIntensity:1.2})),{position:new THREE.Vector3(0,0.6,0),rotation:new THREE.Euler(Math.PI/2,0,0)}));
      const gl=glowSprite(0xcc44ff,3.2); gl.position.y=1.5; g.add(gl);
      const pt=new THREE.PointLight(0xcc44ff,3,12); pt.position.y=1.5; g.add(pt);
      g.position.set(p.x,0,p.z); g.userData={activated:false,crys,light:pt,glow:gl};
      scene.add(g); termMeshes.push(g); terminals.push(g);
    });
    elObjLabel.classList.remove('hidden');
  }
  function updateObjHUD(){elObjCount.textContent=objActivated;}

  // ─── Crates ────────────────────────────────────────────────────────────────
  function makeCrate(x,z) {
    const g=new THREE.Group();
    const box=new THREE.Mesh(new THREE.BoxGeometry(1.7,1.7,1.7),new THREE.MeshStandardMaterial({color:0x8a6a36,roughness:0.85,metalness:0.1}));
    box.position.y=0.85; box.castShadow=true; box.receiveShadow=true; g.add(box);
    const lm=new THREE.MeshStandardMaterial({color:0x44aaff,emissive:0x113344,roughness:0.4,metalness:0.8});
    g.add(Object.assign(new THREE.Mesh(new THREE.BoxGeometry(1.72,0.06,0.07),lm),{position:new THREE.Vector3(0,0.85,0)}));
    g.add(Object.assign(new THREE.Mesh(new THREE.BoxGeometry(0.06,1.72,0.07),lm),{position:new THREE.Vector3(0,0.85,0)}));
    g.position.set(x,0,z); scene.add(g); return g;
  }

  // ─── Bolts ─────────────────────────────────────────────────────────────────
  let boltGeo,boltMat;
  function makeBolt(x,y,z){
    if(!boltGeo){boltGeo=new THREE.CylinderGeometry(0.4,0.4,0.18,8);boltMat=new THREE.MeshStandardMaterial({color:0xffce3a,emissive:0x9a7400,metalness:0.7,roughness:0.2});}
    const m=new THREE.Mesh(boltGeo,boltMat); m.position.set(x,y,z);
    m.userData={vy:6+Math.random()*5,vx:(Math.random()-0.5)*9,vz:(Math.random()-0.5)*9};
    scene.add(m); return m;
  }
  function dropBolts(x,y,z,n){for(let k=0;k<n;k++)bolts.push(makeBolt(x+(Math.random()-0.5)*2,y,z+(Math.random()-0.5)*2));}

  // ─── Particles ─────────────────────────────────────────────────────────────
  function spawnPfx(pos,n,col){
    for(let i=0;i<n;i++){
      const m=new THREE.Mesh(new THREE.OctahedronGeometry(0.13+Math.random()*0.13,0),new THREE.MeshBasicMaterial({color:col}));
      m.position.copy(pos); m.userData={vx:(Math.random()-.5)*18,vy:Math.random()*16,vz:(Math.random()-.5)*18,life:0.45+Math.random()*0.3};
      scene.add(m); particles.push(m);
    }
  }

  // ─── Enemy bullets ─────────────────────────────────────────────────────────
  function spawnEB(x,y,z,dir,spd,dmg,col){
    const m=new THREE.Mesh(new THREE.SphereGeometry(0.28,8,6),new THREE.MeshBasicMaterial({color:col||0xff5e7a}));
    m.position.set(x,y,z); m.userData={vel:dir.clone().normalize().multiplyScalar(spd),dmg,life:4};
    scene.add(m); eBullets.push(m);
  }

  // ─── Clear scene ───────────────────────────────────────────────────────────
  function clearScene(){
    for(const arr of[enemies,bullets,eBullets,bolts,crates,particles]){for(const o of arr)scene.remove(o);arr.length=0;}
    for(const m of termMeshes)scene.remove(m); termMeshes=[]; terminals=[];
  }

  // ─── Collision wrapper (delegates to tested core.resolveVertical) ──────────
  function resolveYCols(pos,ud,halfR){
    const r=resolveVertical(pos,ud.vy,platCols,halfR||0.65,upg.jumpMax);
    pos.y=r.y; ud.vy=r.vy; ud.onGround=r.onGround;
    if(r.jumpsLeft!==null&&ud.jumpsLeft!==undefined) ud.jumpsLeft=r.jumpsLeft;
  }

  // ─── Wave start ────────────────────────────────────────────────────────────
  function startWave(n){
    clearScene(); boss=null; bossSpawned=false; objPhase=false; objActivated=0;
    elBossBar.classList.add('hidden'); elObjLabel.classList.add('hidden');
    const plan=wavePlan(n);
    for(let i=0;i<plan.count;i++){
      const a=Math.random()*Math.PI*2, r=18+Math.random()*(ARENA_R-24);
      const tough=Math.random()<plan.toughChance;
      const roll=Math.random();
      const type=roll<0.5?'chaser':roll<0.8?'dormant':'sniper';
      enemies.push(makeEnemy(Math.cos(a)*r,Math.sin(a)*r,tough,n,type));
    }
    for(let i=0;i<plan.crates;i++){const a=Math.random()*Math.PI*2,r=8+Math.random()*(ARENA_R-16);crates.push(makeCrate(Math.cos(a)*r,Math.sin(a)*r));}
    const pd=player.userData;
    player.position.set(0,0,0); pd.vy=0; pd.velX=0; pd.velZ=0; pd.onGround=true; pd.jumpsLeft=upg.jumpMax;
    updateHUD();
  }

  // ─── Main loop ─────────────────────────────────────────────────────────────
  function frame(t){
    const dt=Math.min((t-lastTime)/1000,0.05); lastTime=t; clock_t+=dt;
    if(state===S.PLAY) update(dt);
    updateMotes(dt);
    if(muzzleLight&&muzzleLight.intensity>0.01){muzzleLight.intensity=decay(muzzleLight.intensity,dt,30);muzzleGlow.material.opacity=decay(muzzleGlow.material.opacity,dt,6);}
    updateCamera(dt);
    renderer.render(scene,camera);
    requestAnimationFrame(frame);
  }

  // ─── Update ────────────────────────────────────────────────────────────────
  function update(dt){
    const pd=player.userData;

    // Input axes (tested in core.js)
    const {nx,nz,mag:rawMag}=resolveMoveAxis(joy,inp);
    if(rawMag>0.06) pd.facing=axisToAngle(nx,nz);

    // Smooth movement with acceleration/deceleration
    const spd=curSpeed();
    pd.velX+=(nx*spd-pd.velX)*Math.min(1,dt*ACCEL/spd);
    pd.velZ+=(nz*spd-pd.velZ)*Math.min(1,dt*ACCEL/spd);
    player.position.x+=pd.velX*dt;
    player.position.z+=pd.velZ*dt;

    // ── Jump / dash: edge-triggered queue (a fast tap is never lost) ──
    while(jumpQueued>0){
      jumpQueued--;
      const decision=jumpDecision({jumpsLeft:pd.jumpsLeft,dashActive,hasDash:upg.hasDash,moving:rawMag>0.1});
      if(decision==='jump'){pd.vy=JUMP_V;pd.jumpsLeft--;pd.onGround=false;sfx.jump();}
      else if(decision==='dash'){dashActive=true;dashT=0.18;dashDir.set(nx,nz).normalize();sfx.dash();}
    }

    // Dash
    if(dashActive){dashT-=dt;player.position.x+=dashDir.x*34*dt;player.position.z+=dashDir.y*34*dt;if(dashT<=0)dashActive=false;}

    // Gravity + collision (tested in core.js)
    pd.vy-=GRAVITY*dt;
    player.position.y+=pd.vy*dt;
    const yc=resolveVertical(player.position,pd.vy,platCols,0.6,upg.jumpMax);
    player.position.y=yc.y; pd.vy=yc.vy; pd.onGround=yc.onGround;
    if(yc.jumpsLeft!==null) pd.jumpsLeft=yc.jumpsLeft;

    // Arena boundary (tested in core.js)
    const pc=clampToArena(player.position.x,player.position.z,ARENA_R-2);
    if(pc.clamped){player.position.x=pc.x;player.position.z=pc.z;pd.velX*=0.25;pd.velZ*=0.25;}

    // Aim joystick
    const aimMag=Math.hypot(aimJoy.axisX,aimJoy.axisY);
    let firing=false;
    if(aimMag>0.15){pd.aimAngle=Math.atan2(-aimJoy.axisX,-aimJoy.axisY);pd.facing=pd.aimAngle;firing=true;}
    else if(rawMag>0.05) pd.aimAngle=pd.facing;
    if(inp.fire) firing=true;
    aimIndicator.visible=(aimMag>0.1||inp.fire);
    aimIndicator.rotation.y=pd.aimAngle;

    // Smooth visual rotation
    player.rotation.y=lerpAngle(player.rotation.y,pd.facing,Math.min(1,dt*16));
    animatePlayer(dt,Math.hypot(pd.velX,pd.velZ));

    // Cooldowns
    pd.fireCd-=dt; pd.swapCd-=dt; pd.invuln-=dt; pd.meleeT-=dt;
    if(pd.meleeT>0) playerGun.rotation.x=-Math.sin(pd.meleeT/0.18*Math.PI)*1.5;
    else playerGun.rotation.x=0;

    // Regen
    if(upg.hasRegen){pd.regenT-=dt;if(pd.regenT<=0){pd.regenT=1;pd.hp=Math.min(pd.maxHp,pd.hp+1);updateHUD();}}

    // Swap
    if(inp.swap&&pd.swapCd<=0){pd.swapCd=0.3;do{pd.weaponIdx=(pd.weaponIdx+1)%WORDER.length;}while(!WEP[WORDER[pd.weaponIdx]].owned);updateGunLook();updateHUD();}

    // Fire
    if(firing&&pd.fireCd<=0) fireWeapon(pd.aimAngle);

    updateBullets(dt); updateEnemies(dt); updateBolts(dt); updateParticles(dt); updateTerminals(dt);
    if(boss) updateBossBar();
    if(pd.hp<=0){gameOver();return;}

    // Wave progression
    if(!objPhase&&!bossSpawned&&enemies.length===0){objPhase=true;buildObjectives();notify('🔮 Ativa os 3 terminais para enfrentar o CHEFE!');}
    if(objPhase&&!bossSpawned&&objActivated>=OBJ_TOTAL) spawnBoss();
    if(bossSpawned&&enemies.length===0) openShop();
  }

  // ─── Terminals ─────────────────────────────────────────────────────────────
  function updateTerminals(dt){
    for(const t of terminals){
      if(t.userData.activated){t.userData.crys.rotation.y+=dt*1.5;continue;}
      const s=1+0.12*Math.sin(clock_t*3+t.position.x);
      t.userData.crys.scale.setScalar(s); t.userData.crys.rotation.y+=dt*0.8;
      if(player.position.distanceTo(t.position)<3.5){
        t.userData.activated=true;
        t.userData.crys.material.color.setHex(0x44ff88);
        t.userData.crys.material.emissive.setHex(0x44ff88);
        t.userData.light.color.setHex(0x44ff88);
        if(t.userData.glow) t.userData.glow.material.color.setHex(0x44ff88);
        objActivated++;updateObjHUD();sfx.activate();
        notify(`🔮 Terminal ${objActivated}/${OBJ_TOTAL} ativado!`);
        if(objActivated>=OBJ_TOTAL) sfx.allObj();
      }
    }
  }

  // ─── Fire weapon ───────────────────────────────────────────────────────────
  function fireWeapon(aimAngle){
    const pd=player.userData, key=WORDER[pd.weaponIdx], w=WEP[key];
    pd.fireCd=wepCd(key);
    const muzzle=new THREE.Vector3(-Math.sin(aimAngle)*1.3,1.4,-Math.cos(aimAngle)*1.3).add(player.position);
    if(w.melee){
      pd.meleeT=0.18; sfx.melee();
      for(const e of enemies.slice()) if(e.position.distanceTo(player.position)<w.range) damageEnemy(e,wepDmg(key));
      for(const c of crates.slice()) if(c.position.distanceTo(player.position)<w.range) breakCrate(c);
      spawnPfx(muzzle,5,w.color); return;
    }
    const baseDir=new THREE.Vector3(-Math.sin(aimAngle),0,-Math.cos(aimAngle));
    for(let i=0;i<(w.pellets||1);i++){
      const off=(w.pellets>1)?(i/(w.pellets-1)-0.5)*w.spread:(Math.random()-0.5)*(w.spread||0);
      const dir=baseDir.clone().applyAxisAngle(new THREE.Vector3(0,1,0),off);
      const m=new THREE.Mesh(new THREE.SphereGeometry(0.22,8,8),new THREE.MeshBasicMaterial({color:w.color}));
      const gl=glowSprite(w.color,1.1); m.add(gl); // glowing projectile
      m.position.copy(muzzle); m.userData={vel:dir.multiplyScalar(w.speed),dmg:wepDmg(key),life:1.8,area:w.area||0};
      scene.add(m); bullets.push(m);
    }
    // Muzzle flash
    if(muzzleLight){muzzleLight.color.setHex(w.color);muzzleLight.position.copy(muzzle);muzzleLight.intensity=4;muzzleGlow.material.color.setHex(w.color);muzzleGlow.position.copy(muzzle);muzzleGlow.material.opacity=0.9;}
    sfx.shoot(); spawnPfx(muzzle,3,w.color);
  }

  // ─── Bullets ───────────────────────────────────────────────────────────────
  function updateBullets(dt){
    for(let i=bullets.length-1;i>=0;i--){
      const b=bullets[i]; b.position.addScaledVector(b.userData.vel,dt); b.userData.life-=dt;
      let hit=false;
      for(const e of enemies){
        if(b.position.distanceTo(e.position)<(e.userData.radius||0.9)+0.5){
          if(!e.userData.alert){e.userData.alert=true;const zzz=e.getObjectByName('zzz');if(zzz)e.remove(zzz);sfx.alert();}
          if(b.userData.area>0){for(const e2 of enemies)if(e2.position.distanceTo(b.position)<b.userData.area)damageEnemy(e2,b.userData.dmg);spawnPfx(b.position,20,0xcc44ff);}
          else damageEnemy(e,b.userData.dmg);
          hit=true; break;
        }
      }
      if(!hit) for(const c of crates){if(b.position.distanceTo(new THREE.Vector3(c.position.x,0.85,c.position.z))<1.5){breakCrate(c);hit=true;break;}}
      if(hit||b.userData.life<=0||Math.hypot(b.position.x,b.position.z)>ARENA_R+5){scene.remove(b);bullets.splice(i,1);}
    }
    for(let i=eBullets.length-1;i>=0;i--){
      const b=eBullets[i]; b.position.addScaledVector(b.userData.vel,dt); b.userData.life-=dt;
      const pp=new THREE.Vector3(player.position.x,player.position.y+1.3,player.position.z);
      if(player.userData.invuln<=0&&b.position.distanceTo(pp)<1.2){hurtPlayer(b.userData.dmg);scene.remove(b);eBullets.splice(i,1);continue;}
      if(b.userData.life<=0){scene.remove(b);eBullets.splice(i,1);}
    }
  }

  // ─── Enemy AI ──────────────────────────────────────────────────────────────
  function updateEnemies(dt){
    const pd=player.userData;
    for(let i=enemies.length-1;i>=0;i--){
      const e=enemies[i]; const ed=e.userData;

      // Hit flash
      if(ed.hitFlash>0){ed.hitFlash-=dt;ed.mat.emissive.setHex(ed.hitFlash>0?0xffffff:(ed.isBoss?0x1a0008:0x000000));}

      // Gravity + collision
      ed.vy-=GRAVITY*dt; e.position.y+=ed.vy*dt;
      resolveYCols(e.position,ed,ed.isBoss?2.0:0.65);

      // Direction to player (xz only)
      const dx=player.position.x-e.position.x, dz=player.position.z-e.position.z;
      const dist=Math.hypot(dx,dz)||0.001;
      const ndx=dx/dist, ndz=dz/dist;

      // Alert check
      if(!ed.alert){
        const aRange=ed.type==='dormant'?12:26;
        if(dist<aRange||ed.hp<ed.maxHp){
          ed.alert=true; sfx.alert();
          const zzz=e.getObjectByName('zzz'); if(zzz) e.remove(zzz);
        }
      }

      if(ed.alert){
        if(ed.isBoss){
          // Boss always chases
          if(dist>4.5){const sp=2.8+wave*0.2;e.position.x+=ndx*sp*dt;e.position.z+=ndz*sp*dt;e.rotation.y=Math.atan2(dx,dz);}
          else if(pd.invuln<=0) hurtPlayer(28);
          ed.shootCd-=dt;
          if(ed.shootCd<=0&&dist<75){
            ed.shootCd=1.5;
            for(let s=0;s<12;s++){const a=s/12*Math.PI*2+clock_t*0.5;spawnEB(e.position.x,e.position.y+3,e.position.z,new THREE.Vector3(Math.sin(a),0,Math.cos(a)),22,14,0xff8a3d);}
            const aim=new THREE.Vector3(player.position.x,player.position.y+1.4,player.position.z).sub(new THREE.Vector3(e.position.x,e.position.y+3,e.position.z));
            spawnEB(e.position.x,e.position.y+3,e.position.z,aim,40,22,0xffd23a);
          }
        }
        else if(ed.type==='sniper'){
          // Sniper: keep 18-30 units away
          if(dist<16){const sp=(ed.tough?5.5:4.5)+wave*0.2;e.position.x-=ndx*sp*dt;e.position.z-=ndz*sp*dt;}
          else if(dist>30){e.position.x+=ndx*2*dt;e.position.z+=ndz*2*dt;}
          e.rotation.y=Math.atan2(dx,dz);
          ed.shootCd-=dt;
          if(ed.shootCd<=0&&dist<45){
            ed.shootCd=0.85+Math.random()*0.65;
            const aim=new THREE.Vector3(player.position.x,player.position.y+1.3,player.position.z).sub(new THREE.Vector3(e.position.x,e.position.y+1.2,e.position.z));
            spawnEB(e.position.x,e.position.y+1.2,e.position.z,aim,36,ed.tough?18:12,0xaaff44);
          }
        }
        else{
          // Chaser / dormant (once alert): rushes player
          if(dist>1.9){const sp=(ed.tough?4.5:6.5)+wave*0.3;e.position.x+=ndx*sp*dt;e.position.z+=ndz*sp*dt;e.rotation.y=Math.atan2(dx,dz);}
          else if(pd.invuln<=0) hurtPlayer(ed.tough?18:12);
          ed.shootCd-=dt;
          if(ed.shootCd<=0&&dist<50){
            ed.shootCd=1.5+Math.random()*1.5;
            const aim=new THREE.Vector3(player.position.x,player.position.y+1.3,player.position.z).sub(new THREE.Vector3(e.position.x,e.position.y+1.2,e.position.z));
            spawnEB(e.position.x,e.position.y+1.2,e.position.z,aim,28,ed.tough?17:11,0xff5e7a);
          }
        }
      }

      // Animation (walk swing when alert, idle sway otherwise)
      const ep=ed.parts;
      if(ep){
        ed.walkPhase+=dt*(ed.alert?9:2.5);
        if(ed.alert){
          const sw=Math.sin(ed.walkPhase)*0.55;
          ep.legs[0].rotation.x=sw; ep.legs[1].rotation.x=-sw;
          ep.arms[0].rotation.x=-sw*0.6; ep.arms[1].rotation.x=sw*0.6;
          ep.torso.position.y=1.25+Math.abs(Math.sin(ed.walkPhase))*0.06;
          ep.head.rotation.y=lerpf(ep.head.rotation.y,0,dt*8);
        } else {
          ep.torso.rotation.z=Math.sin(ed.walkPhase)*0.04;
          ep.head.rotation.y=Math.sin(ed.walkPhase*0.6)*0.3;
        }
      }
      // Dormant zzz pulse
      const zz=e.getObjectByName('zzz');
      if(zz){zz.scale.setScalar(0.6+0.15*Math.sin(clock_t*4));zz.position.y=2.9+0.15*Math.sin(clock_t*2);}

      // Arena boundary
      const ed2=Math.hypot(e.position.x,e.position.z);
      if(ed2>ARENA_R-3){const s=(ARENA_R-3)/ed2;e.position.x*=s;e.position.z*=s;}

      // Death
      if(ed.hp<=0){
        if(ed.isBoss){sfx.bossDie();elBossBar.classList.add('hidden');boss=null;dropBolts(e.position.x,1,e.position.z,50);spawnPfx(e.position,60,0xff8a3d);shake(1.3);notify('CHEFE DERROTADO! 🏆');}
        else{sfx.die();dropBolts(e.position.x,1,e.position.z,ed.tough?20:10);spawnPfx(e.position,16,ed.type==='sniper'?0x88ff44:(ed.type==='chaser'?0xff5e7a:0x4488ff));}
        scene.remove(e); enemies.splice(i,1);
      }
    }
  }

  // ─── Bolts ─────────────────────────────────────────────────────────────────
  function updateBolts(dt){
    for(let i=bolts.length-1;i>=0;i--){
      const b=bolts[i],bd=b.userData; b.rotation.y+=dt*6; bd.vy-=GRAVITY*dt;
      b.position.x+=bd.vx*dt;b.position.z+=bd.vz*dt;b.position.y+=bd.vy*dt;
      if(b.position.y<0.3){b.position.y=0.3;bd.vy*=-0.3;bd.vx*=0.7;bd.vz*=0.7;}
      const pp=new THREE.Vector3(player.position.x,player.position.y+1,player.position.z);
      const d=pp.distanceTo(b.position);
      if(d<8){pp.sub(b.position).normalize();b.position.addScaledVector(pp,24*dt);}
      if(d<1.3){bolts_total++;scene.remove(b);bolts.splice(i,1);updateHUD();sfx.bolt();}
    }
  }

  // ─── Particles ─────────────────────────────────────────────────────────────
  function updateParticles(dt){
    for(let i=particles.length-1;i>=0;i--){
      const p=particles[i],u=p.userData; u.life-=dt; u.vy-=34*dt;
      p.position.x+=u.vx*dt;p.position.y+=u.vy*dt;p.position.z+=u.vz*dt;
      p.scale.setScalar(Math.max(0.01,u.life*2.4));
      if(u.life<=0){scene.remove(p);particles.splice(i,1);}
    }
  }

  // ─── Damage ────────────────────────────────────────────────────────────────
  function damageEnemy(e,dmg){e.userData.hp-=dmg;e.userData.hitFlash=0.1;e.userData.mat.emissive.setHex(0xffffff);sfx.hit();}
  function breakCrate(c){const idx=crates.indexOf(c);if(idx===-1)return;crates.splice(idx,1);scene.remove(c);dropBolts(c.position.x,1,c.position.z,14);spawnPfx(new THREE.Vector3(c.position.x,1,c.position.z),10,0xcaa15a);}
  function hurtPlayer(dmg){const pd=player.userData;pd.hp=Math.max(0,pd.hp-dmg);pd.invuln=0.8;updateHUD();sfx.hurt();shake(0.35+dmg*0.01);flashHurt();}
  let _hurtT=null;
  function flashHurt(){const el=document.getElementById('hurt-vignette');if(!el)return;el.classList.add('show');clearTimeout(_hurtT);_hurtT=setTimeout(()=>el.classList.remove('show'),180);}

  // ─── Player animation (walk cycle, bob, lean, air pose) ────────────────────
  function animatePlayer(dt,speed){
    const pd=player.userData, P=pd.parts; if(!P) return;
    const moving=speed>0.5;
    P.walkPhase+=dt*(moving?speed*1.1:6);
    const airborne=!pd.onGround;
    if(airborne){
      // Tuck legs, lean forward slightly
      const tuck=Math.max(-0.5,Math.min(0.5,-pd.vy*0.03));
      P.legs[0].rotation.x=lerpf(P.legs[0].rotation.x,0.5,dt*10);
      P.legs[1].rotation.x=lerpf(P.legs[1].rotation.x,0.5,dt*10);
      P.torso.rotation.x=lerpf(P.torso.rotation.x,tuck,dt*8);
      P.torso.position.y=lerpf(P.torso.position.y,1.15,dt*8);
      P.armR.rotation.x=lerpf(P.armR.rotation.x,-0.6,dt*8);
    } else if(moving){
      const sw=Math.sin(P.walkPhase)*0.6;
      P.legs[0].rotation.x=sw; P.legs[1].rotation.x=-sw;
      P.armR.rotation.x=-sw*0.7;
      P.torso.position.y=1.15+Math.abs(Math.sin(P.walkPhase))*0.07;
      P.torso.rotation.x=lerpf(P.torso.rotation.x,0.08,dt*8);
      P.torso.rotation.z=Math.sin(P.walkPhase)*0.04;
    } else {
      // Idle breathing
      const b=Math.sin(P.walkPhase*0.5)*0.03;
      P.legs[0].rotation.x=lerpf(P.legs[0].rotation.x,0,dt*10);
      P.legs[1].rotation.x=lerpf(P.legs[1].rotation.x,0,dt*10);
      P.armR.rotation.x=lerpf(P.armR.rotation.x,0,dt*10);
      P.torso.position.y=1.15+b;
      P.torso.rotation.x=lerpf(P.torso.rotation.x,0,dt*8);
      P.torso.rotation.z=lerpf(P.torso.rotation.z,0,dt*8);
      P.head.rotation.y=Math.sin(P.walkPhase*0.3)*0.15;
    }
  }
  function lerpf(a,b,t){return a+(b-a)*Math.min(1,t);}

  // ─── Floating motes ─────────────────────────────────────────────────────────
  function updateMotes(dt){
    if(!motes) return;
    const p=motes.geometry.attributes.position; const arr=p.array;
    for(let i=0;i<motePhase.length;i++){
      arr[i*3+1]+=Math.sin(clock_t*0.6+motePhase[i])*dt*0.6+dt*0.15;
      if(arr[i*3+1]>24) arr[i*3+1]=1;
    }
    p.needsUpdate=true;
    motes.rotation.y+=dt*0.01;
  }

  // ─── Camera (follow + shake) ───────────────────────────────────────────────
  function shake(mag){ shakeMag=Math.min(1.4,shakeMag+mag); }
  function updateCamera(dt){
    const tgt=new THREE.Vector3().copy(player.position).add(CAM_OFF);
    camera.position.lerp(tgt,Math.min(1,dt*6));
    if(shakeMag>0.001){
      camera.position.x+=(Math.random()-0.5)*shakeMag;
      camera.position.y+=(Math.random()-0.5)*shakeMag;
      camera.position.z+=(Math.random()-0.5)*shakeMag;
      shakeMag=decay(shakeMag,dt,shakeMag*6+2);
    }
    camera.lookAt(player.position.x,player.position.y+1.8,player.position.z);
  }
  function updateGunLook(){const w=WEP[WORDER[player.userData.weaponIdx]];const m=playerGun.userData.barrelMat;if(m){m.color.setHex(w.color);m.emissive.setHex(w.melee?0x333344:0x16566b);}}
  function lerpAngle(a,b,t){let d=b-a;while(d>Math.PI)d-=Math.PI*2;while(d<-Math.PI)d+=Math.PI*2;return a+d*t;}

  // ─── HUD ───────────────────────────────────────────────────────────────────
  const elHealth  =document.getElementById('health-fill');
  const elBolts   =document.getElementById('bolts-count');
  const elWave    =document.getElementById('wave-label');
  const elWeapon  =document.getElementById('weapon-label');
  const elBossBar =document.getElementById('boss-bar');
  const elBossFill=document.getElementById('boss-health-fill');
  const elObjLabel=document.getElementById('objective-label');
  const elObjCount=document.getElementById('obj-count');
  const elNotif   =document.getElementById('notification');
  let notifTimer=null;

  function updateBossBar(){if(!boss)return;elBossFill.style.width=Math.max(0,boss.userData.hp/boss.userData.maxHp*100)+'%';}
  function updateHUD(){const pd=player.userData;elHealth.style.width=(pd.hp/pd.maxHp*100)+'%';elBolts.textContent=bolts_total;elWave.textContent='Onda '+wave;elWeapon.textContent=WEP[WORDER[pd.weaponIdx]].name;}
  function notify(msg,dur=2.8){elNotif.textContent=msg;elNotif.classList.add('show');clearTimeout(notifTimer);notifTimer=setTimeout(()=>elNotif.classList.remove('show'),dur*1000);}

  // ─── Shop ──────────────────────────────────────────────────────────────────
  const SHOP_ITEMS={
    vida:[
      {id:'heal',  name:'Reparar armadura',desc:'Recupera toda a vida',           price:60, repeat:true, action:()=>{const pd=player.userData;pd.hp=pd.maxHp;}},
      {id:'maxhp1',name:'Vida máx +25',    desc:'Aumenta a vida máxima',           price:90, action:()=>{const pd=player.userData;pd.maxHp+=25;pd.hp+=25;}},
      {id:'maxhp2',name:'Vida máx +50',    desc:'Aumenta ainda mais a vida máxima',price:180,req:'maxhp1',action:()=>{const pd=player.userData;pd.maxHp+=50;pd.hp+=50;}},
      {id:'regen', name:'Regeneração',      desc:'+1 HP por segundo (passivo)',    price:160,once:true,action:()=>{upg.hasRegen=true;}},
    ],
    arma:[
      {id:'spread',name:WEP.spread.name,desc:WEP.spread.desc,price:WEP.spread.price,weapon:'spread'},
      {id:'pyro',  name:WEP.pyro.name,  desc:WEP.pyro.desc,  price:WEP.pyro.price,  weapon:'pyro'},
      {id:'plasma',name:WEP.plasma.name,desc:WEP.plasma.desc,price:WEP.plasma.price,weapon:'plasma'},
      {id:'dmg1',  name:'Dano +25%',    desc:'Todos os danos aumentam 25%',price:110,action:()=>{upg.dmgLevel=Math.min(2,upg.dmgLevel+1);}},
      {id:'dmg2',  name:'Dano +50%',    desc:'Todos os danos aumentam 50%',price:200,req:'dmg1',action:()=>{upg.dmgLevel=Math.min(2,upg.dmgLevel+1);}},
      {id:'cd1',   name:'Cadência +15%',desc:'Reduz cooldown de disparo',  price:120,action:()=>{upg.cdLevel=Math.min(2,upg.cdLevel+1);}},
      {id:'cd2',   name:'Cadência +30%',desc:'Reduz ainda mais o cooldown',price:210,req:'cd1',action:()=>{upg.cdLevel=Math.min(2,upg.cdLevel+1);}},
    ],
    movimento:[
      {id:'jump3',name:'Triplo salto',  desc:'Ganha um 3.º salto no ar',              price:90, once:true,action:()=>{upg.jumpMax=3;}},
      {id:'dash', name:'Dash',          desc:'Sem jumps + direção → dash horizontal', price:150,once:true,action:()=>{upg.hasDash=true;}},
      {id:'spd1', name:'Velocidade +25%',desc:'Move-te mais depressa',               price:100,action:()=>{upg.spLevel=Math.min(2,upg.spLevel+1);}},
      {id:'spd2', name:'Velocidade +50%',desc:'Move-te muito mais depressa',         price:190,req:'spd1',action:()=>{upg.spLevel=Math.min(2,upg.spLevel+1);}},
    ],
  };
  const bought=new Set();

  function openShop(){state=S.SHOP;sfx.waveClear();renderShop();show('shop',true);}
  function renderShop(){
    document.getElementById('shop-bolts').textContent=bolts_total;
    const ct=document.getElementById('shop-items'); ct.innerHTML='';
    for(const u of(SHOP_ITEMS[shopTab]||[])){
      const isW=!!u.weapon;
      const owned=isW?WEP[u.weapon].owned:(!u.repeat&&bought.has(u.id));
      const st=shopItemState(u,{bolts:bolts_total,owned,boughtReq:!u.req||bought.has(u.req)});
      const div=document.createElement('div'); div.className='shop-item';
      div.innerHTML=`<div class="info"><div class="name">${u.name}</div><div class="desc">${u.desc||''}</div></div>`;
      const btn=document.createElement('button'); btn.className='buy-btn';
      if(st==='owned'){btn.textContent='✓ Comprado';btn.classList.add('owned');btn.disabled=true;}
      else if(st==='locked'){btn.textContent='🔒 Bloqueado';btn.disabled=true;}
      else{
        btn.textContent=u.price+' ⚙️'; btn.disabled=(st==='unaffordable');
        btn.onclick=()=>{if(bolts_total<u.price)return;bolts_total-=u.price;if(isW)WEP[u.weapon].owned=true;if(u.action)u.action();bought.add(u.id);sfx.buy();updateHUD();renderShop();};
      }
      div.appendChild(btn); ct.appendChild(div);
    }
  }

  function nextWave(){wave++;startWave(wave);show('shop',false);state=S.PLAY;}
  function gameOver(){state=S.OVER;document.getElementById('final-wave').textContent=wave;document.getElementById('final-bolts').textContent=bolts_total;show('gameover',true);}
  function startGame(){
    initAudio(); bolts_total=0; wave=1;
    for(const k of Object.keys(WEP)) WEP[k].owned=(k==='wrench'||k==='blaster');
    bought.clear(); resetUpgrades(); jumpQueued=0; dashActive=false; dashT=0;
    Object.assign(player.userData,{vy:0,velX:0,velZ:0,onGround:true,jumpsLeft:2,jumpHeld:false,aimAngle:0,facing:0,hp:100,maxHp:100,weaponIdx:1,fireCd:0,swapCd:0,invuln:0,meleeT:0,regenT:0});
    player.rotation.y=0; updateGunLook(); startWave(wave);
    show('overlay',false);show('shop',false);show('gameover',false); state=S.PLAY;
  }
  function show(id,v){document.getElementById(id).classList.toggle('hidden',!v);}

  // ─── Keyboard ──────────────────────────────────────────────────────────────
  const KM={ArrowUp:'fwd',w:'fwd',W:'fwd',ArrowDown:'back',s:'back',S:'back',ArrowLeft:'left',a:'left',A:'left',ArrowRight:'right',d:'right',D:'right',' ':'jump',z:'fire',Z:'fire',c:'swap',C:'swap'};
  window.addEventListener('keydown',e=>{if(KM[e.key]){const a=KM[e.key];if(a==='jump'&&!e.repeat)jumpQueued++;inp[a]=true;e.preventDefault();}});
  window.addEventListener('keyup',  e=>{if(KM[e.key]){inp[KM[e.key]]=false;e.preventDefault();}});

  // ─── Touch buttons ─────────────────────────────────────────────────────────
  function bindButtons(){
    document.querySelectorAll('.ctrl').forEach(btn=>{
      const act=btn.dataset.act; if(!act) return;
      const on=e=>{e.preventDefault();if(act==='jump')jumpQueued++;inp[act]=true;};
      const off=e=>{e.preventDefault();inp[act]=false;};
      btn.addEventListener('touchstart',on,{passive:false}); btn.addEventListener('touchend',off,{passive:false}); btn.addEventListener('touchcancel',off,{passive:false});
      btn.addEventListener('mousedown',on); btn.addEventListener('mouseup',off); btn.addEventListener('mouseleave',off);
    });
  }

  // ─── Joystick ──────────────────────────────────────────────────────────────
  function makeJoystick(baseEl,thumbEl,joyObj){
    function setCenter(){const r=baseEl.getBoundingClientRect();joyObj.cx=r.left+r.width/2;joyObj.cy=r.top+r.height/2;joyObj.radius=r.width/2-8;}
    function moveTo(cx,cy){let dx=cx-joyObj.cx,dy=cy-joyObj.cy;const d=Math.hypot(dx,dy),m=joyObj.radius;if(d>m){dx=dx/d*m;dy=dy/d*m;}joyObj.axisX=dx/m;joyObj.axisY=dy/m;thumbEl.style.transform=`translate(${dx}px,${dy}px)`;}
    function start(cx,cy,id){joyObj.active=true;joyObj.id=id;setCenter();moveTo(cx,cy);}
    function end(){joyObj.active=false;joyObj.id=null;joyObj.axisX=0;joyObj.axisY=0;thumbEl.style.transform='translate(0px,0px)';}
    baseEl.addEventListener('touchstart',e=>{e.preventDefault();const t=e.changedTouches[0];start(t.clientX,t.clientY,t.identifier);},{passive:false});
    document.addEventListener('touchmove',e=>{if(!joyObj.active)return;for(const t of e.changedTouches)if(t.identifier===joyObj.id){e.preventDefault();moveTo(t.clientX,t.clientY);}},{passive:false});
    const te=e=>{for(const t of e.changedTouches)if(t.identifier===joyObj.id)end();};
    document.addEventListener('touchend',te);document.addEventListener('touchcancel',te);
    baseEl.addEventListener('mousedown',e=>{start(e.clientX,e.clientY,'mouse');const mm=ev=>moveTo(ev.clientX,ev.clientY);const mu=()=>{end();document.removeEventListener('mousemove',mm);document.removeEventListener('mouseup',mu);};document.addEventListener('mousemove',mm);document.addEventListener('mouseup',mu);});
  }

  // ─── Shop tabs ─────────────────────────────────────────────────────────────
  function bindShopTabs(){
    document.querySelectorAll('.tab-btn').forEach(btn=>{
      btn.addEventListener('click',()=>{shopTab=btn.dataset.tab;document.querySelectorAll('.tab-btn').forEach(b=>b.classList.toggle('active',b===btn));renderShop();});
    });
  }

  // ─── Menu buttons ──────────────────────────────────────────────────────────
  document.getElementById('start-btn').addEventListener('click',startGame);
  document.getElementById('restart-btn').addEventListener('click',startGame);
  document.getElementById('next-wave-btn').addEventListener('click',nextWave);

  // ─── Resize ────────────────────────────────────────────────────────────────
  function resize(){const w=window.innerWidth,h=window.innerHeight;renderer.setPixelRatio(Math.min(window.devicePixelRatio||1,2));renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();}
  window.addEventListener('resize',resize);
  window.addEventListener('orientationchange',()=>setTimeout(resize,200));

  // ─── Init ──────────────────────────────────────────────────────────────────
  initThree();
  bindButtons();
  makeJoystick(document.getElementById('joystick'),document.getElementById('joy-thumb'),joy);
  makeJoystick(document.getElementById('aim-joystick'),document.getElementById('aim-thumb'),aimJoy);
  bindShopTabs();
  updateHUD();
  requestAnimationFrame(t=>{lastTime=t;frame(t);});
  if('serviceWorker'in navigator)navigator.serviceWorker.register('sw.js').catch(()=>{});
})();
