# Comprehensive Guide: Job Management & Video Processing Infrastructure

> Полное руководство для Senior Backend Developer по системам управления задачами, видеообработке и облачной инфраструктуре

---

# Содержание

1. [Концепция Job-Based Architecture](#1-концепция-job-based-architecture)
2. [Текущая система: Job Monitoring System](#2-текущая-система-job-monitoring-system)
3. [Node.js в Production: Глубокое погружение](#3-nodejs-в-production-глубокое-погружение)
4. [AWS Ecosystem для видео-инфраструктуры](#4-aws-ecosystem-для-видео-инфраструктуры)
5. [Видеопротоколы: SRT/HLS](#5-видеопротоколы-srthls)
6. [DRM: Digital Rights Management](#6-drm-digital-rights-management)
7. [WebGL для видео](#7-webgl-для-видео)
8. [MySQL в высоконагруженных системах](#8-mysql-в-высоконагруженных-системах)
9. [Интеграция всех компонентов](#9-интеграция-всех-компонентов)
10. [Edge Cases и Production Pain Points](#10-edge-cases-и-production-pain-points)

---

# 1. Концепция Job-Based Architecture

## 1.1 Что такое Job?

**Job (задача)** — это атомарная единица работы, которая:
- Имеет четкий lifecycle (создание → выполнение → завершение)
- Может быть повторена при сбое (idempotent)
- Изолирована от других задач
- Имеет метаданные (ID, статус, время, результат)

### Зачем нужны Jobs?

```
Без Jobs (синхронная обработка):
┌─────────┐    ┌──────────────┐
│ Request │───▶│ Process Video│ ← Блокирует на 10+ минут
└─────────┘    │ (10 minutes) │
               └──────────────┘
   ❌ Timeout
   ❌ Невозможность масштабирования
   ❌ Потеря работы при сбое

С Jobs (асинхронная обработка):
┌─────────┐    ┌─────────┐    ┌───────┐
│ Request │───▶│ Create  │───▶│ Queue │
└─────────┘    │ Job     │    └───┬───┘
               └─────────┘        │
                                  ▼
                            ┌──────────┐
                            │ Workers  │
                            │ Process  │
                            │ in bg    │
                            └──────────┘
   ✅ Instant response
   ✅ Horizontal scaling
   ✅ Retry on failure
```

## 1.2 Типы Job Systems

### A. In-Process Jobs (текущая реализация)

```javascript
// Наша система: JobManager управляет процессами
class JobManager {
  jobs = new Map();           // In-memory storage
  queue = [];                 // FIFO queue
  runningJobs = new Set();    // Active processes
  
  submitJob(name, args) {
    const job = new Job(name, args);
    this.jobs.set(job.id, job);
    
    if (this.canRun()) {
      this.startJob(job.id);
    } else {
      this.queue.push(job.id);  // Defer
    }
  }
}
```

**Плюсы:**
- ✅ Простая реализация
- ✅ Низкая latency
- ✅ Нет внешних зависимостей

**Минусы:**
- ❌ Не переживает рестарт
- ❌ Нельзя масштабировать горизонтально
- ❌ Ограничено ресурсами одной машины

### B. Queue-Based Jobs (Production-grade)

```javascript
// Redis/RabbitMQ/SQS подход
const bull = require('bull');
const videoQueue = new bull('video-processing', {
  redis: { host: 'localhost', port: 6379 }
});

// Producer (API server)
app.post('/videos', async (req, res) => {
  const job = await videoQueue.add({
    videoId: req.body.videoId,
    action: 'transcode'
  }, {
    attempts: 3,
    backoff: { type: 'exponential', delay: 2000 }
  });
  
  res.json({ jobId: job.id });
});

// Consumer (Worker)
videoQueue.process(async (job) => {
  await transcodeVideo(job.data.videoId);
});
```

**Плюсы:**
- ✅ Переживает рестарты (persistence)
- ✅ Горизонтальное масштабирование (N workers)
- ✅ Priority queues, delayed jobs
- ✅ Built-in retry, dead-letter queues

**Минусы:**
- ❌ Сложность (Redis/RabbitMQ setup)
- ❌ Network overhead
- ❌ Нужен мониторинг очереди

### C. Serverless Jobs (AWS Lambda)

```javascript
// Lambda triggered by S3 upload
exports.handler = async (event) => {
  const bucket = event.Records[0].s3.bucket.name;
  const key = event.Records[0].s3.object.key;
  
  // Transcode video
  await transcodeVideo(bucket, key);
};
```

**Плюсы:**
- ✅ Auto-scaling (0 → 1000 workers)
- ✅ Pay per execution
- ✅ Нет управления инфраструктурой

**Минусы:**
- ❌ 15-минутный лимит на Lambda
- ❌ Cold start latency
- ❌ Vendor lock-in

## 1.3 Job Lifecycle в деталях

```
Полный lifecycle с retry и error handling:

┌─────────────────────────────────────────────────────────┐
│                     JOB LIFECYCLE                       │
└─────────────────────────────────────────────────────────┘

1. SUBMITTED
   ├─ Валидация входных данных
   ├─ Генерация уникального ID
   ├─ Сохранение в storage
   └─ Переход в QUEUED

2. QUEUED
   ├─ Ожидание свободного слота (concurrency limit)
   ├─ Priority queue sorting (если есть приоритеты)
   └─ Dequeue → RUNNING

3. RUNNING
   ├─ Spawn процесса/worker
   ├─ Heartbeat проверки (watchdog)
   ├─ Progress tracking (опционально)
   └─ Exit handling:
       ├─ Exit code 0 → COMPLETED
       └─ Exit code != 0 → FAILED

4. FAILED
   ├─ Проверка retry count < max retries
   ├─ YES → RETRYING
   └─ NO  → DEAD (final failure)

5. RETRYING
   ├─ Exponential backoff delay
   ├─ Reset временных данных
   └─ → RUNNING (повторная попытка)

6. COMPLETED
   ├─ Сохранение результата
   ├─ Уведомление callback URL (если указан)
   ├─ Cleanup временных файлов
   └─ Архивирование метаданных

7. DEAD (optional)
   ├─ Перемещение в Dead Letter Queue
   ├─ Алерт для ops team
   └─ Manual retry возможен
```

### Критические моменты в lifecycle:

**1. Idempotency (идемпотентность)**

```javascript
// ПЛОХО: не идемпотентная операция
async function processVideo(jobId) {
  await db.query('INSERT INTO processed_videos ...');  // Упадет при retry
  await transcodeVideo();
}

// ХОРОШО: идемпотентная операция
async function processVideo(jobId) {
  // Проверяем, не обработано ли уже
  const existing = await db.query(
    'SELECT * FROM processed_videos WHERE job_id = ?', 
    [jobId]
  );
  
  if (existing) {
    return existing;  // Уже обработано
  }
  
  const result = await transcodeVideo();
  
  // Atomic upsert
  await db.query(`
    INSERT INTO processed_videos (job_id, result) 
    VALUES (?, ?)
    ON DUPLICATE KEY UPDATE result = ?
  `, [jobId, result, result]);
  
  return result;
}
```

**2. Watchdog (защита от зависших процессов)**

```javascript
class JobManager {
  startJob(jobId) {
    const job = this.jobs.get(jobId);
    const child = spawn(job.command, job.args);
    
    // Watchdog timer
    const timeout = setTimeout(() => {
      console.error(`Job ${jobId} timeout, killing process`);
      child.kill('SIGKILL');
      job.status = 'TIMEOUT';
    }, 10 * 60 * 1000);  // 10 минут
    
    child.on('exit', (code) => {
      clearTimeout(timeout);  // Отменяем watchdog
      this.handleExit(jobId, code);
    });
  }
}
```

**3. Graceful Shutdown**

```javascript
// Критически важно для избежания потери данных
let isShuttingDown = false;

process.on('SIGTERM', async () => {
  isShuttingDown = true;
  
  // 1. Перестаем принимать новые jobs
  server.close();
  
  // 2. Ждем завершения текущих jobs (до 30 сек)
  await Promise.race([
    waitForRunningJobs(),
    timeout(30000)
  ]);
  
  // 3. Сохраняем состояние queued jobs
  await saveQueuedJobs(queue);
  
  // 4. Выходим
  process.exit(0);
});

async function waitForRunningJobs() {
  while (runningJobs.size > 0) {
    await sleep(100);
  }
}
```

---

# 2. Текущая система: Job Monitoring System

## 2.1 Архитектура

```
┌────────────────────────────────────────────────────────┐
│                    CLIENT LAYER                        │
│  curl, Postman, Frontend App, Scripts                 │
└────────────┬───────────────────────────────────────────┘
             │ HTTP REST
             ▼
┌────────────────────────────────────────────────────────┐
│                     API LAYER                          │
│  ┌──────────────┐    ┌─────────────────┐              │
│  │ Express.js   │───▶│ Routes          │              │
│  │ Middleware   │    │ - POST /jobs    │              │
│  │ - JSON parse │    │ - GET /jobs     │              │
│  │ - Logging    │    │ - GET /jobs/:id │              │
│  │ - Errors     │    │ - GET /stats    │              │
│  └──────────────┘    └─────────────────┘              │
└────────────┬───────────────────────────────────────────┘
             │ Business Logic Calls
             ▼
┌────────────────────────────────────────────────────────┐
│                   CORE LAYER                           │
│  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐  │
│  │ JobManager  │  │ Statistics   │  │ Process      │  │
│  │             │  │ Engine       │  │ Spawner      │  │
│  │ - Queue     │  │              │  │              │  │
│  │ - Retry     │  │ - 7 patterns │  │ - OS detect  │  │
│  │ - Lifecycle │  │ - Aggregation│  │ - .sh/.bat   │  │
│  └─────────────┘  └──────────────┘  └──────────────┘  │
└────────────┬───────────────────────────────────────────┘
             │ Process Spawning
             ▼
┌────────────────────────────────────────────────────────┐
│                  PROCESS LAYER                         │
│  ┌──────────────┐           ┌──────────────┐          │
│  │ dummy.sh     │           │ dummy.bat    │          │
│  │ (Unix-like)  │           │ (Windows)    │          │
│  │              │           │              │          │
│  │ - Random fail│           │ - Random fail│          │
│  │ - Sleep 100- │           │ - Sleep 100- │          │
│  │   500ms      │           │   500ms      │          │
│  └──────────────┘           └──────────────┘          │
└────────────────────────────────────────────────────────┘
```

## 2.2 Как работает Job Manager

### Внутренние структуры данных

```javascript
class JobManager {
  constructor() {
    // Основное хранилище: jobId → Job object
    this.jobs = new Map();
    
    // Активные процессы: Set<jobId>
    this.runningJobs = new Set();
    
    // Очередь: Array<jobId> (FIFO)
    this.queue = [];
    
    // Конфигурация
    this.maxConcurrent = 100;  // Лимит параллельных задач
    this.maxRetries = 1;       // Попытки retry
    this.retryDelay = 500;     // Задержка перед retry (ms)
  }
}
```

### Алгоритм работы

**Шаг 1: Submission**

```javascript
submitJob(jobName, args) {
  // 1. Создаем Job object
  const job = new Job(jobName, args);
  job.status = 'QUEUED';
  job.submittedAt = new Date();
  
  // 2. Сохраняем в Map
  this.jobs.set(job.id, job);
  
  // 3. Проверяем доступность слота
  if (this.runningJobs.size < this.maxConcurrent) {
    // Есть место → запускаем сразу
    this._startJob(job.id);
  } else {
    // Нет места → в очередь
    this.queue.push(job.id);
    console.log(`Job ${job.id} queued (${this.queue.length} in queue)`);
  }
  
  return job;
}
```

**Шаг 2: Execution**

```javascript
_startJob(jobId) {
  const job = this.jobs.get(jobId);
  
  // 1. Transition: QUEUED → RUNNING
  job.transitionTo('RUNNING');
  job.startedAt = new Date();
  
  // 2. Добавляем в активные
  this.runningJobs.add(jobId);
  
  // 3. Spawn процесс
  const child = this.spawner.spawn(job.jobName, job.arguments);
  job.pid = child.pid;
  
  console.log(`Job ${jobId} started (PID: ${child.pid})`);
  
  // 4. Подписываемся на события
  child.on('exit', (exitCode, signal) => {
    this._handleExit(jobId, exitCode, signal);
  });
}
```

**Шаг 3: Completion Handling**

```javascript
_handleExit(jobId, exitCode, signal) {
  const job = this.jobs.get(jobId);
  
  // 1. Убираем из активных
  this.runningJobs.delete(jobId);
  
  // 2. Сохраняем результат
  job.exitCode = exitCode;
  job.completedAt = new Date();
  job.duration = job.completedAt - job.startedAt;
  
  // 3. Определяем финальный статус
  if (exitCode === 0) {
    // Успех
    job.transitionTo('COMPLETED');
    console.log(`Job ${jobId} completed in ${job.duration}ms`);
    
  } else {
    // Провал
    if (job.retryCount < this.maxRetries) {
      // Есть попытки → retry
      this._scheduleRetry(jobId);
    } else {
      // Попытки исчерпаны
      job.transitionTo('FAILED');
      console.error(`Job ${jobId} failed after ${job.retryCount} retries`);
    }
  }
  
  // 4. Обрабатываем очередь
  this._processQueue();
}
```

**Шаг 4: Retry Logic**

```javascript
_scheduleRetry(jobId) {
  const job = this.jobs.get(jobId);
  
  // 1. Transition: RUNNING → RETRYING
  job.transitionTo('RETRYING');
  job.retryCount++;
  
  console.log(`Scheduling retry for job ${jobId} (attempt ${job.retryCount})`);
  
  // 2. Delayed retry (exponential backoff можно добавить)
  setTimeout(() => {
    const currentJob = this.jobs.get(jobId);
    
    // Проверяем, что job еще в RETRYING (не был удален/отменен)
    if (currentJob && currentJob.status === 'RETRYING') {
      console.log(`Retrying job ${jobId}`);
      
      // Reset временных полей
      currentJob.startedAt = null;
      currentJob.pid = null;
      currentJob.exitCode = null;
      
      // Запускаем заново
      this._startJob(jobId);
    }
  }, this.retryDelay);
}
```

**Шаг 5: Queue Processing**

```javascript
_processQueue() {
  // Пока есть свободные слоты и задачи в очереди
  while (
    this.queue.length > 0 && 
    this.runningJobs.size < this.maxConcurrent
  ) {
    const nextJobId = this.queue.shift();  // FIFO: берем первый
    
    console.log(`Dequeuing job ${nextJobId} (${this.queue.length} remaining)`);
    
    this._startJob(nextJobId);
  }
}
```

### State Machine диаграмма

```
Job State Machine:

        submitJob()
            ↓
        ┌─────────┐
        │ QUEUED  │ ← Ожидает слота
        └────┬────┘
             │ _startJob()
             ▼
        ┌─────────┐
        │ RUNNING │ ← Выполняется
        └────┬────┘
             │
      ┌──────┴──────┐
      │             │
   exitCode=0   exitCode!=0
      │             │
      ▼             ▼
 ┌──────────┐  ┌─────────┐
 │COMPLETED │  │ FAILED  │
 └──────────┘  └────┬────┘
                    │
              retryCount < maxRetries?
                    │
               ┌────┴────┐
              YES       NO
               │         │
               ▼         ▼
          ┌──────────┐ ┌──────┐
          │RETRYING  │ │ DEAD │
          └────┬─────┘ └──────┘
               │
         delay expired
               │
               └────────→ RUNNING
```

## 2.3 ProcessSpawner: Кроссплатформенность

### Проблема

Node.js работает на Windows, macOS, Linux, но:
- Windows использует `.bat` / `.cmd` / `.exe`
- Unix-like использует `.sh` / бинарники

### Решение

```javascript
import { spawn } from 'child_process';
import { platform } from 'os';

class ProcessSpawner {
  constructor() {
    this.platform = platform();  // 'win32', 'darwin', 'linux', etc.
    this.isWindows = this.platform === 'win32';
    
    // Выбираем правильный скрипт
    this.scriptExtension = this.isWindows ? '.bat' : '.sh';
    this.scriptPath = `./scripts/dummy${this.scriptExtension}`;
  }
  
  spawn(jobName, args) {
    const processArgs = [jobName, ...args];
    
    const child = spawn(this.scriptPath, processArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],  // stdin, stdout, stderr
      shell: this.isWindows  // Windows требует shell: true
    });
    
    return child;
  }
}
```

### Особенности по платформам

**Unix (Linux/macOS)**

```bash
#!/bin/bash
# dummy.sh

# Аргументы доступны через $1, $2, ...
JOB_NAME=$1
shift
ARGS="$@"

# Random число через $RANDOM
RANDOM_NUM=$((RANDOM % 100))

# Sleep с дробными секундами
sleep 0.25

# Exit code определяет успех/провал
exit 0  # success
exit 1  # failure
```

**Windows**

```batch
@echo off
REM dummy.bat

REM Аргументы через %1, %2, ...
set JOB_NAME=%1
shift
set ARGS=%*

REM Random через %time%
set /a RANDOM_NUM=%time:~-2% %% 100

REM Sleep через powershell
powershell -Command "Start-Sleep -Milliseconds 250"

REM Exit code
exit /b 0
exit /b 1
```

### Почему не скомпилированный C++?

**Минусы C++:**
- ❌ Нужен компилятор (g++, MSVC)
- ❌ Cross-compilation сложна
- ❌ Бинарники нужно distribut'ить под каждую платформу
- ❌ Сложнее тестировать

**Плюсы скриптов:**
- ✅ Работают на любой ОС with shell
- ✅ Легко редактировать (не нужна перекомпиляция)
- ✅ Одинаковое поведение гарантировано

## 2.4 StatisticsEngine: Анализ паттернов

### 7 реализованных паттернов

**1. Name Prefix (практический)**

```javascript
_analyzeNamePrefix(jobs) {
  const prefixes = ['critical-', 'batch-', 'test-'];
  const counts = {};
  
  prefixes.forEach(prefix => {
    counts[prefix] = jobs.filter(job =>
      job.jobName.toLowerCase().startsWith(prefix)
    ).length;
  });
  
  counts.other = jobs.filter(job =>
    !prefixes.some(p => job.jobName.toLowerCase().startsWith(p))
  ).length;
  
  return counts;
}

// Результат:
// {
//   "critical-": 15,  ← SLA-critical задачи
//   "batch-": 8,      ← Batch processing
//   "test-": 22,      ← Тестовые jobs
//   "other": 55
// }
```

**Use Case:** Идентификация типов задач для приоритизации и SLA мониторинга.

**2. Argument Flags (практический)**

```javascript
_analyzeArgumentFlags(jobs) {
  const flags = ['--fast', '--quality', '--debug'];
  const counts = {};
  
  flags.forEach(flag => {
    counts[flag] = jobs.filter(job =>
      job.arguments.includes(flag)
    ).length;
  });
  
  return counts;
}

// Результат:
// {
//   "--fast": 42,      ← Speed-optimized runs
//   "--quality": 18,   ← Quality-optimized runs
//   "--debug": 5       ← Debug mode runs
// }
```

**Use Case:** A/B тестирование параметров, оптимизация defaults.

**3. Burst Submissions (практический)**

```javascript
_analyzeBurstSubmissions(jobs) {
  const WINDOW_MS = 10000;  // 10 секунд
  const THRESHOLD = 5;       // >5 jobs = burst
  
  // Сортируем по времени
  const sorted = jobs.slice().sort((a, b) =>
    a.submittedAt - b.submittedAt
  );
  
  let burstCount = 0;
  let totalBursts = 0;
  
  // Sliding window algorithm
  for (let i = 0; i < sorted.length; i++) {
    let windowStart = i;
    
    // Двигаем окно, пока разница < 10 сек
    while (
      windowStart < i &&
      sorted[i].submittedAt - sorted[windowStart].submittedAt > WINDOW_MS
    ) {
      windowStart++;
    }
    
    const windowSize = i - windowStart + 1;
    
    if (windowSize > THRESHOLD) {
      burstCount++;
      if (windowSize === THRESHOLD + 1) {
        totalBursts++;  // Новый burst
      }
    }
  }
  
  return { burstCount, totalBursts };
}

// Результат:
// {
//   "burstCount": 12,    ← Jobs в burst'ах
//   "totalBursts": 3     ← Количество burst событий
// }
```

**Use Case:** 
- Детектирование spike'ов нагрузки
- Auto-scaling triggers
- Rate limiting

**4. Duration Correlation (практический)**

```javascript
_analyzeDurationCorrelation(jobs) {
  const completed = jobs.filter(j => 
    j.status === 'completed' && j.duration !== null
  );
  
  const failed = jobs.filter(j => 
    j.status === 'failed' && j.duration !== null
  );
  
  const avg = (arr) => arr.length > 0
    ? arr.reduce((sum, j) => sum + j.duration, 0) / arr.length
    : null;
  
  return {
    avgCompletedDuration: avg(completed),
    avgFailedDuration: avg(failed),
    completedCount: completed.length,
    failedCount: failed.length
  };
}

// Результат:
// {
//   "avgCompletedDuration": 234.5,  ← Успешные быстрее?
//   "avgFailedDuration": 456.8,     ← Провалы медленнее?
//   "completedCount": 85,
//   "failedCount": 15
// }
```

**Use Case:** 
- Если failed jobs дольше → timeout проблема
- Если failed jobs быстрее → fail-fast validation
- Performance regression detection

**5. Retry Correlation (практический)**

```javascript
_analyzeRetryCorrelation(jobs) {
  const withRetry = jobs.filter(j => j.retryCount > 0);
  const withoutRetry = jobs.filter(j => j.retryCount === 0);
  
  const calcSuccessRate = (arr) => {
    const succeeded = arr.filter(j => j.status === 'completed').length;
    return arr.length > 0 ? succeeded / arr.length : null;
  };
  
  return {
    withRetry: {
      total: withRetry.length,
      succeeded: withRetry.filter(j => j.status === 'completed').length,
      successRate: calcSuccessRate(withRetry)
    },
    withoutRetry: {
      total: withoutRetry.length,
      succeeded: withoutRetry.filter(j => j.status === 'completed').length,
      successRate: calcSuccessRate(withoutRetry)
    }
  };
}

// Результат:
// {
//   "withRetry": {
//     "total": 15,
//     "succeeded": 10,
//     "successRate": 0.667    ← 67% success after retry
//   },
//   "withoutRetry": {
//     "total": 85,
//     "succeeded": 75,
//     "successRate": 0.882    ← 88% success first try
//   }
// }
```

**Use Case:**
- Эффективность retry стратегии
- Если retry success rate низкий → проблема не transient

**6. PID Parity (экзотический)**

```javascript
_analyzePidParity(jobs) {
  const withPid = jobs.filter(j => j.pid !== null);
  
  return {
    even: withPid.filter(j => j.pid % 2 === 0).length,
    odd: withPid.filter(j => j.pid % 2 === 1).length
  };
}

// Результат:
// {
//   "even": 52,
//   "odd": 48
// }
```

**Use Case:** Академический интерес, проверка рандомности OS scheduler.

**7. Warmup Effect (экзотический)**

```javascript
_analyzeWarmupEffect(jobs) {
  const sorted = jobs.slice().sort((a, b) =>
    a.submittedAt - b.submittedAt
  );
  
  const firstTen = sorted.slice(0, 10);
  const rest = sorted.slice(10);
  
  const calcStats = (arr) => {
    const succeeded = arr.filter(j => j.status === 'completed').length;
    return {
      total: arr.length,
      succeeded,
      successRate: arr.length > 0 ? succeeded / arr.length : null
    };
  };
  
  return {
    firstTen: calcStats(firstTen),
    rest: calcStats(rest)
  };
}

// Результат:
// {
//   "firstTen": {
//     "total": 10,
//     "succeeded": 9,
//     "successRate": 0.9      ← Первые 10 успешнее
//   },
//   "rest": {
//     "total": 90,
//     "succeeded": 76,
//     "successRate": 0.844    ← Остальные хуже
//   }
// }
```

**Use Case:** 
- Детектирование cold start проблем
- JVM warmup, cache priming эффекты
- Connection pool establishment

---

# 3. Node.js в Production: Глубокое погружение

## 3.1 Event Loop: Сердце Node.js

### Архитектура

```
┌───────────────────────────────────────────────┐
│           Node.js Architecture                │
└───────────────────────────────────────────────┘

┌─────────────────────────────────────────────┐
│         JavaScript Code (Single Thread)      │
│  ┌─────────────────────────────────────┐    │
│  │  V8 Engine (JIT compilation)        │    │
│  │  - Heap (memory)                    │    │
│  │  - Call Stack                       │    │
│  └─────────────────────────────────────┘    │
└──────────────┬──────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────┐
│            Event Loop (libuv)                │
│  ┌────────────────────────────────────────┐ │
│  │  Phases (в порядке выполнения):       │ │
│  │  1. Timers      (setTimeout/Interval) │ │
│  │  2. Pending     (I/O callbacks)       │ │
│  │  3. Idle/Prepare (internal)           │ │
│  │  4. Poll        (retrieve new I/O)    │ │
│  │  5. Check       (setImmediate)        │ │
│  │  6. Close       (close callbacks)     │ │
│  └────────────────────────────────────────┘ │
└──────────────┬──────────────────────────────┘
               │
               ▼
┌──────────────────────────────────────────────┐
│      Thread Pool (libuv, default: 4)         │
│  - File I/O                                  │
│  - DNS lookup (getaddrinfo)                  │
│  - Crypto (некоторые операции)               │
│  - Compression (zlib)                        │
└──────────────────────────────────────────────┘
```

### Как это работает на примере

```javascript
console.log('1: Sync');

setTimeout(() => {
  console.log('2: Timeout');
}, 0);

setImmediate(() => {
  console.log('3: Immediate');
});

Promise.resolve().then(() => {
  console.log('4: Promise');
});

process.nextTick(() => {
  console.log('5: NextTick');
});

console.log('6: Sync');

// Вывод:
// 1: Sync
// 6: Sync
// 5: NextTick        ← Выполняется после текущей фазы
// 4: Promise         ← Microtask queue
// 2: Timeout         ← Timers phase
// 3: Immediate       ← Check phase
```

**Почему так?**

```
Call Stack execution:
├─ console.log('1: Sync')          ← Выполнено сразу
├─ setTimeout(...)                 ← Регистрируется в Timers queue
├─ setImmediate(...)               ← Регистрируется в Check queue
├─ Promise.then(...)               ← Регистрируется в Microtask queue
├─ process.nextTick(...)           ← Регистрируется в NextTick queue
└─ console.log('6: Sync')          ← Выполнено сразу

После завершения текущего кода:
1. NextTick queue очищается ПЕРВОЙ
2. Microtask queue очищается ВТОРОЙ
3. Event Loop переходит к фазам:
   - Timers → setTimeout
   - ...
   - Check → setImmediate
```

## 3.2 Concurrency Patterns

### Pattern 1: Async/Await (рекомендуется)

```javascript
// ПЛОХО: Callback Hell
function processVideo(videoId, callback) {
  downloadVideo(videoId, (err, file) => {
    if (err) return callback(err);
    
    transcodeVideo(file, (err, transcoded) => {
      if (err) return callback(err);
      
      uploadToS3(transcoded, (err, url) => {
        if (err) return callback(err);
        
        updateDatabase(videoId, url, (err) => {
          if (err) return callback(err);
          
          callback(null, url);
        });
      });
    });
  });
}

// ХОРОШО: Async/Await
async function processVideo(videoId) {
  const file = await downloadVideo(videoId);
  const transcoded = await transcodeVideo(file);
  const url = await uploadToS3(transcoded);
  await updateDatabase(videoId, url);
  return url;
}
```

### Pattern 2: Parallel Execution

```javascript
// ПЛОХО: Sequential (медленно)
async function processVideos(videoIds) {
  const results = [];
  
  for (const id of videoIds) {
    const result = await processVideo(id);  // Ждем каждое
    results.push(result);
  }
  
  return results;
}
// Время: N * avg_time

// ХОРОШО: Parallel (быстро)
async function processVideos(videoIds) {
  const promises = videoIds.map(id => processVideo(id));
  return await Promise.all(promises);
}
// Время: max(times)

// ЕЩЕ ЛУЧШЕ: Parallel с лимитом (защита от перегрузки)
async function processVideos(videoIds, concurrency = 10) {
  const results = [];
  
  for (let i = 0; i < videoIds.length; i += concurrency) {
    const batch = videoIds.slice(i, i + concurrency);
    const batchResults = await Promise.all(
      batch.map(id => processVideo(id))
    );
    results.push(...batchResults);
  }
  
  return results;
}
```

### Pattern 3: Error Handling

```javascript
// ПЛОХО: Незащищенный код
async function processVideo(videoId) {
  const file = await downloadVideo(videoId);  // Может упасть
  return await transcodeVideo(file);          // Может упасть
}

// ХОРОШО: Try/Catch
async function processVideo(videoId) {
  try {
    const file = await downloadVideo(videoId);
    return await transcodeVideo(file);
  } catch (error) {
    console.error(`Failed to process video ${videoId}:`, error);
    throw new Error(`Video processing failed: ${error.message}`);
  }
}

// ЕЩЕ ЛУЧШЕ: Granular error handling
async function processVideo(videoId) {
  let file;
  
  try {
    file = await downloadVideo(videoId);
  } catch (error) {
    throw new Error(`Download failed: ${error.message}`);
  }
  
  try {
    return await transcodeVideo(file);
  } catch (error) {
    // Cleanup
    await fs.unlink(file.path);
    throw new Error(`Transcode failed: ${error.message}`);
  }
}
```

## 3.3 Memory Management

### Heap и сборка мусора

```javascript
// Memory Leak Example
const leaks = [];

setInterval(() => {
  // Создаем объект, который никогда не очистится
  leaks.push({
    data: new Array(1000000).fill('leak'),
    timestamp: Date.now()
  });
}, 100);

// Через час: FATAL ERROR: Ineffective mark-compacts near heap limit
```

**Heap Snapshot анализ:**

```bash
# 1. Включаем inspector
node --inspect server.js

# 2. В Chrome DevTools (chrome://inspect)
# Memory → Take Heap Snapshot

# 3. Смотрим на:
# - Retained Size (память, которая освободится при удалении объекта)
# - Shallow Size (размер самого объекта)
# - Retainers (кто держит ссылку)
```

### Best Practices

```javascript
// 1. Очищайте timers
const timer = setTimeout(() => {}, 1000);
clearTimeout(timer);

// 2. Удаляйте event listeners
emitter.on('event', handler);
// ...
emitter.off('event', handler);

// 3. Используйте WeakMap для кешей
const cache = new WeakMap();  // Не препятствует GC

// ПЛОХО
const cache = new Map();
cache.set(obj, data);  // obj никогда не очистится

// ХОРОШО
const cache = new WeakMap();
cache.set(obj, data);  // obj может быть очищен GC

// 4. Streaming вместо buffering
// ПЛОХО
const data = await fs.readFile('large-video.mp4');  // Вся в память
await processData(data);

// ХОРОШО
const stream = fs.createReadStream('large-video.mp4');
stream.pipe(transcoder).pipe(uploader);
```

## 3.4 Clustering для Multi-Core

```javascript
// server.js
import cluster from 'cluster';
import os from 'os';
import process from 'process';

const numCPUs = os.cpus().length;

if (cluster.isPrimary) {
  console.log(`Primary ${process.pid} is running`);
  
  // Fork workers
  for (let i = 0; i < numCPUs; i++) {
    cluster.fork();
  }
  
  cluster.on('exit', (worker, code, signal) => {
    console.log(`Worker ${worker.process.pid} died`);
    // Respawn
    cluster.fork();
  });
  
} else {
  // Worker process
  import('./app.js').then(({ default: app }) => {
    app.listen(3000, () => {
      console.log(`Worker ${process.pid} started`);
    });
  });
}
```

**Альтернатива: PM2**

```bash
# pm2.config.js
module.exports = {
  apps: [{
    name: 'api-server',
    script: './src/index.js',
    instances: 'max',  // = numCPUs
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production'
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z'
  }]
};

# Запуск
pm2 start pm2.config.js
pm2 monit  # Мониторинг
```

---

# 4. AWS Ecosystem для видео-инфраструктуры

## 4.1 S3: Object Storage

### Архитектура

```
S3 Bucket Structure для видео-платформы:

my-video-platform/
├── uploads/                    ← Raw uploads
│   ├── 2024/01/15/
│   │   └── uuid-original.mp4
│   └── ...
├── transcoded/                 ← Processed videos
│   ├── 720p/
│   │   └── uuid.mp4
│   ├── 1080p/
│   │   └── uuid.mp4
│   └── hls/                    ← Adaptive streaming
│       └── uuid/
│           ├── master.m3u8
│           ├── 720p.m3u8
│           ├── 720p-001.ts
│           ├── 720p-002.ts
│           └── ...
├── thumbnails/                 ← Preview images
│   └── uuid-thumbnail.jpg
└── subtitles/                  ← Captions
    └── uuid-en.vtt
```

### S3 Best Practices

**1. Bucket Naming & Organization**

```javascript
// ПЛОХО: Flat structure
// s3://videos/video1.mp4
// s3://videos/video2.mp4
// Проблемы:
// - Медленный listing при >1000 объектов
// - Невозможно применить lifecycle policies выборочно

// ХОРОШО: Hierarchical with date partitioning
// s3://videos/uploads/2024/01/15/uuid.mp4
// s3://videos/transcoded/720p/uuid.mp4
// Преимущества:
// - Быстрый listing (prefix-based)
// - Granular lifecycle policies
// - Легче analytics (Athena queries)

const getUploadPath = (userId, videoId) => {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  
  return `uploads/${year}/${month}/${day}/${userId}/${videoId}.mp4`;
};
```

**2. Multipart Upload для больших файлов**

```javascript
import { S3 } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import fs from 'fs';

async function uploadLargeVideo(filePath, key) {
  const s3 = new S3({ region: 'us-east-1' });
  
  const upload = new Upload({
    client: s3,
    params: {
      Bucket: 'my-videos',
      Key: key,
      Body: fs.createReadStream(filePath),
      ContentType: 'video/mp4'
    },
    
    // Автоматический multipart для файлов >5MB
    partSize: 10 * 1024 * 1024,  // 10MB parts
    queueSize: 4,  // 4 параллельных загрузки
    
    leavePartsOnError: false  // Cleanup при ошибке
  });
  
  // Progress tracking
  upload.on('httpUploadProgress', (progress) => {
    const percent = (progress.loaded / progress.total) * 100;
    console.log(`Upload: ${percent.toFixed(2)}%`);
  });
  
  const result = await upload.done();
  return result.Location;
}

// Для файлов >5GB рекомендуется:
// partSize: 100MB
// queueSize: 10
```

**3. Lifecycle Policies**

```json
{
  "Rules": [
    {
      "Id": "DeleteOldUploads",
      "Status": "Enabled",
      "Prefix": "uploads/",
      "Expiration": {
        "Days": 7
      },
      "NoncurrentVersionExpiration": {
        "NoncurrentDays": 1
      }
    },
    {
      "Id": "TransitionToGlacier",
      "Status": "Enabled",
      "Prefix": "transcoded/",
      "Transitions": [
        {
          "Days": 30,
          "StorageClass": "STANDARD_IA"
        },
        {
          "Days": 90,
          "StorageClass": "GLACIER"
        }
      ]
    }
  ]
}
```

**Стоимость (2024):**
- Standard: $0.023/GB/месяц
- Intelligent-Tiering: $0.0025/GB/месяц (мониторинг) + storage cost
- Glacier: $0.004/GB/месяц (retrieval: hours)
- Deep Archive: $0.00099/GB/месяц (retrieval: 12 hours)

**4. Signed URLs (pre-signed)**

```javascript
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

const s3 = new S3Client({ region: 'us-east-1' });

// Upload URL (для клиента)
async function getUploadUrl(key) {
  const command = new PutObjectCommand({
    Bucket: 'my-videos',
    Key: key,
    ContentType: 'video/mp4'
  });
  
  // URL валиден 15 минут
  const url = await getSignedUrl(s3, command, { expiresIn: 900 });
  return url;
}

// Download URL (для просмотра)
async function getDownloadUrl(key) {
  const command = new GetObjectCommand({
    Bucket: 'my-videos',
    Key: key
  });
  
  // URL валиден 1 час
  const url = await getSignedUrl(s3, command, { expiresIn: 3600 });
  return url;
}

// Использование на фронтенде:
// 1. GET /api/upload-url → { uploadUrl: "https://..." }
// 2. PUT uploadUrl (binary data)
// 3. POST /api/videos (notify backend)
```

**5. S3 Events → Lambda Trigger**

```javascript
// Lambda function triggered on S3 upload
export const handler = async (event) => {
  for (const record of event.Records) {
    const bucket = record.s3.bucket.name;
    const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
    
    console.log(`New upload: s3://${bucket}/${key}`);
    
    // Запускаем transcoding job
    await startTranscodingJob(bucket, key);
  }
};

// S3 Event configuration (JSON)
{
  "LambdaFunctionConfigurations": [
    {
      "LambdaFunctionArn": "arn:aws:lambda:us-east-1:123456789:function:VideoTranscoder",
      "Events": ["s3:ObjectCreated:*"],
      "Filter": {
        "Key": {
          "FilterRules": [
            {
              "Name": "prefix",
              "Value": "uploads/"
            },
            {
              "Name": "suffix",
              "Value": ".mp4"
            }
          ]
        }
      }
    }
  ]
}
```

## 4.2 CloudFront: CDN

### Архитектура

```
User Request Flow:

User (Moscow)
    ↓
    ↓ 1. GET /video.mp4
    ↓
┌───────────────────────┐
│ CloudFront Edge       │ ← Nearest edge location
│ (Moscow POP)          │
└───────┬───────────────┘
        │
        ├─ Cache HIT → Return immediately (fast!)
        │
        └─ Cache MISS → Forward to origin
                ↓
        ┌───────────────────┐
        │ S3 Origin         │ ← us-east-1
        │ my-videos bucket  │
        └───────────────────┘
                ↓
            Fetch object
                ↓
        ┌───────────────────┐
        │ CloudFront Edge   │ ← Cache object
        │ (Moscow POP)      │
        └───────────────────┘
                ↓
            Return to user
```

### CloudFront Configuration

```javascript
// CDK/CloudFormation example
const distribution = new cloudfront.Distribution(this, 'VideoDistribution', {
  defaultBehavior: {
    origin: new origins.S3Origin(videoBucket),
    
    // Cache policy
    cachePolicy: new cloudfront.CachePolicy(this, 'VideoCache', {
      cachePolicyName: 'VideoStreamingPolicy',
      
      // Cache TTL
      defaultTtl: Duration.days(7),
      minTtl: Duration.hours(1),
      maxTtl: Duration.days(365),
      
      // Query strings to include in cache key
      queryStringBehavior: cloudfront.CacheQueryStringBehavior.whitelist(
        'v'  // Version parameter
      ),
      
      // Headers
      headerBehavior: cloudfront.CacheHeaderBehavior.allowList(
        'Origin',
        'Access-Control-Request-Method',
        'Access-Control-Request-Headers'
      ),
      
      // Compression
      enableAcceptEncodingGzip: true,
      enableAcceptEncodingBrotli: true
    }),
    
    // Viewer protocol
    viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
    
    // Allowed methods
    allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
    
    // Origin request policy
    originRequestPolicy: cloudfront.OriginRequestPolicy.CORS_S3_ORIGIN
  },
  
  // Price class (где размещать edge locations)
  priceClass: cloudfront.PriceClass.PRICE_CLASS_100,  // NA + Europe
  
  // Custom domain
  domainNames: ['videos.example.com'],
  certificate: certificate,
  
  // Geo restriction (опционально)
  geoRestriction: cloudfront.GeoRestriction.allowlist('RU', 'US', 'GB')
});
```

### HLS Streaming через CloudFront

```javascript
// m3u8 manifest
// https://d1234.cloudfront.net/videos/abc123/master.m3u8

#EXTM3U
#EXT-X-VERSION:3
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360
360p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=1400000,RESOLUTION=842x480
480p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1280x720
720p.m3u8
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080
1080p.m3u8

// CloudFront автоматически кеширует:
// - master.m3u8 (TTL: 5 seconds - часто обновляется)
// - 720p.m3u8 (TTL: 60 seconds)
// - 720p-segment-001.ts (TTL: 1 hour - immutable)
```

**Cache Behavior по типу файла:**

```javascript
// Разные TTL для разных файлов
const behaviors = {
  // Manifests (часто меняются)
  '*.m3u8': {
    cacheTtl: 5,  // 5 секунд
    compress: true
  },
  
  // Segments (immutable)
  '*.ts': {
    cacheTtl: 86400,  // 24 hours
    compress: false  // Уже compressed video
  },
  
  // Thumbnails
  '*.jpg': {
    cacheTtl: 3600,  // 1 hour
    compress: true
  }
};
```

### CloudFront + Lambda@Edge

```javascript
// Изменение response headers для видео
export const handler = async (event) => {
  const response = event.Records[0].cf.response;
  const headers = response.headers;
  
  // CORS
  headers['access-control-allow-origin'] = [{ 
    key: 'Access-Control-Allow-Origin', 
    value: '*' 
  }];
  
  // Cache control
  if (response.uri.endsWith('.ts')) {
    headers['cache-control'] = [{ 
      key: 'Cache-Control', 
      value: 'public, max-age=31536000, immutable' 
    }];
  }
  
  // Security headers
  headers['x-content-type-options'] = [{ 
    key: 'X-Content-Type-Options', 
    value: 'nosniff' 
  }];
  
  return response;
};
```

## 4.3 RDS: Relational Database

### Архитектура для видео-платформы

```sql
-- Schema design

-- Videos table
CREATE TABLE videos (
  id VARCHAR(36) PRIMARY KEY,
  user_id VARCHAR(36) NOT NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  duration INT,  -- seconds
  status ENUM('uploading', 'processing', 'ready', 'failed'),
  
  -- S3 paths
  original_s3_key VARCHAR(512),
  hls_manifest_s3_key VARCHAR(512),
  thumbnail_s3_key VARCHAR(512),
  
  -- CloudFront URLs
  cdn_url VARCHAR(512),
  
  -- Metadata
  width INT,
  height INT,
  bitrate INT,
  codec VARCHAR(50),
  
  -- Timestamps
  uploaded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  processed_at TIMESTAMP NULL,
  published_at TIMESTAMP NULL,
  
  -- Indexing
  INDEX idx_user_id (user_id),
  INDEX idx_status (status),
  INDEX idx_published_at (published_at),
  
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Transcoding jobs
CREATE TABLE transcoding_jobs (
  id VARCHAR(36) PRIMARY KEY,
  video_id VARCHAR(36) NOT NULL,
  preset VARCHAR(50),  -- '720p', '1080p', 'hls'
  status ENUM('queued', 'running', 'completed', 'failed'),
  
  input_s3_key VARCHAR(512),
  output_s3_key VARCHAR(512),
  
  error_message TEXT,
  retry_count INT DEFAULT 0,
  
  started_at TIMESTAMP NULL,
  completed_at TIMESTAMP NULL,
  duration_ms INT,
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_video_id (video_id),
  INDEX idx_status (status),
  
  FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE
) ENGINE=InnoDB;

-- Analytics (time-series data)
CREATE TABLE video_views (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  video_id VARCHAR(36) NOT NULL,
  user_id VARCHAR(36),
  
  -- Playback metrics
  watched_duration INT,  -- seconds watched
  completed BOOLEAN,
  
  -- Client info
  ip_address VARCHAR(45),
  user_agent TEXT,
  country_code CHAR(2),
  
  -- CDN metrics
  cdn_cache_status ENUM('hit', 'miss', 'refresh'),
  cdn_edge_location VARCHAR(50),
  
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  
  INDEX idx_video_id (video_id),
  INDEX idx_created_at (created_at),
  
  FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE
) ENGINE=InnoDB;
```

### RDS Best Practices

**1. Connection Pooling**

```javascript
import mysql from 'mysql2/promise';

// ПЛОХО: Новое подключение на каждый запрос
async function getVideo(id) {
  const connection = await mysql.createConnection({
    host: 'db.example.com',
    user: 'app',
    password: 'secret',
    database: 'videos'
  });
  
  const [rows] = await connection.query('SELECT * FROM videos WHERE id = ?', [id]);
  await connection.end();
  
  return rows[0];
}
// Проблемы:
// - TCP handshake overhead
// - SSL negotiation каждый раз
// - Limit на connections (~150 default)

// ХОРОШО: Connection pool
const pool = mysql.createPool({
  host: 'db.example.com',
  user: 'app',
  password: 'secret',
  database: 'videos',
  
  connectionLimit: 10,  // Max connections
  waitForConnections: true,
  queueLimit: 0,
  
  // Reuse
  enableKeepAlive: true,
  keepAliveInitialDelay: 0
});

async function getVideo(id) {
  const [rows] = await pool.query('SELECT * FROM videos WHERE id = ?', [id]);
  return rows[0];
}
// Connection возвращается в pool автоматически
```

**2. Read Replicas для scaling**

```javascript
// Write to primary
const primaryPool = mysql.createPool({
  host: 'primary.db.example.com',
  ...
});

// Read from replica
const replicaPool = mysql.createPool({
  host: 'replica.db.example.com',
  ...
});

async function getVideos(userId) {
  // Read operations → replica
  const [rows] = await replicaPool.query(
    'SELECT * FROM videos WHERE user_id = ?',
    [userId]
  );
  return rows;
}

async function createVideo(data) {
  // Write operations → primary
  const [result] = await primaryPool.query(
    'INSERT INTO videos SET ?',
    [data]
  );
  return result.insertId;
}

// Важно: Replication lag
// После INSERT на primary, данные могут появиться на replica через 1-5 секунд
async function createAndRead(data) {
  const id = await createVideo(data);
  
  // ПЛОХО: Может не найти (replication lag)
  const video = await getVideo(id);  // Читает из replica
  
  // ХОРОШО: Читаем из primary сразу после записи
  const [rows] = await primaryPool.query(
    'SELECT * FROM videos WHERE id = ?',
    [id]
  );
  return rows[0];
}
```

**3. Query Optimization**

```sql
-- ПЛОХО: N+1 query problem
SELECT * FROM videos WHERE user_id = 'abc123';
-- Затем для каждого video:
SELECT COUNT(*) FROM video_views WHERE video_id = 'video1';
SELECT COUNT(*) FROM video_views WHERE video_id = 'video2';
...
-- 1 + N запросов

-- ХОРОШО: JOIN
SELECT 
  v.*,
  COUNT(vv.id) as view_count
FROM videos v
LEFT JOIN video_views vv ON v.id = vv.video_id
WHERE v.user_id = 'abc123'
GROUP BY v.id;
-- 1 запрос

-- EXPLAIN для анализа
EXPLAIN SELECT 
  v.*,
  COUNT(vv.id) as view_count
FROM videos v
LEFT JOIN video_views vv ON v.id = vv.video_id
WHERE v.user_id = 'abc123'
GROUP BY v.id;

-- Смотрим на:
-- - type: должен быть ref/eq_ref (НЕ ALL - full scan)
-- - key: используемый index (НЕ NULL)
-- - rows: количество проверенных строк (чем меньше, тем лучше)
```

**4. Partitioning для больших таблиц**

```sql
-- video_views растет быстро (миллионы строк)
-- Партицирование по месяцам

ALTER TABLE video_views
PARTITION BY RANGE (YEAR(created_at) * 100 + MONTH(created_at)) (
  PARTITION p202401 VALUES LESS THAN (202402),
  PARTITION p202402 VALUES LESS THAN (202403),
  PARTITION p202403 VALUES LESS THAN (202404),
  ...
  PARTITION p202412 VALUES LESS THAN (202501),
  PARTITION pmax VALUES LESS THAN MAXVALUE
);

-- Queries автоматически оптимизируются:
SELECT COUNT(*) 
FROM video_views 
WHERE created_at >= '2024-03-01' 
  AND created_at < '2024-04-01';
-- Проверяет только partition p202403

-- Удаление старых данных:
ALTER TABLE video_views DROP PARTITION p202401;
-- Быстрее чем DELETE (просто удаляет файлы)
```

---

*Это первая часть comprehensive guide. Продолжить со следующими разделами:*
- *5. Видеопротоколы: SRT/HLS*
- *6. DRM*
- *7. WebGL*
- *8. MySQL advanced*
- *9. Интеграция*
- *10. Edge Cases*

*Документ уже ~3000 строк. Продолжить?*
# 5. Видеопротоколы: SRT/HLS

## 5.1 HLS (HTTP Live Streaming)

### Что такое HLS?

**HLS** — это adaptive bitrate streaming protocol, разработанный Apple.

```
Принцип работы:

1. Видео разбивается на chunks (segments) по 2-10 секунд
2. Каждый chunk кодируется в нескольких качествах (360p, 720p, 1080p)
3. Создаются manifest файлы (.m3u8), описывающие сегменты
4. Клиент скачивает segments по HTTP, переключая качество на лету
```

### Структура HLS

```
video-abc123/
├── master.m3u8           ← Master playlist (список всех качеств)
├── 360p.m3u8             ← Media playlist для 360p
├── 360p-00001.ts         ← Video segment #1 (2 seconds)
├── 360p-00002.ts
├── 360p-00003.ts
├── ...
├── 720p.m3u8
├── 720p-00001.ts
├── 720p-00002.ts
└── ...
```

**master.m3u8:**

```m3u8
#EXTM3U
#EXT-X-VERSION:3

# 360p stream
#EXT-X-STREAM-INF:BANDWIDTH=800000,RESOLUTION=640x360,CODECS="avc1.42e00a,mp4a.40.2"
360p.m3u8

# 720p stream
#EXT-X-STREAM-INF:BANDWIDTH=2800000,RESOLUTION=1280x720,CODECS="avc1.4d401f,mp4a.40.2"
720p.m3u8

# 1080p stream
#EXT-X-STREAM-INF:BANDWIDTH=5000000,RESOLUTION=1920x1080,CODECS="avc1.640028,mp4a.40.2"
1080p.m3u8
```

**720p.m3u8:**

```m3u8
#EXTM3U
#EXT-X-VERSION:3
#EXT-X-TARGETDURATION:10
#EXT-X-MEDIA-SEQUENCE:0
#EXT-X-PLAYLIST-TYPE:VOD

#EXTINF:10.0,
720p-00001.ts
#EXTINF:10.0,
720p-00002.ts
#EXTINF:10.0,
720p-00003.ts
#EXTINF:5.5,
720p-00004.ts
#EXT-X-ENDLIST
```

### Генерация HLS с FFmpeg

```bash
# Input: video.mp4
# Output: HLS segments + manifests

ffmpeg -i video.mp4 \
  # 360p variant
  -vf scale=w=640:h=360:force_original_aspect_ratio=decrease \
  -c:a aac -ar 48000 -b:a 128k \
  -c:v h264 -profile:v main -crf 20 -g 48 -keyint_min 48 -sc_threshold 0 \
  -b:v 800k -maxrate 856k -bufsize 1200k \
  -hls_time 4 -hls_playlist_type vod -hls_segment_filename "360p_%03d.ts" \
  360p.m3u8 \
  \
  # 720p variant
  -vf scale=w=1280:h=720:force_original_aspect_ratio=decrease \
  -c:a aac -ar 48000 -b:a 128k \
  -c:v h264 -profile:v main -crf 20 -g 48 -keyint_min 48 -sc_threshold 0 \
  -b:v 2800k -maxrate 2996k -bufsize 4200k \
  -hls_time 4 -hls_playlist_type vod -hls_segment_filename "720p_%03d.ts" \
  720p.m3u8 \
  \
  # 1080p variant
  -vf scale=w=1920:h=1080:force_original_aspect_ratio=decrease \
  -c:a aac -ar 48000 -b:a 192k \
  -c:v h264 -profile:v high -crf 20 -g 48 -keyint_min 48 -sc_threshold 0 \
  -b:v 5000k -maxrate 5350k -bufsize 7500k \
  -hls_time 4 -hls_playlist_type vod -hls_segment_filename "1080p_%03d.ts" \
  1080p.m3u8

# Параметры объяснение:
# -g 48: GOP size (keyframe каждые 48 frames = 2 sec @ 24fps)
# -keyint_min 48: Минимум между keyframes
# -sc_threshold 0: Отключить scene change detection (для consistent segments)
# -hls_time 4: Длина каждого segment (4 seconds)
# -hls_playlist_type vod: Video On Demand (не live)
```

### HLS Playback на клиенте

```javascript
// Using HLS.js (поддержка HLS в не-Safari браузерах)
import Hls from 'hls.js';

const video = document.getElementById('video');
const videoSrc = 'https://cdn.example.com/videos/abc123/master.m3u8';

if (Hls.isSupported()) {
  const hls = new Hls({
    // Adaptive bitrate config
    debug: false,
    enableWorker: true,
    
    // Buffer settings
    maxBufferLength: 30,        // Max buffer (seconds)
    maxMaxBufferLength: 600,    // Absolute max
    
    // ABR (Adaptive Bitrate) settings
    abrEwmaDefaultEstimate: 500000,  // Initial bandwidth estimate (bps)
    abrEwmaFastLive: 3,
    abrEwmaSlowLive: 9,
    abrBandWidthFactor: 0.95,   // Safety factor (use 95% of bandwidth)
    abrBandWidthUpFactor: 0.7,  // Threshold to upgrade quality
    
    // Network settings
    manifestLoadingTimeOut: 10000,
    manifestLoadingMaxRetry: 3,
    levelLoadingTimeOut: 10000
  });
  
  hls.loadSource(videoSrc);
  hls.attachMedia(video);
  
  // Event listeners
  hls.on(Hls.Events.MANIFEST_PARSED, (event, data) => {
    console.log(`Loaded ${data.levels.length} quality levels`);
    video.play();
  });
  
  hls.on(Hls.Events.LEVEL_SWITCHED, (event, data) => {
    const level = hls.levels[data.level];
    console.log(`Switched to ${level.height}p (${level.bitrate} bps)`);
  });
  
  hls.on(Hls.Events.ERROR, (event, data) => {
    if (data.fatal) {
      switch (data.type) {
        case Hls.ErrorTypes.NETWORK_ERROR:
          console.error('Network error, trying to recover');
          hls.startLoad();
          break;
        case Hls.ErrorTypes.MEDIA_ERROR:
          console.error('Media error, trying to recover');
          hls.recoverMediaError();
          break;
        default:
          console.error('Fatal error, cannot recover');
          hls.destroy();
          break;
      }
    }
  });
  
} else if (video.canPlayType('application/vnd.apple.mpegurl')) {
  // Native HLS support (Safari)
  video.src = videoSrc;
}
```

### Adaptive Bitrate Algorithm (упрощенно)

```javascript
class SimpleABR {
  constructor() {
    this.bandwidthSamples = [];
    this.currentLevel = 0;
  }
  
  selectLevel(levels, downloadStats) {
    // 1. Измеряем bandwidth
    const bandwidth = this.measureBandwidth(downloadStats);
    
    // 2. Находим максимальное качество, которое можем поддержать
    let selectedLevel = 0;
    
    for (let i = 0; i < levels.length; i++) {
      const level = levels[i];
      
      // Safety factor: используем только 90% bandwidth
      if (level.bitrate <= bandwidth * 0.9) {
        selectedLevel = i;
      }
    }
    
    // 3. Hysteresis: не переключаем качество слишком часто
    if (selectedLevel > this.currentLevel) {
      // Upgrade: требуем stable bandwidth 3 секунды
      if (this.isStable(bandwidth, 3000)) {
        this.currentLevel = selectedLevel;
      }
    } else if (selectedLevel < this.currentLevel) {
      // Downgrade: сразу (buffer starving)
      this.currentLevel = selectedLevel;
    }
    
    return this.currentLevel;
  }
  
  measureBandwidth(stats) {
    const bps = (stats.loaded * 8) / stats.duration;  // bits per second
    
    this.bandwidthSamples.push(bps);
    if (this.bandwidthSamples.length > 5) {
      this.bandwidthSamples.shift();  // Keep last 5 samples
    }
    
    // Exponential weighted moving average
    let ewma = this.bandwidthSamples[0];
    for (let i = 1; i < this.bandwidthSamples.length; i++) {
      ewma = ewma * 0.7 + this.bandwidthSamples[i] * 0.3;
    }
    
    return ewma;
  }
  
  isStable(bandwidth, duration) {
    // Проверяем, что bandwidth стабилен последние N секунд
    // (упрощенная версия)
    return this.bandwidthSamples.every(sample =>
      Math.abs(sample - bandwidth) / bandwidth < 0.1  // <10% variance
    );
  }
}
```

## 5.2 SRT (Secure Reliable Transport)

### Что такое SRT?

**SRT** — это low-latency live streaming protocol для передачи видео через нестабильные сети (интернет).

**Сравнение с RTMP:**

| Feature | RTMP | SRT |
|---------|------|-----|
| Latency | 5-20 seconds | 0.5-3 seconds |
| Error recovery | TCP retransmission | ARQ + FEC |
| Firewall-friendly | ❌ (port 1935) | ✅ (любой UDP port) |
| Encryption | ❌ | ✅ (AES-128/256) |
| Packet loss handling | ❌ (зависает) | ✅ (восстанавливает) |

### SRT Use Cases

1. **Live event streaming** (концерты, спорт)
2. **Remote production** (удаленные камеры)
3. **Contribution feeds** (доставка в data center)
4. **Streaming через сотовые сети** (4G/5G bonding)

### SRT Stream с FFmpeg

```bash
# Sender (кодирование и отправка)
ffmpeg -i input.mp4 \
  -c:v libx264 -preset veryfast -tune zerolatency \
  -b:v 3000k -maxrate 3000k -bufsize 6000k \
  -g 60 -keyint_min 60 \
  -c:a aac -b:a 128k \
  -f mpegts \
  "srt://receiver.example.com:9000?pkt_size=1316&latency=200&mode=caller"

# Receiver (прием и декодирование)
ffmpeg -i "srt://0.0.0.0:9000?mode=listener&latency=200" \
  -c copy output.ts

# SRT параметры:
# - pkt_size=1316: MTU size (1500 - IP/UDP headers)
# - latency=200: Буфер для восстановления пакетов (200ms)
# - mode=caller/listener: Initiator vs receiver
# - passphrase=secret: Encryption key (AES-256)
```

### SRT в Node.js

```javascript
// Using srt-node (native bindings)
import SRT from 'srt-node';

// SRT Server (принимает streams)
class SRTServer {
  constructor(port = 9000) {
    this.port = port;
    this.socket = SRT.createSocket(false);  // non-blocking
    
    this.socket.bind('0.0.0.0', port);
    this.socket.listen(1);  // Max 1 connection (можно больше)
    
    console.log(`SRT server listening on port ${port}`);
    
    this.acceptConnections();
  }
  
  async acceptConnections() {
    while (true) {
      const client = await this.socket.accept();
      console.log('New SRT connection');
      
      this.handleClient(client);
    }
  }
  
  async handleClient(client) {
    try {
      while (true) {
        const chunk = await client.read(1316);  // MTU size
        
        if (!chunk) {
          break;  // Connection closed
        }
        
        // Process video data
        await this.processChunk(chunk);
      }
    } catch (error) {
      console.error('Client error:', error);
    } finally {
      client.close();
    }
  }
  
  async processChunk(chunk) {
    // Chunk = MPEG-TS data
    // Parse TS packets, extract video/audio
    // Feed to transcoder or save to file
    
    // Example: Save to file
    fs.appendFileSync('stream.ts', chunk);
  }
}

// SRT Client (отправляет stream)
class SRTClient {
  constructor(host, port) {
    this.socket = SRT.createSocket(true);  // blocking
    
    // Connect with latency
    this.socket.connect(host, port, {
      latency: 200,  // 200ms buffer
      maxBW: 10000000,  // 10 Mbps max bandwidth
      passphrase: 'my-secret-key'  // Encryption
    });
    
    console.log(`Connected to ${host}:${port}`);
  }
  
  send(data) {
    return this.socket.write(data);
  }
  
  close() {
    this.socket.close();
  }
}

// Usage
const server = new SRTServer(9000);

// In another process:
const client = new SRTClient('receiver.example.com', 9000);
const stream = fs.createReadStream('video.ts', { highWaterMark: 1316 });

stream.on('data', (chunk) => {
  client.send(chunk);
});
```

### SRT Error Recovery

```
SRT использует ARQ (Automatic Repeat Request):

Time →
Sender:   [Packet 1] [Packet 2] [Packet 3] [Packet 4] [Packet 5]
              ↓          ↓          ✗          ↓          ↓
              ↓          ↓     (lost)         ↓          ↓
Receiver: [Packet 1] [Packet 2]  ...     [Packet 4] [Packet 5]
                                  ↑
                            [NAK for #3]
                                  ↓
Sender:                    [Retransmit #3]
                                  ↓
Receiver:                  [Packet 3] ← Recovered!

Latency buffer: 200ms дает время на retransmission
```

**Packet Loss Concealment:**

```javascript
// Когда пакет потерян безвозвратно
class VideoDecoder {
  handleLostPacket(packetNum) {
    // Стратегии:
    
    // 1. Frame freezing (показываем предыдущий frame)
    this.repeatLastFrame();
    
    // 2. Interpolation (усредняем соседние frames)
    this.interpolateFrames(packetNum - 1, packetNum + 1);
    
    // 3. Error concealment (заполняем artifacts from neighboring blocks)
    this.concealErrors(packetNum);
  }
}
```

## 5.3 HLS vs SRT: Когда что использовать

```
┌─────────────────────────────────────────────────────────┐
│                    Use Case Matrix                      │
└─────────────────────────────────────────────────────────┘

HLS (HTTP Live Streaming):
✅ VOD (video on demand)
✅ Large-scale distribution (миллионы зрителей)
✅ Когда latency не критична (10-30 seconds OK)
✅ CDN-friendly (CloudFront, Cloudflare)
✅ Работает везде (Safari, Android, Smart TV)
❌ Live events с interaction (комментарии, ставки)

SRT (Secure Reliable Transport):
✅ Live broadcasting (<3 seconds latency)
✅ Remote production (camera feeds)
✅ Unstable networks (4G, satellite)
✅ Point-to-point contribution
✅ Когда нужна encryption
❌ Large-scale distribution (требует медиасервер)

Гибридная архитектура (типичная):
1. Camera → SRT → Ingest server (low latency)
2. Ingest → Transcoder → HLS (for distribution)
3. HLS → CDN → End users (scalability)

            SRT (200ms)          HLS (15s)
[Camera] ──────────────→ [Server] ──────────→ [CDN] → Users
         low latency              scalable
```

---

# 6. DRM: Digital Rights Management

## 6.1 Зачем нужен DRM?

**Проблема:**
```
Без DRM:
User → Download video.mp4 → Save to disk → Share on torrent
       ❌ Нет контроля
       ❌ Пиратство
       ❌ Потеря revenue
```

**С DRM:**
```
User → Request encrypted video → License server validates → Play in browser
       ✅ Encrypted content
       ✅ License expiration
       ✅ Device binding
       ❌ Cannot save raw video
```

## 6.2 DRM Systems

### Основные стандарты

```
┌──────────────────────────────────────────────────────┐
│              DRM Ecosystem                           │
└──────────────────────────────────────────────────────┘

1. Widevine (Google)
   - Chrome, Android, ChromeOS
   - Levels: L1 (hardware), L2, L3 (software)
   - Key provider: Google

2. FairPlay (Apple)
   - Safari, iOS, tvOS
   - Requires Apple Developer account
   - Key provider: Apple

3. PlayReady (Microsoft)
   - Edge, Xbox, Windows
   - Enterprise DRM
   - Key provider: Microsoft

Multi-DRM: Комбинация всех трех для покрытия всех платформ
```

### Widevine Architecture

```
┌────────────────────────────────────────────────────┐
│              Widevine Flow                         │
└────────────────────────────────────────────────────┘

1. Content Preparation:
   [Original Video] → [Widevine Packager] → [Encrypted Video]
                              ↓
                       [Content Keys]
                              ↓
                    [Key Management System]

2. Playback:
   [Browser] → Request video → [CDN] → Encrypted chunks
       ↓
   [EME API] → Request license → [License Server]
                                        ↓
                                  [Validates user]
                                        ↓
                                  [Returns license]
       ↓
   [CDM (Content Decryption Module)] → Decrypt → Play
```

### Encrypted DASH (MPEG-DASH with CENC)

```xml
<!-- manifest.mpd -->
<MPD xmlns="urn:mpeg:dash:schema:mpd:2011">
  <Period>
    <AdaptationSet mimeType="video/mp4" codecs="avc1.4d401f">
      
      <!-- Content Protection (Widevine) -->
      <ContentProtection 
        schemeIdUri="urn:uuid:edef8ba9-79d6-4ace-a3c8-27dcd51d21ed"
        value="Widevine">
        <cenc:pssh>AAAA2HBzc2gAAAAA7e+LqXnWSs6jyCfc1R0h7QAAALgSEAAA...</cenc:pssh>
      </ContentProtection>
      
      <!-- Content Protection (PlayReady) -->
      <ContentProtection 
        schemeIdUri="urn:uuid:9a04f079-9840-4286-ab92-e65be0885f95"
        value="PlayReady">
        <cenc:pssh>AAADYnBzc2gAAAAAmgTweZhAQoarkuZb4IhflQAAA0ICAAAB...</cenc:pssh>
      </ContentProtection>
      
      <Representation id="720p" bandwidth="2800000" width="1280" height="720">
        <SegmentTemplate 
          media="720p-$Number$.m4s" 
          initialization="720p-init.mp4" 
          duration="4" 
          startNumber="1"/>
      </Representation>
    </AdaptationSet>
  </Period>
</MPD>
```

### License Server Implementation

```javascript
// Express license server
import express from 'express';
import crypto from 'crypto';

const app = express();

// Widevine license endpoint
app.post('/widevine/license', async (req, res) => {
  // 1. Parse license request
  const licenseRequest = req.body;  // Protobuf binary
  
  // 2. Validate user (JWT, session, etc.)
  const userId = await validateUser(req.headers.authorization);
  
  if (!userId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  // 3. Check entitlement (does user have access?)
  const videoId = extractVideoId(licenseRequest);
  const hasAccess = await checkAccess(userId, videoId);
  
  if (!hasAccess) {
    return res.status(403).json({ error: 'No access to this content' });
  }
  
  // 4. Get content keys from KMS
  const contentKey = await getContentKey(videoId);
  
  // 5. Build license response
  const license = buildWidevineKeyResponse({
    contentKey,
    policy: {
      canPlay: true,
      canPersist: false,  // Offline viewing
      rentalDuration: 86400,  // 24 hours
      playbackDuration: 7200,  // 2 hours
      licenseDuration: 604800  // 7 days
    }
  });
  
  // 6. Sign license with Widevine provider key
  const signedLicense = signLicense(license, WIDEVINE_PROVIDER_KEY);
  
  res.set('Content-Type', 'application/octet-stream');
  res.send(signedLicense);
});

// Key Management System (KMS)
class KMS {
  async getContentKey(videoId) {
    // В реальности: HSM (Hardware Security Module) или AWS KMS
    
    // 1. Retrieve encrypted key from database
    const encryptedKey = await db.query(
      'SELECT encrypted_key FROM video_keys WHERE video_id = ?',
      [videoId]
    );
    
    // 2. Decrypt using master key
    const masterKey = await this.getMasterKey();
    const contentKey = this.decrypt(encryptedKey, masterKey);
    
    return contentKey;
  }
  
  decrypt(encryptedKey, masterKey) {
    const decipher = crypto.createDecipheriv(
      'aes-256-gcm',
      masterKey,
      encryptedKey.iv
    );
    
    decipher.setAuthTag(encryptedKey.authTag);
    
    let decrypted = decipher.update(encryptedKey.data, null, 'hex');
    decrypted += decipher.final('hex');
    
    return Buffer.from(decrypted, 'hex');
  }
}
```

### FairPlay Streaming (HLS + DRM)

```javascript
// FairPlay requires Apple FPS SDK

// Client-side (Safari/iOS)
const video = document.getElementById('video');
const contentId = 'video-abc123';
const certificateUrl = 'https://license.example.com/fairplay/cert';
const licenseUrl = 'https://license.example.com/fairplay/license';

// 1. Load FairPlay certificate
const certificate = await fetch(certificateUrl).then(r => r.arrayBuffer());

// 2. Handle encrypted event
video.addEventListener('encrypted', async (event) => {
  const initData = event.initData;
  const contentId = extractContentId(initData);
  
  // 3. Create WebKitMediaKeys
  const mediaKeys = new WebKitMediaKeys('com.apple.fps.1_0');
  video.webkitSetMediaKeys(mediaKeys);
  
  // 4. Create key session
  const keySession = mediaKeys.createSession('video/mp4', initData);
  
  // 5. Handle key message
  keySession.addEventListener('webkitkeymessage', async (event) => {
    const message = event.message;
    
    // 6. Send SPC (Server Playback Context) to license server
    const response = await fetch(licenseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/octet-stream'
      },
      body: message
    });
    
    // 7. Receive CKC (Content Key Context)
    const license = await response.arrayBuffer();
    
    // 8. Update key session with license
    keySession.update(new Uint8Array(license));
  });
});

// 9. Load video
video.src = 'https://cdn.example.com/video-abc123/master.m3u8';
video.play();
```

### DRM Content Packaging

```bash
# Shaka Packager (open-source DRM packager)

# Input: clear video
# Output: encrypted DASH + HLS

packager \
  # Input
  input=video.mp4,stream=video,output=video.mp4 \
  input=video.mp4,stream=audio,output=audio.mp4 \
  \
  # DASH output
  --mpd_output manifest.mpd \
  \
  # HLS output
  --hls_master_playlist_output master.m3u8 \
  \
  # Encryption
  --enable_raw_key_encryption \
  --keys label=AUDIO:key_id=<audio_key_id>:key=<audio_key>,label=SD:key_id=<sd_key_id>:key=<sd_key> \
  \
  # Widevine
  --protection_scheme cbcs \
  --widevine_encryption \
  --widevine_server_url https://license.widevine.com/cenc/getcontentkey/widevine_test \
  --content_id <content_id> \
  \
  # FairPlay
  --fairplay_key_uri skd://fairplay.example.com

# Результат:
# - manifest.mpd (DASH manifest with Widevine/PlayReady)
# - master.m3u8 (HLS manifest with FairPlay)
# - video.mp4 (encrypted video segments)
# - audio.mp4 (encrypted audio segments)
```

## 6.3 DRM Edge Cases & Pain Points

### 1. Offline Playback

```javascript
// Widevine Persistent License (для offline viewing)

// Request persistent license
const config = [{
  initDataTypes: ['cenc'],
  videoCapabilities: [{
    contentType: 'video/mp4; codecs="avc1.42E01E"',
    robustness: 'SW_SECURE_CRYPTO'  // L3
  }],
  persistentState: 'required',  // ← Ключевое
  sessionTypes: ['persistent-license']  // ← Ключевое
}];

navigator.requestMediaKeySystemAccess('com.widevine.alpha', config)
  .then(keySystemAccess => {
    return keySystemAccess.createMediaKeys();
  })
  .then(mediaKeys => {
    video.setMediaKeys(mediaKeys);
    
    // Create persistent session
    const session = mediaKeys.createSession('persistent-license');
    
    // ... license flow ...
    
    // Save session ID
    session.addEventListener('keystatuseschange', () => {
      if (session.sessionId) {
        localStorage.setItem('drmSessionId', session.sessionId);
      }
    });
  });

// Later: Load from persistent session
const sessionId = localStorage.getItem('drmSessionId');
const session = mediaKeys.createSession('persistent-license');
await session.load(sessionId);

// Проблемы:
// ❌ Работает только на Android (iOS не поддерживает)
// ❌ Требует license renewal (обычно каждые 30 дней)
// ❌ User может перенести устройство на другой аккаунт
```

### 2. HDCP (High-bandwidth Digital Content Protection)

```
Проблема: Widevine L1 (hardware DRM) требует HDCP-compliant путь:

┌─────────┐   HDCP    ┌─────────┐   HDCP    ┌─────────┐
│ Browser │─────────→│  GPU    │─────────→│ Monitor │
└─────────┘           └─────────┘           └─────────┘

Если любой компонент не поддерживает HDCP:
→ Fallback to Widevine L3 (software DRM)
→ Max resolution: 540p (ограничение Widevine)

Детектирование:
```

```javascript
navigator.requestMediaKeySystemAccess('com.widevine.alpha', [{
  videoCapabilities: [{
    contentType: 'video/mp4; codecs="avc1.42E01E"',
    robustness: 'HW_SECURE_ALL'  // L1 - требует HDCP
  }]
}]).then(() => {
  console.log('L1 available (1080p+ possible)');
}).catch(() => {
  // Fallback to L3
  return navigator.requestMediaKeySystemAccess('com.widevine.alpha', [{
    videoCapabilities: [{
      contentType: 'video/mp4; codecs="avc1.42E01E"',
      robustness: 'SW_SECURE_CRYPTO'  // L3
    }]
  }]);
}).then(() => {
  console.log('L3 only (max 540p)');
});
```

### 3. Concurrent Streams Limit

```javascript
// License server должен трекать активные сессии

class LicenseServer {
  async issueLicense(userId, videoId, deviceId) {
    // 1. Check concurrent streams
    const activeSessions = await db.query(`
      SELECT COUNT(*) as count
      FROM active_sessions
      WHERE user_id = ? AND expires_at > NOW()
    `, [userId]);
    
    const maxConcurrent = await getUserPlan(userId);  // Free: 1, Premium: 4
    
    if (activeSessions.count >= maxConcurrent) {
      throw new Error(`Max ${maxConcurrent} streams reached`);
    }
    
    // 2. Create session
    const sessionId = uuid();
    await db.query(`
      INSERT INTO active_sessions (id, user_id, video_id, device_id, expires_at)
      VALUES (?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 4 HOUR))
    `, [sessionId, userId, videoId, deviceId]);
    
    // 3. Issue license with session ID
    return buildLicense({
      sessionId,
      expiresIn: 14400  // 4 hours
    });
  }
  
  // Heartbeat endpoint (player calls every 30 seconds)
  async heartbeat(sessionId) {
    await db.query(`
      UPDATE active_sessions
      SET last_heartbeat = NOW()
      WHERE id = ?
    `, [sessionId]);
  }
  
  // Cleanup stale sessions (cron job)
  async cleanupStaleSessions() {
    // Remove sessions without heartbeat for >5 minutes
    await db.query(`
      DELETE FROM active_sessions
      WHERE last_heartbeat < DATE_SUB(NOW(), INTERVAL 5 MINUTE)
    `);
  }
}
```

### 4. Cross-Browser Compatibility Nightmare

```javascript
// EME (Encrypted Media Extensions) implementation различается

const CONFIG_SAFARI = {
  initDataTypes: ['skd'],  // FairPlay specific
  videoCapabilities: [{
    contentType: 'application/vnd.apple.mpegurl'
  }]
};

const CONFIG_CHROME = {
  initDataTypes: ['cenc'],  // Widevine
  videoCapabilities: [{
    contentType: 'video/mp4; codecs="avc1.42E01E"'
  }]
};

const CONFIG_EDGE = {
  initDataTypes: ['cenc'],  // PlayReady
  videoCapabilities: [{
    contentType: 'video/mp4; codecs="avc1.42E01E"'
  }]
};

// Detection hell
function getDRMConfig() {
  const userAgent = navigator.userAgent;
  
  if (/Safari/.test(userAgent) && !/Chrome/.test(userAgent)) {
    return { system: 'com.apple.fps.1_0', config: CONFIG_SAFARI };
  } else if (/Chrome/.test(userAgent)) {
    return { system: 'com.widevine.alpha', config: CONFIG_CHROME };
  } else if (/Edge/.test(userAgent)) {
    return { system: 'com.microsoft.playready', config: CONFIG_EDGE };
  }
  
  throw new Error('DRM not supported');
}
```

---

# 7. WebGL для видео

## 7.1 Зачем WebGL для видео?

**Canvas 2D Context проблемы:**
```javascript
// ПЛОХО: Медленно для обработки каждого frame
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');
const video = document.getElementById('video');

function processFrame() {
  // 1. Draw video to canvas
  ctx.drawImage(video, 0, 0);
  
  // 2. Get pixel data
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const pixels = imageData.data;  // RGBA array
  
  // 3. Apply filter (grayscale)
  for (let i = 0; i < pixels.length; i += 4) {
    const gray = 0.299 * pixels[i] + 0.587 * pixels[i+1] + 0.114 * pixels[i+2];
    pixels[i] = pixels[i+1] = pixels[i+2] = gray;
  }
  
  // 4. Put back
  ctx.putImageData(imageData, 0, 0);
  
  requestAnimationFrame(processFrame);
}

// Проблема: CPU-bound, ~5-10 FPS на 1080p
```

**WebGL решение:**
```javascript
// ХОРОШО: GPU-accelerated, 60 FPS
const gl = canvas.getContext('webgl2');

// Shader для grayscale
const fragmentShader = `
  precision mediump float;
  uniform sampler2D uTexture;
  varying vec2 vTexCoord;
  
  void main() {
    vec4 color = texture2D(uTexture, vTexCoord);
    float gray = dot(color.rgb, vec3(0.299, 0.587, 0.114));
    gl_FragColor = vec4(vec3(gray), color.a);
  }
`;

// Каждый frame: просто upload texture и render
function processFrame() {
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
  requestAnimationFrame(processFrame);
}

// Результат: 60 FPS на 4K
```

## 7.2 WebGL Video Pipeline

### Setup

```javascript
class WebGLVideoRenderer {
  constructor(canvas, video) {
    this.canvas = canvas;
    this.video = video;
    this.gl = canvas.getContext('webgl2');
    
    if (!this.gl) {
      throw new Error('WebGL2 not supported');
    }
    
    this.setupShaders();
    this.setupGeometry();
    this.setupTexture();
  }
  
  setupShaders() {
    const gl = this.gl;
    
    // Vertex shader (определяет позиции)
    const vertexShaderSource = `
      attribute vec2 aPosition;
      attribute vec2 aTexCoord;
      varying vec2 vTexCoord;
      
      void main() {
        gl_Position = vec4(aPosition, 0.0, 1.0);
        vTexCoord = aTexCoord;
      }
    `;
    
    // Fragment shader (определяет цвета пикселей)
    const fragmentShaderSource = `
      precision mediump float;
      uniform sampler2D uTexture;
      varying vec2 vTexCoord;
      
      void main() {
        gl_FragColor = texture2D(uTexture, vTexCoord);
      }
    `;
    
    // Compile shaders
    const vertexShader = this.compileShader(vertexShaderSource, gl.VERTEX_SHADER);
    const fragmentShader = this.compileShader(fragmentShaderSource, gl.FRAGMENT_SHADER);
    
    // Link program
    this.program = gl.createProgram();
    gl.attachShader(this.program, vertexShader);
    gl.attachShader(this.program, fragmentShader);
    gl.linkProgram(this.program);
    
    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS)) {
      throw new Error('Program link failed: ' + gl.getProgramInfoLog(this.program));
    }
    
    gl.useProgram(this.program);
    
    // Get attribute/uniform locations
    this.aPosition = gl.getAttribLocation(this.program, 'aPosition');
    this.aTexCoord = gl.getAttribLocation(this.program, 'aTexCoord');
    this.uTexture = gl.getUniformLocation(this.program, 'uTexture');
  }
  
  setupGeometry() {
    const gl = this.gl;
    
    // Quad vertices (2 triangles forming rectangle)
    const vertices = new Float32Array([
      // Position    // TexCoord
      -1.0,  1.0,    0.0, 0.0,  // Top-left
      -1.0, -1.0,    0.0, 1.0,  // Bottom-left
       1.0, -1.0,    1.0, 1.0,  // Bottom-right
       
      -1.0,  1.0,    0.0, 0.0,  // Top-left
       1.0, -1.0,    1.0, 1.0,  // Bottom-right
       1.0,  1.0,    1.0, 0.0   // Top-right
    ]);
    
    const buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    
    // Setup attributes
    gl.enableVertexAttribArray(this.aPosition);
    gl.vertexAttribPointer(this.aPosition, 2, gl.FLOAT, false, 16, 0);
    
    gl.enableVertexAttribArray(this.aTexCoord);
    gl.vertexAttribPointer(this.aTexCoord, 2, gl.FLOAT, false, 16, 8);
  }
  
  setupTexture() {
    const gl = this.gl;
    
    this.texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    
    // Texture parameters
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  }
  
  render() {
    const gl = this.gl;
    
    // Upload video frame to texture
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.texImage2D(
      gl.TEXTURE_2D, 
      0, 
      gl.RGBA, 
      gl.RGBA, 
      gl.UNSIGNED_BYTE, 
      this.video  // ← Video element as texture source
    );
    
    // Clear and render
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
  
  compileShader(source, type) {
    const gl = this.gl;
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(shader);
      gl.deleteShader(shader);
      throw new Error('Shader compilation failed: ' + info);
    }
    
    return shader;
  }
}

// Usage
const video = document.getElementById('video');
const canvas = document.getElementById('canvas');
const renderer = new WebGLVideoRenderer(canvas, video);

function animate() {
  renderer.render();
  requestAnimationFrame(animate);
}

video.addEventListener('play', () => {
  animate();
});
```

## 7.3 Video Effects с Shaders

### Эффект: Brightness/Contrast

```glsl
// fragment shader
precision mediump float;
uniform sampler2D uTexture;
uniform float uBrightness;  // -1.0 to 1.0
uniform float uContrast;    // 0.0 to 2.0
varying vec2 vTexCoord;

void main() {
  vec4 color = texture2D(uTexture, vTexCoord);
  
  // Apply brightness
  color.rgb += uBrightness;
  
  // Apply contrast
  color.rgb = (color.rgb - 0.5) * uContrast + 0.5;
  
  gl_FragColor = color;
}
```

```javascript
// JavaScript control
const brightnessSlider = document.getElementById('brightness');
const contrastSlider = document.getElementById('contrast');

brightnessSlider.addEventListener('input', (e) => {
  const value = parseFloat(e.target.value);  // -1.0 to 1.0
  
  gl.uniform1f(gl.getUniformLocation(program, 'uBrightness'), value);
});

contrastSlider.addEventListener('input', (e) => {
  const value = parseFloat(e.target.value);  // 0.0 to 2.0
  
  gl.uniform1f(gl.getUniformLocation(program, 'uContrast'), value);
});
```

### Эффект: Chroma Key (Green Screen)

```glsl
precision mediump float;
uniform sampler2D uTexture;
uniform vec3 uKeyColor;      // RGB color to remove (e.g. green)
uniform float uThreshold;    // Similarity threshold
varying vec2 vTexCoord;

void main() {
  vec4 color = texture2D(uTexture, vTexCoord);
  
  // Calculate distance from key color
  float dist = distance(color.rgb, uKeyColor);
  
  // If close to key color, make transparent
  float alpha = smoothstep(uThreshold - 0.1, uThreshold, dist);
  
  gl_FragColor = vec4(color.rgb, color.a * alpha);
}
```

```javascript
// Remove green (#00FF00)
gl.uniform3f(
  gl.getUniformLocation(program, 'uKeyColor'),
  0.0, 1.0, 0.0  // RGB normalized
);

gl.uniform1f(
  gl.getUniformLocation(program, 'uThreshold'),
  0.4  // Adjust for cleaner keying
);
```

### Эффект: Blur (Gaussian)

```glsl
// Требует multi-pass rendering
precision mediump float;
uniform sampler2D uTexture;
uniform vec2 uDirection;  // (1.0, 0.0) for horizontal, (0.0, 1.0) for vertical
uniform vec2 uResolution;
varying vec2 vTexCoord;

void main() {
  vec2 texelSize = 1.0 / uResolution;
  vec4 color = vec4(0.0);
  
  // Gaussian kernel weights
  float weights[5];
  weights[0] = 0.227027;
  weights[1] = 0.1945946;
  weights[2] = 0.1216216;
  weights[3] = 0.054054;
  weights[4] = 0.016216;
  
  // Center pixel
  color += texture2D(uTexture, vTexCoord) * weights[0];
  
  // Blur in direction
  for (int i = 1; i < 5; i++) {
    vec2 offset = float(i) * texelSize * uDirection;
    color += texture2D(uTexture, vTexCoord + offset) * weights[i];
    color += texture2D(uTexture, vTexCoord - offset) * weights[i];
  }
  
  gl_FragColor = color;
}
```

```javascript
// Two-pass blur for performance
class BlurRenderer {
  constructor(gl, width, height) {
    this.gl = gl;
    
    // Create framebuffers for ping-pong
    this.fbo1 = this.createFramebuffer(width, height);
    this.fbo2 = this.createFramebuffer(width, height);
  }
  
  render(inputTexture) {
    const gl = this.gl;
    
    // Pass 1: Horizontal blur (input → fbo1)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo1.framebuffer);
    gl.uniform2f(this.uDirection, 1.0, 0.0);  // Horizontal
    gl.bindTexture(gl.TEXTURE_2D, inputTexture);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    
    // Pass 2: Vertical blur (fbo1 → fbo2)
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo2.framebuffer);
    gl.uniform2f(this.uDirection, 0.0, 1.0);  // Vertical
    gl.bindTexture(gl.TEXTURE_2D, this.fbo1.texture);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    
    // Final: Render to screen
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, this.fbo2.texture);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
}
```

## 7.4 Performance Optimization

### 1. Texture Reuse

```javascript
// ПЛОХО: Создаем texture каждый frame
function render() {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
  // ... render ...
  gl.deleteTexture(texture);  // Leak prevention
}

// ХОРОШО: Reuse texture
const texture = gl.createTexture();

function render() {
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
  // ... render ...
}
```

### 2. PixelFormat Optimization

```javascript
// Video часто в YUV format, не RGB

// ПЛОХО: Browser converts YUV → RGBA (slow)
gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);

// ХОРОШО: Upload YUV planes separately (WebGL2 only)
const yTexture = gl.createTexture();
const uTexture = gl.createTexture();
const vTexture = gl.createTexture();

// Upload Y plane
gl.activeTexture(gl.TEXTURE0);
gl.bindTexture(gl.TEXTURE_2D, yTexture);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, width, height, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, yPlane);

// Upload U plane
gl.activeTexture(gl.TEXTURE1);
gl.bindTexture(gl.TEXTURE_2D, uTexture);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, width/2, height/2, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, uPlane);

// Upload V plane
gl.activeTexture(gl.TEXTURE2);
gl.bindTexture(gl.TEXTURE_2D, vTexture);
gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, width/2, height/2, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, vPlane);

// Fragment shader: YUV → RGB conversion
const fragmentShader = `
  precision mediump float;
  uniform sampler2D yTexture;
  uniform sampler2D uTexture;
  uniform sampler2D vTexture;
  varying vec2 vTexCoord;
  
  void main() {
    float y = texture2D(yTexture, vTexCoord).r;
    float u = texture2D(uTexture, vTexCoord).r - 0.5;
    float v = texture2D(vTexture, vTexCoord).r - 0.5;
    
    float r = y + 1.402 * v;
    float g = y - 0.344 * u - 0.714 * v;
    float b = y + 1.772 * u;
    
    gl_FragColor = vec4(r, g, b, 1.0);
  }
`;
```

### 3. Избегайте State Changes

```javascript
// ПЛОХО: Много state changes
for (let i = 0; i < objects.length; i++) {
  gl.useProgram(objects[i].program);  // Expensive
  gl.bindTexture(gl.TEXTURE_2D, objects[i].texture);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
}

// ХОРОШО: Batch by program/texture
const batches = groupBy(objects, obj => obj.program);

for (const [program, batch] of batches) {
  gl.useProgram(program);  // Once per batch
  
  for (const obj of batch) {
    gl.bindTexture(gl.TEXTURE_2D, obj.texture);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
  }
}
```

---

**Comprehensive Guide продолжение следует:**
- 8. MySQL в высоконагруженных системах
- 9. Интеграция всех компонентов
- 10. Edge Cases и Production Pain Points

**Текущий объем: ~4500 строк**

Продолжить с разделами 8-10?

# 8. MySQL в высоконагруженных системах

## 8.1 Оптимизация Queries

### EXPLAIN Analysis

```sql
-- Проблемный запрос
SELECT v.*, u.username, COUNT(vv.id) as views
FROM videos v
JOIN users u ON v.user_id = u.id
LEFT JOIN video_views vv ON v.id = vv.video_id
WHERE v.status = 'ready'
  AND v.published_at > DATE_SUB(NOW(), INTERVAL 7 DAY)
GROUP BY v.id
ORDER BY views DESC
LIMIT 10;

-- EXPLAIN показывает:
+----+-------------+-------+------+---------------+------+---------+------+-------+-------------+
| id | select_type | table | type | possible_keys | key  | key_len | ref  | rows  | Extra       |
+----+-------------+-------+------+---------------+------+---------+------+-------+-------------+
|  1 | SIMPLE      | v     | ALL  | NULL          | NULL | NULL    | NULL | 50000 | Using where |
|  1 | SIMPLE      | u     | ALL  | NULL          | NULL | NULL    | NULL | 10000 | Using where |
|  1 | SIMPLE      | vv    | ALL  | NULL          | NULL | NULL    | NULL | 1M    | Using where |
+----+-------------+-------+------+---------------+------+---------+------+-------+-------------+

-- Проблемы:
-- 1. type = ALL (full table scan)
-- 2. rows = 50K + 10K + 1M (проверяет 1.06M строк!)
-- 3. key = NULL (индексы не используются)
```

**Решение: Добавляем индексы**

```sql
-- Composite index для WHERE clause
CREATE INDEX idx_videos_status_published 
ON videos(status, published_at);

-- Index для JOIN
CREATE INDEX idx_video_views_video_id 
ON video_views(video_id);

-- EXPLAIN после индексов:
+----+-------------+-------+--------+---------------------------+-----------+---------+------+------+-------------+
| id | select_type | table | type   | possible_keys             | key       | key_len | ref  | rows | Extra       |
+----+-------------+-------+--------+---------------------------+-----------+---------+------+------+-------------+
|  1 | SIMPLE      | v     | range  | idx_videos_status_pub     | idx_...   | 10      | NULL | 150  | Using index |
|  1 | SIMPLE      | u     | eq_ref | PRIMARY                   | PRIMARY   | 36      | v.id | 1    | NULL        |
|  1 | SIMPLE      | vv    | ref    | idx_video_views_video_id  | idx_...   | 36      | v.id | 10   | Using index |
+----+-------------+-------+--------+---------------------------+-----------+---------+------+------+-------------+

-- Результат:
-- rows: 1.06M → 150 (improvement: 7000x!)
-- type: ALL → range/eq_ref/ref (using indexes)
-- Execution time: 5000ms → 50ms
```

### Covering Index

```sql
-- Query
SELECT id, title, published_at 
FROM videos
WHERE user_id = 'abc123' AND status = 'ready'
ORDER BY published_at DESC;

-- ПЛОХО: Index только на (user_id, status)
CREATE INDEX idx_user_status ON videos(user_id, status);
-- MySQL должен:
-- 1. Use index для WHERE
-- 2. Fetch rows from table (random I/O)
-- 3. Sort (filesort)

-- ХОРОШО: Covering index (все колонки в индексе)
CREATE INDEX idx_user_status_published_covering 
ON videos(user_id, status, published_at, id, title);

-- MySQL:
-- 1. Use index для WHERE
-- 2. Data уже в индексе (no table lookup!)
-- 3. No sort needed (index already sorted)

EXPLAIN показывает "Using index" в Extra колонке
```

### Denormalization для читаемости

```sql
-- ПЛОХО: JOIN на каждый SELECT
SELECT 
  v.*,
  u.username,
  COUNT(DISTINCT vv.id) as view_count,
  COUNT(DISTINCT c.id) as comment_count
FROM videos v
JOIN users u ON v.user_id = u.id
LEFT JOIN video_views vv ON v.id = vv.video_id
LEFT JOIN comments c ON v.id = c.video_id
GROUP BY v.id;

-- ХОРОШО: Denormalized counters
ALTER TABLE videos ADD COLUMN view_count INT DEFAULT 0;
ALTER TABLE videos ADD COLUMN comment_count INT DEFAULT 0;
ALTER TABLE videos ADD COLUMN username VARCHAR(255);

-- Update через triggers
DELIMITER $$
CREATE TRIGGER after_video_view_insert
AFTER INSERT ON video_views
FOR EACH ROW
BEGIN
  UPDATE videos 
  SET view_count = view_count + 1
  WHERE id = NEW.video_id;
END$$
DELIMITER ;

-- Теперь query простой:
SELECT id, title, view_count, comment_count, username
FROM videos
WHERE user_id = 'abc123';

-- Tradeoff:
-- ✅ Reads: быстрее (no JOINs)
-- ❌ Writes: медленнее (trigger overhead)
-- ❌ Consistency: eventual (counter может быть slightly off)
```

## 8.2 Connection Pooling Best Practices

```javascript
// Pool configuration
const pool = mysql.createPool({
  host: 'db.example.com',
  user: 'app',
  password: process.env.DB_PASSWORD,
  database: 'videos',
  
  // Connection limits
  connectionLimit: 10,        // Max connections
  queueLimit: 0,              // Unlimited queue (careful!)
  
  // Timeouts
  connectTimeout: 10000,      // 10s to establish connection
  acquireTimeout: 10000,      // 10s to acquire from pool
  
  // Health check
  waitForConnections: true,
  enableKeepAlive: true,
  keepAliveInitialDelay: 0,
  
  // Character set
  charset: 'utf8mb4',         // Emoji support
  
  // Timezone
  timezone: 'Z'               // UTC
});

// Monitoring
pool.on('acquire', (connection) => {
  console.log('Connection %d acquired', connection.threadId);
});

pool.on('release', (connection) => {
  console.log('Connection %d released', connection.threadId);
});

pool.on('enqueue', () => {
  console.log('Waiting for available connection slot');
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Closing MySQL pool...');
  await pool.end();
  console.log('MySQL pool closed');
  process.exit(0);
});

// Usage with error handling
async function getVideo(id) {
  let connection;
  
  try {
    connection = await pool.getConnection();
    
    const [rows] = await connection.query(
      'SELECT * FROM videos WHERE id = ?',
      [id]
    );
    
    return rows[0];
    
  } catch (error) {
    // Log error
    console.error('DB query failed:', error);
    
    // Retry logic (if transient error)
    if (error.code === 'ECONNRESET' || error.code === 'PROTOCOL_CONNECTION_LOST') {
      // Retry once
      return await getVideo(id);
    }
    
    throw error;
    
  } finally {
    if (connection) {
      connection.release();  // Return to pool
    }
  }
}
```

### Pool Size Calculation

```
Formula: connectionLimit = (core_count * 2) + effective_spindle_count

Пример:
- 4 CPU cores
- SSD (effective spindle = 1)
→ connectionLimit = (4 * 2) + 1 = 9 ≈ 10

Reasoning:
- CPU-bound: 2x cores (context switching overhead)
- I/O-bound: + disk spindles (parallelism)

НЕ ДЕЛАЙТЕ connectionLimit = 1000:
❌ Context switching overhead
❌ Memory per connection (~256KB)
❌ MySQL max_connections limit (default: 151)
```

## 8.3 Transactions & Isolation Levels

### ACID Guarantees

```sql
-- Example: Transfer views between videos

START TRANSACTION;

-- 1. Deduct from source
UPDATE videos 
SET view_count = view_count - 100
WHERE id = 'video1';

-- 2. Add to target
UPDATE videos 
SET view_count = view_count + 100
WHERE id = 'video2';

-- 3. Log transfer
INSERT INTO view_transfers (from_id, to_id, count, transferred_at)
VALUES ('video1', 'video2', 100, NOW());

COMMIT;

-- Если ANY step fails → ROLLBACK (atomicity)
-- Другие transactions не видят intermediate state (isolation)
```

### Isolation Levels

```sql
-- Problem: Dirty Read

-- Transaction 1:
START TRANSACTION;
UPDATE videos SET view_count = 1000 WHERE id = 'v1';
-- (не COMMIT)

-- Transaction 2 (READ UNCOMMITTED):
SELECT view_count FROM videos WHERE id = 'v1';
-- Видит 1000 (uncommitted data!)

-- Transaction 1:
ROLLBACK;  -- Отменяем изменения

-- Transaction 2 прочитал "грязные" данные, которых не существует!
```

**Isolation Levels:**

```sql
-- 1. READ UNCOMMITTED (самый быстрый, небезопасный)
SET SESSION TRANSACTION ISOLATION LEVEL READ UNCOMMITTED;
-- ❌ Dirty reads possible
-- ❌ Non-repeatable reads possible
-- ❌ Phantom reads possible

-- 2. READ COMMITTED (default в PostgreSQL)
SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED;
-- ✅ No dirty reads
-- ❌ Non-repeatable reads possible
-- ❌ Phantom reads possible

-- 3. REPEATABLE READ (default в MySQL)
SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ;
-- ✅ No dirty reads
-- ✅ No non-repeatable reads
-- ❌ Phantom reads possible (но MySQL решает через gap locks)

-- 4. SERIALIZABLE (самый медленный, безопасный)
SET SESSION TRANSACTION ISOLATION LEVEL SERIALIZABLE;
-- ✅ Полная изоляция
-- ❌ Locks everything (low concurrency)
```

**Практический выбор:**

```javascript
// Для видео-платформы:

// Reads (статистика, списки):
// → READ COMMITTED (баланс performance/consistency)
pool.query('SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED');

// Critical writes (payments, subscriptions):
// → REPEATABLE READ (MySQL default, OK)
// Никаких изменений не нужно

// Analytics queries (не критичны):
// → READ UNCOMMITTED (максимальная скорость)
analyticsPool.query('SET SESSION TRANSACTION ISOLATION LEVEL READ UNCOMMITTED');
```

### Deadlock Handling

```sql
-- Deadlock scenario:

-- Transaction 1:
START TRANSACTION;
UPDATE videos SET view_count = view_count + 1 WHERE id = 'v1';  -- Lock v1
-- ... waiting for v2 lock ...
UPDATE videos SET view_count = view_count + 1 WHERE id = 'v2';  -- Needs v2

-- Transaction 2:
START TRANSACTION;
UPDATE videos SET view_count = view_count + 1 WHERE id = 'v2';  -- Lock v2
-- ... waiting for v1 lock ...
UPDATE videos SET view_count = view_count + 1 WHERE id = 'v1';  -- Needs v1

-- DEADLOCK! MySQL kills one transaction:
-- ERROR 1213 (40001): Deadlock found when trying to get lock; 
-- try restarting transaction
```

**Решение:**

```javascript
async function updateVideos(id1, id2) {
  // Always lock in consistent order (alphabetical)
  const [first, second] = [id1, id2].sort();
  
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();
    
    await connection.query(
      'UPDATE videos SET view_count = view_count + 1 WHERE id = ?',
      [first]
    );
    
    await connection.query(
      'UPDATE videos SET view_count = view_count + 1 WHERE id = ?',
      [second]
    );
    
    await connection.commit();
    
  } catch (error) {
    await connection.rollback();
    
    // Retry on deadlock
    if (error.code === 'ER_LOCK_DEADLOCK') {
      console.log('Deadlock detected, retrying...');
      await sleep(Math.random() * 100);  // Random backoff
      return await updateVideos(id1, id2);
    }
    
    throw error;
    
  } finally {
    connection.release();
  }
}
```

## 8.4 Replication & High Availability

### Primary-Replica Setup

```
┌─────────────────────────────────────────────────┐
│          MySQL Replication Topology             │
└─────────────────────────────────────────────────┘

                    ┌─────────────┐
                    │   PRIMARY   │
                    │  (writes)   │
                    └──────┬──────┘
                           │
              ┌────────────┼────────────┐
              │            │            │
              ▼            ▼            ▼
       ┌───────────┐┌───────────┐┌───────────┐
       │ REPLICA 1 ││ REPLICA 2 ││ REPLICA 3 │
       │  (reads)  ││  (reads)  ││  (reads)  │
       └───────────┘└───────────┘└───────────┘

Benefits:
✅ Read scaling (distribute reads across replicas)
✅ Failover (promote replica to primary)
✅ Backups (snapshot replica without affecting primary)
```

**Node.js routing:**

```javascript
// Separate pools for primary and replicas
const primaryPool = mysql.createPool({
  host: 'primary.db.example.com',
  ...
});

const replicaPools = [
  mysql.createPool({ host: 'replica1.db.example.com', ... }),
  mysql.createPool({ host: 'replica2.db.example.com', ... }),
  mysql.createPool({ host: 'replica3.db.example.com', ... })
];

let replicaIndex = 0;

function getReplicaPool() {
  // Round-robin
  const pool = replicaPools[replicaIndex];
  replicaIndex = (replicaIndex + 1) % replicaPools.length;
  return pool;
}

// Write operations → primary
async function createVideo(data) {
  return await primaryPool.query(
    'INSERT INTO videos SET ?',
    [data]
  );
}

// Read operations → replica
async function getVideos(userId) {
  const pool = getReplicaPool();
  
  const [rows] = await pool.query(
    'SELECT * FROM videos WHERE user_id = ?',
    [userId]
  );
  
  return rows;
}

// Critical reads → primary (replication lag bypass)
async function getVideoAfterCreate(id) {
  // Сразу после INSERT, читаем из primary
  const [rows] = await primaryPool.query(
    'SELECT * FROM videos WHERE id = ?',
    [id]
  );
  
  return rows[0];
}
```

### Replication Lag Monitoring

```javascript
// Check replication lag
async function checkReplicationLag() {
  const [rows] = await replicaPool.query('SHOW SLAVE STATUS');
  
  if (rows.length === 0) {
    throw new Error('Not a replica');
  }
  
  const lag = rows[0].Seconds_Behind_Master;
  
  if (lag === null) {
    throw new Error('Replication not running');
  }
  
  if (lag > 5) {
    console.warn(`High replication lag: ${lag} seconds`);
  }
  
  return lag;
}

// Circuit breaker pattern
class ReplicaCircuitBreaker {
  constructor(pool) {
    this.pool = pool;
    this.failureCount = 0;
    this.lastCheck = Date.now();
    this.state = 'CLOSED';  // CLOSED, OPEN, HALF_OPEN
  }
  
  async query(...args) {
    if (this.state === 'OPEN') {
      // Circuit открыт → используем primary
      if (Date.now() - this.lastCheck > 30000) {
        this.state = 'HALF_OPEN';  // Попробуем снова через 30s
      } else {
        return await primaryPool.query(...args);
      }
    }
    
    try {
      const result = await this.pool.query(...args);
      
      // Success → reset
      this.failureCount = 0;
      this.state = 'CLOSED';
      
      return result;
      
    } catch (error) {
      this.failureCount++;
      
      if (this.failureCount >= 3) {
        // Open circuit после 3 failures
        this.state = 'OPEN';
        this.lastCheck = Date.now();
        console.error('Replica circuit opened, routing to primary');
      }
      
      // Fallback to primary
      return await primaryPool.query(...args);
    }
  }
}
```

---

# 9. Интеграция всех компонентов

## 9.1 Полная архитектура видео-платформы

```
┌─────────────────────────────────────────────────────────────────────┐
│                      Video Platform Architecture                    │
└─────────────────────────────────────────────────────────────────────┘

                        ┌──────────────┐
                        │   Client     │
                        │ (Browser/App)│
                        └──────┬───────┘
                               │
                    ┌──────────┴──────────┐
                    │                     │
              ┌─────▼─────┐        ┌─────▼─────┐
              │CloudFront │        │   API     │
              │   (CDN)   │        │  Gateway  │
              └─────┬─────┘        └─────┬─────┘
                    │                    │
              ┌─────▼─────┐        ┌─────▼─────┐
              │    S3     │        │ Node.js   │
              │  (video   │        │  App      │
              │  storage) │        │ Servers   │
              └─────┬─────┘        └─────┬─────┘
                    │                    │
                    │              ┌─────┴──────┐
                    │              │            │
                    │        ┌─────▼────┐ ┌─────▼─────┐
                    │        │  MySQL   │ │   Redis   │
                    │        │  (RDS)   │ │  (cache)  │
                    │        └──────────┘ └───────────┘
                    │
              ┌─────▼──────┐
              │  Lambda    │
              │ (transcode)│
              └─────┬──────┘
                    │
              ┌─────▼──────┐
              │ MediaConvert│
              │  (AWS)     │
              └────────────┘

Data Flow:
1. Upload: Client → API → S3 (pre-signed URL)
2. Process: S3 Event → Lambda → MediaConvert → S3
3. View: Client → CloudFront → S3 (HLS/DASH)
4. DRM: Client → License Server → Widevine/FairPlay
```

## 9.2 Upload Flow (детальный)

```javascript
// API Server: /api/upload/init
app.post('/api/upload/init', async (req, res) => {
  const { fileName, fileSize, contentType } = req.body;
  const userId = req.user.id;
  
  // 1. Validate
  if (fileSize > 10 * 1024 * 1024 * 1024) {  // 10GB max
    return res.status(400).json({ error: 'File too large' });
  }
  
  if (!['video/mp4', 'video/quicktime'].includes(contentType)) {
    return res.status(400).json({ error: 'Invalid content type' });
  }
  
  // 2. Create video record
  const videoId = uuid();
  
  await db.query(`
    INSERT INTO videos (id, user_id, status, original_filename, file_size)
    VALUES (?, ?, 'uploading', ?, ?)
  `, [videoId, userId, fileName, fileSize]);
  
  // 3. Generate S3 upload URL
  const s3Key = `uploads/${userId}/${videoId}/${fileName}`;
  
  const uploadUrl = await s3.getSignedUrl('putObject', {
    Bucket: 'my-videos',
    Key: s3Key,
    ContentType: contentType,
    Expires: 3600  // 1 hour
  });
  
  // 4. Return upload URL
  res.json({
    videoId,
    uploadUrl,
    expiresIn: 3600
  });
});

// Client: Upload to S3
async function uploadVideo(file) {
  // 1. Get upload URL
  const { videoId, uploadUrl } = await fetch('/api/upload/init', {
    method: 'POST',
    body: JSON.stringify({
      fileName: file.name,
      fileSize: file.size,
      contentType: file.type
    })
  }).then(r => r.json());
  
  // 2. Upload directly to S3
  const response = await fetch(uploadUrl, {
    method: 'PUT',
    body: file,
    headers: {
      'Content-Type': file.type
    },
    
    // Progress tracking
    onUploadProgress: (event) => {
      const percent = (event.loaded / event.total) * 100;
      console.log(`Upload: ${percent.toFixed(2)}%`);
    }
  });
  
  if (!response.ok) {
    throw new Error('Upload failed');
  }
  
  // 3. Notify backend
  await fetch(`/api/videos/${videoId}/uploaded`, {
    method: 'POST'
  });
  
  return videoId;
}

// API Server: /api/videos/:id/uploaded
app.post('/api/videos/:id/uploaded', async (req, res) => {
  const { id } = req.params;
  
  // 1. Update status
  await db.query(`
    UPDATE videos 
    SET status = 'processing', uploaded_at = NOW()
    WHERE id = ?
  `, [id]);
  
  // 2. Trigger transcoding job
  await triggerTranscoding(id);
  
  res.json({ status: 'processing' });
});
```

## 9.3 Transcoding Flow

```javascript
// Lambda function (triggered by S3 upload)
export const handler = async (event) => {
  const record = event.Records[0];
  const bucket = record.s3.bucket.name;
  const key = decodeURIComponent(record.s3.object.key.replace(/\+/g, ' '));
  
  // Parse video ID from key: uploads/{userId}/{videoId}/filename.mp4
  const videoId = key.split('/')[2];
  
  // 1. Create MediaConvert job
  const job = await mediaConvert.createJob({
    Role: 'arn:aws:iam::123456789:role/MediaConvertRole',
    
    Settings: {
      Inputs: [{
        FileInput: `s3://${bucket}/${key}`,
        AudioSelectors: {
          'Audio Selector 1': {
            DefaultSelection: 'DEFAULT'
          }
        }
      }],
      
      OutputGroups: [
        // HLS output
        {
          Name: 'HLS',
          OutputGroupSettings: {
            Type: 'HLS_GROUP_SETTINGS',
            HlsGroupSettings: {
              Destination: `s3://my-videos/transcoded/${videoId}/hls/`,
              ManifestDurationFormat: 'INTEGER',
              SegmentLength: 4,
              MinSegmentLength: 0
            }
          },
          Outputs: [
            // 360p
            {
              NameModifier: '_360p',
              VideoDescription: {
                Width: 640,
                Height: 360,
                CodecSettings: {
                  Codec: 'H_264',
                  H264Settings: {
                    Bitrate: 800000,
                    MaxBitrate: 856000,
                    RateControlMode: 'QVBR'
                  }
                }
              },
              AudioDescriptions: [{
                CodecSettings: {
                  Codec: 'AAC',
                  AacSettings: {
                    Bitrate: 96000,
                    SampleRate: 48000
                  }
                }
              }]
            },
            // 720p
            {
              NameModifier: '_720p',
              VideoDescription: {
                Width: 1280,
                Height: 720,
                CodecSettings: {
                  Codec: 'H_264',
                  H264Settings: {
                    Bitrate: 2800000,
                    MaxBitrate: 2996000,
                    RateControlMode: 'QVBR'
                  }
                }
              },
              AudioDescriptions: [{
                CodecSettings: {
                  Codec: 'AAC',
                  AacSettings: {
                    Bitrate: 128000,
                    SampleRate: 48000
                  }
                }
              }]
            }
            // ... 1080p, 1440p, 4K ...
          ]
        },
        
        // Thumbnail output
        {
          Name: 'Thumbnails',
          OutputGroupSettings: {
            Type: 'FILE_GROUP_SETTINGS',
            FileGroupSettings: {
              Destination: `s3://my-videos/thumbnails/${videoId}/`
            }
          },
          Outputs: [{
            Extension: 'jpg',
            VideoDescription: {
              Width: 1280,
              Height: 720,
              CodecSettings: {
                Codec: 'FRAME_CAPTURE',
                FrameCaptureSettings: {
                  MaxCaptures: 10,
                  Quality: 80
                }
              }
            }
          }]
        }
      ]
    },
    
    // Callbacks
    StatusUpdateInterval: 'SECONDS_60',
    UserMetadata: {
      videoId: videoId
    }
  });
  
  // 2. Save job ID
  await db.query(`
    INSERT INTO transcoding_jobs (id, video_id, aws_job_id, status)
    VALUES (?, ?, ?, 'running')
  `, [uuid(), videoId, job.Job.Id]);
  
  return { statusCode: 200, body: JSON.stringify({ jobId: job.Job.Id }) };
};

// MediaConvert completion callback (SNS → Lambda)
export const handleCompletion = async (event) => {
  const message = JSON.parse(event.Records[0].Sns.Message);
  const jobId = message.jobId;
  const status = message.status;  // COMPLETE or ERROR
  const videoId = message.userMetadata.videoId;
  
  if (status === 'COMPLETE') {
    // 1. Update video record
    await db.query(`
      UPDATE videos
      SET 
        status = 'ready',
        hls_manifest_s3_key = ?,
        cdn_url = ?,
        processed_at = NOW()
      WHERE id = ?
    `, [
      `transcoded/${videoId}/hls/master.m3u8`,
      `https://d1234.cloudfront.net/transcoded/${videoId}/hls/master.m3u8`,
      videoId
    ]);
    
    // 2. Send notification
    await sendNotification(videoId, 'Video processing complete');
    
    // 3. Generate DRM keys (if needed)
    await generateDRMKeys(videoId);
    
  } else {
    // Error handling
    await db.query(`
      UPDATE videos SET status = 'failed' WHERE id = ?
    `, [videoId]);
    
    await sendNotification(videoId, 'Video processing failed');
  }
};
```

## 9.4 Playback Flow with DRM

```javascript
// Client: Video player initialization
class SecureVideoPlayer {
  constructor(videoElement, videoId) {
    this.video = videoElement;
    this.videoId = videoId;
  }
  
  async initialize() {
    // 1. Get manifest URL
    const metadata = await fetch(`/api/videos/${this.videoId}`)
      .then(r => r.json());
    
    const manifestUrl = metadata.cdn_url;
    const drmRequired = metadata.drm_enabled;
    
    if (drmRequired) {
      await this.setupDRM(manifestUrl);
    } else {
      await this.setupClearPlayback(manifestUrl);
    }
  }
  
  async setupDRM(manifestUrl) {
    const config = [{
      initDataTypes: ['cenc'],
      videoCapabilities: [{
        contentType: 'video/mp4; codecs="avc1.42E01E"'
      }],
      audioCapabilities: [{
        contentType: 'audio/mp4; codecs="mp4a.40.2"'
      }]
    }];
    
    // Request media key system access
    const keySystemAccess = await navigator.requestMediaKeySystemAccess(
      'com.widevine.alpha',
      config
    );
    
    const mediaKeys = await keySystemAccess.createMediaKeys();
    await this.video.setMediaKeys(mediaKeys);
    
    // Handle encrypted event
    this.video.addEventListener('encrypted', async (e) => {
      const session = mediaKeys.createSession();
      
      // Generate license request
      await session.generateRequest(e.initDataType, e.initData);
      
      // Handle license message
      session.addEventListener('message', async (event) => {
        // Send to license server
        const license = await fetch('/api/drm/license', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/octet-stream',
            'Authorization': `Bearer ${await getAuthToken()}`
          },
          body: event.message
        }).then(r => r.arrayBuffer());
        
        // Update session with license
        await session.update(license);
      });
    });
    
    // Load video
    await this.loadHLS(manifestUrl);
  }
  
  async loadHLS(url) {
    if (Hls.isSupported()) {
      this.hls = new Hls({
        xhrSetup: (xhr, url) => {
          // Add auth token to segment requests
          xhr.setRequestHeader('Authorization', `Bearer ${getAuthToken()}`);
        }
      });
      
      this.hls.loadSource(url);
      this.hls.attachMedia(this.video);
      
      // Analytics
      this.hls.on(Hls.Events.FRAG_LOADED, (event, data) => {
        this.trackSegmentLoad(data);
      });
      
    } else if (this.video.canPlayType('application/vnd.apple.mpegurl')) {
      // Native HLS (Safari)
      this.video.src = url;
    }
  }
  
  trackSegmentLoad(data) {
    // Send analytics to backend
    fetch('/api/analytics/segment-load', {
      method: 'POST',
      body: JSON.stringify({
        videoId: this.videoId,
        segmentUrl: data.frag.url,
        loadTime: data.stats.loading.end - data.stats.loading.start,
        bytes: data.stats.loaded,
        level: data.frag.level
      })
    });
  }
}

// Usage
const player = new SecureVideoPlayer(
  document.getElementById('video'),
  'abc123'
);

await player.initialize();
```

---

# 10. Edge Cases и Production Pain Points

## 10.1 Видео Edge Cases

### 1. Variable Frame Rate (VFR)

```
Проблема:
Input video: VFR (телефонная камера, screen recording)
→ Timestamp inconsistencies
→ Audio sync issues
→ HLS segment boundaries misaligned

Симптомы:
- Audio drift (звук опережает/отстает от видео)
- Player stuttering
- Segment duration != expected

Решение:
```

```bash
# Detect VFR
ffprobe -v error -select_streams v:0 \
  -show_entries stream=r_frame_rate,avg_frame_rate \
  input.mp4

# Output:
# r_frame_rate=60/1      ← Declared rate
# avg_frame_rate=29/1    ← Actual average
# → VFR detected!

# Convert to CFR (Constant Frame Rate)
ffmpeg -i input.mp4 \
  -vf "fps=30" \  # Force 30 FPS
  -vsync cfr \    # Constant frame rate sync
  -c:v libx264 \
  -c:a aac \
  output.mp4

# Alternative: Use -r flag
ffmpeg -i input.mp4 -r 30 -c:v libx264 -c:a aac output.mp4
```

### 2. Audio/Video Sync Issues

```javascript
// Detection: Check PTS (Presentation Time Stamp) drift

const ffmpeg = spawn('ffmpeg', [
  '-i', inputFile,
  '-af', 'aresample=async=1',  // Audio resample для sync
  '-vsync', 'vfr',              // Variable frame rate sync
  '-c:v', 'libx264',
  '-c:a', 'aac',
  outputFile
]);

// Если drift >100ms → warning
ffmpeg.stderr.on('data', (data) => {
  const output = data.toString();
  
  const match = output.match(/A-V:\s*(-?\d+\.?\d*)/);
  if (match) {
    const drift = parseFloat(match[1]);
    
    if (Math.abs(drift) > 0.1) {  // 100ms
      console.warn(`A/V sync drift: ${drift}s`);
    }
  }
});
```

### 3. Rotation Metadata

```
Проблема:
Мобильные видео содержат rotation metadata (90°, 180°, 270°)
→ Видео отображается sideways

Решение:
```

```bash
# Detect rotation
ffprobe -v error -select_streams v:0 \
  -show_entries stream_tags=rotate \
  -of default=nw=1:nk=1 \
  input.mp4

# Output: 90 (degrees)

# Auto-rotate during transcode
ffmpeg -i input.mp4 \
  -vf "transpose=1" \  # 1 = 90° clockwise
  -c:v libx264 \
  -c:a copy \
  output.mp4

# Transpose values:
# 0 = 90° counter-clockwise + vertical flip
# 1 = 90° clockwise
# 2 = 90° counter-clockwise
# 3 = 90° clockwise + vertical flip

# Smart auto-rotate (uses metadata)
ffmpeg -i input.mp4 \
  -vf "transpose=dir=clock:passthrough=none" \
  -metadata:s:v rotate="" \  # Remove rotation metadata
  -c:v libx264 \
  -c:a copy \
  output.mp4
```

### 4. Aspect Ratio Letterboxing

```bash
# Problem: 4:3 video → 16:9 display = pillarboxing

# ПЛОХО: Squash/stretch
ffmpeg -i input_4x3.mp4 -vf "scale=1920:1080" output.mp4
# → Искажение

# ХОРОШО: Letterbox/pillarbox
ffmpeg -i input_4x3.mp4 \
  -vf "scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2" \
  output.mp4

# Параметры:
# - force_original_aspect_ratio=decrease: сохраняет aspect ratio, уменьшает
# - pad=1920:1080: финальный размер
# - (ow-iw)/2:(oh-ih)/2: центрирование (output_width - input_width) / 2
```

## 10.2 Scaling Pain Points

### 1. Cold Start Latency (Lambda)

```
Проблема:
Lambda cold start: 3-5 seconds
→ Первый request медленный
→ Пользователь видит timeout

Решение:
```

```javascript
// Provisioned Concurrency (AWS Lambda)
const lambda = new AWS.Lambda();

await lambda.putProvisionedConcurrencyConfig({
  FunctionName: 'VideoTranscoderLambda',
  ProvisionedConcurrentExecutions: 5  // Always warm
}).promise();

// Alternative: Periodic warming (cron)
exports.warmer = async (event) => {
  if (event.source === 'aws.events') {
    // CloudWatch Events trigger каждые 5 минут
    console.log('Warming function...');
    return { statusCode: 200, body: 'Warmed' };
  }
  
  // Normal execution
  return await processVideo(event);
};

// CloudWatch Events rule:
// Rate: 5 minutes
// Target: VideoTranscoderLambda
```

### 2. Thundering Herd (Cache Miss)

```
Проблема:
Popular video publishes → 10K requests/sec
→ All miss cache simultaneously
→ 10K database queries
→ Database overload

Решение: Request coalescing
```

```javascript
class RequestCoalescer {
  constructor() {
    this.pending = new Map();
  }
  
  async fetch(key, fetchFn) {
    // Check if request already pending
    if (this.pending.has(key)) {
      console.log(`Coalescing request for ${key}`);
      return await this.pending.get(key);
    }
    
    // Create promise
    const promise = (async () => {
      try {
        const result = await fetchFn();
        return result;
      } finally {
        this.pending.delete(key);
      }
    })();
    
    this.pending.set(key, promise);
    return await promise;
  }
}

// Usage
const coalescer = new RequestCoalescer();

app.get('/api/videos/:id', async (req, res) => {
  const { id } = req.params;
  
  const video = await coalescer.fetch(id, async () => {
    // Check cache
    let cached = await redis.get(`video:${id}`);
    
    if (cached) {
      return JSON.parse(cached);
    }
    
    // Fetch from DB (только одно выполнение для N concurrent requests)
    const video = await db.query('SELECT * FROM videos WHERE id = ?', [id]);
    
    // Cache
    await redis.setex(`video:${id}`, 3600, JSON.stringify(video));
    
    return video;
  });
  
  res.json(video);
});

// Результат:
// 10K simultaneous requests → 1 DB query
```

### 3. Hot Shard (Database)

```
Проблема:
Celebrity uploads video → viral
→ Все queries на один shard (user_id = celebrity_id)
→ Shard overload

Решение: Shard by video_id, не user_id
```

```sql
-- ПЛОХО: Shard by user_id
-- Shard = user_id % num_shards
-- Celebrity на одном shard → hot shard

-- ХОРОШО: Shard by video_id
-- Shard = video_id % num_shards
-- Celebrity videos распределены across shards

-- Routing logic
function getShardForVideo(videoId) {
  const shardCount = 16;
  const hash = crypto.createHash('sha256').update(videoId).digest();
  const shardId = hash[0] % shardCount;
  
  return {
    host: `shard${shardId}.db.example.com`,
    database: `videos_shard${shardId}`
  };
}

// Query
const shard = getShardForVideo(videoId);
const pool = pools[shard.host];
const [rows] = await pool.query('SELECT * FROM videos WHERE id = ?', [videoId]);
```

### 4. Memory Leak в Video Processing

```javascript
// ПЛОХО: Accumulating buffers
const processedFrames = [];

video.on('frame', (frame) => {
  const processed = applyFilter(frame);
  processedFrames.push(processed);  // Never cleared!
});

// После обработки 10-минутного видео @ 30 FPS:
// 18,000 frames * 2MB each = 36GB memory
// → OOM kill

// ХОРОШО: Streaming
const writeStream = fs.createWriteStream('output.mp4');

video.on('frame', (frame) => {
  const processed = applyFilter(frame);
  
  // Write immediately, don't accumulate
  writeStream.write(processed);
  
  // Allow GC
  frame = null;
  processed = null;
});

video.on('end', () => {
  writeStream.end();
});
```

## 10.3 Security Pain Points

### 1. Pre-signed URL Abuse

```
Проблема:
User generates upload URL → shares publicly
→ Unauthorized uploads to your S3

Решение:
```

```javascript
// Rate limit pre-signed URL generation
const rateLimit = require('express-rate-limit');

const uploadLimiter = rateLimit({
  windowMs: 60 * 1000,  // 1 minute
  max: 5,               // Max 5 uploads per minute
  message: 'Too many upload requests'
});

app.post('/api/upload/init', uploadLimiter, async (req, res) => {
  // ... generate pre-signed URL ...
});

// Validate upload after completion
app.post('/api/videos/:id/uploaded', async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  
  // 1. Check ownership
  const video = await db.query(
    'SELECT user_id FROM videos WHERE id = ?',
    [id]
  );
  
  if (video.user_id !== userId) {
    // Delete unauthorized upload
    await s3.deleteObject({
      Bucket: 'my-videos',
      Key: video.s3_key
    });
    
    return res.status(403).json({ error: 'Unauthorized' });
  }
  
  // 2. Validate file
  const metadata = await s3.headObject({
    Bucket: 'my-videos',
    Key: video.s3_key
  });
  
  if (metadata.ContentLength > 10 * 1024 * 1024 * 1024) {
    // Delete oversized file
    await s3.deleteObject({ Bucket: 'my-videos', Key: video.s3_key });
    return res.status(400).json({ error: 'File too large' });
  }
  
  // OK
  res.json({ status: 'processing' });
});
```

### 2. DRM License Server DoS

```javascript
// Проблема: Злоумышленник спамит license requests
// Решение: Throttling + CAPTCHA

const licenses = new Map();  // userId → { count, resetAt }

app.post('/api/drm/license', async (req, res) => {
  const userId = req.user.id;
  
  // Rate limit: 10 licenses per minute
  const now = Date.now();
  let userLimits = licenses.get(userId) || { count: 0, resetAt: now + 60000 };
  
  if (now > userLimits.resetAt) {
    userLimits = { count: 0, resetAt: now + 60000 };
  }
  
  if (userLimits.count >= 10) {
    // Require CAPTCHA
    if (!req.body.captcha || !await verifyCaptcha(req.body.captcha)) {
      return res.status(429).json({ error: 'Rate limit exceeded, CAPTCHA required' });
    }
  }
  
  userLimits.count++;
  licenses.set(userId, userLimits);
  
  // ... issue license ...
});
```

### 3. HLS Playlist Hijacking

```
Проблема:
Attacker downloads master.m3u8
→ Hosts на своем CDN
→ Steals bandwidth

Решение: Signed URLs в playlist
```

```javascript
// Generate signed HLS playlist
async function generateSignedPlaylist(videoId, userId) {
  // 1. Get base playlist from S3
  const playlist = await s3.getObject({
    Bucket: 'my-videos',
    Key: `transcoded/${videoId}/hls/master.m3u8`
  }).promise();
  
  const lines = playlist.Body.toString().split('\n');
  
  // 2. Sign each .ts segment URL
  const signedLines = await Promise.all(lines.map(async (line) => {
    if (line.endsWith('.ts')) {
      // Generate signed URL для сегмента
      const signedUrl = await s3.getSignedUrl('getObject', {
        Bucket: 'my-videos',
        Key: `transcoded/${videoId}/hls/${line}`,
        Expires: 3600  // 1 hour
      });
      
      return signedUrl;
    }
    
    return line;
  }));
  
  return signedLines.join('\n');
}

// API endpoint
app.get('/api/videos/:id/playlist.m3u8', async (req, res) => {
  const { id } = req.params;
  const userId = req.user.id;
  
  // Check access
  const hasAccess = await checkAccess(userId, id);
  
  if (!hasAccess) {
    return res.status(403).json({ error: 'No access' });
  }
  
  // Generate signed playlist
  const playlist = await generateSignedPlaylist(id, userId);
  
  res.set('Content-Type', 'application/vnd.apple.mpegurl');
  res.send(playlist);
});
```

## 10.4 Debugging Pain Points

### 1. "Video works on my machine"

```
Проблема:
- Works in Chrome, fails in Safari
- Works on desktop, fails on mobile
- Works with WiFi, fails with 4G

Debugging checklist:
```

```javascript
// Comprehensive device/network logging

class VideoDebugger {
  constructor(player) {
    this.player = player;
    this.collectDeviceInfo();
    this.setupEventListeners();
  }
  
  collectDeviceInfo() {
    this.info = {
      // Browser
      userAgent: navigator.userAgent,
      vendor: navigator.vendor,
      
      // Video capabilities
      canPlayH264: this.canPlay('video/mp4; codecs="avc1.42E01E"'),
      canPlayHEVC: this.canPlay('video/mp4; codecs="hvc1.1.6.L93.B0"'),
      canPlayVP9: this.canPlay('video/webm; codecs="vp9"'),
      
      // DRM
      widevineSupport: 'requestMediaKeySystemAccess' in navigator,
      
      // Network
      connection: navigator.connection ? {
        effectiveType: navigator.connection.effectiveType,  // 4g, 3g, 2g
        downlink: navigator.connection.downlink,            // Mbps
        rtt: navigator.connection.rtt                       // ms
      } : null,
      
      // Hardware
      cores: navigator.hardwareConcurrency,
      memory: navigator.deviceMemory,  // GB
      
      // Screen
      screen: {
        width: window.screen.width,
        height: window.screen.height,
        pixelRatio: window.devicePixelRatio
      }
    };
  }
  
  canPlay(mimeType) {
    const video = document.createElement('video');
    const support = video.canPlayType(mimeType);
    return support === 'probably' || support === 'maybe';
  }
  
  setupEventListeners() {
    this.player.on('error', (error) => {
      this.logError(error);
    });
    
    this.player.on('levelLoaded', (event, data) => {
      this.logLevelSwitch(data);
    });
  }
  
  logError(error) {
    fetch('/api/analytics/video-error', {
      method: 'POST',
      body: JSON.stringify({
        error: {
          code: error.code,
          message: error.message,
          details: error.details
        },
        device: this.info,
        timestamp: new Date().toISOString()
      })
    });
  }
  
  logLevelSwitch(data) {
    console.log('Quality switch:', {
      from: data.details.prevLevel,
      to: data.details.level,
      reason: data.details.reason,
      bandwidth: this.info.connection?.downlink
    });
  }
}
```

### 2. Transcoding Pipeline Debugging

```bash
# FFmpeg verbose logging
ffmpeg -i input.mp4 \
  -report \  # Создает ffmpeg-YYYYMMDD-HHMMSS.log
  -loglevel verbose \
  ... output.mp4

# Log analysis
grep -i "error\|warning" ffmpeg-20240101-120000.log

# Common issues:
# "moov atom not found" → Corrupted MP4
# "Timestamps are unset" → VFR video
# "Non-monotonous DTS" → Out-of-order frames
```

### 3. HLS Playback Debugging

```javascript
// HLS.js debug mode
const hls = new Hls({
  debug: true,
  enableWorker: false  // Easier debugging
});

// Log all events
Object.keys(Hls.Events).forEach(event => {
  hls.on(Hls.Events[event], (eventName, data) => {
    console.log(eventName, data);
  });
});

// Critical events to monitor:
hls.on(Hls.Events.ERROR, (event, data) => {
  console.error('HLS Error:', {
    type: data.type,      // NETWORK_ERROR, MEDIA_ERROR, etc.
    fatal: data.fatal,    // Recoverable?
    details: data.details,
    response: data.response
  });
  
  if (data.fatal) {
    switch (data.type) {
      case Hls.ErrorTypes.NETWORK_ERROR:
        // Network issue → retry
        hls.startLoad();
        break;
        
      case Hls.ErrorTypes.MEDIA_ERROR:
        // Media decode issue → try recovery
        hls.recoverMediaError();
        break;
        
      default:
        // Unrecoverable
        hls.destroy();
        showError('Playback failed');
        break;
    }
  }
});
```

---

# Заключение

## Ключевые Takeaways

### 1. Job-Based Architecture
- ✅ Async processing критичен для масштабируемости
- ✅ Idempotency обязательна для retry logic
- ✅ Queue + Workers pattern универсален
- ❌ In-memory jobs не для production (используйте Redis/SQS)

### 2. Node.js Production
- ✅ Event Loop понимание обязательно
- ✅ Clustering для multi-core utilization
- ✅ Memory profiling для leak detection
- ❌ Не блокируйте Event Loop

### 3. AWS Ecosystem
- ✅ S3 + CloudFront для video delivery
- ✅ Lambda для event-driven processing
- ✅ RDS Read Replicas для read scaling
- ❌ Не забывайте про costs (egress, storage)

### 4. Video Protocols
- ✅ HLS для VOD, SRT для live low-latency
- ✅ Adaptive bitrate essential для UX
- ✅ CDN caching критичен для performance
- ❌ Browser compatibility nightmare (multi-DRM)

### 5. DRM
- ✅ Multi-DRM (Widevine + FairPlay + PlayReady) для покрытия
- ✅ License server security критичен
- ✅ Concurrent streams enforcement
- ❌ Offline playback сложен (особенно iOS)

### 6. WebGL
- ✅ GPU acceleration для video effects
- ✅ Shaders для real-time processing
- ✅ Framebuffer для multi-pass rendering
- ❌ Не забывайте про texture memory limits

### 7. MySQL
- ✅ Indexes критичны (EXPLAIN ваш друг)
- ✅ Connection pooling обязателен
- ✅ Read replicas для scaling
- ❌ Transactions могут вызвать deadlocks

## Архитектурные Паттерны

```
1. Job Queue Pattern
   Producer → Queue → Consumer(s)
   
2. Cache-Aside Pattern
   App → Cache (miss) → Database → Cache (set)
   
3. Circuit Breaker Pattern
   Service → Monitor → Open/Closed/Half-Open
   
4. Sidecar Pattern
   App + Proxy (logging, metrics, tracing)
   
5. CQRS Pattern
   Commands (writes) ≠ Queries (reads)
```

## Production Checklist

**Performance:**
- [ ] CDN configured (CloudFront/Cloudflare)
- [ ] Database indexes optimized (EXPLAIN queries)
- [ ] Caching layer (Redis/Memcached)
- [ ] Connection pooling configured
- [ ] Adaptive bitrate streaming implemented

**Reliability:**
- [ ] Retry logic with exponential backoff
- [ ] Circuit breakers для external services
- [ ] Health checks configured
- [ ] Graceful shutdown implemented
- [ ] Database replication setup

**Security:**
- [ ] DRM implemented (multi-DRM)
- [ ] Rate limiting configured
- [ ] Input validation everywhere
- [ ] Signed URLs для protected content
- [ ] HTTPS everywhere

**Observability:**
- [ ] Structured logging (JSON)
- [ ] Metrics collection (Prometheus/CloudWatch)
- [ ] Error tracking (Sentry/Rollbar)
- [ ] Distributed tracing (Jaeger/X-Ray)
- [ ] Alerting configured

**Cost Optimization:**
- [ ] S3 lifecycle policies configured
- [ ] CloudFront cache hit rate >90%
- [ ] Database query optimization
- [ ] Lambda provisioned concurrency review
- [ ] Unused resources cleanup

---

**Comprehensive Guide завершен.**

**Объем:** ~5500+ строк  
**Темы:** Job Management, Node.js, AWS, Video Protocols, DRM, WebGL, MySQL, Integration, Edge Cases  
**Уровень:** Senior Backend Developer

Документ готов для использования в production окружении.
