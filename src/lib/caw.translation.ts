/**
 * Translation Layer for Code Awareness
 * Handles translating code between user's preferred language and English
 */
import * as vscode from 'vscode'
import logger from '@/lib/logger'
import CAWIPC from '@/lib/caw.ipc'

// Track which documents are currently showing translated content
const translatedDocuments = new Set<string>()

// Current user language
let currentLanguage = 'en'

export const CAWTranslation = {
  /**
   * Initialize translation layer
   * Language preference is stored locally in the extension (defaults to 'en')
   */
  async init(): Promise<void> {
    // Language defaults to 'en', user can change via caw.selectLanguage command
    logger.log(`Translation: Initialized with language ${currentLanguage}`)
  },

  /**
   * Get current language
   */
  getLanguage(): string {
    return currentLanguage
  },

  /**
   * Set current language
   */
  setLanguage(language: string): void {
    currentLanguage = language
  },

  /**
   * Translate document content after opening
   * Called when a file is activated
   */
  async translateDocument(editor: vscode.TextEditor): Promise<void> {
    const document = editor.document
    const filePath = document.uri.fsPath

    if (currentLanguage === 'en' || !editor) return
    if (!CAWTranslation.isSupportedFile(filePath)) return

    try {
      logger.log(`Translation: Translating file to ${currentLanguage}: ${filePath}`)

      // Read English content from disk (the actual file content)
      const englishContent = document.getText()

      // Request translated version from i18n extension via domain-based routing
      console.log('[CAWTranslation] Sending i18n:translate-code request for:', filePath)
      const response = await CAWIPC.transmit('i18n:translate-code', {
        code: englishContent,
        filePath,
        targetLang: currentLanguage,
      })

      console.log('[CAWTranslation] Received response:', response)

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
   */
  async saveTranslatedDocument(document: vscode.TextDocument): Promise<boolean> {
    if (currentLanguage === 'en') return false // Let normal save proceed

    const filePath = document.uri.fsPath
    const translatedContent = document.getText()

    try {
      logger.log(`Translation: Saving translated file back to English: ${filePath}`)

      const response = await CAWIPC.transmit('i18n:translate-code', {
        code: translatedContent,
        filePath: filePath,
        targetLang: 'en',
      })

      if (response && response.success && response.code) {
        logger.log('Translation: Successfully translated back to English')

        // Write the English content to disk using VSCode API
        const englishContent = response.code
        const fileUri = document.uri
        await vscode.workspace.fs.writeFile(fileUri, Buffer.from(englishContent, 'utf-8'))

        // TODO: maybe Re-read and translate again for continued editing
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
  }
}

export default CAWTranslation
