import type { CopilotApi } from '../shared/types'

declare global {
  interface Window {
    copilot: CopilotApi
  }
}
