import { describe, it, expect } from 'vitest'
import { parseWebmOpus, webmToOggOpus, opusPacketSamples, webmOpusDurationSeconds } from './opusOgg'

/**
 * O remux nao tem como ser validado "olhando": ou os bytes saem certos, ou o
 * audio chega mudo no celular do contato. Entao o teste monta um WebM sintetico
 * (mesma estrutura que o MediaRecorder produz), roda o remux e **le o Ogg de
 * volta com um parser proprio**, conferindo que os pacotes Opus atravessaram
 * intactos e que o enquadramento (CRC, lacing, granulepos) esta correto.
 */

/* ── Escrita de WebM para o teste ────────────────────────────────────────── */

/** Vint com bit de marcacao, no menor tamanho que couber. */
function vint(value: number): Buffer {
  for (let len = 1; len <= 8; len++) {
    // O valor "todos os bits em 1" e reservado para "tamanho desconhecido".
    const max = 2 ** (7 * len) - 1
    if (value >= max) continue
    const buf = Buffer.alloc(len)
    let v = value
    for (let i = len - 1; i >= 0; i--) {
      buf[i] = v & 0xff
      v = Math.floor(v / 256)
    }
    buf[0] |= 0x80 >> (len - 1)
    return buf
  }
  throw new Error('valor grande demais')
}

const UNKNOWN_SIZE = Buffer.from([0xff])

function element(id: number[], content: Buffer): Buffer {
  return Buffer.concat([Buffer.from(id), vint(content.length), content])
}

function elementUnknownSize(id: number[], content: Buffer): Buffer {
  return Buffer.concat([Buffer.from(id), UNKNOWN_SIZE, content])
}

function uintElement(id: number[], value: number): Buffer {
  return element(id, Buffer.from([value]))
}

function simpleBlock(trackNumber: number, timecode: number, packet: Buffer): Buffer {
  const head = Buffer.alloc(4)
  head[0] = 0x80 | trackNumber // vint de 1 byte
  head.writeInt16BE(timecode, 1)
  head[3] = 0x80 // keyframe, sem lacing
  return element([0xa3], Buffer.concat([head, packet]))
}

function opusHead(channels = 1, preSkip = 312): Buffer {
  const head = Buffer.alloc(19)
  head.write('OpusHead', 0, 'ascii')
  head.writeUInt8(1, 8)
  head.writeUInt8(channels, 9)
  head.writeUInt16LE(preSkip, 10)
  head.writeUInt32LE(48000, 12)
  head.writeInt16LE(0, 16)
  head.writeUInt8(0, 18)
  return head
}

/** Pacote Opus falso: TOC valido (config 9 = 20ms, 1 frame) + recheio. */
function opusPacket(length: number, fill: number): Buffer {
  const packet = Buffer.alloc(length, fill)
  packet[0] = (9 << 3) | 0
  return packet
}

function buildWebm(packets: Buffer[], head = opusHead()): Buffer {
  const trackEntry = element(
    [0xae],
    Buffer.concat([
      uintElement([0xd7], 1), // TrackNumber
      uintElement([0x83], 2), // TrackType = audio
      element([0x86], Buffer.from('A_OPUS', 'ascii')), // CodecID
      element([0x63, 0xa2], head), // CodecPrivate
      element([0xe1], uintElement([0x9f], 1)) // Audio > Channels
    ])
  )

  const cluster = elementUnknownSize(
    [0x1f, 0x43, 0xb6, 0x75],
    Buffer.concat([
      element([0xe7], Buffer.from([0])), // Timecode
      ...packets.map((p, i) => simpleBlock(1, i * 20, p))
    ])
  )

  // Segment com tamanho desconhecido: e assim que o MediaRecorder grava.
  return elementUnknownSize(
    [0x18, 0x53, 0x80, 0x67],
    Buffer.concat([element([0x16, 0x54, 0xae, 0x6b], trackEntry), cluster])
  )
}

/* ── Leitura do Ogg produzido ────────────────────────────────────────────── */

const CRC_TABLE = ((): Uint32Array => {
  const table = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let r = i << 24
    for (let j = 0; j < 8; j++) r = r & 0x80000000 ? ((r << 1) ^ 0x04c11db7) >>> 0 : (r << 1) >>> 0
    table[i] = r >>> 0
  }
  return table
})()

function crcOf(page: Buffer): number {
  let crc = 0
  for (const byte of page) crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ byte) & 0xff]) >>> 0
  return crc >>> 0
}

interface OggPage {
  flags: number
  granule: number
  serial: number
  sequence: number
  crcOk: boolean
  segments: number[]
  body: Buffer
}

function readOggPages(buf: Buffer): OggPage[] {
  const pages: OggPage[] = []
  let pos = 0
  while (pos < buf.length) {
    expect(buf.subarray(pos, pos + 4).toString('ascii')).toBe('OggS')
    expect(buf[pos + 4]).toBe(0) // versao
    const count = buf[pos + 26]
    const segments = [...buf.subarray(pos + 27, pos + 27 + count)]
    const bodyStart = pos + 27 + count
    const bodyLength = segments.reduce((a, b) => a + b, 0)
    const pageEnd = bodyStart + bodyLength

    const stated = buf.readUInt32LE(pos + 22)
    const zeroed = Buffer.from(buf.subarray(pos, pageEnd))
    zeroed.writeUInt32LE(0, 22)

    pages.push({
      flags: buf[pos + 5],
      granule: buf.readUInt32LE(pos + 6) + buf.readUInt32LE(pos + 10) * 0x100000000,
      serial: buf.readUInt32LE(pos + 14),
      sequence: buf.readUInt32LE(pos + 18),
      crcOk: crcOf(zeroed) === stated,
      segments,
      body: Buffer.from(buf.subarray(bodyStart, pageEnd))
    })
    pos = pageEnd
  }
  return pages
}

/** Remonta os pacotes a partir do lacing das paginas. */
function readOggPackets(pages: OggPage[]): Buffer[] {
  const packets: Buffer[] = []
  let current: Buffer[] = []
  for (const page of pages) {
    let offset = 0
    for (const size of page.segments) {
      current.push(page.body.subarray(offset, offset + size))
      offset += size
      // Segmento < 255 fecha o pacote.
      if (size < 255) {
        packets.push(Buffer.concat(current))
        current = []
      }
    }
  }
  return packets
}

/* ── Testes ──────────────────────────────────────────────────────────────── */

describe('opusPacketSamples', () => {
  it('le a duracao pelo byte TOC', () => {
    // config 9 (SILK WB 20ms), 1 frame
    expect(opusPacketSamples(Buffer.from([(9 << 3) | 0, 0]))).toBe(960)
    // config 11 (60ms), 1 frame
    expect(opusPacketSamples(Buffer.from([(11 << 3) | 0, 0]))).toBe(2880)
    // config 9, dois frames
    expect(opusPacketSamples(Buffer.from([(9 << 3) | 1, 0]))).toBe(1920)
    // config 16 (CELT 2.5ms), 1 frame
    expect(opusPacketSamples(Buffer.from([(16 << 3) | 0, 0]))).toBe(120)
  })

  it('le a contagem arbitraria de frames no segundo byte', () => {
    expect(opusPacketSamples(Buffer.from([(9 << 3) | 3, 5]))).toBe(960 * 5)
  })
})

describe('parseWebmOpus', () => {
  it('acha a trilha Opus e os pacotes mesmo com Segment/Cluster de tamanho desconhecido', () => {
    const packets = [opusPacket(40, 0xaa), opusPacket(60, 0xbb)]
    const parsed = parseWebmOpus(buildWebm(packets))

    expect(parsed.track.trackNumber).toBe(1)
    expect(parsed.track.codecId).toBe('A_OPUS')
    expect(parsed.track.codecPrivate?.subarray(0, 8).toString('ascii')).toBe('OpusHead')
    expect(parsed.packets.map((p) => p.length)).toEqual([40, 60])
    expect(parsed.packets[0].equals(packets[0])).toBe(true)
  })

  it('recusa audio sem trilha Opus', () => {
    expect(() => parseWebmOpus(Buffer.alloc(0))).toThrow(/Opus/)
  })
})

describe('webmToOggOpus', () => {
  const packets = [
    opusPacket(40, 0x11),
    opusPacket(300, 0x22), // dois segmentos (255 + 45)
    opusPacket(510, 0x33), // multiplo exato de 255: exige segmento final 0
    opusPacket(80, 0x44)
  ]

  it('produz paginas Ogg validas, com CRC e sequencia corretos', () => {
    const pages = readOggPages(webmToOggOpus(buildWebm(packets)))

    expect(pages.length).toBeGreaterThanOrEqual(3)
    expect(pages.every((p) => p.crcOk)).toBe(true)
    expect(pages.map((p) => p.sequence)).toEqual(pages.map((_, i) => i))
    expect(pages.every((p) => p.serial === pages[0].serial)).toBe(true)

    // Primeira pagina e BOS, ultima e EOS.
    expect(pages[0].flags & 0x02).toBe(0x02)
    expect(pages[pages.length - 1].flags & 0x04).toBe(0x04)
  })

  it('mantem os pacotes Opus intactos, com OpusHead e OpusTags na frente', () => {
    const all = readOggPackets(readOggPages(webmToOggOpus(buildWebm(packets))))

    expect(all[0].subarray(0, 8).toString('ascii')).toBe('OpusHead')
    expect(all[1].subarray(0, 8).toString('ascii')).toBe('OpusTags')

    const audio = all.slice(2)
    expect(audio.length).toBe(packets.length)
    audio.forEach((p, i) => {
      expect(p.equals(packets[i]), `pacote ${i} mudou no remux`).toBe(true)
    })
  })

  it('conta o granulepos final como pre-skip + amostras de todos os pacotes', () => {
    const preSkip = 312
    const pages = readOggPages(webmToOggOpus(buildWebm(packets, opusHead(1, preSkip))))
    const total = packets.reduce((sum, p) => sum + opusPacketSamples(p), 0)

    expect(pages[0].granule).toBe(0) // OpusHead
    expect(pages[1].granule).toBe(0) // OpusTags
    expect(pages[pages.length - 1].granule).toBe(preSkip + total)
  })

  it('quebra em varias paginas quando o audio e longo, sem partir pacote', () => {
    // ~3s de audio a 20ms por pacote: passa do limite de 4KB por pagina.
    const many = Array.from({ length: 150 }, (_, i) => opusPacket(60, i & 0xff))
    const ogg = webmToOggOpus(buildWebm(many))
    const pages = readOggPages(ogg)

    expect(pages.length).toBeGreaterThan(3) // 2 de cabecalho + varias de audio
    expect(pages.every((p) => p.crcOk)).toBe(true)
    // Nenhuma pagina termina com segmento 255 (isso indicaria pacote partido).
    for (const page of pages) {
      expect(page.segments[page.segments.length - 1]).not.toBe(255)
    }

    const audio = readOggPackets(pages).slice(2)
    expect(audio.length).toBe(many.length)
    expect(audio.every((p, i) => p.equals(many[i]))).toBe(true)
  })
})

describe('webmOpusDurationSeconds', () => {
  it('soma a duracao dos pacotes', () => {
    // 100 pacotes de 20ms = 2s
    const packets = Array.from({ length: 100 }, () => opusPacket(50, 0x01))
    expect(webmOpusDurationSeconds(buildWebm(packets))).toBe(2)
  })
})
