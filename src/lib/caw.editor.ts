/**********************************************************
 * VSCode Text Editor
/**********************************************************/
import * as vscode from 'vscode'
import logger from './logger'

import { CAWStore } from './caw.store'
import CAWDeco from './caw.deco'

// TODO: find a way to detect windows env

export type TCAWEditor = vscode.TextEditor & {
  _documentData: any
  _selections: Array<any>
  _visibleRanges: Array<any>
  diffInformation: any
}

const getSelectedLine = (editor: TCAWEditor) => editor._selections && editor._selections[0].active.line
const getEditorDocFileName = (editor?: TCAWEditor) => (editor || CAWStore.activeTextEditor)?.document.fileName

const closeActiveEditor = () => {
  return vscode.commands.executeCommand('workbench.action.closeActiveEditor')
}

// TODO: why TCAWEditor doesn't work here as a type (what's length and ev[0]?)
const getSelections = (ev: any) => {
  if (!ev || !ev.length || !ev[0]) return { selections: [], visibleRanges: [], uri: '' }
  const uri = ev._documentData._uri
  const selections = ev._selections
  const visibleRanges = ev._visibleRanges
  return { selections, visibleRanges, uri }
}

/************************************************************************************
 * Mark the currently active editor in the global state
 *
 * We're setting up the workspace everytime a new editor is activated,
 * because the user may have several repositories open, or a file outside any repo.
 *
 * @param editor Object - editor object from VSCode
 *
 ************************************************************************************/
function setActiveEditor(editor: TCAWEditor) {
  const { tmpDir } = CAWStore
  if (editor?.document.fileName.includes(tmpDir)) return
  CAWStore.reset()
  CAWStore.activeTextEditor = editor
  logger.info('EDITOR: set active editor', editor)
}

/************************************************************************************
 * Mark peer changes within the current editor (gutter only when caw panel is not active)
 *
 * CAWWorkspace calls this function when we have a change or a new file open.
 *
 * @param project object The `project` structure is defined in the CAW Local Service
 ************************************************************************************/
function updateDecorations(project?: any) {
  CAWDeco.insertDecorations()
  return project
}

/************************************************************************************
 * trying to close the diff window.
 *
 * A workaround attempt, trying to close the diff window when the user clicks the
 * same selected peer in Kawa Code WebView
 ************************************************************************************/
let tryingToClose: boolean // Yeah, I don't know how to do this, VSCode seems to be stripped of fundamental window concepts, or maybe it's an Electron issue
function closeDiffEditor() {
  const { tmpDir } = CAWStore
  /*
  const editors = vscode.window.visibleTextEditors
  editors.map(editor => (editor._documentData._document.uri.path.includes(tmpDir) && closeEditor(editor)))
  */
  setTimeout(() => {
    const editor = vscode.window.activeTextEditor as TCAWEditor
    if (!editor) {
      vscode.commands.executeCommand('workbench.action.focusNextGroup')
      if (tryingToClose) {
        tryingToClose = false
        return
      }
      tryingToClose = true
      return setTimeout(closeDiffEditor, 100)
    } else {
      // vscode.commands.getCommands().then(logger.log)
      /*
      vscode.commands.executeCommand('workbench.action.focusNextGroup')
      vscode.commands.executeCommand('workbench.action.focusPreviousGroup')
      */
    }
    tryingToClose = false
    const fileName = getEditorDocFileName(editor)
    try {
      if (fileName?.toLowerCase().includes(tmpDir.toLowerCase())) closeActiveEditor()
    } catch {}

    return true
  }, 100)
}

/************************************************************************************
 * try to focus the active editor window
 *
 * When we open the CAW panel, we need to re-focus on our editor (not stealing focus)
 ************************************************************************************/
function focusTextEditor() {
  if (CAWStore.activeTextEditor) return
  const editors = vscode.window.visibleTextEditors as Array<TCAWEditor>
  setActiveEditor(editors[0])
}

const CAWEditor = {
  closeDiffEditor,
  focusTextEditor,
  getEditorDocFileName,
  getSelectedLine,
  getSelections,
  setActiveEditor,
  updateDecorations,
}

export default CAWEditor
