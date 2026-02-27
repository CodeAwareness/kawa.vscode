/*********************************************
 * Simple Store for VSCode extension.
 * We don't need reactivity for this project,
 * just a centralized collection of variables.
 *********************************************/
import * as vscode from 'vscode'

import { TCAWEditor } from '@/lib/caw.editor'
import CAWIPC from '@/lib/caw.ipc'
import logger from './logger'

export type TProject = {
  name: string                  // TODO
  root: string                  // local absolute path of this repo
  origin: string                // repo origin (github, gitlab, etc)
  repo: string                  // TODO
  branch: string                // local active branch name
  branches: Array<string>       // list of branches
  head: string                  // local head SHA value
  cSHA: string                  // common SHA value among peers
  activePath: string            // active file path
  line: number                  // cursor line
  peers: Array<any>             // TODO
  changes: Record<string, any>  // change list for the current (active) file
  hl: Array<number>             // highlights for the current (active) file
}

export type TDiffRange = {
  range: {
    line: number,
    len: number, // len: 0 indicates an insert op
  },
  replaceLen: number,
}

export type TAuth = {
  user: any
  tokens: any
}

export type TChanges = {
  l?: Array<number>, // line numbers containing changes
  s?: string, // sha against which the changes are compiled
  k?: string, // the peer file url (stored on S3 or something)
}

export type TPeer = {
  diffDir: string, // the temp folder where the file is extracted
  diff: string, // filename only of the current diff
  lupd: Date, // date of last file update
  origin: string, // repo url
  email: string, // peer email
  avatar: string, // profile pic of this peer
  user: string, // user ID
  _id: string, // contribution ID
}

/**
 * peerFS: {
 *   wsFolder: {
 *     folderName1: {
 *       fileName11: {},
 *       folderName11: {
 *         fileName111: {},
 *       },
 *     },
 *     folderName2: {
 *       fileName21: {},
 *     },
 *     fileName1: {}
 *     ...
 *   }
 * }
 */
export type TPeerFS = Record<string, any>

export type TTokens = {
  access: {
    token: string,
    expires: Date,
  },
  refresh: {
    token: string,
    expires: Date,
  },
}

export type TUser = {
  _id: string,
  name: string,
  avatar: string,
}

export type TSelection = vscode.Selection

export const CAWStore = {
  activeContext: {
    uri: '',
    dirty: false,
  },
  activeTextEditor: null as TCAWEditor | null,
  activeProject: undefined as any,
  activeSelections: [] as readonly TSelection[],
  projects: [] as any[], // [{ repo, scIndex, root }]
  selectedPeer: undefined as any,

  doc: undefined as any | undefined, // active document (specific doc format for Atom, VSCode)
  line: 0, // cursor line nr in document

  colorTheme: 1 as vscode.ColorThemeKind, // 1 = Light, 2 = Dark, 3 = High Contrast

  tmpDir: '/tmp/caw.vscode', // temp dir default value; the real value is actually received from Kawa Code, during the init phase

  /* Just a tree hash map structure, for faster locating of files and folders */
  peerFS: {} as TPeerFS,

  panel: undefined as any,
  tokens: undefined as TTokens | undefined,
  user: undefined as TUser | undefined,
  ws: undefined as typeof CAWIPC | undefined,

  clear: () => {
    logger.log('STORE CLEAR')
    CAWStore.tokens = undefined as unknown as TTokens
    CAWStore.user = undefined as unknown as TUser
    CAWStore.panel = undefined
    CAWStore.colorTheme = 1
    CAWStore.tmpDir = '/tmp/caw.vscode'
    CAWStore.peerFS = {}
    CAWStore.doc = undefined
    CAWStore.line = 0
  },

  reset: () => {
    logger.log('Store Reset')
    CAWStore.peerFS = {}
    CAWStore.doc = undefined
    CAWStore.line = 0
  }
}

let tokenInterval: ReturnType<typeof setTimeout>|undefined
let syncTimer: ReturnType<typeof setTimeout>|undefined

export const CAWWork = {
  // terminal (optional feature: client side processing using shell commands)
  tokenInterval,
  syncTimer,
}

export default CAWStore
