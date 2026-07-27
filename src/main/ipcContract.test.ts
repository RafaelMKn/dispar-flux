import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * O nome do canal IPC e uma string duplicada entre o preload e o main. O
 * TypeScript nao consegue cruzar as duas pontas: um erro de digitacao compila
 * sem reclamar e so aparece como "No handler registered for 'x'" quando o
 * usuario clica no botao.
 *
 * Este teste le os dois arquivos como texto e cobra a correspondencia nos dois
 * sentidos. E a unica rede possivel para esse contrato.
 */

const SRC = join(__dirname, '..')

function read(rel: string): string {
  return readFileSync(join(SRC, rel), 'utf8')
}

function matchAll(source: string, re: RegExp): string[] {
  return [...source.matchAll(re)].map((m) => m[1]).sort()
}

const preload = read('preload/index.ts')
const ipc = read('main/ipc.ts')

/** Canais que o renderer chama via ipcRenderer.invoke('x'). */
const invoked = matchAll(preload, /ipcRenderer\.invoke\(\s*'([^']+)'/g)
/** Canais que o main atende via ipcMain.handle('x'). */
const handled = matchAll(ipc, /ipcMain\.handle\(\s*'([^']+)'/g)

/** Eventos que o preload assina via subscribe('x', ...). */
const subscribed = matchAll(preload, /subscribe(?:<[^>]*>)?\(\s*'([^']+)'/g)
/** Eventos que o main emite via broadcast('x', ...). */
const broadcast = matchAll(ipc, /broadcast\(\s*'([^']+)'/g)

describe('contrato IPC entre preload e main', () => {
  it('encontra canais nos dois arquivos (o regex nao silenciou)', () => {
    expect(invoked.length).toBeGreaterThan(0)
    expect(handled.length).toBeGreaterThan(0)
    expect(subscribed.length).toBeGreaterThan(0)
    expect(broadcast.length).toBeGreaterThan(0)
  })

  it('todo invoke() do preload tem um handle() no main', () => {
    const semHandler = invoked.filter((c) => !handled.includes(c))
    expect(semHandler, `canais chamados sem handler no main: ${semHandler.join(', ')}`).toEqual([])
  })

  it('todo handle() do main e alcancavel pelo preload', () => {
    const orfaos = handled.filter((c) => !invoked.includes(c))
    expect(orfaos, `handlers no main que ninguem chama: ${orfaos.join(', ')}`).toEqual([])
  })

  it('todo evento assinado pelo preload e emitido pelo main', () => {
    const semEmissor = subscribed.filter((c) => !broadcast.includes(c))
    expect(semEmissor, `eventos assinados que ninguem emite: ${semEmissor.join(', ')}`).toEqual([])
  })

  it('nao ha canal duplicado', () => {
    expect(new Set(handled).size).toBe(handled.length)
    expect(new Set(invoked).size).toBe(invoked.length)
  })
})
