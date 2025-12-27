/**
 * Translated FileSystem Provider
 *
 * A VSCode FileSystemProvider that transparently translates code:
 * - readFile: Reads English from disk, returns translated content
 * - writeFile: Receives translated content, writes English to disk
 *
 * This eliminates the "modified" flag issues because VSCode sees
 * the translated content as the file's actual content.
 */
import * as vscode from 'vscode'
import i18nIPC from '@/lib/i18n.ipc'
import CAWIPC from '@/lib/caw.ipc'
import logger from '@/lib/logger'
import { parseTranslatedUri, getOriginalUri, isTranslatableFile } from './uri-utils'

// Cache entry for translated content
interface CachedTranslation {
  translatedContent: Uint8Array
  englishHash: string  // Hash of original English content for invalidation
  timestamp: number
}

// LRU cache configuration
const MAX_CACHE_SIZE = 50
const MAX_CACHE_AGE_MS = 30 * 60 * 1000  // 30 minutes

/**
 * FileSystemProvider that provides translated content
 */
export class TranslatedFileSystemProvider implements vscode.FileSystemProvider {
  private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>()
  readonly onDidChangeFile = this._emitter.event

  // Translation cache: originalUri.toString() -> CachedTranslation
  private cache = new Map<string, CachedTranslation>()

  // Active file watchers for real files
  private watchers = new Map<string, vscode.Disposable>()

  // Current user language (set by mode manager)
  private currentLanguage = 'en'

  /**
   * Set the current language for translations
   */
  setLanguage(lang: string): void {
    if (this.currentLanguage !== lang) {
      this.currentLanguage = lang
      // Invalidate cache when language changes
      this.clearCache()
      logger.log(`[TranslatedFS] Language set to: ${lang}`)
    }
  }

  /**
   * Get the current language
   */
  getLanguage(): string {
    return this.currentLanguage
  }

  /**
   * Clear all cached translations
   */
  clearCache(): void {
    this.cache.clear()
    logger.log('[TranslatedFS] Cache cleared')
  }

  /**
   * Get file stats from the original file
   */
  async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
    const originalUri = getOriginalUri(uri)
    if (!originalUri) {
      throw vscode.FileSystemError.FileNotFound(uri)
    }

    try {
      const realStat = await vscode.workspace.fs.stat(originalUri)
      return {
        type: realStat.type,
        ctime: realStat.ctime,
        mtime: realStat.mtime,
        size: realStat.size  // Note: actual translated size may differ
      }
    } catch {
      throw vscode.FileSystemError.FileNotFound(uri)
    }
  }

  /**
   * Read file: Read English from disk, return translated content
   */
  async readFile(uri: vscode.Uri): Promise<Uint8Array> {
    const params = parseTranslatedUri(uri)
    if (!params) {
      throw vscode.FileSystemError.FileNotFound(uri)
    }

    const { originalUri, targetLang } = params
    const cacheKey = originalUri.toString()

    // Read English content from disk
    let englishBytes: Uint8Array
    try {
      englishBytes = await vscode.workspace.fs.readFile(originalUri)
    } catch {
      throw vscode.FileSystemError.FileNotFound(uri)
    }

    const englishContent = new TextDecoder().decode(englishBytes)
    const englishHash = this.hashContent(englishContent)

    // Check cache
    const cached = this.cache.get(cacheKey)
    if (cached && cached.englishHash === englishHash && !this.isCacheExpired(cached)) {
      logger.log(`[TranslatedFS] Cache hit: ${originalUri.fsPath}`)
      return cached.translatedContent
    }

    // No translation needed for English
    if (targetLang === 'en') {
      return englishBytes
    }

    // Don't translate non-code files
    if (!isTranslatableFile(originalUri.fsPath)) {
      return englishBytes
    }

    // Translate via i18n IPC
    try {
      logger.log(`[TranslatedFS] Translating ${originalUri.fsPath} to ${targetLang}`)

      const response = await i18nIPC.transmit<{
        success: boolean
        code: string
        translating?: boolean
      }>('i18n', 'translate-code', {
        code: englishContent,
        filePath: originalUri.fsPath,
        targetLang
      })

      // Check if translation is happening in background
      if (response?.translating && !response.success) {
        logger.log(`[TranslatedFS] Translation in progress, returning English for now`)
        return englishBytes
      }

      if (response?.success && response.code) {
        const translatedBytes = new TextEncoder().encode(response.code)

        // Cache the translation
        this.cacheTranslation(cacheKey, translatedBytes, englishHash)

        logger.log(`[TranslatedFS] Translation complete: ${originalUri.fsPath}`)
        return translatedBytes
      }
    } catch (error) {
      logger.error(`[TranslatedFS] Translation failed: ${error}`)
      this.showTranslationWarning(originalUri, error)
    }

    // Fallback to English if translation fails
    return englishBytes
  }

  /**
   * Write file: Receive translated content, write English to disk
   */
  async writeFile(
    uri: vscode.Uri,
    content: Uint8Array,
    options: { create: boolean; overwrite: boolean }
  ): Promise<void> {
    const params = parseTranslatedUri(uri)
    if (!params) {
      throw vscode.FileSystemError.FileNotFound(uri)
    }

    const { originalUri, targetLang } = params
    const translatedContent = new TextDecoder().decode(content)

    // If English, write directly
    if (targetLang === 'en') {
      await vscode.workspace.fs.writeFile(originalUri, content)
      await this.notifyGardener(originalUri.fsPath, translatedContent)
      return
    }

    // Translate back to English
    try {
      logger.log(`[TranslatedFS] Saving ${originalUri.fsPath}, translating to English`)

      const response = await i18nIPC.transmit<{
        success: boolean
        code: string
      }>('i18n', 'file-saved', {
        code: translatedContent,
        filePath: originalUri.fsPath
      })

      if (response?.success && response.code) {
        const englishBytes = new TextEncoder().encode(response.code)

        // Write English to disk
        await vscode.workspace.fs.writeFile(originalUri, englishBytes)

        // Update cache with new state
        const cacheKey = originalUri.toString()
        const englishHash = this.hashContent(response.code)
        this.cacheTranslation(cacheKey, content, englishHash)

        // Notify Gardener about the save
        await this.notifyGardener(originalUri.fsPath, response.code)

        logger.log(`[TranslatedFS] Save complete: ${originalUri.fsPath}`)
        return
      }

      throw new Error(response ? 'Translation failed' : 'No response from i18n')
    } catch (error) {
      logger.error(`[TranslatedFS] Save failed: ${error}`)
      vscode.window.showErrorMessage(`Failed to save translated file: ${error}`)
      throw vscode.FileSystemError.Unavailable(uri)
    }
  }

  /**
   * Watch a file for changes
   */
  watch(
    uri: vscode.Uri,
    options: { recursive: boolean; excludes: string[] }
  ): vscode.Disposable {
    const originalUri = getOriginalUri(uri)
    if (!originalUri) {
      return new vscode.Disposable(() => {})
    }

    const cacheKey = originalUri.toString()

    // Avoid duplicate watchers
    if (this.watchers.has(cacheKey)) {
      return new vscode.Disposable(() => {})
    }

    // Create a file system watcher for the real file
    const dir = vscode.Uri.file(originalUri.fsPath.replace(/[/\\][^/\\]+$/, ''))
    const fileName = originalUri.fsPath.split(/[/\\]/).pop() || ''
    const pattern = new vscode.RelativePattern(dir, fileName)

    const watcher = vscode.workspace.createFileSystemWatcher(pattern)

    const onChange = () => {
      // Invalidate cache
      this.cache.delete(cacheKey)
      // Emit change event for virtual file
      this._emitter.fire([{ type: vscode.FileChangeType.Changed, uri }])
    }

    const disposable = vscode.Disposable.from(
      watcher,
      watcher.onDidChange(onChange),
      watcher.onDidCreate(() => {
        this._emitter.fire([{ type: vscode.FileChangeType.Created, uri }])
      }),
      watcher.onDidDelete(() => {
        this.cache.delete(cacheKey)
        this._emitter.fire([{ type: vscode.FileChangeType.Deleted, uri }])
      })
    )

    this.watchers.set(cacheKey, disposable)

    return new vscode.Disposable(() => {
      disposable.dispose()
      this.watchers.delete(cacheKey)
    })
  }

  /**
   * Read directory - pass through to real filesystem
   */
  async readDirectory(uri: vscode.Uri): Promise<[string, vscode.FileType][]> {
    const originalUri = getOriginalUri(uri)
    if (!originalUri) return []
    return vscode.workspace.fs.readDirectory(originalUri)
  }

  /**
   * Create directory - pass through to real filesystem
   */
  async createDirectory(uri: vscode.Uri): Promise<void> {
    const originalUri = getOriginalUri(uri)
    if (!originalUri) return
    await vscode.workspace.fs.createDirectory(originalUri)
  }

  /**
   * Delete - pass through to real filesystem
   */
  async delete(uri: vscode.Uri, options: { recursive: boolean }): Promise<void> {
    const originalUri = getOriginalUri(uri)
    if (!originalUri) return
    await vscode.workspace.fs.delete(originalUri, options)
    this.cache.delete(originalUri.toString())
  }

  /**
   * Rename - pass through to real filesystem
   */
  async rename(
    oldUri: vscode.Uri,
    newUri: vscode.Uri,
    options: { overwrite: boolean }
  ): Promise<void> {
    const oldOriginal = getOriginalUri(oldUri)
    const newOriginal = getOriginalUri(newUri)
    if (!oldOriginal || !newOriginal) return

    await vscode.workspace.fs.rename(oldOriginal, newOriginal, options)

    // Move cache entry
    const oldKey = oldOriginal.toString()
    const newKey = newOriginal.toString()
    const cached = this.cache.get(oldKey)
    if (cached) {
      this.cache.delete(oldKey)
      this.cache.set(newKey, cached)
    }
  }

  /**
   * Dispose all watchers
   */
  dispose(): void {
    for (const watcher of this.watchers.values()) {
      watcher.dispose()
    }
    this.watchers.clear()
    this.cache.clear()
    this._emitter.dispose()
  }

  // ===== Private helpers =====

  /**
   * Simple hash for cache invalidation
   */
  private hashContent(content: string): string {
    let hash = 0
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i)
      hash = ((hash << 5) - hash) + char
      hash = hash & hash  // Convert to 32-bit integer
    }
    return hash.toString(16)
  }

  /**
   * Check if cache entry is expired
   */
  private isCacheExpired(entry: CachedTranslation): boolean {
    return Date.now() - entry.timestamp > MAX_CACHE_AGE_MS
  }

  /**
   * Cache a translation with LRU eviction
   */
  private cacheTranslation(key: string, content: Uint8Array, englishHash: string): void {
    // Evict oldest if at capacity
    if (this.cache.size >= MAX_CACHE_SIZE) {
      let oldestKey: string | null = null
      let oldestTime = Infinity

      for (const [k, entry] of this.cache) {
        if (entry.timestamp < oldestTime) {
          oldestTime = entry.timestamp
          oldestKey = k
        }
      }

      if (oldestKey) {
        this.cache.delete(oldestKey)
      }
    }

    this.cache.set(key, {
      translatedContent: content,
      englishHash,
      timestamp: Date.now()
    })
  }

  /**
   * Notify Gardener about a file save
   */
  private async notifyGardener(filePath: string, englishContent: string): Promise<void> {
    try {
      await CAWIPC.transmit('file-saved', {
        fpath: filePath,
        doc: englishContent,
        caw: CAWIPC.guid
      })
    } catch (error) {
      logger.error(`[TranslatedFS] Failed to notify Gardener: ${error}`)
    }
  }

  /**
   * Show a warning when translation fails
   */
  private showTranslationWarning(uri: vscode.Uri, error: unknown): void {
    const message = error instanceof Error ? error.message : String(error)
    vscode.window.showWarningMessage(
      `Translation unavailable for ${uri.fsPath}: ${message}. Showing English version.`
    )
  }
}

// Singleton instance
let providerInstance: TranslatedFileSystemProvider | null = null

/**
 * Get or create the singleton provider instance
 */
export function getTranslatedFSProvider(): TranslatedFileSystemProvider {
  if (!providerInstance) {
    providerInstance = new TranslatedFileSystemProvider()
  }
  return providerInstance
}

/**
 * Dispose the singleton provider
 */
export function disposeTranslatedFSProvider(): void {
  if (providerInstance) {
    providerInstance.dispose()
    providerInstance = null
  }
}
