import process from 'process'
import vscode from 'vscode'

// TODO: move some/all these into VSCode extension configuration instead
const cawConfig = vscode.workspace.getConfiguration('codeAwareness')

/* eslint-disable-next-line */
const DEBUG = false // TODO: how to determine if we're running inside an extension host or as an installed extension
const CATALOG_DEV = false

const LOCAL_API = false // Code Awareness API

const LOCAL_PANEL = false // VSCode webview panel

// Dev mode when you have CodeAwareness VSCode Panel running locally; please configure local nginx.
const PORT_LOCAL = 8885

// SCHEMA used by VSCode to handle repository, SCM, etc
const CAW_SCHEMA = 'codeAwareness'

// API version
const SERVER_VERSION = 'v1'

// Where to post requests to
const API_URL = LOCAL_API ? `https://lc.codeawareness.com:${PORT_LOCAL}` : 'https://api.codeawareness.com'

// VSCode panel webview location
const PANEL_URL = LOCAL_PANEL ? `https://lc.codeawareness.com:${PORT_LOCAL}` : 'https://ext.codeawareness.com/vscode'

const PROD_MEDIA = 'https://ext.codeawareness.com'

// Add this extension to the catalog of clients on CodeAwareness Local Service.
const CATALOG: string = cawConfig.get('catalog') || 'catalog'
const HIGHLIGHT_WHILE_CLOSED: boolean = cawConfig.get('highlight_while_closed') || false
const PIPE_CATALOG = CATALOG + (CATALOG_DEV ? '_dev' : '')

const LOG_LEVEL = process.env.LOG_LEVEL || 'debug' // ['verbose', 'debug', 'error']

// EXTRACT_REPO_DIR where we gather all the files from common SHA commit, but only those touched by a peer
const EXTRACT_REPO_DIR = 'r'

export default {
  API_URL,
  CAW_SCHEMA,
  DEBUG,
  EXTRACT_REPO_DIR,
  HIGHLIGHT_WHILE_CLOSED,
  LOCAL_API,
  LOCAL_PANEL,
  LOG_LEVEL,
  PANEL_URL,
  PIPE_CATALOG,
  PORT_LOCAL,
  PROD_MEDIA,
  SERVER_VERSION,
}
