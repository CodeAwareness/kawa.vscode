/* eslint-disable @typescript-eslint/no-non-null-assertion */
import * as vscode from 'vscode'

import logger from '@/lib/logger'

import CAWPanel from '@/lib/caw.panel'
import CAWIPC from '@/lib/caw.ipc'
import CAWWorkspace from '@/lib/caw.workspace'
import { CAWStatusbar } from '@/vscode/statusbar'
import CAWTranslation from '@/lib/caw.translation'

const { registerCommand } = vscode.commands

function setupCommands(context: vscode.ExtensionContext) {
  context.subscriptions.push(registerCommand('caw.toggle', function() {
    CAWPanel.toggle(context)
  }))

  context.subscriptions.push(registerCommand('caw.highlight', function() {
    logger.log('COMMAND: highlight request received')
    // TODO: highlight a range (slice)
  }))

  context.subscriptions.push(registerCommand('caw.nextPeer', function() {
    try {
      CAWWorkspace.cycleBlock(1)
    } catch (err) {
      console.error(err)
    }
  }))

  context.subscriptions.push(registerCommand('caw.prevPeer', function() {
    try {
      CAWWorkspace.cycleBlock(-1)
    } catch (err) {
      console.error(err)
    }
  }))

  context.subscriptions.push(registerCommand('caw.mergeSlice', function(...rest) {
    logger.log('COMMAND: mergeSlice request received', rest)
    // CAWDiffs.mergeSlice()
  }))

  context.subscriptions.push(registerCommand('caw.mergeAll', function() {
    logger.log('COMMAND: mergeAll request received')
  }))

  context.subscriptions.push(registerCommand('caw.openPeerFile', function(wsFolder, fpath, uid) {
    CAWIPC.transmit('vscode-diff', { wsFolder, fpath, uid })
      .then((data: any) => {
        if (data.exists) {
          const resourceUri = vscode.Uri.file(data.res1)
          vscode.commands.executeCommand('vscode.open', resourceUri)
        } else {
          const res1 = vscode.Uri.file(data.res1)
          const res2 = vscode.Uri.file(data.res2)
          vscode.commands.executeCommand('vscode.diff', res1, res2, 'New File (diff mode)', { viewColumn: 1, preserveFocus: true })
        }
      })
  }))

  context.subscriptions.push(registerCommand('caw.openDiff', function(/* resourceUri, cdir, cfile, title */) {
    logger.log('COMMAND: openDiff request received')
    // TODO: open diffs
  }))

  context.subscriptions.push(registerCommand('caw.refresh', function() {
    logger.log('COMMAND: refresh request received')
    // TODO: refresh diffs
  }))

  context.subscriptions.push(registerCommand('caw.openFile', function({ resourceUri }, ...rest) {
    logger.log('COMMAND: openFile request received', resourceUri, rest)
    vscode.commands.executeCommand('vscode.open', resourceUri)
  }))

  context.subscriptions.push(registerCommand('caw.selectRange', function() {
    logger.log('COMMAND: selectRange request received')
    // TODO: select a diff range (slice)
  }))

  context.subscriptions.push(registerCommand('caw.selectLanguage', async function() {
    logger.log('COMMAND: selectLanguage request received')

    // Language options with emoji flags
    const languages = [
      { label: '🇺🇸 English', value: 'en', description: 'Code in English' },
      { label: '🇯🇵 日本語 (Japanese)', value: 'ja', description: 'コードを日本語で' },
      { label: '🇪🇸 Español (Spanish)', value: 'es', description: 'Código en español' },
      { label: '🇨🇳 中文 (Chinese)', value: 'zh', description: '用中文编码' },
      { label: '🇸🇦 العربية (Arabic)', value: 'ar', description: 'البرمجة بالعربية' },
    ]

    // Show quick pick
    const selected = await vscode.window.showQuickPick(languages, {
      placeHolder: 'Select your preferred coding language',
      title: 'Code Awareness: Language Selection'
    })

    if (selected) {
      try {
        // Send IPC message to Gardener
        const response = await CAWIPC.transmit('user:set-language', { language: selected.value })

        // Update translation module
        CAWTranslation.setLanguage(selected.value)

        // Update status bar
        CAWStatusbar.updateLanguage(selected.value)

        // Show success notification
        vscode.window.showInformationMessage(
          `Language changed to ${selected.label.split(' ')[1]}. Active file will reload.`
        )

        // Translate active editor if there is one
        const activeEditor = vscode.window.activeTextEditor
        if (activeEditor) {
          // Translate the currently open document
          await CAWTranslation.translateDocument(activeEditor)

          // Also notify Gardener about the active file
          const document = activeEditor.document
          CAWIPC.transmit('active-path', {
            wsFolder: vscode.workspace.getWorkspaceFolder(document.uri)?.uri.fsPath,
            fpath: document.uri.fsPath
          })
        }

        logger.log(`Language changed to: ${selected.value}`)
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to change language: ${error}`)
        logger.error('Failed to set language:', error)
      }
    }
  }))
}

export {
  setupCommands,
}
