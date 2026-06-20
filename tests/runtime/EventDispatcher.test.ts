import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  ConsoleDispatchObserver,
  EventDispatcher,
  EventDispatchError,
  EventPriority,
  InMemoryEventQueue,
  NoopHandler,
  SimulationLogHandler,
  type DispatchContext,
  type DispatchObserver,
  type EventDispatchBatchResult,
  type EventDispatchTrace,
  type EventHandlerMap,
  type SimulationLogPayload,
  type ScheduleSimulationEventInput,
  type SimulationEvent
} from '../../src/engine/runtime/events'

function createInput(
  overrides: Partial<ScheduleSimulationEventInput> = {}
): ScheduleSimulationEventInput {
  return {
    id: 'event-a',
    type: 'demo.ok',
    scheduledAt: 10,
    createdAt: 0,
    priority: EventPriority.SCENARIO,
    payload: {},
    ...overrides
  }
}

function createEvent(
  queue: InMemoryEventQueue,
  overrides: Partial<ScheduleSimulationEventInput> = {}
): SimulationEvent {
  queue.schedule(createInput(overrides))
  const [event] = queue.popDueEvents(overrides.scheduledAt ?? 10)

  if (!event) {
    throw new Error('Expected test event to be due')
  }

  return event
}

function createContext(queue = new InMemoryEventQueue(), simulationTimeMs = 10): DispatchContext {
  return {
    simulationTimeMs,
    eventQueue: queue
  }
}

function assertWallTiming(result: { startedAtWallMs: number; finishedAtWallMs: number; durationWallMs: number }): void {
  assert.ok(Number.isFinite(result.startedAtWallMs))
  assert.ok(Number.isFinite(result.finishedAtWallMs))
  assert.ok(Number.isFinite(result.durationWallMs))
  assert.ok(result.finishedAtWallMs >= result.startedAtWallMs)
  assert.ok(result.durationWallMs >= 0)
}

class RecordingObserver implements DispatchObserver {
  readonly starts: EventDispatchTrace[] = []
  readonly successes: EventDispatchTrace[] = []
  readonly failures: EventDispatchTrace[] = []
  readonly batchStarts: SimulationEvent[][] = []
  readonly batchCompletes: EventDispatchBatchResult[] = []

  onDispatchStart(trace: EventDispatchTrace): void {
    this.starts.push(trace)
  }

  onDispatchSuccess(trace: EventDispatchTrace): void {
    this.successes.push(trace)
  }

  onDispatchFailure(trace: EventDispatchTrace): void {
    this.failures.push(trace)
  }

  onBatchStart(events: SimulationEvent[]): void {
    this.batchStarts.push(events)
  }

  onBatchComplete(result: EventDispatchBatchResult): void {
    this.batchCompletes.push(result)
  }
}

describe('EventDispatcher', () => {
  it('selects a handler by event type and passes the dispatch context', () => {
    const queue = new InMemoryEventQueue()
    const context = createContext(queue, 42)
    const event = createEvent(queue, {
      id: 'event-1',
      type: 'demo.ok',
      scheduledAt: 42
    })
    let receivedEvent: SimulationEvent | undefined
    let receivedContext: DispatchContext | undefined

    const dispatcher = new EventDispatcher({
      handlers: {
        'demo.ok': (nextEvent, nextContext) => {
          receivedEvent = nextEvent
          receivedContext = nextContext
          return { notes: ['handled'] }
        }
      }
    })

    const result = dispatcher.dispatch(event, context)

    assert.equal(result.ok, true)
    assert.equal(receivedEvent, event)
    assert.equal(receivedContext, context)
    assert.deepEqual(result.notes, ['handled'])
    assert.equal(result.simulationTimeMs, 42)
    assert.equal(result.scheduledAt, 42)
    assertWallTiming(result)
  })

  it('records trace transitions and notifies observers', () => {
    const queue = new InMemoryEventQueue()
    const event = createEvent(queue, { id: 'event-2', type: 'demo.ok' })
    const observer = new RecordingObserver()
    const dispatcher = new EventDispatcher({
      handlers: {
        'demo.ok': function demoOk() {
          return { notes: ['observer'] }
        }
      },
      observers: [observer]
    })

    const result = dispatcher.dispatch(event, createContext(queue))

    assert.equal(result.trace.status, 'completed')
    assert.equal(result.trace.handlerFound, true)
    assert.equal(result.trace.handlerName, 'demoOk')
    assert.equal(observer.starts.length, 1)
    assert.equal(observer.starts[0]?.status, 'started')
    assert.equal(observer.successes.length, 1)
    assert.equal(observer.successes[0]?.status, 'completed')
    assert.equal(observer.failures.length, 0)
  })

  it('allows a handler to schedule follow-up events through the event queue', () => {
    const queue = new InMemoryEventQueue()
    const event = createEvent(queue, { id: 'event-3', type: 'demo.schedule_next' })
    const dispatcher = new EventDispatcher({
      handlers: {
        'demo.schedule_next': (_event, context) => {
          const scheduled = context.eventQueue.schedule(
            createInput({
              id: 'event-4',
              type: 'demo.ok',
              scheduledAt: context.simulationTimeMs + 5,
              createdAt: context.simulationTimeMs
            })
          )

          return { scheduledEventIds: [scheduled.id] }
        }
      }
    })

    const result = dispatcher.dispatch(event, createContext(queue, 10))

    assert.equal(result.ok, true)
    assert.deepEqual(result.scheduledEventIds, ['event-4'])
    assert.equal(queue.peekNext()?.id, 'event-4')
  })

  it('returns a recoverable failure when no handler is registered', () => {
    const queue = new InMemoryEventQueue()
    const event = createEvent(queue, { id: 'event-5', type: 'demo.missing_handler' })
    const dispatcher = new EventDispatcher({ handlers: {} })

    const result = dispatcher.dispatch(event, createContext(queue))

    assert.equal(result.ok, false)
    assert.equal(result.handlerFound, false)
    assert.equal(result.error?.code, 'EVENT_HANDLER_NOT_FOUND')
    assert.equal(result.error?.severity, 'recoverable')
    assert.equal(result.trace.status, 'failed')
    assertWallTiming(result)
  })

  it('preserves thrown EventDispatchError metadata', () => {
    const queue = new InMemoryEventQueue()
    const event = createEvent(queue, { id: 'event-6', type: 'demo.invalid' })
    const dispatcher = new EventDispatcher({
      handlers: {
        'demo.invalid': () => {
          throw new EventDispatchError(
            'INVALID_EVENT_PAYLOAD',
            'recoverable',
            'Invalid demo payload',
            { field: 'payload' }
          )
        }
      }
    })

    const result = dispatcher.dispatch(event, createContext(queue))

    assert.equal(result.ok, false)
    assert.equal(result.error?.code, 'INVALID_EVENT_PAYLOAD')
    assert.equal(result.error?.severity, 'recoverable')
    assert.deepEqual(result.error?.details, { field: 'payload' })
  })

  it('converts unknown thrown errors into fatal handler errors', () => {
    const queue = new InMemoryEventQueue()
    const event = createEvent(queue, { id: 'event-7', type: 'demo.throw' })
    const dispatcher = new EventDispatcher({
      handlers: {
        'demo.throw': () => {
          throw new Error('boom')
        }
      }
    })

    const result = dispatcher.dispatch(event, createContext(queue))

    assert.equal(result.ok, false)
    assert.equal(result.error?.code, 'HANDLER_UNEXPECTED_ERROR')
    assert.equal(result.error?.severity, 'fatal')
    assert.equal(result.error?.message, 'boom')
  })

  it('continues a batch after recoverable errors and stops after a fatal error', () => {
    const queue = new InMemoryEventQueue()
    queue.schedule(createInput({ id: 'ok-1', type: 'demo.ok' }))
    queue.schedule(createInput({ id: 'missing', type: 'demo.missing_handler' }))
    queue.schedule(createInput({ id: 'fatal', type: 'demo.fatal' }))
    queue.schedule(createInput({ id: 'skipped', type: 'demo.ok' }))
    const events = queue.popDueEvents(10)
    const handled: string[] = []
    const observer = new RecordingObserver()
    const dispatcher = new EventDispatcher({
      handlers: {
        'demo.ok': (event) => {
          handled.push(event.id)
        },
        'demo.fatal': () => {
          throw new EventDispatchError('REGISTRY_INCONSISTENT', 'fatal', 'Registry is inconsistent')
        }
      },
      observers: [observer]
    })

    const result = dispatcher.dispatchMany(events, createContext(queue))

    assert.deepEqual(handled, ['ok-1'])
    assert.equal(result.total, 3)
    assert.equal(result.ok, 1)
    assert.equal(result.failed, 2)
    assert.equal(result.recoverable, 1)
    assert.equal(result.fatal, 1)
    assert.equal(result.stopped, true)
    assert.deepEqual(
      result.results.map((item) => item.eventId),
      ['ok-1', 'missing', 'fatal']
    )
    assert.equal(observer.batchStarts.length, 1)
    assert.equal(observer.batchStarts[0]?.length, 4)
    assert.equal(observer.batchCompletes.length, 1)
    assert.equal(observer.batchCompletes[0]?.stopped, true)
  })

  it('runs a demo scenario with console observer and dispatch history', () => {
    const queue = new InMemoryEventQueue()
    queue.schedule(createInput({ id: 'event_1', type: 'demo.ok' }))
    queue.schedule(createInput({ id: 'event_2', type: 'demo.schedule_next' }))
    queue.schedule(createInput({ id: 'event_3', type: 'demo.missing_handler' }))
    const events = queue.popDueEvents(10)
    const historyObserver = new RecordingObserver()
    const handlers: EventHandlerMap = {
      'demo.ok': () => undefined,
      'demo.schedule_next': (_event, context) => {
        const scheduled = context.eventQueue.schedule(
          createInput({
            id: 'event_4',
            type: 'demo.ok',
            scheduledAt: 15,
            createdAt: context.simulationTimeMs
          })
        )

        return {
          scheduledEventIds: [scheduled.id],
          notes: ['scheduled next demo event']
        }
      }
    }
    const dispatcher = new EventDispatcher({
      handlers,
      observers: [new ConsoleDispatchObserver(), historyObserver]
    })

    const result = dispatcher.dispatchMany(events, createContext(queue, 10))

    assert.equal(result.total, 3)
    assert.equal(result.ok, 2)
    assert.equal(result.failed, 1)
    assert.equal(result.recoverable, 1)
    assert.equal(result.fatal, 0)
    assert.equal(result.stopped, false)
    assert.deepEqual(
      result.results.map((item) => item.eventId),
      ['event_1', 'event_2', 'event_3']
    )
    assert.deepEqual(result.results[1]?.scheduledEventIds, ['event_4'])
    assert.equal(queue.peekNext()?.id, 'event_4')
    assert.deepEqual(
      historyObserver.starts.map((trace) => trace.eventId),
      ['event_1', 'event_2', 'event_3']
    )
    assert.deepEqual(
      result.traces.map((trace) => trace.status),
      ['completed', 'completed', 'failed']
    )
  })

  it('executes the built-in simulation noop handler', () => {
    const queue = new InMemoryEventQueue()
    const event = createEvent(queue, { id: 'noop', type: 'simulation.noop' })
    const dispatcher = new EventDispatcher({
      handlers: {
        'simulation.noop': NoopHandler
      }
    })

    const result = dispatcher.dispatch(event, createContext(queue))

    assert.equal(result.ok, true)
    assert.equal(result.handlerName, 'NoopHandler')
    assert.deepEqual(result.notes, ['noop executed'])
  })

  it('executes the built-in simulation log handler through context logger', () => {
    const queue = new InMemoryEventQueue()
    const logs: Array<{ level: string; message: string; details?: unknown }> = []
    const payload: SimulationLogPayload = {
      level: 'warning',
      message: 'Battery is low',
      details: { deviceId: 'node-1' }
    }
    const event = createEvent(queue, {
      id: 'log',
      type: 'simulation.log',
      payload
    })
    const dispatcher = new EventDispatcher({
      handlers: {
        'simulation.log': SimulationLogHandler
      }
    })

    const result = dispatcher.dispatch(event, {
      ...createContext(queue),
      logger: {
        warn(message, details) {
          logs.push({ level: 'warning', message, details })
        }
      }
    })

    assert.equal(result.ok, true)
    assert.deepEqual(logs, [
      {
        level: 'warning',
        message: 'Battery is low',
        details: { deviceId: 'node-1' }
      }
    ])
    assert.deepEqual(result.notes, ['log warning: Battery is low'])
  })

  it('returns recoverable invalid payload failure from simulation log handler', () => {
    const queue = new InMemoryEventQueue()
    const event = createEvent(queue, {
      id: 'invalid-log',
      type: 'simulation.log',
      payload: { level: 'verbose', message: 'Unsupported' }
    })
    const dispatcher = new EventDispatcher({
      handlers: {
        'simulation.log': SimulationLogHandler
      }
    })

    const result = dispatcher.dispatch(event, createContext(queue))

    assert.equal(result.ok, false)
    assert.equal(result.error?.code, 'INVALID_EVENT_PAYLOAD')
    assert.equal(result.error?.severity, 'recoverable')
  })
})
