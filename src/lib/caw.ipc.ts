/******************************************************************
 * CodeAwareness Inter Process Communication with the Local Service
 ******************************************************************/
import os from 'os'
import IPC from '@/lib/ipc'
import config from '@/config'
import { CAWStatusbar } from '@/vscode/statusbar'

import CAWWorkspace from './caw.workspace'
import CAWEvents from './caw.events'

export type TClass<T> = new (...args: any[]) => T

export const shortid = () => {
  return new Date().valueOf().toString() + Math.random() // we run multiple editors, yes, but we run them as a user on a local computer, so this is fine.
}

/* We send a GUID with every request, such that multiple instances of VSCode can work independently;
 * TODO: perhaps allow different users logged into different VSCode instances? IS THIS SECURE? (it will require rewriting some of the local service)
 */
let assignedCAW: string | null = null // CAW ID assigned by Huginn IPC server
// On Windows: Uses catalog pipe (\\.\pipe\muninn.catalog), socketName is ignored
// On Unix: Uses ~/.kawa-code/sockets/muninn
const socketName = 'muninn' // Used only on Unix
const ipcClient = new IPC(socketName)
const responseHandlers = new Map<string, { resolve: Function, reject: Function }>()
let authReadyCallback: (() => void) | null = null // Callback when auth is complete

const CAWIPC = {
  get guid() {
    return assignedCAW || 'unknown'
  },
  ipcClient,

  /**
   * Register a callback to be called when auth and initialization are complete
   */
  onAuthReady(callback: () => void) {
    authReadyCallback = callback
  },

  init: async function(): Promise<void> {
    ipcClient.pubsub.removeAllListeners()

    // Connect to Huginn IPC server
    ipcClient.connect()

    ipcClient.pubsub.on('connected', () => {
      console.log('[CAWIPC] Connected to Huginn IPC server, sending handshake...')

      // Send handshake to get CAW ID
      ipcClient.emit(JSON.stringify({
        flow: 'req',
        domain: 'system',
        action: 'handshake',
        data: { clientType: 'vscode' }
      }))
    })

    // Listen for handshake response
    ipcClient.pubsub.once('handshake', (cawId: string) => {
      assignedCAW = cawId
      console.log('[CAWIPC] Received CAW ID:', assignedCAW)

      // Now proceed with initialization
      initServer()
        .then(() => CAWIPC.transmit('auth:info')) // ask for existing auth info, if any
        .then(CAWWorkspace.init)
        .then(CAWStatusbar.init)
        .then(() => {
          // ⭐ Notify that auth and initialization are complete
          if (authReadyCallback) {
            authReadyCallback()
          }
        })
    })

    // here we treat only calls made with `transmit(..).then().catch()`
    // but we also have an IPC processor inside the caw.events.ts, to respond to events not triggered by VSCode
    ipcClient.pubsub.on("response", (body: any) => {
      try {
        const res = body.length ? JSON.parse(body) : body
        const { domain, action, data, err } = res
        const errObj = typeof err === 'string' ? { err } : err
        const aid = `${domain}:${action}`

        console.log('[CAWIPC] Received response:', aid, 'Has handler?', responseHandlers.has(aid))

        CAWEvents.processIPC(res)

        // Check if this response has a handler
        if (responseHandlers.has(aid)) {
          const handler = responseHandlers.get(aid)!
          responseHandlers.delete(aid)

          if (err) {
            console.log('[CAWIPC] Rejecting promise with error:', err)
            handler.reject(errObj)
          } else {
            console.log('[CAWIPC] Resolving promise with data:', data)
            handler.resolve(data)
          }
        } else {
          console.log('[CAWIPC] No handler found for:', aid)
        }
      } catch (err) {
        console.error("CAWIPC: Error processing response", err)
      }
    })
  },

  /* Transmit an action, and perhaps some data. */
  transmit: function<T>(action: string, data?: any, options?: { timeout?: number }): Promise<any> {
    // Parse domain from action string (e.g., "auth:info" -> domain="auth", action="info")
    let domain = 'code'  // default domain for code/file operations
    let actualAction = action

    if (action.includes(':')) {
      const parts = action.split(':')
      domain = parts[0]
      actualAction = parts.slice(1).join(':')  // Handle cases like "repo:file:activate"
    }

    const aid = `${domain}:${actualAction}`
    const caw = CAWIPC.guid

    console.log('[CAWIPC] Transmitting:', action, 'Expecting response:', aid)

    return new Promise<T>((resolve, reject) => {
      responseHandlers.set(aid, { resolve, reject })
      console.log('[CAWIPC] Registered handler for:', aid)
      ipcClient.emit(JSON.stringify({ flow: 'req', domain, action: actualAction, data, caw })) // send to Huginn IPC server

      // Timeout to reject if no response received
      // Default: 20 seconds, but caller can override for long-running operations
      const timeoutMs = options?.timeout ?? 20000
      setTimeout(() => {
        if (responseHandlers.has(aid)) {
          responseHandlers.delete(aid)
          reject(new Error(`CAWIPC: Request timed out for ${aid}`))
        }
      }, timeoutMs)
    })
  },

  dispose: function() {
    // TODO: cleanup IPC
    // return this.transmit('auth:logout')
  },
}

function initServer() {
  return new Promise(resolve => {
    setTimeout(() => {
      ipcClient.connect(() => {
        setTimeout(resolve, 2000)
      })
      ipcClient.pubsub.on('reset', CAWIPC.init)
    }, 2000) // let the VSCode and its extensions settle down, plus local service needs to create a client pipe connection
  })
}

export default CAWIPC
