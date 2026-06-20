import { EventDispatchError } from '../EventDispatcherErrors'
import type { EventHandler } from '../EventDispatcherTypes'

export const SimulationNoopEventType = 'simulation.noop' as const
export const SimulationLogEventType = 'simulation.log' as const

export type SimulationLogPayload = {
  level: 'info' | 'warning' | 'error'
  message: string
  details?: unknown
}

export const NoopHandler: EventHandler = function NoopHandler() {
  return {
    notes: ['noop executed']
  }
}

export const SimulationLogHandler: EventHandler =
  function SimulationLogHandler(event, context) {
    const payload = validateSimulationLogPayload(event.payload)
    const logger = context.logger ?? console

    switch (payload.level) {
      case 'info':
        logger.info?.(payload.message, payload.details)
        break
      case 'warning':
        logger.warn?.(payload.message, payload.details)
        break
      case 'error':
        logger.error?.(payload.message, payload.details)
        break
    }

    return {
      notes: [`log ${payload.level}: ${payload.message}`]
    }
  }

function validateSimulationLogPayload(payload: unknown): SimulationLogPayload {
  if (typeof payload !== 'object' || payload === null) {
    throwInvalidPayload('Simulation log payload must be an object', { payload })
  }

  const candidate = payload as Partial<SimulationLogPayload>

  if (
    candidate.level !== 'info' &&
    candidate.level !== 'warning' &&
    candidate.level !== 'error'
  ) {
    throwInvalidPayload('Simulation log level must be info, warning, or error', { payload })
  }

  if (typeof candidate.message !== 'string' || !candidate.message.trim()) {
    throwInvalidPayload('Simulation log message is required', { payload })
  }

  return {
    level: candidate.level,
    message: candidate.message,
    ...(candidate.details !== undefined ? { details: candidate.details } : {})
  }
}

function throwInvalidPayload(message: string, details: unknown): never {
  throw new EventDispatchError('INVALID_EVENT_PAYLOAD', 'recoverable', message, details)
}
