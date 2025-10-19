import os from 'os'
import path from 'node:path'
import net, { Socket } from 'net'
import { EventEmitter } from 'node:events'

import logger from './logger'

const id = os.hostname()
const delimiter = '\f'
const isWindows = os.platform() === 'win32'

class IPC {
  // Use this pubsub to listen for responses to your emits
  public pubsub = new EventEmitter()
  public socket = null as Socket | null
  public appspace = 'caw.'
  public socketRoot = isWindows ? '\\\\.\\pipe\\' : path.join(os.homedir(), '.kawa-code', 'sockets')
  public retryInterval = 2000 // retry connecting every 2 seconds
  public maxRetries = Infinity

  private retriesRemaining = Infinity
  private explicitlyDisconnected = false
  private ipcBuffer = '' as string
  private path = ''

  constructor(guid: string) {
    this.path = path.join(this.socketRoot, this.appspace + (guid || id))
  }

  connect(callback?: any) {
    if (this.socket && !this.socket.destroyed) {
      return callback && callback() // already connected
    }
    if (this.socket) this.socket.destroy()

    const socket = net.createConnection({ path: this.path })
    socket.setEncoding('utf8')
    this.socket = socket

    socket.on('error', err => {
      logger.log('IPC: socket error: ', err)
    })

    socket.on('connect', () => {
      logger.log('IPC: socket connected', this.path)
      this.retriesRemaining = this.maxRetries
      if (callback) callback()
    })

    socket.on('drain', (e: any) => {
      logger.log('IPC: Socket draining', e)
    })

    socket.on('ready', () => {
      this.pubsub.emit('connected')
    })

    socket.on('timeout', (e: any) => {
      logger.log('IPC: Socket timeout', e)
    })

    socket.on('end', (e: any) => {
      logger.log('IPC: Socket ended', e)
    })

    socket.on('close', (exitCode: any) => {
      logger.log('IPC: connection closed', this.path, this.retriesRemaining, 'tries remaining of', this.maxRetries, exitCode)

      if (this.retriesRemaining < 1 || this.explicitlyDisconnected) {
        logger.log('IPC: connection failed. Exceeded the maximum retries.', this.path)
        socket.destroy()
        return
      }

      setTimeout(() => {
        if (this.explicitlyDisconnected) {
          return
        }
        this.retriesRemaining--
        this.connect()
      }, this.retryInterval)
    })

    socket.on('data', data => {
      // logger.log('IPC: received data', this.path, data.toString().substring(0, 100))
      this.ipcBuffer += data.toString()

      if (this.ipcBuffer.indexOf(delimiter) === -1) {
        logger.log('IPC: Messages are pretty large, is this really necessary?')
        return
      }

      const events = this.ipcBuffer.split(delimiter)
      events.map(event => {
        if (!event) return
        const message = JSON.parse(event)
        const { flow, domain, action, data, err } = message
        if (action && ['res', 'err'].includes(flow)) {
          logger.info(`IPC: resolved ${domain}:${action} with ${flow}`, data || err)
          this.pubsub.emit('response', JSON.stringify({ flow, domain, action, data, err }))
        }
      })

      this.ipcBuffer = ''
    })
  }

  emit(message: string) {
    if (!this.socket) {
      logger.log('IPC: cannot dispatch event. No socket for', this.path)
      return
    }
    logger.log('IPC: dispatching event to ', this.path, ' : ', message.substring(0, 256))
    this.socket.write(message + delimiter)
  }
}

export default IPC
