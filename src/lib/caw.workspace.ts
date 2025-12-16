/**************************
 * Code Awareness workspace
 **************************/
/* eslint-disable @typescript-eslint/no-non-null-assertion */
import logger from './logger'

import type { TProject } from './caw.store'

import { CAWStore, CAWWork } from './caw.store'

import CAWEditor from './caw.editor'
import CAWSCM from './caw.scm'
import CAWIPC, { shortid } from './caw.ipc'
import CAWPanel from '@/lib/caw.panel'
import CAWTDP from '@/lib/caw.tdp'
import { commands, Position, Range /*, CodeActionTriggerKind */ } from 'vscode'
import CAWDeco from './caw.deco'
import CAWEvents from './caw.events'
import CAWTranslation from './caw.translation'

// Sync actions from LS are defined here
const actionTable: Record<string, any> = {
  refresh: refreshActiveFile,
}

function init(data?: any) {
  logger.log('Workspace: init', data)
  // commands.getCommands().then(logger.log) // TODO: thousands of commands available
  if (data?.user) {
    CAWStore.user = data.user
    CAWStore.tokens = data.tokens
    setupSync() // TODO: when we restart LS the client reconnects but we lose the sync (and it seems auth:info returns undefined?)
    CAWWorkspace.refreshActiveFile()
  }
  return setupTempFiles()
}

function dispose() {
  logger.info('WORKSPACE: dispose')
  // TODO: cleanup temp files
  if (CAWWork.syncTimer) clearInterval(CAWWork.syncTimer)
  CAWStore.panel?.dispose()
  CAWStore.panel = undefined
  CAWEditor.updateDecorations()
}

function setupTempFiles() {
  return CAWIPC.transmit('get-tmp-dir', CAWIPC.guid)
    .then((data: any) => {
      CAWStore.tmpDir = data.tmpDir
      logger.info('WORKSPACE: temporary folder used: ', CAWStore.tmpDir)
    })
}

// setupSync is used to receive refresh requests from the local service
function setupSync() {
  const actionID = shortid()
  CAWIPC.ipcClient.emit(JSON.stringify({
    domain: 'code',
    action: 'sync:setup',
    caw: CAWIPC.guid,
    aid: actionID,
  })) // don't use transmit, as that will overwrite the response handler
}

function closeTextDocument(params: any) {
  logger.log('WORKSPACE: closeTextDocument', params)
}

/************************************************************************************
 * Diff code slices navigation
 *
 * Ideally we could press a key combo to replace chunks of our code with the code from
 * our contributors diff, and cycle through all variations this way.
 * This would allow us to quickly check a single block of changes without having to
 * open the diff editor for each contributor.
 ************************************************************************************/
function highlight() {
  // TODO: cycle through the changes while highlighting changes existing at peers
}

// TODO: add heartbeat so that we can clean up duplicate projects (which accumulate on Local Service due to restarting VSCode)
// Update: i think i solved this issue by cleaning up in the socket.on('close') event listener in LS
function addProject(project: TProject) {
  logger.log('WORKSPACE: addProject', project)
  CAWSCM.addProject(project)
  if (~CAWStore.projects.findIndex(el => el.root === project.root)) CAWStore.projects.push(project)
  CAWStore.activeProject = project
  return project
}

function refreshActiveFile() {
  const editor = CAWStore.activeTextEditor
  if (!editor) {
    logger.log('no active text editor')
    return
  }

  // Check if this is a diff or special view (not a regular source file)
  const scheme = editor.document.uri.scheme
  const isDiffOrSpecialView = scheme !== 'file' && scheme !== 'untitled'

  logger.log('Editor scheme:', scheme, 'isDiffOrSpecialView:', isDiffOrSpecialView)

  if (isDiffOrSpecialView) {
    logger.log('Skipping refresh for diff/special view')
    return
  }

  logger.log('refreshing active file', editor.document.fileName)
  const fpath = CAWEditor.getEditorDocFileName()

  return CAWIPC.transmit<TProject>('active-path', {
    fpath,
    caw: CAWIPC.guid,
    doc: CAWStore.activeTextEditor?.document?.getText(),
    lang: CAWTranslation.getLanguage()  // Send current language for translation detection
  })
    .then((response: any) => {
      // Muninn wraps the project in a response object
      return response.project || response
    })
    .then(addProject)
    .then(CAWEditor.updateDecorations)
    .then(CAWPanel.updateProject)
    .then((project: any) => {
      project.tree?.map(CAWTDP.addFile(project.root))
      CAWTDP.refresh()
    })
}

export type TDiffBlock = {
  range: {
    line: number
    len: number
    content: string[]
  }
  replaceLen: number
}

let isCycling = false

function cycleBlock(direction: number) {
  if (!CAWStore.activeTextEditor) {
    logger.log('no active text editor')
    return
  }

  const fpath = CAWStore.activeProject.activePath
  const doc = CAWStore.activeTextEditor.document.getText()
  const origin = CAWStore.activeProject.origin
  const caw = CAWIPC.guid
  const editor = CAWStore.activeTextEditor

  const promise = Promise.resolve()
  const line = CAWStore.activeTextEditor.selections[0].active.line + 1
  if (isCycling) promise.then(() => commands.executeCommand('undo'))

  isCycling = true
  let block: any
  return promise
    .then(() => CAWIPC.transmit<TDiffBlock>('cycle-block', { caw, origin, fpath, doc, line, direction }))
    .then(data => {
      logger.log('CYCLE RESPONSE', data)
      block = data
      if (!block?.range || !editor) return
      CAWPanel.selectPeer(block)

      return CAWDeco.flashLines(editor, block.range.line, block.range.len, block.replaceLen)
    })
    .then(() => {
      const start = new Position((block.range.line || 1) - 1, 0)
      const end = editor.document.lineAt((block.range.line + block.range.len)).range.end
      const content = block.range.content.join('\n') // TODO: what about Windows platform?
      editor
        .edit(editBuilder => {
          if (block.replaceLen && !block.range.len) {
            const insStart = new Position(block.range.line, 0)
            editBuilder.insert(insStart, content + '\n')
          } else if (!block.replaceLen) {
            const delEnd = new Position((block.range.line || 1) + block.range.len - 1, 0)
            editBuilder.delete(new Range(start, delEnd))
          } else {
            editBuilder.replace(new Range(start, end), content)
          }
        })
        .then(applied => {
          logger.log('changes applied?', applied)
          if (applied) refreshActiveFile()
        })
    })
}

function docChanged() {
  isCycling = false
}

export function crossPlatform(fpath: string) {
  return fpath?.replace(/\\/g, '/')
}

/************************************************************************************
 * Export module
 ************************************************************************************/
const CAWWorkspace = {
  addProject,
  closeTextDocument,
  cycleBlock,
  dispose,
  docChanged,
  highlight,
  init,
  refreshActiveFile,
  setupSync,
  setupTempFiles,
}

export default CAWWorkspace
