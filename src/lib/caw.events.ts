/**************************************************************
 * Communication between VSCode extension and the webview panel
 **************************************************************/
/* eslint-disable @typescript-eslint/no-non-null-assertion */
import * as vscode from 'vscode'
import path from 'node:path'

import type { TAuth } from './caw.store'

import { localize } from './locale'
import { CAWStore } from './caw.store'

import logger from './logger'
import CAWEditor from './caw.editor'
import CAWDeco from './caw.deco'
import CAWPanel from './caw.panel'
import CAWIPC from './caw.ipc'
import CAWWorkspace from './caw.workspace'

/**
 * This is the VSCode <--> VSCode Webview Events module
 */
function init() {
  CAWStore.colorTheme = vscode.window.activeColorTheme.kind
  const data = { colorTheme: CAWStore.colorTheme }
  CAWPanel.postMessage({ command: 'setup:color-theme', data })
}

const postBack = (command: string, id?: string) => (data: any) => {
  CAWPanel.postMessage({ command, id, data })
}

// The eventsTable is a map of event names received from the webview and their actions (functions).
const eventsTable: Record<string, any> = {}

eventsTable['webview:loaded'] = () => {
  logger.log('Will init webview with GUID', CAWIPC.guid)
  init()
  postBack('setup:wss-guid')(CAWIPC.guid)
  CAWIPC
    .transmit('auth:info')
    .then((data: any) => {
      CAWStore.user = data.user
      CAWStore.tokens = data.tokens
      postBack('auth:info')({ user: CAWStore.user, tokens: CAWStore.tokens })
    })
}

eventsTable['auth:login'] = (data: TAuth) => {
  init()
  CAWStore.user = data?.user
  CAWStore.tokens = data?.tokens
  CAWWorkspace.init(data)
  postBack('auth:info')({ user: data.user, tokens: data.tokens })
  if (data?.user) {
    CAWWorkspace.setupSync()
  }
}

eventsTable['auth:info'] = eventsTable['auth:login']

eventsTable['auth:logout'] = () => {
  CAWStore.clear()
  CAWDeco.clear()
}

eventsTable['branch:select'] = (branchOrData: string | any) => {
  // Handle two cases:
  // 1. Called from webview with branch name (string) - need to transmit to Gardener
  // 2. Called from IPC with response data (object) - already processed by Gardener
  
  logger.log('branch:select handler called with:', typeof branchOrData, branchOrData)
  
  if (typeof branchOrData === 'string') {
    // Case 1: Branch name from webview
    logger.log('branch:select Case 1: String branch name')
    const caw = CAWIPC.guid
    CAWIPC.transmit('branch:select', { branch: branchOrData, caw })
      .then((info: any) => {
        const peerFileUri = vscode.Uri.file(info.peerFile)
        const userFileUri = vscode.Uri.file(info.userFile)
        vscode.commands.executeCommand('vscode.diff', userFileUri, peerFileUri, info.title, { viewColumn: 1, preserveFocus: true })
      })
  } else if (branchOrData && branchOrData.peerFile && branchOrData.userFile) {
    // Case 2: Response data from Gardener (via IPC from external source like Muninn)
    logger.log('branch:select Case 2: Opening diff with peerFile:', branchOrData.peerFile, 'userFile:', branchOrData.userFile)
    const peerFileUri = vscode.Uri.file(branchOrData.peerFile)
    const userFileUri = vscode.Uri.file(branchOrData.userFile)
    vscode.commands.executeCommand('vscode.diff', userFileUri, peerFileUri, branchOrData.title, { viewColumn: 1, preserveFocus: true })
  } else {
    logger.error('branch:select: Invalid data format', branchOrData)
  }
}

eventsTable['branch:unselect'] = () => {
  CAWEditor.closeDiffEditor()
}

eventsTable['branch:refresh'] = (/* data: any */) => {
  // TODO: refresh branches using git and display in CAWPanel
}

export type TDiffResponse = {
  title: string
  extractDir: string
  peerFile: string
  fpath: string
}

eventsTable['context:open-rel'] = (data: any) => {
  vscode.commands.executeCommand('vscode.open', vscode.Uri.parse(data.sourceFile))
}

eventsTable['peer:select'] = (peer: any) => {
  const activeProject = CAWStore.activeProject
  if (!activeProject) {
    logger.log('peer:select: No active project available yet')
    return
  }
  
  const { origin } = activeProject
  const fpath = activeProject.activePath
  if (!fpath) return
  const caw = CAWIPC.guid
  CAWIPC.transmit<TDiffResponse>('diff-peer', { origin, fpath, caw, peer })
    .then((info) => {
      const peerFileUri = vscode.Uri.file(info.peerFile)
      // Note: thanks to smart node:path for figuring out how to join Windows and *nix paths together.
      const userFileUri = vscode.Uri.file(path.join(activeProject.root, fpath))
      logger.log('PEER DIFF', fpath, peerFileUri, userFileUri)
      // logger.info('OPEN DIFF with', fpath, info)
      vscode.commands.executeCommand('vscode.diff', userFileUri, peerFileUri, info.title, { viewColumn: 1, preserveFocus: true })
    })
}

eventsTable['peer:unselect'] = () => {
  CAWEditor.closeDiffEditor()
}

eventsTable['open-peer-file'] = (data: any) => {
  logger.log('open-peer-file event received', data)
  
  // The response from Gardener includes absolute paths, so we handle it directly
  if (data.exists) {
    // File exists locally, just open it
    const resourceUri = vscode.Uri.file(data.filePath)
    vscode.commands.executeCommand('vscode.open', resourceUri)
  } else {
    // File doesn't exist locally, show diff with peer version
    const emptyFile = vscode.Uri.file(data.emptyFilePath)
    const peerFile = vscode.Uri.file(data.filePath)
    const title = `New File (peer: ${data.peerId || 'unknown'})`
    vscode.commands.executeCommand('vscode.diff', emptyFile, peerFile, title, { viewColumn: 1, preserveFocus: true })
  }
}

export type TLineContext = {
  line: number
  context: Array<string>
}

export type TProjectContext = {
  file: string
  context: Array<string>
}

export type TContextResponse = {
  fileContext: {
    _id: string
    user: string
    repo: string
    file: string
    lines: Array<TLineContext>
    updatedAt: string
    createdAt?: string
  }
  projectContext: Array<TProjectContext>
}

eventsTable['context:add'] = (context: string) => {
  const activeProject = CAWStore.activeProject
  const fpath = path.join(activeProject.root, activeProject.activePath)
  if (!fpath) return
  const caw = CAWIPC.guid
  const selections = CAWStore.activeSelections
  const op = 'add'
  CAWIPC.transmit<TContextResponse>('context:apply', { fpath, selections, context, op, caw })
    .then(res => {
      postBack('context:update')(res)
    })
}

eventsTable['context:del'] = (context: string) => {
  const activeProject = CAWStore.activeProject
  const fpath = path.join(activeProject.root, activeProject.activePath)
  if (!fpath) return
  const caw = CAWIPC.guid
  const selections = CAWStore.activeSelections
  const op = 'del'
  CAWIPC.transmit<TContextResponse>('context:apply', { fpath, selections, context, op, caw })
    .then(res => {
      postBack('context:update')(res)
    })
}

/************************************************************************************
 * @param string - key: the event key, indicating an action to be taken
 * @param object - data: the data to be processed inside the action
 ************************************************************************************/
function processSystemEvent(key: string, data: any): void {
  logger.info('EVENTS processSystemEvent', key, data)
  if (eventsTable[key]) eventsTable[key](data)
}

/************************************************************************************
 * @param string - id: a unique ID to keep the req-res correlation.
 * @param string - key: the event key, indicating an action to be taken,
 * For example, key can be: `auth:info:1kG9`.
 * @param object - data: the data to be processed inside the action
 ************************************************************************************/
function localRequest(id: string, key: string, data: any): void {
  logger.info('WebView event (localRequest)', key, data)
  CAWIPC.transmit(key, data)
    .then(data => {
      const obj = typeof data === 'string' ? JSON.parse(data) : data
      postBack(`res:${key}`, id)(obj)
      if (eventsTable[key]) eventsTable[key](obj)
    })
    .catch(err => {
      const obj = typeof err === 'string' ? JSON.parse(err) : err
      postBack(`err:${key}`, id)(obj)
    })
}

/************************************************************************************
 * @param object - webview: the webview object
 * @param object - context: used for continuation of subscriptions
 ************************************************************************************/
function setup(webview: any, context: any) {
  webview.onDidReceiveMessage(
    (message: any) => {
      logger.log('From WebPanel:', message)
      switch (message.command) {
        case 'localRequest':
          // requests to send to the local service, e.g. `auth:login`
          localRequest(message.id, message.key, message.data)
          break

        case 'event':
          // system events to sync data between editor and webview (clicks, selects, etc)
          processSystemEvent(message.key, message.data)
          break

        case 'alert':
          // errors, warnings
          vscode.window.showErrorMessage(message.text)
          break

        case 'notification':
          // other feedback
          vscode.window.showInformationMessage(localize(message.localeKey, message.text))
          break
      }
    },
    undefined,
    context.subscriptions,
  )
}

function processIPC(res: any) {
  try {
    const { flow, domain, action, data, err } = res
    switch (`${flow}:${domain}:${action}`) {
      case 'res:code:sync:setup':
        // TODO
        break
      case 'res:*:auth:login':
        eventsTable['auth:login'](res.data)
        break
      case 'res:code:peer:select':
        eventsTable['peer:select'](res.data)
        break
      case 'res:code:branch:select':
        logger.log('VSCode received res:code:branch:select with data:', res.data)
        eventsTable['branch:select'](res.data)
        break
      case 'res:code:context:open-rel':
        eventsTable['context:open-rel'](res.data)
        break
      case 'res:code:open-peer-file':
        eventsTable['open-peer-file'](res.data)
        break
      case 'err:code:branch:select':
        logger.error('Branch diff error:', err)
        vscode.window.showErrorMessage(`Branch diff failed: ${err}`)
        break
      case 'err:code:open-peer-file':
        logger.error('Open peer file error:', err)
        vscode.window.showErrorMessage(`Failed to open peer file: ${err}`)
        break
    }
  } catch (err) {
    console.error("CAWEvents: Error processing response", err)
  }
}

const CAWEvents = {
  processIPC,
  setup,
}

export default CAWEvents
