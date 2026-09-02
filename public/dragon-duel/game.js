(() => {
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  const base = { w: 960, h: 540 };
  const input = { keys: {}, pressed: new Set() };
  let scale = 1;
  let dpr = window.devicePixelRatio || 1;
  let externalAdvance = false;

  const crystals = [
    { x: 80, y: 380, w: 38, h: 110, color: '#5fe0ff' },
    { x: 140, y: 400, w: 28, h: 80, color: '#7cc8ff' },
    { x: 240, y: 360, w: 50, h: 140, color: '#59b0ff' },
    { x: 320, y: 410, w: 24, h: 70, color: '#78f0ff' },
    { x: 520, y: 380, w: 40, h: 120, color: '#6ad6ff' },
    { x: 620, y: 410, w: 26, h: 80, color: '#5ed7ff' },
    { x: 700, y: 360, w: 44, h: 150, color: '#79bfff' },
    { x: 820, y: 400, w: 30, h: 90, color: '#58c9ff' }
  ];

  const rocks = [
    { x: 40, y: 440, r: 26 },
    { x: 120, y: 460, r: 30 },
    { x: 210, y: 448, r: 22 },
    { x: 300, y: 470, r: 34 },
    { x: 420, y: 452, r: 28 },
    { x: 560, y: 468, r: 36 },
    { x: 660, y: 450, r: 24 },
    { x: 760, y: 465, r: 32 },
    { x: 880, y: 448, r: 26 }
  ];

  let rngSeed = 1337;
  const rand = () => {
    let t = (rngSeed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const state = {
    mode: 'title',
    time: 0,
    score: 0,
    groundY: 410,
    player: {
      x: 220,
      y: 390,
      vx: 0,
      vy: 0,
      r: 18,
      facing: 1,
      onGround: false,
      health: 100,
      maxHealth: 100,
      invuln: 0,
      slashTimer: 0,
      slashCooldown: 0,
      slashHit: false,
      dashTimer: 0,
      dashCooldown: 0,
      dashHit: false
    },
    dragon: {
      x: 740,
      y: 180,
      baseY: 180,
      vx: 40,
      r: 56,
      health: 220,
      maxHealth: 220,
      hurtTimer: 0,
      attackCooldown: 1.8,
      chargeTimer: 0,
      mode: 'idle'
    },
    projectiles: [],
    effects: []
  };

  const resetGame = (toTitle = true) => {
    rngSeed = 1337;
    state.time = 0;
    state.score = 0;
    state.mode = toTitle ? 'title' : 'playing';
    state.player.x = 220;
    state.player.y = state.groundY - state.player.r;
    state.player.vx = 0;
    state.player.vy = 0;
    state.player.onGround = false;
    state.player.facing = 1;
    state.player.health = state.player.maxHealth;
    state.player.invuln = 0;
    state.player.slashTimer = 0;
    state.player.slashCooldown = 0;
    state.player.slashHit = false;
    state.player.dashTimer = 0;
    state.player.dashCooldown = 0;
    state.player.dashHit = false;
    state.dragon.x = 740;
    state.dragon.y = 180;
    state.dragon.vx = 40;
    state.dragon.health = state.dragon.maxHealth;
    state.dragon.hurtTimer = 0;
    state.dragon.attackCooldown = 1.8;
    state.dragon.chargeTimer = 0;
    state.dragon.mode = 'idle';
    state.projectiles.length = 0;
    state.effects.length = 0;
  };

  const resize = () => {
    dpr = window.devicePixelRatio || 1;
    scale = Math.min(window.innerWidth / base.w, window.innerHeight / base.h);
    const cssW = Math.floor(base.w * scale);
    const cssH = Math.floor(base.h * scale);
    canvas.style.width = `${cssW}px`;
    canvas.style.height = `${cssH}px`;
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, 0, 0);
    ctx.imageSmoothingEnabled = true;
  };

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      canvas.requestFullscreen?.();
    } else {
      document.exitFullscreen?.();
    }
  };

  const isDown = (code) => !!input.keys[code];
  const consume = (code) => {
    if (input.pressed.has(code)) {
      input.pressed.delete(code);
      return true;
    }
    return false;
  };

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

  const addEffect = (x, y, color) => {
    state.effects.push({ x, y, life: 0.35, color });
  };

  const hurtPlayer = (amount, knockback = -180) => {
    const player = state.player;
    if (player.invuln > 0 || state.mode !== 'playing') return;
    player.health = Math.max(0, player.health - amount);
    player.invuln = 1.0;
    player.vx += knockback;
    player.vy = -240;
    addEffect(player.x, player.y - 20, '#ff9b3f');
    if (player.health <= 0) {
      state.mode = 'lose';
    }
  };

  const hurtDragon = (amount) => {
    const dragon = state.dragon;
    if (state.mode !== 'playing') return;
    dragon.health = Math.max(0, dragon.health - amount);
    dragon.hurtTimer = 0.25;
    state.score += amount;
    addEffect(dragon.x - 10, dragon.y + 10, '#ffd27a');
    if (dragon.health <= 0) {
      state.mode = 'win';
    }
  };

  const spawnFireball = () => {
    const dragon = state.dragon;
    const player = state.player;
    const angle = Math.atan2(player.y - dragon.y, player.x - dragon.x);
    const speed = 300 + rand() * 60;
    state.projectiles.push({
      x: dragon.x - 20,
      y: dragon.y + 10,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      r: 10,
      life: 4.5
    });
  };

  const updatePlayer = (dt) => {
    const player = state.player;
    const left = isDown('ArrowLeft') || isDown('KeyA');
    const right = isDown('ArrowRight') || isDown('KeyD');
    const jump = consume('Space') || consume('ArrowUp') || consume('KeyW');

    if ((consume('KeyJ') || consume('KeyB')) && player.slashCooldown <= 0 && state.mode === 'playing') {
      player.slashTimer = 0.18;
      player.slashCooldown = 0.45;
      player.slashHit = false;
    }
    if ((consume('KeyK') || consume('ArrowDown')) && player.dashCooldown <= 0 && state.mode === 'playing') {
      player.dashTimer = 0.2;
      player.dashCooldown = 1.0;
      player.dashHit = false;
    }

    if (jump && player.onGround && state.mode === 'playing') {
      player.vy = -430;
      player.onGround = false;
    }

    const accel = 1800;
    const maxSpeed = 240;
    if (state.mode === 'playing') {
      if (left) {
        player.vx -= accel * dt;
        player.facing = -1;
      }
      if (right) {
        player.vx += accel * dt;
        player.facing = 1;
      }
    }

    if (player.dashTimer > 0) {
      player.vx = player.facing * 560;
    }

    if (!left && !right) {
      player.vx *= 0.84;
    }

    player.vx = clamp(player.vx, -maxSpeed, maxSpeed);
    player.vy += 1200 * dt;

    player.x += player.vx * dt;
    player.y += player.vy * dt;

    player.x = clamp(player.x, player.r + 20, base.w - player.r - 20);

    if (player.y + player.r >= state.groundY) {
      player.y = state.groundY - player.r;
      player.vy = 0;
      player.onGround = true;
    }

    if (player.slashTimer > 0) player.slashTimer -= dt;
    if (player.slashCooldown > 0) player.slashCooldown -= dt;
    if (player.dashTimer > 0) player.dashTimer -= dt;
    if (player.dashCooldown > 0) player.dashCooldown -= dt;
    if (player.invuln > 0) player.invuln -= dt;
  };

  const updateDragon = (dt) => {
    const dragon = state.dragon;
    if (state.mode !== 'playing') return;

    dragon.y = dragon.baseY + Math.sin(state.time * 1.2) * 18;
    dragon.x += dragon.vx * dt;
    if (dragon.x > 820 || dragon.x < 620) dragon.vx *= -1;

    if (dragon.hurtTimer > 0) dragon.hurtTimer -= dt;
    if (dragon.chargeTimer > 0) dragon.chargeTimer -= dt;

    dragon.attackCooldown -= dt;
    if (dragon.attackCooldown <= 0) {
      dragon.mode = rand() > 0.35 ? 'fireball' : 'burst';
      dragon.chargeTimer = dragon.mode === 'burst' ? 0.6 : 0.3;
      dragon.attackCooldown = 2.2 + rand() * 1.5;
    }

    if (dragon.chargeTimer <= 0 && dragon.mode !== 'idle') {
      if (dragon.mode === 'fireball') {
        spawnFireball();
      } else if (dragon.mode === 'burst') {
        spawnFireball();
        spawnFireball();
      }
      dragon.mode = 'idle';
    }
  };

  const resolveAttacks = () => {
    const player = state.player;
    const dragon = state.dragon;
    if (state.mode !== 'playing') return;

    if (player.slashTimer > 0 && !player.slashHit) {
      const dx = dragon.x - player.x;
      const dy = dragon.y - (player.y - 10);
      const facingOk = Math.sign(dx) === player.facing;
      const dist = Math.hypot(dx, dy);
      if (dist < 110 && facingOk) {
        hurtDragon(12);
        player.slashHit = true;
      }
    }

    if (player.dashTimer > 0 && !player.dashHit) {
      const dx = dragon.x - player.x;
      const dy = dragon.y - (player.y - 10);
      const dist = Math.hypot(dx, dy);
      if (dist < 90) {
        hurtDragon(14);
        player.dashHit = true;
      }
    }
  };

  const updateProjectiles = (dt) => {
    for (let i = state.projectiles.length - 1; i >= 0; i -= 1) {
      const p = state.projectiles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;

      if (p.x < -40 || p.x > base.w + 40 || p.y < -40 || p.y > base.h + 40 || p.life <= 0) {
        state.projectiles.splice(i, 1);
        continue;
      }

      const player = state.player;
      const dist = Math.hypot(p.x - player.x, p.y - player.y);
      if (dist < p.r + player.r) {
        state.projectiles.splice(i, 1);
        hurtPlayer(14, -220 * Math.sign(player.x - p.x));
      }
    }
  };

  const updateEffects = (dt) => {
    for (let i = state.effects.length - 1; i >= 0; i -= 1) {
      state.effects[i].life -= dt;
      if (state.effects[i].life <= 0) state.effects.splice(i, 1);
    }
  };

  const update = (dt) => {
    state.time += dt;

    if (consume('KeyF')) toggleFullscreen();
    if (consume('KeyP')) {
      if (state.mode === 'playing') state.mode = 'pause';
      else if (state.mode === 'pause') state.mode = 'playing';
    }

    if (state.mode === 'title') {
      if (consume('Space') || consume('Enter')) {
        resetGame(false);
      }
      return;
    }

    if (state.mode === 'win' || state.mode === 'lose') {
      if (consume('KeyR') || consume('Enter')) {
        resetGame(true);
      }
      return;
    }

    if (state.mode === 'pause') return;

    updatePlayer(dt);
    updateDragon(dt);
    updateProjectiles(dt);
    resolveAttacks();
    updateEffects(dt);
  };

  const drawBackground = () => {
    const gradient = ctx.createLinearGradient(0, 0, 0, base.h);
    gradient.addColorStop(0, '#140b2f');
    gradient.addColorStop(0.5, '#160a3f');
    gradient.addColorStop(1, '#0a0920');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, base.w, base.h);

    ctx.save();
    ctx.fillStyle = 'rgba(40, 20, 80, 0.8)';
    ctx.beginPath();
    ctx.moveTo(0, 60);
    ctx.bezierCurveTo(120, 10, 240, 90, 360, 40);
    ctx.bezierCurveTo(520, 0, 620, 110, 760, 60);
    ctx.bezierCurveTo(860, 20, 920, 80, 960, 40);
    ctx.lineTo(960, 0);
    ctx.lineTo(0, 0);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    crystals.forEach((crystal) => {
      ctx.save();
      ctx.translate(crystal.x, crystal.y);
      ctx.fillStyle = crystal.color;
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(crystal.w * 0.5, -crystal.h * 0.2);
      ctx.lineTo(crystal.w, -crystal.h);
      ctx.lineTo(crystal.w * 1.2, -crystal.h * 0.1);
      ctx.lineTo(crystal.w * 0.8, 10);
      ctx.closePath();
      ctx.fill();
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = '#e9f7ff';
      ctx.beginPath();
      ctx.moveTo(crystal.w * 0.4, -crystal.h * 0.1);
      ctx.lineTo(crystal.w * 0.6, -crystal.h * 0.6);
      ctx.lineTo(crystal.w * 0.75, -crystal.h * 0.2);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    });
  };

  const drawLava = () => {
    const lavaGradient = ctx.createLinearGradient(0, state.groundY, 0, base.h);
    lavaGradient.addColorStop(0, '#ff7b1e');
    lavaGradient.addColorStop(0.5, '#ff3a00');
    lavaGradient.addColorStop(1, '#b61000');
    ctx.fillStyle = lavaGradient;
    ctx.fillRect(0, state.groundY, base.w, base.h - state.groundY);

    for (let i = 0; i < base.w; i += 40) {
      const wave = Math.sin(state.time * 3 + i * 0.08) * 4;
      ctx.fillStyle = 'rgba(255, 220, 120, 0.35)';
      ctx.beginPath();
      ctx.ellipse(i + 20, state.groundY + 12 + wave, 20, 6, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    rocks.forEach((rock) => {
      ctx.fillStyle = '#3a1c1a';
      ctx.beginPath();
      ctx.arc(rock.x, rock.y, rock.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 140, 60, 0.25)';
      ctx.beginPath();
      ctx.arc(rock.x - 6, rock.y - 6, rock.r * 0.5, 0, Math.PI * 2);
      ctx.fill();
    });
  };

  const drawPlayer = () => {
    const player = state.player;
    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.scale(player.facing, 1);

    ctx.fillStyle = player.invuln > 0 ? 'rgba(240, 200, 160, 0.7)' : '#d6c1a8';
    ctx.beginPath();
    ctx.arc(0, -12, 12, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#5b4a70';
    ctx.fillRect(-10, -8, 20, 28);

    ctx.fillStyle = '#b08a4d';
    ctx.fillRect(-8, 10, 6, 16);
    ctx.fillRect(2, 10, 6, 16);

    ctx.fillStyle = '#c23b3b';
    ctx.beginPath();
    ctx.moveTo(-10, -4);
    ctx.lineTo(-32, 12);
    ctx.lineTo(-12, 18);
    ctx.closePath();
    ctx.fill();

    if (player.slashTimer > 0) {
      ctx.strokeStyle = 'rgba(255, 220, 140, 0.9)';
      ctx.lineWidth = 6;
      ctx.beginPath();
      ctx.arc(20, -4, 26, -0.2, 1.1);
      ctx.stroke();
    }

    if (player.dashTimer > 0) {
      ctx.fillStyle = 'rgba(255, 180, 80, 0.5)';
      ctx.fillRect(-18, -6, 36, 12);
    }

    ctx.restore();
  };

  const drawDragon = () => {
    const dragon = state.dragon;
    ctx.save();
    ctx.translate(dragon.x, dragon.y);

    ctx.fillStyle = dragon.hurtTimer > 0 ? '#ff8aa0' : '#7b33c9';
    ctx.beginPath();
    ctx.ellipse(0, 20, 70, 40, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#5e1f9b';
    ctx.beginPath();
    ctx.ellipse(20, 0, 42, 30, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#f4e7ff';
    ctx.beginPath();
    ctx.moveTo(-20, -10);
    ctx.lineTo(-90, -50);
    ctx.lineTo(-60, 10);
    ctx.closePath();
    ctx.fill();

    ctx.beginPath();
    ctx.moveTo(-10, -20);
    ctx.lineTo(80, -70);
    ctx.lineTo(50, 0);
    ctx.closePath();
    ctx.fill();

    ctx.fillStyle = '#ffd75a';
    ctx.beginPath();
    ctx.ellipse(30, -12, 8, 6, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.fillStyle = '#3d1a54';
    ctx.beginPath();
    ctx.moveTo(50, 8);
    ctx.lineTo(76, 18);
    ctx.lineTo(44, 20);
    ctx.closePath();
    ctx.fill();

    ctx.strokeStyle = dragon.mode !== 'idle' ? 'rgba(255, 160, 90, 0.8)' : 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(62, 10);
    ctx.lineTo(90, 6);
    ctx.stroke();

    ctx.restore();
  };

  const drawProjectiles = () => {
    state.projectiles.forEach((p) => {
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.fillStyle = '#ff9a2f';
      ctx.beginPath();
      ctx.arc(0, 0, p.r, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = 'rgba(255, 220, 160, 0.6)';
      ctx.beginPath();
      ctx.arc(-3, -3, p.r * 0.5, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  };

  const drawEffects = () => {
    state.effects.forEach((fx) => {
      ctx.save();
      ctx.globalAlpha = fx.life / 0.35;
      ctx.fillStyle = fx.color;
      ctx.beginPath();
      ctx.arc(fx.x, fx.y, 18 * (1 - fx.life / 0.35), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    });
  };

  const drawUI = () => {
    const player = state.player;
    const dragon = state.dragon;

    const barW = 220;
    const barH = 14;

    ctx.fillStyle = 'rgba(0, 0, 0, 0.4)';
    ctx.fillRect(24, 20, barW, barH);
    ctx.fillRect(base.w - barW - 24, 20, barW, barH);

    ctx.fillStyle = '#6ce173';
    ctx.fillRect(24, 20, barW * (player.health / player.maxHealth), barH);

    ctx.fillStyle = '#ff6b6b';
    ctx.fillRect(base.w - barW - 24, 20, barW * (dragon.health / dragon.maxHealth), barH);

    ctx.fillStyle = '#e4c9ff';
    ctx.font = '14px "Trebuchet MS", sans-serif';
    ctx.fillText(`Score ${state.score}`, 24, 54);
  };

  const drawTitle = () => {
    ctx.fillStyle = 'rgba(10, 6, 20, 0.5)';
    ctx.fillRect(0, 0, base.w, base.h);

    ctx.fillStyle = '#f2ddff';
    ctx.font = '48px "Trebuchet MS", serif';
    ctx.textAlign = 'center';
    ctx.fillText('Crystal Cavern Duel', base.w / 2, 170);

    ctx.fillStyle = '#f6b26b';
    ctx.font = '20px "Trebuchet MS", sans-serif';
    ctx.fillText('Press Space or Enter to Begin', base.w / 2, 220);

    ctx.fillStyle = '#c7b7ff';
    ctx.font = '16px "Trebuchet MS", sans-serif';
    ctx.fillText('Move: A/D or ◀/▶  Jump: W/▲/Space', base.w / 2, 270);
    ctx.fillText('Slash: J or B  Dash: K or ▼  Pause: P  Fullscreen: F', base.w / 2, 300);
  };

  const drawEnd = (text) => {
    ctx.fillStyle = 'rgba(10, 6, 20, 0.55)';
    ctx.fillRect(0, 0, base.w, base.h);

    ctx.fillStyle = '#ffd67b';
    ctx.font = '46px "Trebuchet MS", serif';
    ctx.textAlign = 'center';
    ctx.fillText(text, base.w / 2, 220);

    ctx.fillStyle = '#f2ddff';
    ctx.font = '20px "Trebuchet MS", sans-serif';
    ctx.fillText('Press R or Enter to return', base.w / 2, 260);
  };

  const drawPause = () => {
    ctx.fillStyle = 'rgba(8, 6, 20, 0.6)';
    ctx.fillRect(0, 0, base.w, base.h);
    ctx.fillStyle = '#f2ddff';
    ctx.font = '34px "Trebuchet MS", sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Paused', base.w / 2, 240);
  };

  const render = () => {
    drawBackground();
    drawLava();
    drawDragon();
    drawPlayer();
    drawProjectiles();
    drawEffects();
    drawUI();

    if (state.mode === 'title') drawTitle();
    if (state.mode === 'win') drawEnd('Victory!');
    if (state.mode === 'lose') drawEnd('Defeated');
    if (state.mode === 'pause') drawPause();
  };

  const loop = (timestamp) => {
    if (!loop.last) loop.last = timestamp;
    const delta = Math.min(0.033, (timestamp - loop.last) / 1000);
    loop.last = timestamp;
    if (!externalAdvance) {
      update(delta);
      render();
    }
    requestAnimationFrame(loop);
  };

  window.render_game_to_text = () => {
    const player = state.player;
    const dragon = state.dragon;
    const payload = {
      coord: 'origin top-left, +x right, +y down, units=px',
      mode: state.mode,
      arena: { width: base.w, height: base.h, groundY: state.groundY },
      player: {
        x: player.x,
        y: player.y,
        vx: player.vx,
        vy: player.vy,
        facing: player.facing,
        health: player.health,
        onGround: player.onGround,
        slashCooldown: Math.max(0, player.slashCooldown),
        dashCooldown: Math.max(0, player.dashCooldown)
      },
      dragon: {
        x: dragon.x,
        y: dragon.y,
        health: dragon.health,
        mode: dragon.mode
      },
      projectiles: state.projectiles.map((p) => ({ x: p.x, y: p.y, vx: p.vx, vy: p.vy, r: p.r })),
      score: state.score
    };
    return JSON.stringify(payload);
  };

  window.advanceTime = (ms) => {
    externalAdvance = true;
    const steps = Math.max(1, Math.round(ms / (1000 / 60)));
    for (let i = 0; i < steps; i += 1) {
      update(1 / 60);
    }
    render();
  };

  window.addEventListener('keydown', (event) => {
    if (!event.repeat) input.pressed.add(event.code);
    input.keys[event.code] = true;
    if (event.code === 'KeyF') event.preventDefault();
  });

  window.addEventListener('keyup', (event) => {
    input.keys[event.code] = false;
  });

  window.addEventListener('blur', () => {
    input.keys = {};
    input.pressed.clear();
  });

  window.addEventListener('resize', resize);
  document.addEventListener('fullscreenchange', resize);

  resize();
  resetGame(true);
  render();
  requestAnimationFrame(loop);
})();
