export interface JobStats {
  totalJobs: number;
  patterns: {
    namePrefix: { "critical-": number; "test-": number; "batch-": number; [key: string]: number };
    argumentFlags: { "--fast": number; [key: string]: number };
    durationCorrelation: { failedCount: number };
    pidParity: { even: number; odd: number };
  };
}

export class MockServer {
  private state: JobStats = {
    totalJobs: 46,
    patterns: { 
      namePrefix: { "critical-": 8, "test-": 11, "batch-": 5 }, 
      argumentFlags: { "--fast": 12 },
      durationCorrelation: { failedCount: 2 },
      pidParity: { even: 23, odd: 23 }
    }
  };

  fetchStats(): JobStats {
    const r = Math.random();
    if (r < 0.15) { }
    else if (r < 0.20) {
      this.state.patterns.durationCorrelation.failedCount += Math.floor(Math.random() * 2) + 1;
      this.state.totalJobs += 1;
    } else if (r < 0.30) {
      const b = Math.floor(Math.random() * 16) + 15;
      this.state.totalJobs += b;
      this.state.patterns.argumentFlags["--fast"] += Math.floor(b * 0.8);
      this.state.patterns.namePrefix["critical-"] += Math.floor(b * 0.5);
      this.state.patterns.namePrefix["batch-"] += Math.floor(b * 0.3);
      this.state.patterns.pidParity.even += Math.floor(b / 2);
      this.state.patterns.pidParity.odd += Math.ceil(b / 2);
    } else {
      const i = Math.floor(Math.random() * 3) + 1;
      this.state.totalJobs += i;
      this.state.patterns.namePrefix["test-"] += i;
      if (Math.random() > 0.5) this.state.patterns.pidParity.even += i;
      else this.state.patterns.pidParity.odd += i;
    }
    return JSON.parse(JSON.stringify(this.state));
  }
}

type Rect = { x: number, y: number, w: number, h: number };
type Coin = Rect & { collected: boolean };
type Particle = { x: number, y: number, s: number, vx: number, vy: number, a: number };

export class GameEngine {
  canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D; server: MockServer;
  useMock = false; // FEATURE TOGGLE: false для интеграции с боевым Node-сервером
  onLog: (m: string) => void; onScore: (s: number) => void; onGameOver: () => void;
  lastStats: JobStats | null = null;
  player = { x: 50, y: 0, w: 20, h: 20, vy: 0, grounded: false, jumps: 0, maxJumps: 2, rotation: 0 };
  jumpBuffer = 0;
  platforms: Rect[] = []; traps: Rect[] = []; coins: Coin[] = []; particles: Particle[] = [];
  scrollX = 0; speed = 5; gravity = 0.6; jumpForce = -10;
  lastChunkX = 0; lastPlatformY = 300; isRunning = false; score = 0;
  fetchInterval: any; animationFrame: any; seederInterval: any;
  framesSinceLastFetch = 0;
  bgImage: HTMLImageElement; bgLoaded = false;

  constructor(canvas: HTMLCanvasElement, onLog: (m: string) => void, onScore: (s: number) => void, onGameOver: () => void) {
    this.canvas = canvas; this.ctx = canvas.getContext('2d')!; this.ctx.imageSmoothingEnabled = false;
    this.server = new MockServer();    this.onLog = onLog; this.onScore = onScore; this.onGameOver = onGameOver;
    this.bgImage = new Image();
    this.bgImage.src = ((import.meta as any).env?.BASE_URL || '/thegame/') + 'background.png';
    this.bgImage.onload = () => { this.bgLoaded = true; };
    for (let i = 0; i < 50; i++) this.particles.push({ x: Math.random() * 2000, y: Math.random() * canvas.height, s: Math.random() * 4 + 2, vx: -Math.random() * 2 - 1, vy: Math.random() * 2 + 1, a: Math.random() * Math.PI * 2 });
    this.reset();
  }

  reset() {
    this.player = { x: 50, y: 100, w: 20, h: 20, vy: 0, grounded: false, jumps: 0, maxJumps: 2, rotation: 0 };
    this.jumpBuffer = 0;
    this.platforms = [{ x: 0, y: 300, w: 1600, h: 20 }];
    this.traps = []; this.coins = []; this.scrollX = 0; this.lastChunkX = 1600; this.lastPlatformY = 300; this.score = 0; this.lastStats = null; this.onScore(0);
    this.framesSinceLastFetch = 0;
  }

  start() {
    if (this.isRunning) return;
    this.isRunning = true; this.reset();
    this.fetchInterval = setInterval(() => this.fetchAndProcess(), 500);

    // Client-side Load Generator
    if (!this.useMock) {
      let tick = 0;
      this.seederInterval = setInterval(() => {
        tick += 0.25;
        // Многослойный хаотичный шум (Perlin-like noise)
        const wave = Math.sin(tick) + Math.cos(tick * 2.3) * 0.5 + (Math.random() - 0.5) * 0.8; 
        let jobName = "test-job";
        
        if (wave > 0.6) jobName = "critical-job"; 
        else if (wave < -0.6) jobName = "batch-job"; 
        
        const argsList = ["--fast", "--debug", "--quality", ""];
        
        // Шанс на генерацию ошибочного джоба, чтобы спавнились шипы и обрывы
        if (Math.random() < 0.15) {
          argsList.push("--fail", "--crash", "invalid_param");
        }

        fetch('/jobs', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jobName: jobName + "-" + Math.floor(Math.random() * 1000),
            arguments: [argsList[Math.floor(Math.random() * argsList.length)]]
          })
        }).catch(() => {});
      }, 200); // 5 запросов в секунду для более плотного потока
    }

    const loop = () => { this.update(); this.draw(); if (this.isRunning) this.animationFrame = requestAnimationFrame(loop); };
    loop();
  }

  stop() { this.isRunning = false; clearInterval(this.fetchInterval); if (this.seederInterval) clearInterval(this.seederInterval); cancelAnimationFrame(this.animationFrame); }
  jump() { this.jumpBuffer = 8; }
  gameOver() { this.stop(); this.onGameOver(); }

  async fetchAndProcess() {
    let newStats: JobStats;
    try {
      if (this.useMock) {
        newStats = this.server.fetchStats();
      } else {
        const res = await fetch('/stats');
        if (!res.ok) return;
        newStats = await res.json();
      }

      if (!this.lastStats) {
        this.lastStats = newStats;
        this.generateChunk({ totalJobs: 0, failedCount: 0, critical: 0, pidParity: { even: 0, odd: 0 } });
        return;
      }
      
      const delta = {
        totalJobs: newStats.totalJobs - this.lastStats.totalJobs,
        failedCount: (newStats.patterns?.durationCorrelation?.failedCount || 0) - (this.lastStats.patterns?.durationCorrelation?.failedCount || 0),
        critical: (newStats.patterns?.namePrefix?.["critical-"] || 0) - (this.lastStats.patterns?.namePrefix?.["critical-"] || 0),
        batch: (newStats.patterns?.namePrefix?.["batch-"] || 0) - (this.lastStats.patterns?.namePrefix?.["batch-"] || 0),
        pidParity: { 
          even: (newStats.patterns?.pidParity?.even || 0) - (this.lastStats.patterns?.pidParity?.even || 0), 
          odd: (newStats.patterns?.pidParity?.odd || 0) - (this.lastStats.patterns?.pidParity?.odd || 0) 
        }
      };
      
      if (delta.totalJobs < 0) { this.onLog("[!] Server restart detected. Resetting baseline."); this.lastStats = newStats; return; }
      this.lastStats = newStats; this.generateChunk(delta);
    } catch (e) {
      if (!this.useMock) this.onLog("[!] Backend connection lost");
    }
  }

  generateChunk(delta: any) {
    const chunkW = this.speed * Math.max(30, this.framesSinceLastFetch);
    this.framesSinceLastFetch = 0;
    let nextY = this.lastPlatformY; let logMsg = "";
    
    if (delta.totalJobs > 0) logMsg += `[+] load: ${delta.totalJobs} -> generating\n`; else logMsg += `[=] Idle -> flat zone\n`;
    
    // Рваная крутизна уклонов
    if (delta.critical > delta.batch) { 
      nextY -= (30 + Math.random() * 40); 
      logMsg += `[^] Critical heavy -> slope UP\n`; 
    }
    else if (delta.batch > delta.critical) { 
      nextY += (30 + Math.random() * 40); 
      logMsg += `[v] Batch heavy -> slope DOWN\n`; 
    }
    else if (delta.totalJobs > 0) {
      if (Math.random() > 0.5) nextY += (10 + Math.random() * 20); else nextY -= (10 + Math.random() * 20);
      logMsg += `[~] Normal load -> bumpy\n`; 
    }

    // Резкие обрывы при ошибках
    if (delta.failedCount > 0) {
      nextY += (80 + Math.random() * 40); // Резкий скачок вниз
      logMsg += `[!!] SERVER ERRORS -> SUDDEN CLIFF\n`;
    }
    
    // Ограничиваем пределы экрана
    nextY = Math.max(150, Math.min(nextY, this.canvas.height - 50));
    this.platforms.push({ x: this.lastChunkX, y: nextY, w: chunkW + 5, h: 20 });
    if (delta.failedCount > 0) { logMsg += `[!] delta failedCount: ${delta.failedCount} -> spawning TRAP\n`; this.traps.push({ x: this.lastChunkX + chunkW / 2 - 10, y: nextY - 20, w: 20, h: 20 }); }
    if (delta.critical > 0) {
      logMsg += `[*] delta critical: ${delta.critical} -> spawning Coins\n`;
      for (let i = 0; i < Math.min(delta.critical, 5); i++) this.coins.push({ x: this.lastChunkX + (chunkW / (delta.critical + 1)) * (i + 1), y: nextY - 60 - (Math.random() * 40), w: 12, h: 12, collected: false });
    }
    this.lastChunkX += chunkW; this.lastPlatformY = nextY;
    if (logMsg) this.onLog(logMsg.trim());
  }

  update() {
    if (!this.isRunning) return;
    this.framesSinceLastFetch++;
    this.player.vy += this.gravity;
    this.player.y += this.player.vy;
    this.player.x += this.speed;

    if (!this.player.grounded && this.player.jumps === 2) {
      this.player.rotation += 0.25;
    } else if (this.player.grounded) {
      this.player.rotation = 0;
    }

    const currentBottom = this.player.y + this.player.h;
    const prevBottom = currentBottom - this.player.vy;

    this.scrollX = this.player.x - 50;
    this.player.grounded = false;
    let minLandingY = Infinity;

    for (const p of this.platforms) {
      if (this.player.x < p.x + p.w && this.player.x + this.player.w > p.x) {
        if (this.player.vy >= 0 && prevBottom <= p.y + 15 && currentBottom >= p.y) {
          if (p.y < minLandingY) minLandingY = p.y;
        }
      }
    }

    if (minLandingY !== Infinity) {
      this.player.y = minLandingY - this.player.h;
      this.player.vy = 0;
      this.player.grounded = true;
      this.player.jumps = 0;
    }

    if (this.jumpBuffer > 0) {
      if (this.player.grounded || this.player.jumps < this.player.maxJumps) {
        this.player.vy = this.jumpForce; this.player.grounded = false; this.player.jumps++; this.jumpBuffer = 0;
      } else {
        this.jumpBuffer--;
      }
    }
    if (this.player.y > this.canvas.height + 250 || (this.player.y > this.canvas.height + 50 && this.player.jumps >= this.player.maxJumps)) {
      this.onLog("[!] FELL INTO THE VOID -> SYSTEM FAILURE");
      this.gameOver();
      return;
    }
    for (const t of this.traps) {
      if (this.player.x < t.x + t.w - 6 && this.player.x + this.player.w > t.x + 6 && this.player.y < t.y + t.h && this.player.y + this.player.h > t.y + 8) {
        this.onLog("[!] HIT A TRAP -> SYSTEM FAILURE");
        this.gameOver();
        return;
      }
    }
    for (const c of this.coins) {
      if (!c.collected && this.player.x < c.x + c.w && this.player.x + this.player.w > c.x && this.player.y < c.y + c.h && this.player.y + this.player.h > c.y) {
        c.collected = true; this.score += 10; this.onScore(this.score);
      }
    }
    for (const p of this.particles) { p.x += p.vx; p.y += p.vy; p.a += 0.05; if (p.y > this.canvas.height) { p.y = -10; p.x = this.scrollX + Math.random() * this.canvas.width; } }
    this.platforms = this.platforms.filter(p => p.x + p.w > this.scrollX); this.traps = this.traps.filter(t => t.x + t.w > this.scrollX); this.coins = this.coins.filter(c => c.x + c.w > this.scrollX && !c.collected);
  }

  draw() {
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);

    if (this.bgLoaded) {
      const scale = this.canvas.height / this.bgImage.height;
      let scaledWidth = this.bgImage.width * scale;
      let scaledHeight = this.canvas.height;

      if (scaledWidth < this.canvas.width) {
        const scaleW = this.canvas.width / this.bgImage.width;
        scaledWidth = this.canvas.width;
        scaledHeight = this.bgImage.height * scaleW;
      }

      const maxScrollX = Math.max(0, scaledWidth - this.canvas.width);
      const parallaxSpeed = 0.03;
      const traveled = this.scrollX * parallaxSpeed;

      let bgX = 0;
      if (maxScrollX > 0) {
        const cycleLength = maxScrollX * 2;
        const mod = traveled % cycleLength;
        bgX = mod < maxScrollX ? -mod : -(maxScrollX - (mod - maxScrollX));
      }

      this.ctx.drawImage(this.bgImage, bgX, 0, scaledWidth, scaledHeight);
    } else {
      const grad = this.ctx.createLinearGradient(0, 0, 0, this.canvas.height); grad.addColorStop(0, '#ffb7c5'); grad.addColorStop(1, '#ffd1dc');
      this.ctx.fillStyle = grad; this.ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      this.ctx.fillStyle = '#e2a9be';
      for (let i = 0; i < 5; i++) {
        const mx = ((i * 300) - (this.scrollX * 0.2)) % (this.canvas.width + 300);
        this.ctx.beginPath(); this.ctx.moveTo(mx - 150, this.canvas.height); this.ctx.lineTo(mx, 150); this.ctx.lineTo(mx + 150, this.canvas.height); this.ctx.fill();
      }
    }

    this.ctx.fillStyle = '#ff9a9e';
    for (const p of this.particles) {
      this.ctx.save(); let px = (p.x - this.scrollX * 0.5) % this.canvas.width; if (px < 0) px += this.canvas.width;
      this.ctx.translate(px, p.y); this.ctx.rotate(p.a); this.ctx.fillRect(-p.s / 2, -p.s / 2, p.s, p.s * 0.6); this.ctx.restore();
    }
    this.ctx.save(); this.ctx.translate(-this.scrollX, 0);
    for (const p of this.platforms) {
      this.ctx.fillStyle = '#4a3b32';
      this.ctx.fillRect(p.x, p.y, p.w, p.h);
      this.ctx.fillStyle = '#2d241e';
      this.ctx.fillRect(p.x, p.y + 5, p.w, p.h - 5);
    }
    this.ctx.fillStyle = '#333';
    for (const t of this.traps) { this.ctx.beginPath(); this.ctx.moveTo(t.x, t.y + t.h); this.ctx.lineTo(t.x + t.w / 2, t.y); this.ctx.lineTo(t.x + t.w, t.y + t.h); this.ctx.fill(); }
    this.ctx.fillStyle = '#ffd700';
    for (const c of this.coins) {
      this.ctx.beginPath(); this.ctx.arc(c.x + c.w / 2, c.y + c.h / 2, c.w / 2, 0, Math.PI * 2); this.ctx.fill();
      this.ctx.fillStyle = '#fff'; this.ctx.beginPath(); this.ctx.arc(c.x + c.w / 2 - 2, c.y + c.h / 2 - 2, c.w / 6, 0, Math.PI * 2); this.ctx.fill(); this.ctx.fillStyle = '#ffd700';
    }

    this.ctx.save();
    this.ctx.translate(this.player.x + this.player.w / 2, this.player.y + this.player.h / 2);
    this.ctx.rotate(this.player.rotation);
    this.ctx.fillStyle = '#ff4e50'; this.ctx.fillRect(-this.player.w / 2, -this.player.h / 2, this.player.w, this.player.h);
    this.ctx.fillStyle = '#fff'; this.ctx.fillRect(-this.player.w / 2, -this.player.h / 2 + 4, this.player.w, 4);
    this.ctx.fillStyle = '#000'; this.ctx.fillRect(-this.player.w / 2 + 12, -this.player.h / 2 + 5, 2, 2);
    this.ctx.restore();

    this.ctx.restore();
  }
}
