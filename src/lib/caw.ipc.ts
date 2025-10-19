/******************************************************************
 * CodeAwareness Inter Process Communication with the Local Service
 ******************************************************************/
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
const guid = shortid()
const ipcClient = new IPC(guid) // FIFO pipe for operations
const ipcCatalog = new IPC(config.PIPE_CATALOG) // the local service watches this file to connect to all clients
const responseHandlers = new Map<string, Function>()

const CAWIPC = {
  guid,
  ipcClient,
  ipcCatalog,

  init: async function(): Promise<void> {
    ipcClient.pubsub.removeAllListeners()
    ipcCatalog.connect()
    ipcCatalog.pubsub.on('connected', () => {
      ipcCatalog.emit(JSON.stringify({ flow: 'req', domain: '*', action: 'clientId', data: guid, caw: guid })) // add this client to the list of clients managed by the local service
      initServer()
        .then(() => CAWIPC.transmit('auth:info')) // ask for existing auth info, if any
        .then(CAWWorkspace.init)
        .then(CAWStatusbar.init)
    })

    // here we treat only calls made with `transmit(..).then().catch()` 
    // but we also have an IPC processor inside the caw.events.ts, to respond to events not triggered by VSCode
    ipcClient.pubsub.on("response", (body: any) => {
      try {
        const res = body.length ? JSON.parse(body) : body
        const { flow, domain, action, data, err } = res
        const errObj = typeof err === 'string' ? { err } : err
        const aidRes = `res:${domain}:${action}`
        const aidErr = `err:${domain}:${action}`
        CAWEvents.processIPC(res)

        if (responseHandlers.has(aidRes)) {
          const resolve = responseHandlers.get(aidRes)!
          responseHandlers.delete(aidRes)
          responseHandlers.delete(aidErr)
          resolve(data)
        } else if (responseHandlers.has(aidErr)) {
          const reject = responseHandlers.get(aidErr)!
          responseHandlers.delete(aidRes)
          responseHandlers.delete(aidErr)
          reject(data)
        }
      } catch (err) {
        console.error("CAWIPC: Error processing response", err)
      }
    })
  },

  /* Transmit an action, and perhaps some data. */
  transmit: function<T>(action: string, data?: any): Promise<any> {
    const domain = (['auth:info', 'auth:login'].includes(action)) ? '*' : 'code'
    const flow = 'req'
    const aidRes = `res:${domain}:${action}`
    const aidErr = `err:${domain}:${action}`
    const caw = CAWIPC.guid

    return new Promise<T>((resolve, reject) => {
      responseHandlers.set(aidRes, resolve)
      responseHandlers.set(aidErr, reject)
      ipcClient.emit(JSON.stringify({ flow, domain, action, data, caw })) // also send data to the pipe

      // Timeout to reject if no response received
      setTimeout(() => {
        if (responseHandlers.has(aidRes) && responseHandlers.has(aidErr)) {
          responseHandlers.delete(aidRes)
          responseHandlers.delete(aidErr)
          reject(new Error(`CAWIPC: Request timed out for ${flow}:${domain}:${action}`))
        }
      }, 20000)
    })
  },

  dispose: function() {
    // TODO: cleanup IPC
    return this.transmit('auth:disconnect')
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
