/**
 * URI Utilities for Translated FileSystem
 *
 * Handles creation and parsing of kawa-translated:// URIs that map
 * translated editor content to English files on disk.
 */
import * as vscode from 'vscode'

export const TRANSLATED_SCHEME = 'kawa-translated'

// File extensions that support translation
const TRANSLATABLE_EXTENSIONS = new Set([
  '.js', '.jsx', '.ts', '.tsx', '.mjs', '.cjs'
])

export interface TranslatedUriParams {
  originalUri: vscode.Uri
  targetLang: string
}

/**
 * Create a translated URI from a file:// URI and target language
 *
 * Format: kawa-translated:///path/to/file.ts?originalUri=file:///path/to/file.ts&lang=ja
 */
export function createTranslatedUri(originalUri: vscode.Uri, targetLang: string): vscode.Uri {
  const query = `originalUri=${encodeURIComponent(originalUri.toString())}&lang=${targetLang}`
  return vscode.Uri.parse(`${TRANSLATED_SCHEME}://${originalUri.path}?${query}`)
}

/**
 * Parse a translated URI to extract original URI and target language
 *
 * @returns TranslatedUriParams or null if not a valid translated URI
 */
export function parseTranslatedUri(uri: vscode.Uri): TranslatedUriParams | null {
  if (uri.scheme !== TRANSLATED_SCHEME) {
    return null
  }

  const params = new URLSearchParams(uri.query)
  const originalUriStr = params.get('originalUri')
  const lang = params.get('lang')

  if (!originalUriStr || !lang) {
    return null
  }

  return {
    originalUri: vscode.Uri.parse(decodeURIComponent(originalUriStr)),
    targetLang: lang
  }
}

/**
 * Get the original file:// URI from a translated URI
 *
 * @returns Original URI or null if not a valid translated URI
 */
export function getOriginalUri(uri: vscode.Uri): vscode.Uri | null {
  const params = parseTranslatedUri(uri)
  return params?.originalUri ?? null
}

/**
 * Check if a file path is translatable based on extension
 */
export function isTranslatableFile(filePath: string): boolean {
  const lastDot = filePath.lastIndexOf('.')
  if (lastDot === -1) return false

  const ext = filePath.slice(lastDot).toLowerCase()
  return TRANSLATABLE_EXTENSIONS.has(ext)
}

/**
 * Check if a URI is a translated URI
 */
export function isTranslatedUri(uri: vscode.Uri): boolean {
  return uri.scheme === TRANSLATED_SCHEME
}
