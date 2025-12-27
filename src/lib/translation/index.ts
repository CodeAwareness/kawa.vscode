/**
 * Translation Module
 *
 * Provides transparent translation layer using VSCode FileSystemProvider.
 * Files on disk are always English; editor shows user's preferred language.
 */

// URI utilities
export {
  TRANSLATED_SCHEME,
  createTranslatedUri,
  parseTranslatedUri,
  getOriginalUri,
  isTranslatableFile,
  isTranslatedUri
} from './uri-utils'

// FileSystemProvider
export {
  TranslatedFileSystemProvider,
  getTranslatedFSProvider,
  disposeTranslatedFSProvider
} from './translated-fs-provider'

// Mode manager
export {
  isTranslationModeActive,
  isI18nReady,
  getCurrentLanguage,
  enableTranslationMode,
  disableTranslationMode,
  dispose as disposeModeManager
} from './mode-manager'
