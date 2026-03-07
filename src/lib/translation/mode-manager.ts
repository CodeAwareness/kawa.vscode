/**
 * Translation Mode Manager
 *
 * Manages the translation mode lifecycle:
 * - Enable/disable translation mode
 * - Redirect file opens to translated scheme
 * - Handle currently open documents when mode changes
 */
import * as vscode from 'vscode'
import logger from '@/lib/logger'
import i18nIPC from '@/lib/i18n.ipc'
import CAWIPC from '@/lib/caw.ipc'
import {
  TRANSLATED_SCHEME,
  createTranslatedUri,
  getOriginalUri,
  isTranslatableFile,
  isTranslatedUri
} from './uri-utils'
import { getTranslatedFSProvider } from './translated-fs-provider'

// Module state
let translationModeActive = false
let currentLanguage = 'en'
let fileOpenDisposable: vscode.Disposable | null = null
let i18nInitialized = false

/**
 * Initialize connection to i18n extension
 * Must be called before using translation features
 */
async function ensureI18nConnection(): Promise<boolean> {
  if (i18nInitialized && i18nIPC.isConnected()) {
    return true
  }

  try {
    // Set the CAW ID from main IPC
    i18nIPC.setCaw(CAWIPC.guid)

    // Connect to i18n extension socket
    await i18nIPC.connect()
    i18nInitialized = true
    logger.log('[ModeManager] Connected to i18n extension')
    return true
  } catch (error) {
    logger.error(`[ModeManager] Failed to connect to i18n extension: ${error}`)
    return false
  }
}

/**
 * Check if translation mode is currently active
 */
export function isTranslationModeActive(): boolean {
  return translationModeActive
}

/**
 * Check if i18n connection is ready for translation
 */
export function isI18nReady(): boolean {
  return i18nInitialized && i18nIPC.isConnected()
}

/**
 * Get the current translation language
 */
export function getCurrentLanguage(): string {
  return currentLanguage
}

/**
 * Enable translation mode for a specific language
 *
 * This will:
 * 1. Connect to i18n extension
 * 2. Set the language in the FileSystemProvider
 * 3. Set up file open interception
 * 4. Redirect currently open translatable files
 */
export async function enableTranslationMode(lang: string): Promise<void> {
  if (lang === 'en') {
    // English means no translation needed
    await disableTranslationMode()
    return
  }

  logger.log(`[ModeManager] Enabling translation mode for: ${lang}`)

  // Ensure i18n connection is established
  const connected = await ensureI18nConnection()
  if (!connected) {
    vscode.window.showErrorMessage(
      'Failed to connect to i18n translation service. Make sure Kawa Code is running with the i18n extension enabled.'
    )
    return
  }

  currentLanguage = lang
  translationModeActive = true

  // Update FileSystemProvider
  const provider = getTranslatedFSProvider()
  provider.setLanguage(lang)

  // Sync language with i18n extension
  try {
    await i18nIPC.transmit('user', 'set-language', { lang })
    logger.log(`[ModeManager] Synced language '${lang}' with i18n extension`)
  } catch (error) {
    logger.error(`[ModeManager] Failed to sync language with i18n: ${error}`)
  }

  // Notify Kawa Code about language change
  try {
    await CAWIPC.transmit('user:set-language', { language: lang })
  } catch (error) {
    logger.error(`[ModeManager] Failed to notify Kawa Code: ${error}`)
  }

  // Set up file open interception
  setupFileOpenInterception()

  // Redirect currently open files
  await redirectOpenDocuments(lang)

  logger.log(`[ModeManager] Translation mode enabled for: ${lang}`)
}

/**
 * Disable translation mode
 *
 * This will:
 * 1. Save any dirty translated documents
 * 2. Close translated documents and reopen as file://
 * 3. Clear caches
 */
export async function disableTranslationMode(): Promise<void> {
  if (!translationModeActive && currentLanguage === 'en') {
    return
  }

  logger.log('[ModeManager] Disabling translation mode')

  translationModeActive = false
  currentLanguage = 'en'

  // Remove file open interception
  if (fileOpenDisposable) {
    fileOpenDisposable.dispose()
    fileOpenDisposable = null
  }

  // Update FileSystemProvider
  const provider = getTranslatedFSProvider()
  provider.setLanguage('en')
  provider.clearCache()

  // Sync language with i18n extension
  try {
    if (i18nIPC.isConnected()) {
      await i18nIPC.transmit('user', 'set-language', { lang: 'en' })
    }
  } catch (error) {
    logger.error(`[ModeManager] Failed to sync language with i18n: ${error}`)
  }

  // Revert translated documents to file://
  await revertTranslatedDocuments()

  logger.log('[ModeManager] Translation mode disabled')
}

/**
 * Set up interception of file opens to redirect to translated scheme
 */
function setupFileOpenInterception(): void {
  // Clean up existing interception
  if (fileOpenDisposable) {
    fileOpenDisposable.dispose()
  }

  // Intercept document opens
  fileOpenDisposable = vscode.workspace.onDidOpenTextDocument(async (doc) => {
    // Only intercept when translation mode is active
    if (!translationModeActive) return

    // Only intercept file:// scheme
    if (doc.uri.scheme !== 'file') return

    // Only intercept translatable files
    if (!isTranslatableFile(doc.uri.fsPath)) return

    // Check if this is a user-initiated open (visible in editor)
    // We need a small delay to check if the document becomes visible
    setTimeout(async () => {
      // Find if this document is shown in any visible editor
      const editor = vscode.window.visibleTextEditors.find(
        e => e.document.uri.toString() === doc.uri.toString()
      )

      if (!editor) return

      logger.log(`[ModeManager] Redirecting file open: ${doc.uri.fsPath}`)

      try {
        const viewColumn = editor.viewColumn

        // Create translated URI
        const translatedUri = createTranslatedUri(doc.uri, currentLanguage)

        // Close the original file:// document
        await vscode.commands.executeCommand('workbench.action.closeActiveEditor')

        // Open the translated version
        await vscode.window.showTextDocument(translatedUri, { viewColumn })
      } catch (error) {
        logger.error(`[ModeManager] Failed to redirect file: ${error}`)
      }
    }, 50)
  })
}

/**
 * Redirect all currently open translatable documents to translated scheme
 */
async function redirectOpenDocuments(targetLang: string): Promise<void> {
  const editors = [...vscode.window.visibleTextEditors]

  for (const editor of editors) {
    const doc = editor.document

    // Skip non-file schemes
    if (doc.uri.scheme !== 'file') continue

    // Skip non-translatable files
    if (!isTranslatableFile(doc.uri.fsPath)) continue

    try {
      const viewColumn = editor.viewColumn
      const translatedUri = createTranslatedUri(doc.uri, targetLang)

      logger.log(`[ModeManager] Redirecting open document: ${doc.uri.fsPath}`)

      // Check if dirty - need to save first
      if (doc.isDirty) {
        await doc.save()
      }

      // Close the original
      await vscode.window.showTextDocument(doc)
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor')

      // Open translated version
      await vscode.window.showTextDocument(translatedUri, { viewColumn })
    } catch (error) {
      logger.error(`[ModeManager] Failed to redirect document: ${error}`)
    }
  }
}

/**
 * Revert all translated documents back to file:// scheme
 */
async function revertTranslatedDocuments(): Promise<void> {
  const editors = [...vscode.window.visibleTextEditors]

  for (const editor of editors) {
    const doc = editor.document

    // Only process translated scheme
    if (!isTranslatedUri(doc.uri)) continue

    try {
      const originalUri = getOriginalUri(doc.uri)
      if (!originalUri) continue

      const viewColumn = editor.viewColumn

      logger.log(`[ModeManager] Reverting to original: ${originalUri.fsPath}`)

      // Check if dirty - need to save first (this writes English to disk)
      if (doc.isDirty) {
        await doc.save()
      }

      // Close the translated document
      await vscode.window.showTextDocument(doc)
      await vscode.commands.executeCommand('workbench.action.closeActiveEditor')

      // Open the original file:// version
      await vscode.window.showTextDocument(originalUri, { viewColumn })
    } catch (error) {
      logger.error(`[ModeManager] Failed to revert document: ${error}`)
    }
  }
}

/**
 * Dispose mode manager resources
 */
export function dispose(): void {
  if (fileOpenDisposable) {
    fileOpenDisposable.dispose()
    fileOpenDisposable = null
  }
  translationModeActive = false
  currentLanguage = 'en'
  i18nInitialized = false

  // Disconnect from i18n
  i18nIPC.disconnect()
}
