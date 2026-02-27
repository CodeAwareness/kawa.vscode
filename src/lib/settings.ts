/************************
 * Kawa Code settings
 ************************/
import * as vscode from 'vscode'
/*
 * VSCode specific settings
 * TODO: separate these from the general settings, which may be applicable to Atom
 */

import logger from './logger'
import { CAWStore } from './caw.store'

/**
 * Projects may contain a .caw file, in which the user can store their own personalised settings.
 * These .caw files function in a similar way to .eslintrc and .editorconfig files
 */
function checkConfiguration(/* context */) {
  if (!vscode.workspace.workspaceFolders) return Promise.resolve()

  // TODO: configure ... all the things
  return Promise.resolve()
}

function initConfig() {
  return checkConfiguration()
    .then(() => {
      logger.info('Configuration ready')
      CAWStore.colorTheme = vscode.window.activeColorTheme.kind
    })
}

export {
  initConfig,
  checkConfiguration,
}
