/**
 * Remux de WebM/Opus para Ogg/Opus.
 *
 * PORQUE ISSO EXISTE: nota de voz do WhatsApp (`ptt`) precisa ser Opus dentro
 * de um container **Ogg**. O gravador nativo do Chromium (`MediaRecorder`, o
 * unico jeito de capturar o microfone dentro do Electron) so entrega Opus
 * dentro de um container **WebM** — nao ha opcao de Ogg. Mandar o webm cru faz
 * o audio chegar como arquivo que o celular do contato nao toca.
 *
 * A saida obvia seria transcodificar (ffmpeg, ou uma lib wasm de encoder opus),
 * mas isso e desnecessario: os dois containers carregam **exatamente os mesmos
 * pacotes Opus**. So o empacotamento muda. Entao aqui nao ha decodificacao nem
 * reencode — os pacotes sao extraidos dos SimpleBlocks do WebM e reempacotados
 * em paginas Ogg, sem perda de qualidade e sem dependencia nova.
 *
 * O modulo e byte-a-byte puro (Buffer entra, Buffer sai), sem I/O e sem
 * Electron, entao da para testar de verdade — o que importa porque o unico
 * outro jeito de validar seria mandar audio para um WhatsApp real.
 */

/* ── Leitura de EBML (o formato do WebM/Matroska) ────────────────────────── */

/** Numero de bytes de um vint, dado o primeiro byte. 0 = invalido. */
function vintLength(first: number): number {
  for (let i = 0; i < 8; i++) {
    if (first & (0x80 >> i)) return i + 1
  }
  return 0
}

interface ElementHeader {
  /** ID do elemento COM os bits de marcacao (e assim que a spec o identifica). */
  id: number
  /** Tamanho do conteudo, ou -1 quando o EBML declara "tamanho desconhecido". */
  size: number
  /** Bytes ocupados pelo cabecalho (id + size). */
  headerLength: number
}

function readElementHeader(buf: Buffer, pos: number): ElementHeader | null {
  if (pos >= buf.length) return null

  const idLen = vintLength(buf[pos])
  // IDs tem no maximo 4 bytes.
  if (idLen === 0 || idLen > 4 || pos + idLen > buf.length) return null
  let id = 0
  for (let i = 0; i < idLen; i++) id = id * 256 + buf[pos + i]

  const sizePos = pos + idLen
  if (sizePos >= buf.length) return null
  const sizeLen = vintLength(buf[sizePos])
  if (sizeLen === 0 || sizePos + sizeLen > buf.length) return null

  // O primeiro byte do size carrega os bits de marcacao: precisam sair.
  let size = buf[sizePos] & (0xff >> sizeLen)
  let allOnes = size === 0xff >> sizeLen
  for (let i = 1; i < sizeLen; i++) {
    const byte = buf[sizePos + i]
    size = size * 256 + byte
    if (byte !== 0xff) allOnes = false
  }

  return {
    id,
    // "Tamanho desconhecido" (todos os bits em 1) e comum em WebM gravado em
    // streaming: o gravador nao sabe o tamanho final quando escreve o cabecalho.
    size: allOnes ? -1 : size,
    headerLength: idLen + sizeLen
  }
}

const ID_SEGMENT = 0x18538067
const ID_TRACKS = 0x1654ae6b
const ID_TRACK_ENTRY = 0xae
const ID_TRACK_NUMBER = 0xd7
const ID_CODEC_ID = 0x86
const ID_CODEC_PRIVATE = 0x63a2
const ID_AUDIO = 0xe1
const ID_CHANNELS = 0x9f
const ID_CLUSTER = 0x1f43b675
const ID_SIMPLE_BLOCK = 0xa3
const ID_BLOCK_GROUP = 0xa0
const ID_BLOCK = 0xa1

/**
 * Elementos em que precisamos descer. Os demais sao pulados pelo tamanho, mesmo
 * que tambem sejam "master" — nao ha nada la dentro que nos interesse.
 */
const CONTAINERS = new Set([
  ID_SEGMENT,
  ID_TRACKS,
  ID_TRACK_ENTRY,
  ID_AUDIO,
  ID_CLUSTER,
  ID_BLOCK_GROUP
])

function readUint(buf: Buffer, start: number, length: number): number {
  let value = 0
  for (let i = 0; i < length; i++) value = value * 256 + buf[start + i]
  return value
}

interface AudioTrack {
  trackNumber: number
  codecId: string
  codecPrivate: Buffer | null
  channels: number
}

export interface WebmOpusData {
  track: AudioTrack
  /** Um pacote Opus por SimpleBlock, na ordem do arquivo. */
  packets: Buffer[]
}

/**
 * Extrai a trilha Opus e seus pacotes de um WebM.
 *
 * A varredura e deliberadamente tolerante: WebM de gravador costuma ter
 * Segment e Cluster com tamanho desconhecido, e ai o unico jeito de achar o fim
 * de um container e continuar lendo os filhos ate o fim do pai.
 */
export function parseWebmOpus(buf: Buffer): WebmOpusData {
  let track: AudioTrack | null = null
  let pending: Partial<AudioTrack> | null = null
  const packets: Buffer[] = []

  const walk = (start: number, end: number): void => {
    let pos = start
    while (pos < end) {
      const header = readElementHeader(buf, pos)
      if (!header) return

      const contentStart = pos + header.headerLength
      // Tamanho desconhecido: o conteudo vai ate onde o pai terminar.
      const contentEnd = header.size < 0 ? end : Math.min(contentStart + header.size, end)
      // Sem isso, um elemento corrompido de tamanho 0 travaria o laco.
      if (contentEnd < contentStart || contentStart > end) return

      switch (header.id) {
        case ID_TRACK_ENTRY:
          pending = {}
          walk(contentStart, contentEnd)
          if (pending.codecId?.startsWith('A_OPUS') && pending.trackNumber !== undefined) {
            track ??= {
              trackNumber: pending.trackNumber,
              codecId: pending.codecId,
              codecPrivate: pending.codecPrivate ?? null,
              channels: pending.channels ?? 1
            }
          }
          pending = null
          break

        case ID_TRACK_NUMBER:
          if (pending) pending.trackNumber = readUint(buf, contentStart, contentEnd - contentStart)
          break

        case ID_CODEC_ID:
          if (pending) {
            // O CodecID pode vir com padding de \0 ate um tamanho fixo.
            pending.codecId = buf
              .subarray(contentStart, contentEnd)
              .toString('ascii')
              .replace(/\0+$/, '')
          }
          break

        case ID_CODEC_PRIVATE:
          if (pending) pending.codecPrivate = Buffer.from(buf.subarray(contentStart, contentEnd))
          break

        case ID_CHANNELS:
          if (pending) pending.channels = readUint(buf, contentStart, contentEnd - contentStart)
          break

        case ID_SIMPLE_BLOCK:
        case ID_BLOCK: {
          const packet = readBlockPayload(buf, contentStart, contentEnd, track?.trackNumber)
          if (packet) packets.push(packet)
          break
        }

        default:
          if (CONTAINERS.has(header.id)) walk(contentStart, contentEnd)
          break
      }

      pos = contentEnd
    }
  }

  walk(0, buf.length)

  if (!track) throw new Error('O audio gravado nao contem uma trilha Opus.')
  if (packets.length === 0) throw new Error('O audio gravado esta vazio.')
  return { track, packets }
}

/**
 * Conteudo util de um (Simple)Block: trackNumber (vint), timecode (int16),
 * flags (1 byte) e entao o pacote.
 */
function readBlockPayload(
  buf: Buffer,
  start: number,
  end: number,
  wantedTrack: number | undefined
): Buffer | null {
  const trackLen = vintLength(buf[start])
  if (trackLen === 0) return null
  const trackNumber = readUint(buf, start, trackLen) & ~(0x80 >> (trackLen - 1))

  if (wantedTrack !== undefined && trackNumber !== wantedTrack) return null

  const flagsPos = start + trackLen + 2
  if (flagsPos >= end) return null
  const lacing = (buf[flagsPos] & 0x06) >> 1
  // Lacing junta varios frames num bloco so. O MediaRecorder nao usa, e tratar
  // errado corromperia o audio em silencio — melhor falhar explicitamente.
  if (lacing !== 0) {
    throw new Error('Formato de audio inesperado (lacing no WebM).')
  }

  const payloadStart = flagsPos + 1
  if (payloadStart >= end) return null
  return Buffer.from(buf.subarray(payloadStart, end))
}

/* ── Duracao de um pacote Opus (RFC 6716, byte TOC) ──────────────────────── */

/** Duracao de um frame, em amostras a 48kHz, por `config` do byte TOC. */
function frameSamples(config: number): number {
  // SILK e hibrido: 10/20/40/60 ms. CELT: 2.5/5/10/20 ms.
  if (config < 12) return [480, 960, 1920, 2880][config % 4]
  if (config < 16) return [480, 960][config % 2]
  return [120, 240, 480, 960][config % 4]
}

/**
 * Amostras (a 48kHz) que um pacote Opus representa.
 *
 * E disso que sai o `granulepos` das paginas Ogg — o campo que diz ao player
 * onde cada pagina cai na linha do tempo. Errar aqui faz o audio tocar com
 * duracao errada ou a barra de progresso ficar maluca.
 */
export function opusPacketSamples(packet: Buffer): number {
  if (packet.length < 1) return 0
  const toc = packet[0]
  const per = frameSamples(toc >> 3)

  switch (toc & 0x03) {
    case 0:
      return per // um frame
    case 1:
    case 2:
      return per * 2 // dois frames
    default: {
      // Arbitrario: a contagem vem nos 6 bits baixos do byte seguinte.
      if (packet.length < 2) return per
      return per * (packet[1] & 0x3f)
    }
  }
}

/* ── Escrita de Ogg ──────────────────────────────────────────────────────── */

/** CRC do Ogg: polinomio 0x04c11db7, sem reflexao, sem xor final. */
const CRC_TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let r = i << 24
    for (let j = 0; j < 8; j++) {
      r = r & 0x80000000 ? ((r << 1) ^ 0x04c11db7) >>> 0 : (r << 1) >>> 0
    }
    table[i] = r >>> 0
  }
  return table
})()

function oggCrc(page: Buffer): number {
  let crc = 0
  for (const byte of page) {
    crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ byte) & 0xff]) >>> 0
  }
  return crc >>> 0
}

const HEADER_BOS = 0x02
const HEADER_EOS = 0x04

/** Lacing do Ogg: cada pacote vira N segmentos de 255 + um resto (que pode ser 0). */
function segmentsFor(length: number): number[] {
  const segments: number[] = []
  let remaining = length
  while (remaining >= 255) {
    segments.push(255)
    remaining -= 255
  }
  segments.push(remaining)
  return segments
}

function buildPage(
  packets: Buffer[],
  granulePosition: number,
  serial: number,
  sequence: number,
  flags: number
): Buffer {
  const segments = packets.flatMap((p) => segmentsFor(p.length))
  if (segments.length > 255) throw new Error('Pagina Ogg com segmentos demais.')

  const header = Buffer.alloc(27 + segments.length)
  header.write('OggS', 0, 'ascii')
  header.writeUInt8(0, 4) // versao
  header.writeUInt8(flags, 5)
  // granulepos e int64; escrevemos como dois uint32 porque o valor cabe
  // folgado em 32 bits (48000 amostras/s levariam ~24h para estourar).
  header.writeUInt32LE(granulePosition >>> 0, 6)
  header.writeUInt32LE(Math.floor(granulePosition / 0x100000000), 10)
  header.writeUInt32LE(serial, 14)
  header.writeUInt32LE(sequence, 18)
  header.writeUInt32LE(0, 22) // CRC entra depois, com o campo zerado
  header.writeUInt8(segments.length, 26)
  for (let i = 0; i < segments.length; i++) header.writeUInt8(segments[i], 27 + i)

  const page = Buffer.concat([header, ...packets])
  page.writeUInt32LE(oggCrc(page), 22)
  return page
}

function buildOpusTags(): Buffer {
  const vendor = Buffer.from('dispar-flux', 'utf-8')
  const tags = Buffer.alloc(8 + 4 + vendor.length + 4)
  tags.write('OpusTags', 0, 'ascii')
  tags.writeUInt32LE(vendor.length, 8)
  vendor.copy(tags, 12)
  tags.writeUInt32LE(0, 12 + vendor.length) // nenhum comentario
  return tags
}

/** OpusHead minimo, para o caso raro de o WebM nao trazer CodecPrivate. */
function buildOpusHead(channels: number): Buffer {
  const head = Buffer.alloc(19)
  head.write('OpusHead', 0, 'ascii')
  head.writeUInt8(1, 8) // versao
  head.writeUInt8(channels, 9)
  head.writeUInt16LE(3840, 10) // pre-skip padrao do libopus
  head.writeUInt32LE(48000, 12)
  head.writeInt16LE(0, 16) // ganho
  head.writeUInt8(0, 18) // mapping family 0
  return head
}

/** Bytes que o decoder descarta no inicio; entram no granulepos por spec. */
function preSkipOf(opusHead: Buffer): number {
  return opusHead.length >= 12 ? opusHead.readUInt16LE(10) : 3840
}

/** Limite de bytes de audio por pagina; ~mesma ordem do que o libogg produz. */
const MAX_PAGE_PAYLOAD = 4096

/**
 * Converte WebM/Opus (saida do MediaRecorder) em Ogg/Opus (o que o WhatsApp
 * aceita como nota de voz). Sem reencode: so troca de container.
 */
export function webmToOggOpus(webm: Buffer, serial = 1): Buffer {
  const { track, packets } = parseWebmOpus(webm)

  const opusHead =
    track.codecPrivate && track.codecPrivate.length >= 19
      ? track.codecPrivate
      : buildOpusHead(track.channels || 1)

  const pages: Buffer[] = [
    buildPage([opusHead], 0, serial, 0, HEADER_BOS),
    buildPage([buildOpusTags()], 0, serial, 1, 0)
  ]

  let sequence = 2
  let granule = preSkipOf(opusHead)
  let batch: Buffer[] = []
  let batchBytes = 0
  let batchSegments = 0

  const flush = (last: boolean): void => {
    if (batch.length === 0 && !last) return
    pages.push(buildPage(batch, granule, serial, sequence, last ? HEADER_EOS : 0))
    sequence += 1
    batch = []
    batchBytes = 0
    batchSegments = 0
  }

  for (const packet of packets) {
    const needed = segmentsFor(packet.length).length
    // Nunca partimos um pacote entre paginas: o leitor teria de remontar, e nao
    // ha ganho nenhum nisso num arquivo de nota de voz.
    if (batch.length > 0 && (batchSegments + needed > 255 || batchBytes >= MAX_PAGE_PAYLOAD)) {
      flush(false)
    }
    batch.push(packet)
    batchBytes += packet.length
    batchSegments += needed
    granule += opusPacketSamples(packet)
  }

  flush(true)
  return Buffer.concat(pages)
}

/** Duracao total, em segundos, dos pacotes de um WebM/Opus. */
export function webmOpusDurationSeconds(webm: Buffer): number {
  const { packets } = parseWebmOpus(webm)
  const samples = packets.reduce((sum, p) => sum + opusPacketSamples(p), 0)
  return Math.round(samples / 48000)
}
