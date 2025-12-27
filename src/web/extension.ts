/* eslint-disable @typescript-eslint/no-non-null-assertion */
import * as vscode from 'vscode'
import * as path from 'node:path'

import { CAWStatusbar } from '@/vscode/statusbar'
import { setupCommands } from '@/vscode/commands'

import type { TCAWEditor } from '@/lib/caw.editor'

import { initConfig } from '@/lib/settings'
import CAWStore from '@/lib/caw.store'

import config from '@/config'
import logger from '@/lib/logger'
import CAWPanel from '@/lib/caw.panel'
import CAWEditor from '@/lib/caw.editor'
import CAWWorkspace from '@/lib/caw.workspace'
import CAWTDP from '@/lib/caw.tdp'
import CAWIPC from '@/lib/caw.ipc'

// New translation module with FileSystemProvider
import {
  TRANSLATED_SCHEME,
  getTranslatedFSProvider,
  disposeTranslatedFSProvider,
  disposeModeManager
} from '@/lib/translation'

let activated: boolean // extension activated !
const deactivateTasks: Array<any> = [] // keeping track of all the disposables (TODO: cleanup)

export const SCM_PEER_FILES_VIEW = 'codeAwareness'

export const activate = initCodeAwareness

export function deactivate() {
  const promises = [
    CAWStatusbar.dispose(),
    CAWWorkspace.dispose(),
    CAWIPC.dispose(),
  ]

  // Dispose translation FileSystemProvider and mode manager
  disposeModeManager()
  disposeTranslatedFSProvider()

  for (const task of deactivateTasks) {
    promises.push(task())
  }

  logger.info('CodeAwareness: extension deactivated')
  return Promise.all(promises)
}

function initCodeAwareness(context: vscode.ExtensionContext) {
  // TODO: when no projects / repos available we should skip init; currently we are getting "cannot read property 'document' of undefined
  activated = true
  initConfig()
  CAWIPC.init()

  // Register the translated FileSystemProvider
  // This provides transparent translation: files on disk are English, editor shows user's language
  const translatedFSProvider = getTranslatedFSProvider()
  context.subscriptions.push(
    vscode.workspace.registerFileSystemProvider(
      TRANSLATED_SCHEME,
      translatedFSProvider,
      { isCaseSensitive: true, isReadonly: false }
    )
  )
  logger.log('Registered translated FileSystemProvider with scheme:', TRANSLATED_SCHEME)

  // ⭐ Register callback to run after auth/handshake completes
  // This ensures CAW ID is assigned before we initialize other modules
  CAWIPC.onAuthReady(async () => {
    logger.log('Auth ready callback triggered, CAW:', CAWIPC.guid)

    // Check if there's an active editor that was open before extension activated
    const activeEditor = vscode.window.activeTextEditor

    logger.log('Checking for active editor after auth...')
    logger.log('activeTextEditor:', activeEditor ? activeEditor.document.fileName : 'undefined')
    logger.log('visibleTextEditors count:', vscode.window.visibleTextEditors.length)

    if (activeEditor) {
      logger.log('Active editor found, registering file:', activeEditor.document.fileName)

      // Set the active editor in CAWEditor
      CAWEditor.setActiveEditor(activeEditor as TCAWEditor)

      // Send active-path to register the repository
      // Translation is now handled by the FileSystemProvider when files are opened
      logger.log('Calling refreshActiveFile()...')
      try {
        const result = CAWWorkspace.refreshActiveFile()
        if (result) {
          result
            .then(() => logger.log('refreshActiveFile() completed successfully'))
            .catch((err: any) => logger.error('refreshActiveFile() failed:', err))
        }
      } catch (err) {
        logger.error('refreshActiveFile() threw error:', err)
      }
    } else {
      logger.log('No active editor found after auth')
    }
  })

  setupCommands(context)
  setupWatchers(context)
  logger.info('CodeAwareness: extension activated (workspaceFolders)', vscode.workspace.workspaceFolders)
  const disposable = {
    dispose: () => {
      CAWIPC.dispose()
    }
  }
  context.subscriptions.push(disposable)
}

const CAWDocumentContentProvider = {

  // Found this trick to transmit events between VSCode internals and our extension
  _onDidChange: new vscode.EventEmitter(),

  get onDidChange() {
    logger.info('CodeAwareness: cawDocumentContentProvider onDidChange')
    return this._onDidChange.event
  },

  dispose() {
    logger.info('CodeAwareness: cawDocumentContentProvider dispose')
    this._onDidChange.dispose()
  },

  updated(repo: any) {
    logger.info('CodeAwareness: cawDocumentContentProvider updated', repo)
    // this._onDidChange.fire(Uri.parse(`${CAW_SCHEMA}:src/extension.js`))
  },

  provideTextDocumentContent(relativePath: string) {
    // @ts-ignore
    const [, wsName, uri] = /([^/]+)\/(.+)$/.exec(relativePath.path)
    const { tmpDir, selectedPeer } = CAWStore
    const ctId = selectedPeer.user
    const userDir = path.join(tmpDir, ctId.toString(), wsName)
    const peerFile = path.join(userDir, config.EXTRACT_REPO_DIR, uri)
    // logger.info('CodeAwareness: cawDocumentContentProvider uri', relativePath.path, 'peerFile', peerFile)

    return CAWIPC.transmit('read-file', { fpath: peerFile })
      // TODO: find a better way to indicate deleted file, as opposed to new file created, as opposed to simply file not existing
      .catch(() => '') // if file not existing
  },
}

/************************************************************************************
 * Watch the workspace folder list, and register / unregister as projects.
 *
 * TDP: Tree Data Provider: showing all files affected by changes at peers (left panel)
 * SCM: Source Control Manager: trying to use internal VSCode SCM here.
 ************************************************************************************/
function setupWatchers(context: vscode.ExtensionContext) {
  const { subscriptions } = context
  CAWTDP.clearWorkspace()
  vscode.workspace.workspaceFolders?.map(wsFolder => subscriptions.push(
    CAWTDP.addPeerWorkspace(wsFolder)
  ))
  vscode.window.registerTreeDataProvider(SCM_PEER_FILES_VIEW, CAWTDP)
  // TODO: SCM files
  subscriptions.push(
    /* @ts-ignore */
    vscode.workspace.registerTextDocumentContentProvider(config.CAW_SCHEMA, CAWDocumentContentProvider)
  )
  // TODO: Code Lenses
  subscriptions.push(
    // cawCodeLensProvider()
  )
  // Sync workspace folders
  subscriptions.push(vscode.workspace.onDidChangeWorkspaceFolders(e => {
    if (!activated) initCodeAwareness(context)
    logger.info('CodeAwareness: onDidChangeWorkspaceFolders (events)', e)
    try {
      e.added.forEach(wsFolder => {
        CAWTDP.addPeerWorkspace(wsFolder)
      })
      e.removed.forEach(wsFolder => {
        CAWTDP.removePeerWorkspace(wsFolder)
      })
    } catch (ex) {
      // showErrorMessage(ex.message)
    } finally {
      // e.removed.forEach(CAWSCM.removeProject)
    }
  }))

  function findSymbolAtPosition(symbols: any, position: vscode.Position): vscode.SymbolInformation | undefined {
    let currentSymbol: vscode.SymbolInformation | undefined

    for (const symbol of symbols) {
      if (symbol.location.range.contains(position)) {
        if (!currentSymbol || symbol.location.range.start.isAfter(currentSymbol.location.range.start)) {
          currentSymbol = symbol
        }
      }
    }

    return currentSymbol
  }

  /************************************************************************************
   * Color theme changes
   ************************************************************************************/
  subscriptions.push(vscode.window.onDidChangeActiveColorTheme(e => {
    CAWStore.colorTheme = e.kind
    const data = { colorTheme: e.kind }
    CAWPanel.postMessage({ command: 'setup:color-theme', data })
  }))

  /************************************************************************************
   * User saving the activeTextEditor
   *
   * For translated files (kawa-translated:// scheme), the FileSystemProvider
   * handles translation and Gardener notification automatically.
   * This handler only processes regular file:// saves.
   ************************************************************************************/
  subscriptions.push(vscode.workspace.onDidSaveTextDocument(async (doc) => {
    // Skip translated files - FileSystemProvider handles those
    if (doc.uri.scheme === TRANSLATED_SCHEME) {
      return
    }

    // Skip non-file schemes
    if (doc.uri.scheme !== 'file') {
      return
    }

    // Normal save flow for regular files
    // TODO: some throttle mechanism to make sure we're only sending at most once per some configured interval
    CAWIPC.transmit('file-saved', { fpath: doc.fileName, doc: doc.getText(), caw: CAWIPC.guid })
      .then(CAWEditor.updateDecorations)
      .then(CAWPanel.updateProject)
      .then((project: any) => {
        project.tree?.map(CAWTDP.addFile(project.root))
        CAWTDP.refresh()
      })
  }))

  /************************************************************************************
   * User changing text in the activeTextEditor
   ************************************************************************************/
  subscriptions.push(vscode.workspace.onDidChangeTextDocument((/* event */) => {
    CAWWorkspace.docChanged()
  }))

  /************************************************************************************
   * User switching to a different file
   *
   * Translation is now handled by the FileSystemProvider via the mode manager.
   * When translation mode is active, file:// opens are redirected to kawa-translated://
   ************************************************************************************/
  vscode.window.onDidChangeActiveTextEditor(async (editor: vscode.TextEditor | undefined) => {
    if (!editor) return
    logger.log('ActiveTextEditor changed', editor.document.fileName)
    CAWEditor.setActiveEditor(editor as TCAWEditor)

    // Refresh active file to update decorations and project state
    CAWWorkspace.refreshActiveFile()
  })

  /************************************************************************************
   * User closed a file (activeTextEditor)
   * VSCode does not properly notify us on closing a tab;
   * Also, when closing a Diff window, VSCode triggers this event for the original source file, not for the diff one. (!WTF...)
   * TODO: find another workaround
   ************************************************************************************/
  subscriptions.push(vscode.window.onDidChangeVisibleTextEditors(params => {
    if (!CAWStore.activeTextEditor) return
    CAWWorkspace.closeTextDocument(params)
  }))

  /************************************************************************************
   * User navigating to a line of code inside the activeTextEditor
   ************************************************************************************/
  subscriptions.push(vscode.window.onDidChangeTextEditorSelection(event => {
    const { selections, textEditor } = event
    const { document, selection } = textEditor
    const currentLine = selection.active.line
    const currentPosition = new vscode.Position(currentLine, 0)
    const fpath = CAWStore.activeTextEditor?.document.fileName

    CAWStore.activeSelections = selections
    // Get the symbol at the current position
    vscode.commands.executeCommand('vscode.executeDocumentSymbolProvider', document.uri)
      .then(symbols => {
        if (symbols) {
          const currentSymbol = findSymbolAtPosition(symbols, currentPosition)
          if (currentSymbol) {
            const rel = `${currentSymbol.containerName || 'Global'}.${currentSymbol.name}`
            /* TODO: select lines event
            CAWIPC.transmit('context:select-lines', { fpath, selections, rel, caw: CAWIPC.guid })
              .then(CAWPanel.updateContext)
              .catch((err) => {
                // Silently ignore context:select-lines errors
                console.debug('[CAW] Context select-lines error:', err)
              })
            */
          } else {
            // outside boundaries
          }
        }
      })
  }))

  /************************************************************************************
   * initial SCM setup
   ************************************************************************************/
  const folders = vscode.workspace.workspaceFolders as vscode.WorkspaceFolder[]
  if (!folders) return
  // TODO: do we still need to do anything here?

  /************************************************************************************
   * VSCode Telemetry
   * TODO: create ApplicationInsights Key for Telemetry (Microsoft VSCode only)
   ************************************************************************************/
  /*
  const { name, version, aiKey } = require('../package.json')
  const telemetryReporter = new TelemetryReporter(name, version, aiKey)
  deactivateTasks.push(() => telemetryReporter.dispose())
  */

  logger.log('CodeAwareness: setup watchers complete.')
}
