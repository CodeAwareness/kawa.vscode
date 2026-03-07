/**
 * Direct IPC connection to the i18n extension
 *
 * This module connects directly to the kawa.i18n socket, bypassing Kawa Code
 * for lower latency translation operations.
 *
 * Architecture:
 * - Huginn (VSCode) connects directly to i18n extension socket
 * - i18n gets origin from its own cache (or queries Kawa Code if needed)
 * - Language state is managed by i18n per CAW
 */
import * as os from 'os'
import * as path from 'path'
import * as net from 'net'
import { Socket } from 'net'
import { EventEmitter } from 'events'

import logger from '@/lib/logger'

const delimiter = '\n'
const isWindows = os.platform() === 'win32'

// Socket paths
const socketRoot = isWindows
  ? '\\\\.\\pipe\\'
  : path.join(os.homedir(), '.kawa-code', 'sockets')
const socketPath = path.join(socketRoot, 'kawa.i18n')

// Generate message IDs
let messageCounter = 0
function generateMsgId(): string {
  return `i18n-${Date.now()}-${messageCounter++}`
}

class I18nIPC {
  public pubsub = new EventEmitter()
  private socket: Socket | null = null
  private ipcBuffer = ''
  private connected = false
  private connecting = false
  private retryTimer: NodeJS.Timeout | null = null
  private caw: string | null = null

  // Map of pending requests by _msgId
  private pendingRequests = new Map<string, {
    resolve: (data: any) => void
    reject: (error: Error) => void
    timeout: NodeJS.Timeout
  }>()

  /**
   * Set the CAW ID (received from Kawa Code IPC)
   */
  setCaw(caw: string): void {
    this.caw = caw
    logger.log(`[i18n.ipc] CAW set to: ${caw}`)
  }

  /**
   * Check if connected to i18n
   */
  isConnected(): boolean {
    return this.connected && this.socket !== null && !this.socket.destroyed
  }

  /**
   * Connect to the i18n direct socket
   */
  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.connected || this.connecting) {
        resolve()
        return
      }

      this.connecting = true

      // Clear any pending retry
      if (this.retryTimer) {
        clearTimeout(this.retryTimer)
        this.retryTimer = null
      }

      // Clean up existing socket
      if (this.socket) {
        this.socket.removeAllListeners()
        this.socket.destroy()
        this.socket = null
      }

      logger.log(`[i18n.ipc] Connecting to: ${socketPath}`)

      try {
        const socket = net.createConnection({ path: socketPath })
        socket.setEncoding('utf8')
        this.socket = socket

        socket.setTimeout(5000) // 5 second connection timeout

        socket.on('connect', () => {
          logger.log('[i18n.ipc] Connected to i18n socket')
          this.connected = true
          this.connecting = false
          socket.setTimeout(0) // Clear timeout after connection
          this.pubsub.emit('connected')
          resolve()
        })

        socket.on('error', (err: NodeJS.ErrnoException) => {
          logger.log(`[i18n.ipc] Socket error: ${err.code}`)

          // Clean up
          socket.removeAllListeners()
          socket.destroy()
          this.socket = null
          this.connected = false
          this.connecting = false

          if (err.code === 'ENOENT' || err.code === 'ECONNREFUSED') {
            // i18n not running yet, this is expected during startup
            logger.log('[i18n.ipc] i18n socket not available (extension may not be running yet)')
          }

          reject(err)
        })

        socket.on('timeout', () => {
          logger.log('[i18n.ipc] Connection timeout')
          socket.destroy()
          this.socket = null
          this.connected = false
          this.connecting = false
          reject(new Error('Connection timeout'))
        })

        socket.on('close', () => {
          logger.log('[i18n.ipc] Socket closed')
          this.connected = false
          this.socket = null

          // Reject all pending requests
          this.pendingRequests.forEach((pending) => {
            clearTimeout(pending.timeout)
            pending.reject(new Error('Socket closed'))
          })
          this.pendingRequests.clear()
        })

        socket.on('data', (data) => {
          this.handleData(data.toString())
        })
      } catch (err: any) {
        logger.log(`[i18n.ipc] Failed to create connection: ${err.message}`)
        this.connecting = false
        reject(err)
      }
    })
  }

  /**
   * Handle incoming data from socket
   */
  private handleData(data: string): void {
    this.ipcBuffer += data

    if (this.ipcBuffer.indexOf(delimiter) === -1) {
      return
    }

    const events = this.ipcBuffer.split(delimiter)
    // Preserve incomplete message at end
    this.ipcBuffer = events.pop() || ''

    for (const event of events) {
      if (!event) continue

      try {
        const message = JSON.parse(event)
        const { _msgId, domain, action, data: respData, err } = message

        logger.log(`[i18n.ipc] Received: ${domain}:${action} msgId=${_msgId}`)

        // Check if this is a response to a pending request
        if (_msgId && this.pendingRequests.has(_msgId)) {
          const pending = this.pendingRequests.get(_msgId)!
          this.pendingRequests.delete(_msgId)
          clearTimeout(pending.timeout)

          if (err) {
            pending.reject(new Error(typeof err === 'string' ? err : err.message || 'Unknown error'))
          } else {
            pending.resolve(respData)
          }
        } else {
          // Broadcast message (not a response to our request)
          this.pubsub.emit('message', message)
        }
      } catch (e) {
        logger.log(`[i18n.ipc] Failed to parse message: ${e}`)
      }
    }
  }

  /**
   * Send a request and wait for response
   */
  transmit<T = any>(domain: string, action: string, data?: any, timeoutMs: number = 30000): Promise<T> {
    return new Promise((resolve, reject) => {
      if (!this.isConnected()) {
        reject(new Error('Not connected to i18n'))
        return
      }

      const msgId = generateMsgId()
      const message = {
        flow: 'req',
        domain,
        action,
        data: data || {},
        caw: this.caw || 'unknown',
        _msgId: msgId
      }

      const messageStr = JSON.stringify(message)

      // Set up timeout
      const timeout = setTimeout(() => {
        if (this.pendingRequests.has(msgId)) {
          this.pendingRequests.delete(msgId)
          reject(new Error(`Request timed out: ${domain}:${action}`))
        }
      }, timeoutMs)

      // Register pending request
      this.pendingRequests.set(msgId, { resolve, reject, timeout })

      logger.log(`[i18n.ipc] Sending: ${domain}:${action} msgId=${msgId}`)

      try {
        this.socket!.write(messageStr + delimiter)
      } catch (err: any) {
        this.pendingRequests.delete(msgId)
        clearTimeout(timeout)
        reject(new Error(`Failed to send: ${err.message}`))
      }
    })
  }

  /**
   * Disconnect from i18n socket
   */
  disconnect(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }

    if (this.socket) {
      this.socket.removeAllListeners()
      this.socket.destroy()
      this.socket = null
    }

    this.connected = false

    // Clear pending requests
    this.pendingRequests.forEach((pending) => {
      clearTimeout(pending.timeout)
      pending.reject(new Error('Disconnected'))
    })
    this.pendingRequests.clear()
  }
}

// Singleton instance
const i18nIPC = new I18nIPC()

export default i18nIPC
