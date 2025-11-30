import { window, StatusBarAlignment } from 'vscode'
import CAWIPC from '@/lib/caw.ipc'

let statusBarItem: any = null
let languageStatusBarItem: any = null
let pulse = 0

export const CAWStatusbar = {

  init: () => {
    if (!statusBarItem) {
      statusBarItem = window.createStatusBarItem(StatusBarAlignment.Right, 100)
      statusBarItem.show()
    }

    if (!languageStatusBarItem) {
      languageStatusBarItem = window.createStatusBarItem(StatusBarAlignment.Right, 99)
      languageStatusBarItem.command = 'caw.selectLanguage'
      languageStatusBarItem.tooltip = 'Click to change coding language'
      languageStatusBarItem.show()

      // Initialize with current language
      CAWStatusbar.updateLanguage('en') // Default to English

      // Fetch actual language from Gardener
      CAWIPC.transmit('user:get-language')
        .then((data: any) => {
          if (data && data.language) {
            CAWStatusbar.updateLanguage(data.language)
          }
        })
        .catch(() => {
          // If fetch fails, keep default
        })
    }

    CAWStatusbar.working('loading...') // TODO: this doesn't work. Is it an older API?
    CAWStatusbar.live()
  },

  working: (workingMsg = 'Working on it...') => {
    statusBarItem.text = `${pulse++} ${workingMsg}...`
    statusBarItem.tooltip = 'In case if it takes long time, check if your Code Awareness local service is running.'
  },

  live: () => {
    statusBarItem.text = 'CodeAwareness'
    statusBarItem.command = 'caw.toggle'
    statusBarItem.tooltip = 'Toggle CodeAwareness panel'
  },

  updateLanguage: (language: string) => {
    if (!languageStatusBarItem) return

    const languageLabels: Record<string, string> = {
      en: '🇺🇸 EN',
      ja: '🇯🇵 JA',
      es: '🇪🇸 ES',
      zh: '🇨🇳 ZH',
      ar: '🇸🇦 AR',
    }

    const languageNames: Record<string, string> = {
      en: 'English',
      ja: '日本語',
      es: 'Español',
      zh: '中文',
      ar: 'العربية',
    }

    languageStatusBarItem.text = languageLabels[language] || '🌐 ??'
    languageStatusBarItem.tooltip = `Coding Language: ${languageNames[language] || language} (click to change)`
  },

  dispose: () => {
    if (statusBarItem) {
      statusBarItem.dispose()
    }
    if (languageStatusBarItem) {
      languageStatusBarItem.dispose()
    }
  },
}
