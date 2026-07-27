import type { DisparApi } from '@shared/types'

declare global {
  interface Window {
    api: DisparApi
  }
}

export {}
