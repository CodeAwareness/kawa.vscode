import os from 'os'
import fs from 'fs'
import path from 'node:path'
import net, { Socket } from 'net'
import { EventEmitter } from 'node:events'

import logger from './logger'

const id = os.hostname()
const delimiter = '\n'  // Huginn IPC server expects newline-delimited messages
const isWindows = os.platform() === 'win32'

/**
 * Muninn's Tauri bundle identifier.
 * Used on macOS to locate the App Sandbox container.
 */
const MUNINN_BUNDLE_ID = 'com.codeawareness.muninn'

/**
 * Get the socket directory with platform-aware discovery.
 *
 * On macOS, checks the App Sandbox container first (for App Store builds),
 * then falls back to the non-sandboxed path (for development builds).
 */
function getSocketDir(): string {
  if (isWindows) return '\\\\.\\pipe\\'

  if (os.platform() === 'darwin') {
    // App Sandbox container (App Store builds)
    const containerDir = path.join(
      os.homedir(),
      'Library', 'Containers', MUNINN_BUNDLE_ID, 'Data',
      'Library', 'Application Support', 'Kawa Code', 'sockets'
    )
    if (fs.existsSync(containerDir)) return containerDir

    // Non-sandboxed (development builds)
    return path.join(os.homedir(), 'Library', 'Application Support', 'Kawa Code', 'sockets')
  }

  // Linux
  return path.join(os.homedir(), '.kawa-code', 'sockets')
}

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
  // On Windows, use catalog pipe: \\.\pipe\muninn.catalog, then dedicated pipe per client
  // On Unix, use file-based socket with platform-aware discovery
  public socketRoot = getSocketDir()
  public retryInterval = 2000 // retry connecting every 2 seconds
  public maxRetries = Infinity

  private retriesRemaining = Infinity
  private explicitlyDisconnected = false
  private ipcBuffer = '' as string
  private path = ''
  private clientId: string | null = null
  private dedicatedPipePath: string | null = null
  private catalogSocket: Socket | null = null
  private readPipePath: string | null = null  // Server writes, client reads
  private writePipePath: string | null = null // Client writes, server reads
  private readSocket: Socket | null = null    // For reading from server (Windows dual-pipe)
  private writeSocket: Socket | null = null   // For writing to server (Windows dual-pipe)
  private retryTimer: NodeJS.Timeout | null = null // Track retry timer to prevent multiple retries
  private isReconnecting = false // Flag to prevent multiple simultaneous reconnection attempts

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
    
    // Clear any pending retry timer
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
    
    // Clean up existing connections
    this.cleanupConnections()

    if (isWindows) {
      // Windows: Use catalog pipe pattern
      this.connectViaCatalog(callback)
    } else {
      // Unix: Direct socket connection
      this.connectDirect(callback)
    }
  }

  private cleanupConnections() {
    if (this.socket && !this.socket.destroyed) {
      this.socket.removeAllListeners()
      this.socket.destroy()
      this.socket = null
    }
    if (this.readSocket && !this.readSocket.destroyed) {
      this.readSocket.removeAllListeners()
      this.readSocket.destroy()
      this.readSocket = null
    }
    if (this.writeSocket && !this.writeSocket.destroyed) {
      this.writeSocket.removeAllListeners()
      this.writeSocket.destroy()
      this.writeSocket = null
    }
    if (this.catalogSocket && !this.catalogSocket.destroyed) {
      this.catalogSocket.removeAllListeners()
      this.catalogSocket.destroy()
      this.catalogSocket = null
    }
  }

  private scheduleRetry(callback?: any) {
    // Prevent multiple simultaneous reconnection attempts
    if (this.isReconnecting || this.explicitlyDisconnected) {
      return
    }

    // Clear any existing retry timer
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
    }

    // Check if we should retry
    if (this.retriesRemaining < 1) {
      logger.log('IPC: Max retries exceeded, stopping reconnection attempts')
      return
    }

    this.isReconnecting = true
    logger.log(`IPC: Scheduling retry in ${this.retryInterval}ms (${this.retriesRemaining} retries remaining)`)
    
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      this.isReconnecting = false
      
      if (this.explicitlyDisconnected) {
        return
      }
      
      this.retriesRemaining--
      logger.log('IPC: Retrying connection...')
      this.connect(callback)
    }, this.retryInterval)
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
            const { caw, pipePath, readPipePath, writePipePath } = message.data || {}
            
            // Check for dual-pipe paths (new Windows implementation)
            if (readPipePath && writePipePath) {
              this.readPipePath = readPipePath
              this.writePipePath = writePipePath
              logger.log('IPC: Received catalog response with dual pipes, CAW ID:', caw, 'Read pipe:', readPipePath, 'Write pipe:', writePipePath)
              
              // Close catalog socket
              catalogSocket.destroy()
              this.catalogSocket = null
              
              // Wait 2 seconds for server to create pipes, then connect to both
              setTimeout(() => {
                this.connectToDualPipes(caw, callback)
              }, 2000)
            } else if (pipePath) {
              // Fallback to single pipe (backward compatibility)
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
      // Schedule retry on error if not explicitly disconnected
      if (!this.explicitlyDisconnected && !this.isReconnecting) {
        catalogSocket.destroy()
        this.catalogSocket = null
        this.scheduleRetry(callback)
      }
    })
    
    catalogSocket.on('close', () => {
      logger.log('IPC: Catalog pipe closed')
      // Only retry if we haven't successfully connected to dedicated pipes yet
      // (i.e., if readSocket and writeSocket are not connected)
      if (!this.explicitlyDisconnected && 
          (!this.readSocket || this.readSocket.destroyed) && 
          (!this.writeSocket || this.writeSocket.destroyed) &&
          !this.isReconnecting) {
        this.scheduleRetry(callback)
      }
    })
  }

  private connectToDualPipes(cawId: string, callback?: any) {
    if (!this.readPipePath || !this.writePipePath) {
      logger.log('IPC: No dual pipe paths available')
      return
    }
    
    console.log('IPC: Connecting to dual pipes - Read:', this.readPipePath, 'Write:', this.writePipePath)
    
    // Create read socket (server writes here, client reads)
    const readSocket = net.createConnection({ path: this.readPipePath })
    readSocket.setEncoding('utf8')
    this.readSocket = readSocket
    
    // Create write socket (client writes here, server reads)
    const writeSocket = net.createConnection({ path: this.writePipePath })
    writeSocket.setEncoding('utf8')
    this.writeSocket = writeSocket
    
    // Store write socket as the main socket for emit() to use
    this.socket = writeSocket
    
    let readConnected = false
    let writeConnected = false
    let connectionError: Error | null = null
    
    const checkReady = () => {
      if (readConnected && writeConnected && !connectionError) {
        logger.log('IPC: Both pipes connected')
        this.retriesRemaining = this.maxRetries
        this.isReconnecting = false
        // Emit handshake event with CAW ID
        this.pubsub.emit('handshake', cawId)
        if (callback) callback()
      }
    }
    
    const handleError = (err: NodeJS.ErrnoException, pipeName: string) => {
      if (!connectionError) {
        connectionError = err
        logger.log(`IPC: ${pipeName} pipe error:`, err)
        console.error(`IPC: ${pipeName} pipe error:`, err)
        // Destroy both pipes on error
        readSocket.destroy()
        writeSocket.destroy()
        // Schedule retry if not explicitly disconnected
        if (!this.explicitlyDisconnected) {
          this.scheduleRetry(callback)
        }
      }
    }
    
    readSocket.setTimeout(5000)
    writeSocket.setTimeout(5000)
    
    readSocket.on('connect', () => {
      logger.log('IPC: Read pipe connected')
      readSocket.setTimeout(0)
      readConnected = true
      checkReady()
    })
    
    writeSocket.on('connect', () => {
      logger.log('IPC: Write pipe connected')
      writeSocket.setTimeout(0)
      writeConnected = true
      checkReady()
    })
    
    readSocket.on('error', (err) => handleError(err, 'Read'))
    writeSocket.on('error', (err) => handleError(err, 'Write'))
    
    readSocket.on('timeout', () => {
      logger.log('IPC: Read pipe timeout')
      readSocket.destroy()
      // Also destroy write socket to ensure clean retry
      if (writeSocket && !writeSocket.destroyed) {
        writeSocket.destroy()
      }
    })
    
    writeSocket.on('timeout', () => {
      logger.log('IPC: Write pipe timeout')
      writeSocket.destroy()
      // Also destroy read socket to ensure clean retry
      if (readSocket && !readSocket.destroyed) {
        readSocket.destroy()
      }
    })
    
    readSocket.on('close', () => {
      logger.log('IPC: Read pipe closed')
      readConnected = false
      // Only retry if both pipes are closed and not explicitly disconnected
      if (!this.explicitlyDisconnected && 
          (!this.writeSocket || this.writeSocket.destroyed) &&
          !this.isReconnecting) {
        this.scheduleRetry(callback)
      }
    })
    
    writeSocket.on('close', () => {
      logger.log('IPC: Write pipe closed')
      writeConnected = false
      // Only retry if both pipes are closed and not explicitly disconnected
      if (!this.explicitlyDisconnected && 
          (!this.readSocket || this.readSocket.destroyed) &&
          !this.isReconnecting) {
        this.scheduleRetry(callback)
      }
    })
    
    // Listen for data on read socket (server writes here)
    readSocket.on('data', data => {
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
    
    this.pubsub.emit('connected')
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
      // Schedule retry on error if not explicitly disconnected
      if (!this.explicitlyDisconnected) {
        socket.destroy()
        this.scheduleRetry(callback)
      }
    })

    socket.on('connect', () => {
      logger.log('IPC: Connected to dedicated pipe', this.dedicatedPipePath)
      this.retriesRemaining = this.maxRetries
      this.isReconnecting = false
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

      if (!this.explicitlyDisconnected && !this.isReconnecting) {
        // Schedule retry
        this.scheduleRetry(callback)
      }
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
        // Schedule retry on error if not explicitly disconnected
        if (!this.explicitlyDisconnected) {
          socket.destroy()
          this.scheduleRetry(callback)
        }
      })

      socket.on('connect', () => {
        logger.log('IPC: socket connected', this.path)
        this.retriesRemaining = this.maxRetries
        this.isReconnecting = false
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

        if (!this.explicitlyDisconnected && !this.isReconnecting) {
          // Schedule retry
          this.scheduleRetry(callback)
        }
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
    // On Windows with dual pipes, use writeSocket; otherwise use socket
    const socketToUse = (isWindows && this.writeSocket) ? this.writeSocket : this.socket
    
    if (!socketToUse) {
      logger.log('IPC: cannot dispatch event. No socket for', this.path)
      return
    }
    logger.log('IPC: dispatching event to ', this.path, ' : ', message.substring(0, 256))
    socketToUse.write(message + delimiter)
  }
}

export default IPC
