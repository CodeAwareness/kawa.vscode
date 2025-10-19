/* eslint-disable @typescript-eslint/no-non-null-assertion */
import * as vscode from 'vscode'

import logger from '@/lib/logger'

import CAWPanel from '@/lib/caw.panel'
import CAWIPC from '@/lib/caw.ipc'
import CAWWorkspace from '@/lib/caw.workspace'

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
}

export {
  setupCommands,
}
