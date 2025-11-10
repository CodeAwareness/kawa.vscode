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
   * Initialize translation layer - fetch user's language preference
   */
  async init(): Promise<void> {
    try {
      const response = await CAWIPC.transmit('get-language')
      if (response && response.language) {
        currentLanguage = response.language
        logger.log(`Translation: User language set to ${currentLanguage}`)
      }
    } catch (error) {
      logger.error('Translation: Failed to get user language', error)
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
   */
  setLanguage(language: string): void {
    currentLanguage = language
  },

  /**
   * Check if document is currently showing translated content
   */
  isTranslated(uri: vscode.Uri): boolean {
    return translatedDocuments.has(uri.toString())
  },

  /**
   * Mark document as translated
   */
  markAsTranslated(uri: vscode.Uri): void {
    translatedDocuments.add(uri.toString())
  },

  /**
   * Mark document as not translated
   */
  markAsUntranslated(uri: vscode.Uri): void {
    translatedDocuments.delete(uri.toString())
  },

  /**
   * Translate document content after opening
   * Called when a file is activated
   */
  async translateDocument(editor: vscode.TextEditor): Promise<void> {
    // Skip if language is English or no editor
    if (currentLanguage === 'en' || !editor) {
      return
    }

    const document = editor.document
    const filePath = document.uri.fsPath

    // Skip if not a supported file type
    if (!CAWTranslation.isSupportedFile(filePath)) {
      return
    }

    try {
      logger.log(`Translation: Translating file to ${currentLanguage}: ${filePath}`)

      // Read English content from disk (the actual file content)
      const englishContent = document.getText()

      // Request translated version from Gardener
      console.log('[CAWTranslation] Sending read-file request for:', filePath)
      const response = await CAWIPC.transmit('read-file', {
        filePath: filePath,
        repoId: null // TODO: get actual repoId from project
      })

      console.log('[CAWTranslation] Received response:', response)
      console.log('[CAWTranslation] Response type:', typeof response)
      console.log('[CAWTranslation] Response has content?', response && 'content' in response)

      if (response && response.content) {
        console.log('[CAWTranslation] Applying edit to document...')
        console.log('[CAWTranslation] English content length:', englishContent.length)
        console.log('[CAWTranslation] Translated content length:', response.content.length)

        // Show preview of translated content (first 300 chars)
        const preview = response.content.substring(0, 300)
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

        edit.replace(document.uri, fullRange, response.content)
        console.log('[CAWTranslation] Edit created, applying...')

        const success = await vscode.workspace.applyEdit(edit)
        console.log('[CAWTranslation] Edit applied, success:', success)

        if (success) {
          CAWTranslation.markAsTranslated(document.uri)
          console.log('[CAWTranslation] Document marked as translated')
          logger.log(`Translation: Successfully translated document to ${currentLanguage}`)
        } else {
          console.error('[CAWTranslation] Failed to apply edit!')
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
    // Skip if not translated
    if (!CAWTranslation.isTranslated(document.uri)) {
      return false // Let normal save proceed
    }

    const filePath = document.uri.fsPath
    const translatedContent = document.getText()

    try {
      logger.log(`Translation: Saving translated file back to English: ${filePath}`)

      // Send translated content to Gardener's writeFile
      // Gardener will translate back to English and write to disk
      const response = await CAWIPC.transmit('write-file', {
        filePath: filePath,
        content: translatedContent,
        repoId: null // TODO: get actual repoId from project
      })

      if (response && response.success) {
        logger.log('Translation: Successfully saved English content to disk')

        // Mark as untranslated since the file now contains English
        CAWTranslation.markAsUntranslated(document.uri)

        // Re-read and translate again for continued editing
        const editor = vscode.window.activeTextEditor
        if (editor && editor.document.uri.toString() === document.uri.toString()) {
          // Small delay to let the file system settle
          setTimeout(() => {
            CAWTranslation.translateDocument(editor)
          }, 100)
        }

        return true // We handled the save
      } else {
        throw new Error(response?.err || 'Write failed')
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
