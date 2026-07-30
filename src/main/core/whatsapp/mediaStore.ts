import { app } from 'electron'
import { join, extname, basename, resolve } from 'node:path'
import { mkdirSync, writeFileSync, copyFileSync, existsSync, statSync } from 'node:fs'
import type { MediaKind } from '@shared/types'

/**
 * Armazenamento local de midia da inbox (anexos recebidos/enviados e fotos de
 * perfil).
 *
 * PORQUE EM DISCO, E NAO NO BANCO: o sql.js mantem o banco inteiro em memoria e
 * cada save reescreve o arquivo todo. Guardar imagem e audio ali faria o banco
 * crescer para centenas de MB e transformaria cada mensagem nova numa reescrita
 * completa. Os bytes ficam em arquivos; o banco guarda so o caminho.
 *
 * PORQUE UM PROTOCOLO PROPRIO: o renderer roda com `contextIsolation` e, no app
 * empacotado, com origem `file://` — nao pode simplesmente apontar um `<img>`
 * para um caminho absoluto do disco. Servir por um scheme registrado
 * (`disparmedia://`) e o caminho suportado pelo Electron, e ainda permite ao
 * `<audio>` fazer seek, o que um data: URL gigante nao daria.
 */

export const MEDIA_SCHEME = 'disparmedia'

const HOST_MEDIA = 'media'
const HOST_AVATAR = 'avatar'

export function mediaRoot(): string {
  return join(app.getPath('userData'), 'media')
}

export function avatarRoot(): string {
  return join(app.getPath('userData'), 'avatars')
}

function rootFor(host: string): string | null {
  if (host === HOST_MEDIA) return mediaRoot()
  if (host === HOST_AVATAR) return avatarRoot()
  return null
}

/* ── Tipos de arquivo ────────────────────────────────────────────────────── */

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'video/mp4': 'mp4',
  'video/3gpp': '3gp',
  'video/quicktime': 'mov',
  'video/webm': 'webm',
  'audio/ogg': 'ogg',
  'audio/opus': 'ogg',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/mp4': 'm4a',
  'audio/aac': 'aac',
  'audio/amr': 'amr',
  'audio/wav': 'wav',
  'audio/x-wav': 'wav',
  'audio/webm': 'webm',
  'application/pdf': 'pdf',
  'text/plain': 'txt'
}

const EXT_TO_MIME: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  gif: 'image/gif',
  mp4: 'video/mp4',
  '3gp': 'video/3gpp',
  mov: 'video/quicktime',
  webm: 'video/webm',
  ogg: 'audio/ogg',
  opus: 'audio/ogg',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
  aac: 'audio/aac',
  amr: 'audio/amr',
  wav: 'audio/wav',
  pdf: 'application/pdf',
  txt: 'text/plain'
}

/** Mimetype sem parametros: "audio/ogg; codecs=opus" -> "audio/ogg". */
export function baseMime(mime: string | null | undefined): string {
  return (mime ?? '').split(';')[0].trim().toLowerCase()
}

/** Extensao (sem ponto) para um mimetype, caindo no nome do arquivo e em `bin`. */
export function extForMime(mime: string | null | undefined, fileName?: string | null): string {
  const known = MIME_TO_EXT[baseMime(mime)]
  if (known) return known

  const fromName = extname(fileName ?? '')
    .replace('.', '')
    .toLowerCase()
  if (/^[a-z0-9]{1,8}$/.test(fromName)) return fromName

  return 'bin'
}

/** Mimetype para servir um arquivo local, deduzido pela extensao. */
export function mimeForPath(path: string): string {
  const ext = extname(path).replace('.', '').toLowerCase()
  return EXT_TO_MIME[ext] ?? 'application/octet-stream'
}

/** Classifica um arquivo escolhido pelo usuario no tipo de mensagem do WhatsApp. */
export function kindForMime(mime: string | null | undefined, fileName?: string | null): MediaKind {
  const m = baseMime(mime) || baseMime(EXT_TO_MIME[extForMime(null, fileName)])
  if (m.startsWith('image/')) return 'image'
  if (m.startsWith('video/')) return 'video'
  if (m.startsWith('audio/')) return 'audio'
  return 'document'
}

/* ── Nomes de arquivo ────────────────────────────────────────────────────── */

/**
 * Nome de arquivo seguro derivado de um identificador do WhatsApp.
 *
 * Os ids do WhatsApp sao alfanumericos, mas nunca confiamos nisso: um id com
 * `/` ou `..` viraria escrita fora da pasta de midia.
 */
export function safeFileName(id: string, ext: string): string {
  const slug = id.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 96) || 'arquivo'
  const safeExt = /^[a-z0-9]{1,8}$/.test(ext) ? ext : 'bin'
  return `${slug}.${safeExt}`
}

/* ── Escrita ─────────────────────────────────────────────────────────────── */

function ensureDir(dir: string): string {
  mkdirSync(dir, { recursive: true })
  return dir
}

/** Grava um anexo e devolve o caminho absoluto. */
export function saveMedia(
  id: string,
  data: Buffer,
  mime: string | null,
  fileName?: string | null
): string {
  const path = join(ensureDir(mediaRoot()), safeFileName(id, extForMime(mime, fileName)))
  writeFileSync(path, data)
  return path
}

/**
 * Copia um arquivo escolhido pelo usuario para a pasta de midia.
 *
 * Copiamos em vez de guardar o caminho original porque o usuario pode mover ou
 * apagar o arquivo depois — e ai a mensagem enviada apareceria quebrada no
 * historico do proprio app.
 */
export function copyIntoMedia(
  id: string,
  sourcePath: string,
  mime: string | null,
  fileName?: string | null
): string {
  const path = join(ensureDir(mediaRoot()), safeFileName(id, extForMime(mime, fileName)))
  copyFileSync(sourcePath, path)
  return path
}

/** Grava a foto de perfil de um contato e devolve o caminho absoluto. */
export function saveAvatar(jid: string, data: Buffer, mime: string | null): string {
  const path = join(ensureDir(avatarRoot()), safeFileName(jid, extForMime(mime) || 'jpg'))
  writeFileSync(path, data)
  return path
}

/* ── URLs para o renderer ────────────────────────────────────────────────── */

function urlFor(
  host: string,
  path: string | null | undefined,
  version?: number | null
): string | null {
  if (!path) return null
  // `?v=` derruba o cache do Chromium quando a foto de perfil muda mas o nome
  // do arquivo continua o mesmo.
  const query = version ? `?v=${version}` : ''
  return `${MEDIA_SCHEME}://${host}/${encodeURIComponent(basename(path))}${query}`
}

export function mediaUrl(path: string | null | undefined): string | null {
  return urlFor(HOST_MEDIA, path)
}

export function avatarUrl(path: string | null | undefined, version?: number | null): string | null {
  return urlFor(HOST_AVATAR, path, version)
}

/**
 * Caminho local para uma URL `disparmedia://`, ou null se nao existir / apontar
 * para fora das pastas de midia.
 *
 * A checagem final compara o caminho **resolvido** com a raiz: e o que barra
 * `..%2F..%2F` e amigos, que sao o unico jeito de esse handler virar leitura
 * arbitraria de disco.
 */
export function resolveMediaUrl(url: string): string | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }

  const root = rootFor(parsed.hostname)
  if (!root) return null

  const name = decodeURIComponent(parsed.pathname.replace(/^\//, ''))
  if (!name || name.includes('/') || name.includes('\\')) return null

  const full = resolve(root, name)
  if (full !== join(root, name)) return null
  if (!existsSync(full) || !statSync(full).isFile()) return null
  return full
}
