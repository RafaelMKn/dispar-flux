import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Gravacao de nota de voz pelo microfone.
 *
 * O Chromium (e portanto o Electron) so grava Opus dentro de um container
 * WebM — nao existe opcao de Ogg no `MediaRecorder`. Como o WhatsApp exige
 * Ogg para nota de voz, o processo main faz o remux depois; aqui so
 * capturamos.
 */

/** Teto de duracao: evita mandar sem querer um audio de meia hora. */
const MAX_SECONDS = 300

export interface VoiceRecorder {
  recording: boolean
  seconds: number
  error: string | null
  start: () => Promise<void>
  /** Encerra e devolve o audio em base64, ou null se nao gravou nada. */
  stop: () => Promise<{ base64: string; seconds: number } | null>
  /** Descarta a gravacao em andamento. */
  cancel: () => void
}

function pickMimeType(): string {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm']
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? ''
}

export function useVoiceRecorder(): VoiceRecorder {
  const [recording, setRecording] = useState(false)
  const [seconds, setSeconds] = useState(0)
  const [error, setError] = useState<string | null>(null)

  const recorderRef = useRef<MediaRecorder | null>(null)
  const chunksRef = useRef<Blob[]>([])
  const streamRef = useRef<MediaStream | null>(null)
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const discardedRef = useRef(false)

  const teardown = useCallback(() => {
    if (tickRef.current) clearInterval(tickRef.current)
    tickRef.current = null
    // Soltar as trilhas apaga o indicador de microfone em uso do sistema.
    streamRef.current?.getTracks().forEach((t) => t.stop())
    streamRef.current = null
    recorderRef.current = null
    setRecording(false)
  }, [])

  // Se a tela for fechada no meio da gravacao, o microfone precisa ser liberado.
  useEffect(() => teardown, [teardown])

  const start = useCallback(async () => {
    setError(null)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      streamRef.current = stream

      const mimeType = pickMimeType()
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      chunksRef.current = []
      discardedRef.current = false
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data)
      }
      recorder.start()
      recorderRef.current = recorder

      setSeconds(0)
      setRecording(true)
      tickRef.current = setInterval(() => {
        setSeconds((s) => {
          if (s + 1 >= MAX_SECONDS) recorder.stop()
          return s + 1
        })
      }, 1000)
    } catch (e) {
      teardown()
      setError(
        e instanceof Error && e.name === 'NotAllowedError'
          ? 'Permissao de microfone negada. Libere o acesso nas configuracoes do sistema.'
          : 'Nao foi possivel acessar o microfone.'
      )
    }
  }, [teardown])

  const stop = useCallback(async (): Promise<{ base64: string; seconds: number } | null> => {
    const recorder = recorderRef.current
    if (!recorder) return null
    const recorded = seconds

    const blob = await new Promise<Blob | null>((resolve) => {
      recorder.onstop = () => {
        resolve(discardedRef.current ? null : new Blob(chunksRef.current))
      }
      if (recorder.state !== 'inactive') recorder.stop()
      else resolve(null)
    })
    teardown()

    if (!blob || blob.size === 0) return null
    const buffer = await blob.arrayBuffer()
    // O IPC nao carrega Blob; base64 e o formato que atravessa o preload.
    let binary = ''
    const bytes = new Uint8Array(buffer)
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
    return { base64: btoa(binary), seconds: Math.max(1, recorded) }
  }, [seconds, teardown])

  const cancel = useCallback(() => {
    discardedRef.current = true
    try {
      if (recorderRef.current?.state !== 'inactive') recorderRef.current?.stop()
    } catch {
      // ja parado
    }
    teardown()
    setSeconds(0)
  }, [teardown])

  return { recording, seconds, error, start, stop, cancel }
}
