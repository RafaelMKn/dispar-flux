import { describe, it, expect, beforeEach } from 'vitest'
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { rotateBackups, BACKUP_KEEP } from './index'

/**
 * O backup existe por causa de uma perda de dados real: o banco vive inteiro em
 * memoria e cada gravacao reescreve o arquivo todo, entao um processo com uma
 * imagem velha apaga tudo que veio depois sem emitir um unico erro. O que estes
 * testes protegem nao e a copia em si — e a JANELA: `.bak.1` tem de ser o
 * estado imediatamente anterior a esta abertura, e as anteriores tem de
 * sobreviver, porque quem percebe a perda raramente percebe na hora.
 */

let dir = ''
let db = ''

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'dispar-backup-test-'))
  db = join(dir, 'dispar-flux.sqlite')
})

const conteudo = (p: string): string => readFileSync(p, 'utf-8')

describe('rotateBackups', () => {
  it('guarda o estado anterior e empurra os antigos para tras', () => {
    writeFileSync(db, 'dia-1')
    rotateBackups(db)
    expect(conteudo(`${db}.bak.1`)).toBe('dia-1')

    // O app roda, altera o banco, e abre de novo no dia seguinte.
    writeFileSync(db, 'dia-2')
    rotateBackups(db)
    expect(conteudo(`${db}.bak.1`)).toBe('dia-2')
    expect(conteudo(`${db}.bak.2`)).toBe('dia-1')

    writeFileSync(db, 'dia-3')
    rotateBackups(db)
    expect(conteudo(`${db}.bak.1`)).toBe('dia-3')
    expect(conteudo(`${db}.bak.2`)).toBe('dia-2')
    expect(conteudo(`${db}.bak.3`)).toBe('dia-1')
  })

  it('para de acumular no teto, descartando so a mais antiga', () => {
    for (let i = 1; i <= BACKUP_KEEP + 2; i++) {
      writeFileSync(db, `versao-${i}`)
      rotateBackups(db)
    }

    expect(existsSync(`${db}.bak.${BACKUP_KEEP}`)).toBe(true)
    expect(existsSync(`${db}.bak.${BACKUP_KEEP + 1}`)).toBe(false)
    // A mais nova e sempre a .1; a mais velha viva e a do teto.
    expect(conteudo(`${db}.bak.1`)).toBe(`versao-${BACKUP_KEEP + 2}`)
    expect(conteudo(`${db}.bak.${BACKUP_KEEP}`)).toBe(`versao-3`)
  })

  it('sobrevive a um banco corrompido: copia os bytes sem interpretar', () => {
    // O backup nao pode depender de o arquivo ser um SQLite valido — o caso em
    // que ele mais importa e justamente o do arquivo estranho.
    writeFileSync(db, Buffer.from([0x00, 0xff, 0x42, 0x00]))
    rotateBackups(db)
    expect([...readFileSync(`${db}.bak.1`)]).toEqual([0x00, 0xff, 0x42, 0x00])
  })

  it('primeira execucao nao cria backup de banco que nao existe', () => {
    rotateBackups(db)
    expect(existsSync(`${db}.bak.1`)).toBe(false)
  })

  it('nao deixa o app travar quando a pasta some', () => {
    writeFileSync(db, 'x')
    rmSync(dir, { recursive: true, force: true })
    // Abrir o app tem de continuar funcionando mesmo sem conseguir copiar.
    expect(() => rotateBackups(db)).not.toThrow()
  })
})
