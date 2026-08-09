import type { OrganizadorApi } from '@shared/types'

declare global {
  interface Window {
    api: OrganizadorApi
  }
}

export {}
