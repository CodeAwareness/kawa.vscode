/**********************
 * CodeAwareness logger
 **********************/
/* eslint-disable no-console */
import config from '@/config'

console.log('LOGGER LEVEL', config.LOG_LEVEL)
/* eslint-disable @typescript-eslint/no-empty-function */
if (config.LOG_LEVEL === 'none') {
  // test env
  console.log = () => {}
  console.info = () => {}
  console.error = () => {}
  console.debug = () => {}
  console.warn = () => {}
  console.dir = () => {}
}

if (config.LOG_LEVEL === 'log') {
  console.info = () => {}
  console.debug = () => {}
}

if (config.LOG_LEVEL === 'error') {
  console.log = () => {}
  console.info = () => {}
  console.dir = () => {}
}

function logLevel(type: string) {
  const nothing = (_?: any) => {}

  return function(...args: any[]) {
    if (!config.DEBUG) return
    let log
    switch (type) {
      case 'info':
        log = console.info
        break
      case 'log':
        log = console.log
        break
      case 'debug':
        log = console.debug
        break
      case 'warn':
        log = console.warn
        break
      case 'error':
        log = console.error
        break
      default:
        log = console.log
    }

    // eslint-disable-next-line prefer-rest-params
    log(Array.from(arguments).map(shallow))

    function shallow(obj: any, depth = 0): any {
      if (depth > 6) return '...$' + depth
      if (obj === null) return obj
      if (['string', 'number', 'undefined', 'boolean'].includes(typeof obj)) return obj
      if (typeof obj === 'function') return obj.toString()
      if (obj instanceof Error) {
        // console.trace('shallow print error')
        return obj.toString()
      }
      if (obj instanceof Array) return obj.map(item => shallow(item, depth + 1))
      const ret: Record<string, any> = {}
      if (!Object.keys(obj).length) return obj.toString()
      Object.keys(obj).map(key => {
        if (['string', 'number', 'undefined', 'boolean'].includes(typeof obj[key])) ret[key] = obj[key]
        else if (obj[key] === null) ret[key] = obj[key]
        else if (typeof obj === 'function') ret[key] = obj[key].toString()
        else if (key === '__proto__') nothing()
        else {
          try {
            ret[key] = shallow(obj[key], depth + 1)
          } catch (err) {
            nothing(err)
          }
        }
      })
      return ret
    }
  }
}

const logger = {
  group: console.group,
  groupEnd: console.groupEnd,
  groupCollapsed: console.groupCollapsed,
  log: logLevel('log'),
  info: logLevel('info'),
  debug: logLevel('debug'),
  warn: logLevel('warn'),
  error: logLevel('error'),
  json: function jsonLog(obj: any) {
    console.dir(obj, { depth: 7 })
  },
}

export default logger
