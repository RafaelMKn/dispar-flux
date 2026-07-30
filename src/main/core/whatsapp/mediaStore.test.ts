import { describe, it, expect } from 'vitest'
import { writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  baseMime,
  extForMime,
  mimeForPath,
  kindForMime,
  safeFileName,
  saveMedia,
  mediaUrl,
  avatarUrl,
  resolveMediaUrl,
  mediaRoot,
  avatarRoot
} from './mediaStore'

describe('baseMime', () => {
  it('descarta parametros e normaliza', () => {
    expect(baseMime('audio/ogg; codecs=opus')).toBe('audio/ogg')
    expect(baseMime('IMAGE/JPEG')).toBe('image/jpeg')
    expect(baseMime(null)).toBe('')
  })
})

describe('extForMime', () => {
  it('usa o mimetype quando conhecido', () => {
    expect(extForMime('image/jpeg')).toBe('jpg')
    expect(extForMime('audio/ogg; codecs=opus')).toBe('ogg')
    expect(extForMime('application/pdf')).toBe('pdf')
  })

  it('cai no nome do arquivo quando o mimetype nao ajuda', () => {
    expect(extForMime('application/octet-stream', 'planilha.xlsx')).toBe('xlsx')
    expect(extForMime(null, 'contrato.docx')).toBe('docx')
  })

  it('cai em bin quando nao da para saber', () => {
    expect(extForMime(null, 'arquivo-sem-extensao')).toBe('bin')
    expect(extForMime('coisa/estranha')).toBe('bin')
  })
})

describe('kindForMime', () => {
  it('classifica pelo mimetype', () => {
    expect(kindForMime('image/png')).toBe('image')
    expect(kindForMime('video/mp4')).toBe('video')
    expect(kindForMime('audio/mpeg')).toBe('audio')
    expect(kindForMime('application/pdf')).toBe('document')
  })

  it('classifica pela extensao quando nao ha mimetype', () => {
    expect(kindForMime(null, 'foto.png')).toBe('image')
    expect(kindForMime('', 'clipe.mp4')).toBe('video')
  })
})

describe('mimeForPath', () => {
  it('deduz o tipo pela extensao, para servir o arquivo ao renderer', () => {
    expect(mimeForPath('/x/y/foto.JPG')).toBe('image/jpeg')
    expect(mimeForPath('/x/y/nota.ogg')).toBe('audio/ogg')
    expect(mimeForPath('/x/y/desconhecido.zzz')).toBe('application/octet-stream')
  })
})

describe('safeFileName', () => {
  it('mantem ids normais do WhatsApp', () => {
    expect(safeFileName('3EB0C1F2A3B4', 'jpg')).toBe('3EB0C1F2A3B4.jpg')
  })

  it('neutraliza qualquer coisa que sairia da pasta de midia', () => {
    // Um id malicioso nunca pode virar escrita em outro diretorio.
    expect(safeFileName('../../etc/passwd', 'jpg')).toBe('______etc_passwd.jpg')
    expect(safeFileName('a/b\\c', 'png')).toBe('a_b_c.png')
    expect(safeFileName('', 'png')).toBe('arquivo.png')
  })

  it('recusa extensao esquisita', () => {
    expect(safeFileName('id', '../sh')).toBe('id.bin')
  })
})

describe('URLs para o renderer', () => {
  it('monta disparmedia:// a partir do caminho local', () => {
    expect(mediaUrl('/qualquer/pasta/ABC.jpg')).toBe('disparmedia://media/ABC.jpg')
    expect(mediaUrl(null)).toBeNull()
  })

  it('versiona a foto de perfil para furar o cache quando ela muda', () => {
    expect(avatarUrl('/p/x.jpg', 1234)).toBe('disparmedia://avatar/x.jpg?v=1234')
  })
})

describe('resolveMediaUrl', () => {
  it('resolve um arquivo que existe na pasta de midia', () => {
    const path = saveMedia('teste-resolve', Buffer.from('conteudo'), 'image/png')
    expect(resolveMediaUrl(mediaUrl(path)!)).toBe(path)
  })

  it('resolve foto de perfil e ignora a query de versao', () => {
    mkdirSync(avatarRoot(), { recursive: true })
    const path = join(avatarRoot(), 'avatar-teste.jpg')
    writeFileSync(path, Buffer.from('x'))
    expect(resolveMediaUrl(`disparmedia://avatar/avatar-teste.jpg?v=99`)).toBe(path)
  })

  it('recusa travessia de diretorio', () => {
    // Sem esta barreira o handler do protocolo viraria leitura livre de disco.
    for (const url of [
      'disparmedia://media/..%2F..%2Fetc%2Fpasswd',
      'disparmedia://media/../../package.json',
      'disparmedia://media/sub%2Farquivo.png'
    ]) {
      expect(resolveMediaUrl(url), url).toBeNull()
    }
  })

  it('recusa host desconhecido, arquivo inexistente e URL invalida', () => {
    expect(resolveMediaUrl('disparmedia://outro/x.png')).toBeNull()
    expect(resolveMediaUrl('disparmedia://media/nao-existe.png')).toBeNull()
    expect(resolveMediaUrl('isso nao e uma url')).toBeNull()
  })

  it('nao entrega um diretorio como se fosse arquivo', () => {
    mkdirSync(join(mediaRoot(), 'pasta'), { recursive: true })
    expect(resolveMediaUrl('disparmedia://media/pasta')).toBeNull()
  })
})
