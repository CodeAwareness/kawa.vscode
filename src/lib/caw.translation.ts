/**
 * Translation Layer for Code Awareness
 * Handles translating code between user's preferred language and English
 *
 * Uses direct IPC to i18n extension for lower latency, with fallback to Muninn routing.
 */
import * as vscode from 'vscode'
import logger from '@/lib/logger'
import CAWIPC from '@/lib/caw.ipc'
import i18nIPC from '@/lib/i18n.ipc'
import CAWEditor from '@/lib/caw.editor'
import CAWPanel from '@/lib/caw.panel'
import CAWTDP from '@/lib/caw.tdp'

// Track which documents are currently showing translated content
const translatedDocuments = new Set<string>()

// Current user language
let currentLanguage = 'en'

// Whether direct i18n connection is available
let directConnectionAvailable = false

export const CAWTranslation = {
  /**
   * Initialize translation layer
   * Attempts to connect directly to i18n extension for lower latency
   */
  async init(): Promise<void> {
    // Language defaults to 'en', user can change via caw.selectLanguage command
    logger.log(`Translation: Initialized with language ${currentLanguage}`)

    // Try to establish direct connection to i18n extension
    try {
      // Pass the CAW ID from main IPC to i18n IPC
      i18nIPC.setCaw(CAWIPC.guid)

      await i18nIPC.connect()
      directConnectionAvailable = true
      logger.log('Translation: Direct connection to i18n established')

      // Sync language with i18n extension
      await i18nIPC.transmit('user', 'set-language', { lang: currentLanguage })
    } catch (error) {
      logger.log(`Translation: Direct i18n connection not available, using Muninn routing`)
      directConnectionAvailable = false
    }
  },

  /**
   * Get current language
   */
  getLanguage(): string {
    return currentLanguage
  },

  /**
   * Set current language
   * Syncs with i18n extension if direct connection is available
   */
  async setLanguage(language: string): Promise<void> {
    currentLanguage = language

    // Sync with i18n extension
    if (directConnectionAvailable && i18nIPC.isConnected()) {
      try {
        await i18nIPC.transmit('user', 'set-language', { lang: language })
        logger.log(`Translation: Synced language '${language}' with i18n extension`)
      } catch (error) {
        logger.log(`Translation: Failed to sync language with i18n: ${error}`)
      }
    }
  },

  /**
   * Translate document content after opening
   * Called when a file is activated
   * Uses direct i18n connection when available, falls back to Muninn routing
   */
  async translateDocument(editor: vscode.TextEditor): Promise<void> {
    const document = editor.document
    const filePath = document.uri.fsPath

    console.log('[CAWTranslation] translateDocument called for:', filePath, 'target:', currentLanguage)

    if (!editor) {
      console.log('[CAWTranslation] No editor, returning')
      return
    }
    if (!CAWTranslation.isSupportedFile(filePath)) {
      console.log('[CAWTranslation] File not supported:', filePath)
      return
    }

    try {
      logger.log(`Translation: Translating file to ${currentLanguage}: ${filePath}`)
      console.log('[CAWTranslation] Direct connection available:', directConnectionAvailable, 'connected:', i18nIPC.isConnected())

      // Read English content from disk (the actual file content)
      const englishContent = document.getText()

      let response: any

      // Try direct i18n connection first for lower latency
      if (directConnectionAvailable && i18nIPC.isConnected()) {
        console.log('[CAWTranslation] Using direct i18n connection for:', filePath)
        try {
          response = await i18nIPC.transmit('i18n', 'translate-code', {
            code: englishContent,
            filePath,
            targetLang: currentLanguage,
          })
        } catch (directError) {
          console.log('[CAWTranslation] Direct connection failed, falling back to Muninn:', directError)
          directConnectionAvailable = false
          // Fall through to Muninn routing
        }
      }

      // Fall back to Muninn routing if direct connection not available
      if (!response) {
        console.log('[CAWTranslation] Using Muninn routing for:', filePath)
        response = await CAWIPC.transmit('i18n:translate-code', {
          code: englishContent,
          filePath,
          targetLang: currentLanguage,
        })
      }

      console.log('[CAWTranslation] Received response:', response)

      // Check if translation is happening in background
      if (response && response.translating && !response.success) {
        logger.log(`Translation: ${response.message || 'Translation initiated in background'}`)
        // Don't apply any changes - user continues working in English
        return
      }

      if (response && response.success && response.code) {
        console.log('[CAWTranslation] Applying edit to document...')
        console.log('[CAWTranslation] English content length:', englishContent.length)
        console.log('[CAWTranslation] Translated content length:', response.code.length)

        // Show preview of translated content (first 300 chars)
        const preview = response.code.substring(0, 300)
        console.log('[CAWTranslation] Translated content preview:', preview)
        console.log('[CAWTranslation] Document URI:', document.uri.toString())
        console.log('[CAWTranslation] Document is closed?', document.isClosed)

        // Replace editor content with translated version
        const edit = new vscode.WorkspaceEdit()
        const fullRange = new vscode.Range(
          document.positionAt(0),
          document.positionAt(englishContent.length)
        )
        console.log('[CAWTranslation] Full range:', fullRange.start.line, fullRange.start.character, '->', fullRange.end.line, fullRange.end.character)

        edit.replace(document.uri, fullRange, response.code)
        console.log('[CAWTranslation] Edit created, applying...')

        const success = await vscode.workspace.applyEdit(edit)
        console.log('[CAWTranslation] Edit applied, success:', success)

        if (success) {
          logger.log(`Translation: Successfully translated document to ${currentLanguage}`)
        } else {
          logger.error('Translation: Failed to apply translated content')
        }
      } else {
        console.log('[CAWTranslation] No content in response or response is null')
      }
    } catch (error) {
      console.error('[CAWTranslation] Exception caught:', error)
      console.error('[CAWTranslation] Error stack:', error instanceof Error ? error.stack : 'N/A')
      logger.error(`Translation: Failed to translate document: ${error}`)
      vscode.window.showWarningMessage(`Failed to translate file: ${error}`)
    }
  },

  /**
   * Translate document content back to English before saving
   * Called when user saves a file
   * Uses direct i18n connection (file-saved handler) when available
   */
  async saveTranslatedDocument(document: vscode.TextDocument): Promise<boolean> {
    if (currentLanguage === 'en') return false // Let normal save proceed

    const filePath = document.uri.fsPath
    const translatedContent = document.getText()

    try {
      logger.log(`Translation: Saving translated file back to English: ${filePath}`)

      let response: any

      // Try direct i18n connection first (uses file-saved handler)
      if (directConnectionAvailable && i18nIPC.isConnected()) {
        console.log('[CAWTranslation] Using direct i18n for save:', filePath)
        try {
          response = await i18nIPC.transmit('i18n', 'file-saved', {
            code: translatedContent,
            filePath: filePath,
          })
        } catch (directError) {
          console.log('[CAWTranslation] Direct save failed, falling back to Muninn:', directError)
          directConnectionAvailable = false
        }
      }

      // Fall back to Muninn routing
      if (!response) {
        console.log('[CAWTranslation] Using Muninn routing for save:', filePath)
        response = await CAWIPC.transmit('i18n:translate-code', {
          code: translatedContent,
          filePath: filePath,
          targetLang: 'en',
        })
      }

      if (response && response.success && response.code) {
        logger.log('Translation: Successfully translated back to English')

        // Write the English content to disk using VSCode API
        const englishContent = response.code
        const fileUri = document.uri
        await vscode.workspace.fs.writeFile(fileUri, Buffer.from(englishContent, 'utf-8'))

        // Notify Gardener about the save with the ENGLISH content (not the Japanese buffer)
        // This is the single source of truth - no Muninn intercept needed
        const gardenerResponse = await CAWIPC.transmit('file-saved', {
          fpath: filePath,
          doc: englishContent,  // English content we just wrote to disk
          caw: CAWIPC.guid
        })

        // Update decorations and panel with Gardener response
        await CAWEditor.updateDecorations(gardenerResponse)
        const project = await CAWPanel.updateProject(gardenerResponse)
        if (project?.tree) {
          project.tree.map(CAWTDP.addFile(project.root))
          CAWTDP.refresh()
        }

        // Re-translate for continued editing
        const editor = vscode.window.activeTextEditor
        if (editor && editor.document.uri.toString() === document.uri.toString()) {
          // Small delay to let the file system settle
          setTimeout(() => {
            CAWTranslation.translateDocument(editor)
          }, 100)
        }

        return true // We handled the save
      } else {
        throw new Error(response?.error || 'Translation failed')
      }
    } catch (error) {
      logger.error(`Translation: Failed to save translated document: ${error}`)
      vscode.window.showErrorMessage(`Failed to save translated file: ${error}`)
      return false
    }
  },

  /**
   * Check if file type is supported for translation
   */
  isSupportedFile(filePath: string): boolean {
    const supportedExtensions = ['.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs']
    return supportedExtensions.some(ext => filePath.endsWith(ext))
  },

  /**
   * Clear all translation state
   */
  dispose(): void {
    translatedDocuments.clear()
    currentLanguage = 'en'
    directConnectionAvailable = false

    // Disconnect from i18n extension
    i18nIPC.disconnect()
  }
}

export default CAWTranslation
