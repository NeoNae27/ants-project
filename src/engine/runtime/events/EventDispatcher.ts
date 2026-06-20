import { EventDispatchError, isEventDispatchError } from './EventDispatcherErrors'
import type { SimulationEvent } from './EventQueueTypes'
import type {
  DispatchContext,
  DispatchObserver,
  EventDispatchBatchResult,
  EventDispatcherParams,
  EventDispatchResult,
  EventDispatchTrace,
  EventHandler,
  EventHandlerMap
} from './EventDispatcherTypes'

function createDispatchId(event: SimulationEvent): string {
  return `dispatch-${event.id}-${event.sequence}`
}

function getWallTimeMs(): number {
  const performanceClock = globalThis.performance

  if (performanceClock) {
    return performanceClock.timeOrigin + performanceClock.now()
  }

  return Date.now()
}

function getHandlerName(handler: EventHandler): string | undefined {
  return handler.name.trim() ? handler.name : undefined
}

function toUnexpectedError(error: unknown, event: SimulationEvent): EventDispatchError {
  if (isEventDispatchError(error)) {
    return error
  }

  if (error instanceof Error) {
    return new EventDispatchError(
      'HANDLER_UNEXPECTED_ERROR',
      'fatal',
      error.message,
      {
        eventId: event.id,
        eventType: event.type,
        errorName: error.name
      }
    )
  }

  return new EventDispatchError(
    'HANDLER_UNEXPECTED_ERROR',
    'fatal',
    'Unknown event handler error',
    {
      eventId: event.id,
      eventType: event.type,
      error
    }
  )
}

export class EventDispatcher {
  private readonly handlers: EventHandlerMap
  private readonly observers: DispatchObserver[]

  constructor(params: EventDispatcherParams) {
    this.handlers = { ...params.handlers }
    this.observers = [...(params.observers ?? [])]
    this.assertHandlers(this.handlers)
  }

  dispatch(event: SimulationEvent, context: DispatchContext): EventDispatchResult {
    this.assertContext(context)

    const startedAtWallMs = getWallTimeMs()
    const handler = this.handlers[event.type]
    const trace: EventDispatchTrace = {
      dispatchId: createDispatchId(event),
      eventId: event.id,
      eventType: event.type,
      scheduledAt: event.scheduledAt,
      simulationTimeMs: context.simulationTimeMs,
      status: 'started',
      startedAtWallMs,
      handlerFound: Boolean(handler),
      ...(handler ? { handlerName: getHandlerName(handler) } : {}),
      scheduledEventIds: []
    }

    this.notify((observer) => observer.onDispatchStart?.(this.cloneTrace(trace)))

    if (!handler) {
      const error = new EventDispatchError(
        'EVENT_HANDLER_NOT_FOUND',
        'recoverable',
        `Event handler not found for type: ${event.type}`,
        {
          eventId: event.id,
          eventType: event.type
        }
      )

      return this.completeFailure(trace, error)
    }

    try {
      const handlerResult = handler(event, context)

      if (handlerResult?.scheduledEventIds) {
        trace.scheduledEventIds = [...handlerResult.scheduledEventIds]
      }

      if (handlerResult?.notes) {
        trace.notes = [...handlerResult.notes]
      }

      return this.completeSuccess(trace)
    } catch (error) {
      return this.completeFailure(trace, toUnexpectedError(error, event))
    }
  }

  dispatchMany(events: SimulationEvent[], context: DispatchContext): EventDispatchBatchResult {
    this.notify((observer) => observer.onBatchStart?.(events.map((event) => ({ ...event }))))

    const results: EventDispatchResult[] = []
    let stopped = false

    for (const event of events) {
      const result = this.dispatch(event, context)
      results.push(result)

      if (result.error?.severity === 'fatal') {
        stopped = true
        break
      }
    }

    const batchResult = this.createBatchResult(results, stopped)
    this.notify((observer) => observer.onBatchComplete?.(batchResult))

    return batchResult
  }

  private completeSuccess(trace: EventDispatchTrace): EventDispatchResult {
    trace.status = 'completed'
    this.finishTrace(trace)
    this.notify((observer) => observer.onDispatchSuccess?.(this.cloneTrace(trace)))
    return this.toResult(trace)
  }

  private completeFailure(trace: EventDispatchTrace, error: EventDispatchError): EventDispatchResult {
    trace.status = 'failed'
    trace.error = error
    this.finishTrace(trace)
    this.notify((observer) => observer.onDispatchFailure?.(this.cloneTrace(trace)))
    return this.toResult(trace)
  }

  private finishTrace(trace: EventDispatchTrace): void {
    const finishedAtWallMs = getWallTimeMs()
    trace.finishedAtWallMs = finishedAtWallMs
    trace.durationWallMs = Math.max(0, finishedAtWallMs - trace.startedAtWallMs)
  }

  private toResult(trace: EventDispatchTrace): EventDispatchResult {
    return {
      ok: trace.status === 'completed',
      eventId: trace.eventId,
      eventType: trace.eventType,
      scheduledAt: trace.scheduledAt,
      simulationTimeMs: trace.simulationTimeMs,
      startedAtWallMs: trace.startedAtWallMs,
      finishedAtWallMs: trace.finishedAtWallMs ?? trace.startedAtWallMs,
      durationWallMs: trace.durationWallMs ?? 0,
      handlerFound: trace.handlerFound,
      ...(trace.handlerName ? { handlerName: trace.handlerName } : {}),
      scheduledEventIds: [...trace.scheduledEventIds],
      ...(trace.error ? { error: trace.error } : {}),
      ...(trace.notes ? { notes: [...trace.notes] } : {}),
      trace: this.cloneTrace(trace)
    }
  }

  private createBatchResult(results: EventDispatchResult[], stopped: boolean): EventDispatchBatchResult {
    const failed = results.filter((result) => !result.ok)
    const recoverable = failed.filter((result) => result.error?.severity === 'recoverable')
    const fatal = failed.filter((result) => result.error?.severity === 'fatal')

    return {
      total: results.length,
      ok: results.length - failed.length,
      failed: failed.length,
      recoverable: recoverable.length,
      fatal: fatal.length,
      stopped,
      results,
      traces: results.map((result) => this.cloneTrace(result.trace))
    }
  }

  private assertHandlers(handlers: EventHandlerMap): void {
    if (typeof handlers !== 'object' || handlers === null) {
      throw new EventDispatchError(
        'HANDLER_REGISTRY_BROKEN',
        'fatal',
        'Event handler registry must be an object'
      )
    }

    for (const [eventType, handler] of Object.entries(handlers)) {
      if (handler !== undefined && typeof handler !== 'function') {
        throw new EventDispatchError(
          'HANDLER_REGISTRY_BROKEN',
          'fatal',
          `Event handler must be a function: ${eventType}`,
          { eventType }
        )
      }
    }
  }

  private assertContext(context: DispatchContext): void {
    if (!Number.isFinite(context.simulationTimeMs) || context.simulationTimeMs < 0) {
      throw new EventDispatchError(
        'DISPATCH_CONTEXT_INVALID',
        'fatal',
        'Dispatch context simulation time must be a non-negative finite number',
        { simulationTimeMs: context.simulationTimeMs }
      )
    }

    if (!context.eventQueue) {
      throw new EventDispatchError(
        'DISPATCH_CONTEXT_INVALID',
        'fatal',
        'Dispatch context event queue is required'
      )
    }
  }

  private notify(callback: (observer: DispatchObserver) => void): void {
    for (const observer of this.observers) {
      try {
        callback(observer)
      } catch {
        // Observers are diagnostics; a broken observer must not change simulation behavior.
      }
    }
  }

  private cloneTrace(trace: EventDispatchTrace): EventDispatchTrace {
    return {
      ...trace,
      scheduledEventIds: [...trace.scheduledEventIds],
      ...(trace.notes ? { notes: [...trace.notes] } : {}),
      ...(trace.error ? { error: trace.error } : {})
    }
  }
}
