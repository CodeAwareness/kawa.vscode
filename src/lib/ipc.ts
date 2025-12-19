import os from 'os'
import path from 'node:path'
import net, { Socket } from 'net'
import { EventEmitter } from 'node:events'

import logger from './logger'

const id = os.hostname()
const delimiter = '\n'  // Huginn IPC server expects newline-delimited messages
const isWindows = os.platform() === 'win32'

// Generate a UUID-like client ID
function generateClientId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = Math.random() * 16 | 0
    const v = c === 'x' ? r : (r & 0x3 | 0x8)
    return v.toString(16)
  })
}

class IPC {
  // Use this pubsub to listen for responses to your emits
  public pubsub = new EventEmitter()
  public socket = null as Socket | null
  // On Windows, use catalog pipe: \\.\pipe\muninn, then dedicated pipe per client
  // On Unix, use file-based socket: ~/.kawa-code/sockets/muninn
  public socketRoot = isWindows ? '\\\\.\\pipe\\' : path.join(os.homedir(), '.kawa-code', 'sockets')
  public retryInterval = 2000 // retry connecting every 2 seconds
  public maxRetries = Infinity

  private retriesRemaining = Infinity
  private explicitlyDisconnected = false
  private ipcBuffer = '' as string
  private path = ''
  private clientId: string | null = null
  private dedicatedPipePath: string | null = null
  private catalogSocket: Socket | null = null

  constructor(socketName: string) {
    // On Windows, socketName is ignored - we use catalog pipe
    // On Unix, socketName is 'muninn' and path is ~/.kawa-code/sockets/muninn
    if (isWindows) {
      this.path = path.join(this.socketRoot, 'muninn')
      this.clientId = generateClientId()
    } else {
      this.path = path.join(this.socketRoot, socketName)
    }
  }

  connect(callback?: any) {
    if (this.socket && !this.socket.destroyed) {
      return callback && callback() // already connected
    }
    if (this.socket) this.socket.destroy()
    if (this.catalogSocket) this.catalogSocket.destroy()

    if (isWindows) {
      // Windows: Use catalog pipe pattern
      this.connectViaCatalog(callback)
    } else {
      // Unix: Direct socket connection
      this.connectDirect(callback)
    }
  }

  private connectViaCatalog(callback?: any) {
    console.log('IPC: Connecting to catalog pipe:', this.path)
    
    const catalogSocket = net.createConnection({ path: this.path })
    catalogSocket.setEncoding('utf8')
    this.catalogSocket = catalogSocket
    
    let catalogBuffer = ''
    
    catalogSocket.on('connect', () => {
      logger.log('IPC: Connected to catalog pipe')
      
      // Send handshake with client ID
      const handshake = JSON.stringify({
        domain: 'system',
        action: 'handshake',
        data: {
          clientType: 'vscode',
          clientId: this.clientId
        }
      })
      
      catalogSocket.write(handshake + delimiter)
      logger.log('IPC: Sent handshake to catalog pipe with clientId:', this.clientId)
    })
    
    catalogSocket.on('data', (data) => {
      catalogBuffer += data.toString()
      
      if (catalogBuffer.indexOf(delimiter) === -1) {
        return
      }
      
      const events = catalogBuffer.split(delimiter)
      events.forEach(event => {
        if (!event) return
        
        try {
          const message = JSON.parse(event)
          if (message.domain === 'system' && message.action === 'handshake') {
            const { caw, pipePath } = message.data || {}
            
            if (pipePath) {
              this.dedicatedPipePath = pipePath
              logger.log('IPC: Received catalog response, CAW ID:', caw, 'Pipe path:', pipePath)
              
              // Close catalog socket
              catalogSocket.destroy()
              this.catalogSocket = null
              
              // Wait 2 seconds for server to create pipe, then connect to dedicated pipe
              setTimeout(() => {
                this.connectToDedicatedPipe(caw, callback)
              }, 2000)
            } else if (message.data?.error) {
              logger.log('IPC: Catalog registration error:', message.data.error)
              console.error('IPC: Catalog registration failed:', message.data.error)
            }
          }
        } catch (e) {
          logger.log('IPC: Failed to parse catalog response:', e)
        }
      })
      
      catalogBuffer = ''
    })
    
    catalogSocket.on('error', (err: NodeJS.ErrnoException) => {
      logger.log('IPC: Catalog pipe error:', err)
      console.error('IPC: Catalog pipe error:', err)
    })
    
    catalogSocket.on('close', () => {
      logger.log('IPC: Catalog pipe closed')
    })
  }

  private connectToDedicatedPipe(cawId: string, callback?: any) {
    if (!this.dedicatedPipePath) {
      logger.log('IPC: No dedicated pipe path available')
      return
    }
    
    console.log('IPC: Connecting to dedicated pipe:', this.dedicatedPipePath)
    
    const socket = net.createConnection({ path: this.dedicatedPipePath })
    socket.setEncoding('utf8')
    this.socket = socket
    
    socket.setTimeout(5000) // 5 second timeout

    socket.on('error', (err: NodeJS.ErrnoException) => {
      logger.log('IPC: Dedicated pipe error:', err)
      const errorDetails: any = {
        code: err.code,
        errno: err.errno,
        syscall: err.syscall,
        message: err.message,
        stack: err.stack
      }
      if ('address' in err) errorDetails.address = (err as any).address
      if ('path' in err) errorDetails.path = (err as any).path
      console.error('IPC: Dedicated pipe error details:', errorDetails)
    })

    socket.on('connect', () => {
      logger.log('IPC: Connected to dedicated pipe', this.dedicatedPipePath)
      this.retriesRemaining = this.maxRetries
      // Clear the connection timeout once connected
      socket.setTimeout(0)
      // Emit handshake event with CAW ID
      this.pubsub.emit('handshake', cawId)
      if (callback) callback()
    })

    socket.on('drain', (e: any) => {
      logger.log('IPC: Socket draining', e)
    })

    socket.on('ready', () => {
      this.pubsub.emit('connected')
    })

    socket.on('timeout', () => {
      logger.log('IPC: Dedicated pipe timeout - connection attempt timed out')
      console.error('IPC: Connection timeout after 5 seconds. Pipe may not be accepting connections.')
      socket.destroy()
    })

    socket.on('end', (e: any) => {
      logger.log('IPC: Dedicated pipe ended', e)
    })

    socket.on('close', (exitCode: any) => {
      logger.log('IPC: Dedicated pipe closed', this.dedicatedPipePath, this.retriesRemaining, 'tries remaining of', this.maxRetries, exitCode)

      if (this.retriesRemaining < 1 || this.explicitlyDisconnected) {
        logger.log('IPC: connection failed. Exceeded the maximum retries.', this.dedicatedPipePath)
        socket.destroy()
        return
      }

      setTimeout(() => {
        if (this.explicitlyDisconnected) {
          return
        }
        this.retriesRemaining--
        // Reconnect via catalog
        this.connectViaCatalog(callback)
      }, this.retryInterval)
    })

    socket.on('data', data => {
      this.ipcBuffer += data.toString()

      if (this.ipcBuffer.indexOf(delimiter) === -1) {
        logger.log('IPC: Messages are pretty large, is this really necessary?')
        return
      }

      const events = this.ipcBuffer.split(delimiter)
      events.forEach(event => {
        if (!event) return
        try {
          const message = JSON.parse(event)
          const { domain, action, data, err } = message

          // All messages are responses from Gardener
          if (action) {
            const hasError = err !== undefined && err !== null
            logger.info(`IPC: resolved ${domain}:${action} ${hasError ? 'with error' : 'successfully'}`, data || err)
            this.pubsub.emit('response', JSON.stringify({ domain, action, data, err }))
          }
        } catch (e) {
          logger.log('IPC: Failed to parse message:', e)
        }
      })

      this.ipcBuffer = ''
    })
  }

  private connectDirect(callback?: any) {
    console.log('IPC: Connecting directly to', this.path)
    
    try {
      const socket = net.createConnection({ path: this.path })
      socket.setEncoding('utf8')
      this.socket = socket
      
      socket.setTimeout(5000) // 5 second timeout

      socket.on('error', (err: NodeJS.ErrnoException) => {
        logger.log('IPC: socket error: ', err)
        const errorDetails: any = {
          code: err.code,
          errno: err.errno,
          syscall: err.syscall,
          message: err.message,
          stack: err.stack
        }
        if ('address' in err) errorDetails.address = (err as any).address
        if ('path' in err) errorDetails.path = (err as any).path
        console.error('IPC: socket error details:', errorDetails)
      })

      socket.on('connect', () => {
        logger.log('IPC: socket connected', this.path)
        this.retriesRemaining = this.maxRetries
        // Clear the connection timeout once connected
        socket.setTimeout(0)
        if (callback) callback()
      })

      socket.on('drain', (e: any) => {
        logger.log('IPC: Socket draining', e)
      })

      socket.on('ready', () => {
        this.pubsub.emit('connected')
      })

      socket.on('timeout', () => {
        logger.log('IPC: Socket timeout - connection attempt timed out')
        console.error('IPC: Connection timeout after 5 seconds. Socket may not be accepting connections.')
        socket.destroy()
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
        this.ipcBuffer += data.toString()

        if (this.ipcBuffer.indexOf(delimiter) === -1) {
          logger.log('IPC: Messages are pretty large, is this really necessary?')
          return
        }

        const events = this.ipcBuffer.split(delimiter)
        events.forEach(event => {
          if (!event) return
          try {
            const message = JSON.parse(event)
            const { domain, action, data, err } = message

            // Handle handshake response from Huginn IPC server
            if (domain === 'system' && action === 'handshake') {
              logger.info('IPC: Received handshake response, CAW ID:', data?.caw)
              this.pubsub.emit('handshake', data?.caw)
              this.ipcBuffer = this.ipcBuffer.substring(event.length + 1)
              return
            }

            // All other messages are responses from Gardener
            if (action) {
              const hasError = err !== undefined && err !== null
              logger.info(`IPC: resolved ${domain}:${action} ${hasError ? 'with error' : 'successfully'}`, data || err)
              this.pubsub.emit('response', JSON.stringify({ domain, action, data, err }))
            }
          } catch (e) {
            logger.log('IPC: Failed to parse message:', e)
          }
        })

        this.ipcBuffer = ''
      })
    } catch (err: any) {
      logger.log('IPC: Failed to create connection:', err)
      console.error('IPC: Failed to create connection:', err)
    }
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
