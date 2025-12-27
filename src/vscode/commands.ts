/* eslint-disable @typescript-eslint/no-non-null-assertion */
import * as vscode from 'vscode'

import logger from '@/lib/logger'

import CAWPanel from '@/lib/caw.panel'
import CAWIPC from '@/lib/caw.ipc'
import CAWWorkspace from '@/lib/caw.workspace'
import { CAWStatusbar } from '@/vscode/statusbar'

// New translation module with FileSystemProvider
import {
  enableTranslationMode,
  disableTranslationMode,
  isTranslatableFile
} from '@/lib/translation'

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
      { label: '🇺🇸 English', value: 'en', description: 'Code in English (no translation)' },
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
        // Update status bar
        CAWStatusbar.updateLanguage(selected.value)

        // Enable or disable translation mode based on language selection
        if (selected.value === 'en') {
          await disableTranslationMode()
          logger.log('Translation mode disabled (English selected)')
        } else {
          await enableTranslationMode(selected.value)
          logger.log(`Translation mode enabled for: ${selected.value}`)
        }
      } catch (error) {
        vscode.window.showErrorMessage(`Failed to change language: ${error}`)
        logger.error('Failed to set language:', error)
      }
    }
  }))

  // Translate current file - now handled by translation mode
  context.subscriptions.push(registerCommand('caw.translateToLanguage', async function() {
    const editor = vscode.window.activeTextEditor
    if (!editor) {
      vscode.window.showInformationMessage('No active editor')
      return
    }

    // Currently we only translate Typescript / Javascript files
    if (!isTranslatableFile(editor.document.uri.fsPath)) {
      vscode.window.showWarningMessage('File type not supported for translation. Supported: .js, .jsx, .ts, .tsx, .mjs, .cjs')
      return
    }

    // Translation is now automatic when a language other than English is selected
    vscode.window.showInformationMessage(
      'Use "Code Awareness: Select Language" command to enable translation mode. ' +
      'Files will be automatically translated when opened.'
    )
  }))
}

export {
  setupCommands,
}
