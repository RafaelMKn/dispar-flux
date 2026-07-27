import { app } from 'electron'
import { join } from 'node:path'
import {
  createWriteStream,
  existsSync,
  mkdirSync,
  renameSync,
  statSync,
  unlinkSync,
  type WriteStream
} from 'node:fs'

/**
 * Logger do processo main: escreve no terminal E num arquivo rotativo.
 *
 * O arquivo importa porque o usuario final roda o app empacotado (sem terminal
 * visivel), e problemas de conexao do WhatsApp sao dificeis de reproduzir — sem
 * log fica impossivel diagnosticar remotamente.
 *
 * Nao usamos pino aqui: precisariamos de pino-pretty para o terminal ficar
 * legivel, e o formato proprio abaixo cobre o que precisamos com zero deps.
 */

export type LogLevel = 'trace' | 'debug' | 'info' | 'warn' | 'error' | 'fatal' | 'silent'

const ORDER: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
  silent: 100
}

const MAX_BYTES = 5 * 1024 * 1024 // 5 MB por arquivo
const KEEP_FILES = 3

function envLevel(name: string, fallback: LogLevel): LogLevel {
  const v = process.env[name]?.toLowerCase()
  return v && v in ORDER ? (v as LogLevel) : fallback
}

/** Nivel do app. Ajustavel por env: DISPAR_LOG_LEVEL=debug npm run dev */
const APP_LEVEL: LogLevel = envLevel('DISPAR_LOG_LEVEL', 'info')

/**
 * Nivel do Baileys separado: em 'debug' ele e extremamente verboso, mas e o
 * unico jeito de ver o detalhe do handshake quando a conexao falha.
 */
export const WA_LEVEL: LogLevel = envLevel('DISPAR_WA_LOG_LEVEL', 'warn')

let stream: WriteStream | null = null
let logPath = ''

function logDir(): string {
  return join(app.getPath('userData'), 'logs')
}

export function getLogPath(): string {
  return logPath || join(logDir(), 'dispar-flux.log')
}

function rotateIfNeeded(file: string): void {
  try {
    if (!existsSync(file)) return
    if (statSync(file).size < MAX_BYTES) return
    // dispar-flux.log -> .1 -> .2 -> descartado
    const oldest = `${file}.${KEEP_FILES}`
    if (existsSync(oldest)) unlinkSync(oldest)
    for (let i = KEEP_FILES - 1; i >= 1; i--) {
      const from = `${file}.${i}`
      if (existsSync(from)) renameSync(from, `${file}.${i + 1}`)
    }
    renameSync(file, `${file}.1`)
  } catch {
    // rotacao e best-effort: nunca deve impedir o app de logar
  }
}

function ensureStream(): WriteStream | null {
  if (stream) return stream
  try {
    const dir = logDir()
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    logPath = join(dir, 'dispar-flux.log')
    rotateIfNeeded(logPath)
    stream = createWriteStream(logPath, { flags: 'a' })
  } catch {
    stream = null // segue logando so no terminal
  }
  return stream
}

function ts(): string {
  const d = new Date()
  const p = (n: number, w = 2): string => String(n).padStart(w, '0')
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ` +
    `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`
  )
}

function serializeMeta(meta: unknown): string {
  if (meta === undefined || meta === null) return ''
  if (meta instanceof Error) {
    return ` ${meta.name}: ${meta.message}${meta.stack ? `\n${meta.stack}` : ''}`
  }
  if (typeof meta === 'string') return ` ${meta}`
  try {
    const s = JSON.stringify(meta)
    return s && s !== '{}' ? ` ${s}` : ''
  } catch {
    return ' [meta nao serializavel]'
  }
}

function write(level: LogLevel, scope: string, msg: string, meta?: unknown): void {
  const line = `${ts()} ${level.toUpperCase().padEnd(5)} [${scope}] ${msg}${serializeMeta(meta)}`

  // Terminal
  if (level === 'error' || level === 'fatal') console.error(line)
  else if (level === 'warn') console.warn(line)
  else console.log(line)

  // Arquivo
  ensureStream()?.write(`${line}\n`)
}

export interface Log {
  trace: (msg: string, meta?: unknown) => void
  debug: (msg: string, meta?: unknown) => void
  info: (msg: string, meta?: unknown) => void
  warn: (msg: string, meta?: unknown) => void
  error: (msg: string, meta?: unknown) => void
  fatal: (msg: string, meta?: unknown) => void
  child: (scope: string) => Log
}

function make(scope: string, level: LogLevel): Log {
  const at =
    (lvl: LogLevel) =>
    (msg: string, meta?: unknown): void => {
      if (ORDER[lvl] >= ORDER[level]) write(lvl, scope, msg, meta)
    }
  return {
    trace: at('trace'),
    debug: at('debug'),
    info: at('info'),
    warn: at('warn'),
    error: at('error'),
    fatal: at('fatal'),
    child: (sub: string) => make(`${scope}:${sub}`, level)
  }
}

export const log = make('app', APP_LEVEL)

export function scoped(scope: string): Log {
  return make(scope, APP_LEVEL)
}

/**
 * Adaptador com a forma que o Baileys espera (interface do pino).
 * O Baileys chama tanto `logger.warn(msg)` quanto `logger.warn(obj, msg)`.
 */
export interface PinoLike {
  level: string
  trace: (a: unknown, b?: unknown) => void
  debug: (a: unknown, b?: unknown) => void
  info: (a: unknown, b?: unknown) => void
  warn: (a: unknown, b?: unknown) => void
  error: (a: unknown, b?: unknown) => void
  fatal: (a: unknown, b?: unknown) => void
  child: () => PinoLike
}

export function pinoAdapter(scope: string, level: LogLevel = WA_LEVEL): PinoLike {
  const emit =
    (lvl: LogLevel) =>
    (a: unknown, b?: unknown): void => {
      if (ORDER[lvl] < ORDER[level]) return
      // Normaliza as duas formas de chamada do pino.
      const msg = typeof a === 'string' ? a : typeof b === 'string' ? b : ''
      const meta = typeof a === 'string' ? b : a
      write(lvl, scope, msg || '(sem mensagem)', meta)
    }
  const self: PinoLike = {
    level,
    trace: emit('trace'),
    debug: emit('debug'),
    info: emit('info'),
    warn: emit('warn'),
    error: emit('error'),
    fatal: emit('fatal'),
    child: () => self
  }
  return self
}

/** Garante que o buffer do arquivo foi para o disco antes de sair. */
export function closeLogger(): void {
  try {
    stream?.end()
  } catch {
    // ignora
  }
  stream = null
}
