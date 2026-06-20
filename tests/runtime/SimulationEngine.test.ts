import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { SimulationRuntimeSessionManager } from '../../src/engine/application/simulation'
import {
  EventDispatchError,
  EventDispatcher,
  EventPriority,
  InMemoryEventQueue,
  SimulationClock,
  SimulationClockSpeedMultiplier,
  SimulationEngine,
  SimulationEngineStatus,
  type DispatchContext,
  type EventHandlerMap,
  type EventQueue,
  type EventQueueSnapshot,
  type ScheduleSimulationEventInput,
  type SimulationEvent,
  type SimulationEventTarget
} from '../../src/engine/runtime'

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

function createEngine(handlers: EventHandlerMap = {}): {
  clock: SimulationClock
  queue: InMemoryEventQueue
  engine: SimulationEngine
} {
  const clock = new SimulationClock()
  const queue = new InMemoryEventQueue()
  const dispatcher = new EventDispatcher({ handlers })
  const engine = new SimulationEngine({
    clock,
    eventQueue: queue,
    dispatcher
  })

  return { clock, queue, engine }
}

class ThrowingPopQueue implements EventQueue {
  schedule<TPayload>(input: ScheduleSimulationEventInput<TPayload>): SimulationEvent<TPayload> {
    return new InMemoryEventQueue().schedule(input)
  }

  popDueEvents(): SimulationEvent[] {
    throw new Error('queue exploded')
  }

  peekNext(): SimulationEvent | undefined {
    return undefined
  }

  cancel(): boolean {
    return false
  }

  cancelByTarget(_target: SimulationEventTarget): number {
    return 0
  }

  clear(): void {
    // Nothing to clear in this broken test fixture.
  }

  size(): number {
    return 0
  }

  getSnapshot(): EventQueueSnapshot {
    return {
      size: 0,
      events: []
    }
  }
}

describe('SimulationEngine', () => {
  it('starts with an idle state and exposes a snapshot', () => {
    const { engine } = createEngine()

    assert.equal(SimulationEngineStatus.IDLE, 'idle')
    assert.deepEqual(engine.getState(), {
      status: SimulationEngineStatus.IDLE,
      stepCount: 0,
      processedEventCount: 0,
      failedEventCount: 0
    })
    assert.deepEqual(engine.getSnapshot(), {
      state: {
        status: SimulationEngineStatus.IDLE,
        stepCount: 0,
        processedEventCount: 0,
        failedEventCount: 0
      },
      nowMs: 0,
      pendingEventCount: 0
    })
  })

  it('starts without advancing time', () => {
    const { clock, engine } = createEngine()

    const result = engine.start()

    assert.equal(result.ok, true)
    assert.equal(result.status, SimulationEngineStatus.RUNNING)
    assert.equal(clock.getNowMs(), 0)
    assert.equal(engine.getState().processedEventCount, 0)
  })

  it('treats step(0) as a successful no-op', () => {
    const { engine } = createEngine()

    const result = engine.step(0)

    assert.equal(result.ok, true)
    assert.equal(result.startedAtMs, 0)
    assert.equal(result.endedAtMs, 0)
    assert.equal(result.deltaRealMs, 0)
    assert.equal(result.deltaSimulationMs, 0)
    assert.equal(result.processedEventCount, 0)
    assert.equal(engine.getState().stepCount, 0)
  })

  it('returns validation failures for invalid step deltas without throwing', () => {
    const { engine } = createEngine()

    for (const deltaRealMs of [-1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = engine.step(deltaRealMs)

      assert.equal(result.ok, false)
      assert.equal(result.errors[0]?.code, 'SIMULATION_ENGINE_DELTA_INVALID')
      assert.equal(engine.getState().status, SimulationEngineStatus.IDLE)
    }
  })

  it('auto-starts from idle and advances by real delta through the clock speed', () => {
    const { clock, engine } = createEngine()

    clock.setSpeed(SimulationClockSpeedMultiplier.X5)
    const result = engine.step(100)

    assert.equal(result.ok, true)
    assert.equal(result.status, SimulationEngineStatus.RUNNING)
    assert.equal(result.startedAtMs, 0)
    assert.equal(result.endedAtMs, 500)
    assert.equal(result.deltaRealMs, 100)
    assert.equal(result.deltaSimulationMs, 500)
    assert.equal(engine.getState().stepCount, 1)
  })

  it('dispatches due events in queue order and leaves future events pending', () => {
    const dispatched: string[] = []
    const { queue, engine } = createEngine({
      'demo.ok': (event) => {
        dispatched.push(event.id)
      }
    })

    queue.schedule(createInput({ id: 'later', scheduledAt: 1500 }))
    queue.schedule(createInput({ id: 'a', scheduledAt: 100, priority: EventPriority.SCENARIO }))
    queue.schedule(createInput({ id: 'b', scheduledAt: 100, priority: EventPriority.LOG }))
    queue.schedule(createInput({ id: 'c', scheduledAt: 300 }))

    const result = engine.step(1000)

    assert.equal(result.ok, true)
    assert.deepEqual(dispatched, ['a', 'b', 'c'])
    assert.deepEqual(
      result.processedEvents.map((event) => event.id),
      ['a', 'b', 'c']
    )
    assert.equal(result.processedEventCount, 3)
    assert.equal(result.pendingEventCount, 1)
    assert.equal(queue.peekNext()?.id, 'later')
  })

  it('passes dispatch context simulation time after clock advance', () => {
    let receivedContext: DispatchContext | undefined
    const { queue, engine } = createEngine({
      'demo.ok': (_event, context) => {
        receivedContext = context
      }
    })

    queue.schedule(createInput({ id: 'event-context', scheduledAt: 100 }))
    const result = engine.step(100)

    assert.equal(result.ok, true)
    assert.equal(receivedContext?.simulationTimeMs, 100)
  })

  it('collects handler failures without putting the engine into error state', () => {
    const { queue, engine } = createEngine({
      'demo.fail': () => {
        throw new EventDispatchError('INVALID_EVENT_PAYLOAD', 'recoverable', 'bad payload')
      }
    })

    queue.schedule(createInput({ id: 'bad', type: 'demo.fail', scheduledAt: 10 }))
    const result = engine.step(10)

    assert.equal(result.ok, false)
    assert.equal(result.failedEventCount, 1)
    assert.equal(result.dispatchResults[0]?.error?.code, 'INVALID_EVENT_PAYLOAD')
    assert.equal(engine.getState().status, SimulationEngineStatus.RUNNING)
  })

  it('pause, resume, and stop control whether step advances time', () => {
    const { clock, engine } = createEngine()

    engine.start()
    engine.step(100)
    engine.pause()
    const paused = engine.step(100)

    assert.equal(paused.ok, true)
    assert.equal(clock.getNowMs(), 100)

    engine.resume()
    engine.step(50)
    assert.equal(clock.getNowMs(), 150)

    engine.stop()
    const stopped = engine.step(100)

    assert.equal(stopped.ok, true)
    assert.equal(clock.getNowMs(), 150)
  })

  it('blocks steps in error state until reset clears state, clock, and queue', () => {
    const clock = new SimulationClock()
    const queue = new ThrowingPopQueue()
    const dispatcher = new EventDispatcher({ handlers: {} })
    const engine = new SimulationEngine({ clock, eventQueue: queue, dispatcher })

    const failed = engine.step(10)

    assert.equal(failed.ok, false)
    assert.equal(engine.getState().status, SimulationEngineStatus.ERROR)
    assert.equal(clock.getNowMs(), 10)

    const blocked = engine.step(10)

    assert.equal(blocked.ok, false)
    assert.equal(blocked.errors[0]?.code, 'SIMULATION_ENGINE_STATUS_BLOCKED')
    assert.equal(clock.getNowMs(), 10)

    const reset = engine.reset()

    assert.equal(reset.ok, true)
    assert.equal(engine.getState().status, SimulationEngineStatus.IDLE)
    assert.equal(clock.getNowMs(), 0)
  })

  it('runUntil reaches target simulation time and respects maxSteps', () => {
    const { engine } = createEngine()

    const reached = engine.runUntil(1000, { stepRealMs: 100 })

    assert.equal(reached.ok, true)
    assert.equal(reached.stoppedReason, 'target_reached')
    assert.equal(reached.stepCount, 10)
    assert.equal(reached.nowMs, 1000)

    const limitedEngine = createEngine().engine
    const limited = limitedEngine.runUntil(10000, { stepRealMs: 100, maxSteps: 3 })

    assert.equal(limited.ok, true)
    assert.equal(limited.stoppedReason, 'max_steps_reached')
    assert.equal(limited.stepCount, 3)
    assert.equal(limited.nowMs, 300)
  })

  it('runUntil no-ops for reached targets and reports paused, stopped, and error states', () => {
    const reachedEngine = createEngine().engine
    reachedEngine.step(100)

    const alreadyReached = reachedEngine.runUntil(50)

    assert.equal(alreadyReached.ok, true)
    assert.equal(alreadyReached.stoppedReason, 'target_reached')
    assert.equal(alreadyReached.stepCount, 0)

    const pausedEngine = createEngine().engine
    pausedEngine.start()
    pausedEngine.pause()

    const paused = pausedEngine.runUntil(100)

    assert.equal(paused.ok, true)
    assert.equal(paused.stoppedReason, 'paused')

    const stoppedEngine = createEngine().engine
    stoppedEngine.stop()

    const stopped = stoppedEngine.runUntil(100)

    assert.equal(stopped.ok, true)
    assert.equal(stopped.stoppedReason, 'stopped')

    const clock = new SimulationClock()
    const errorEngine = new SimulationEngine({
      clock,
      eventQueue: new ThrowingPopQueue(),
      dispatcher: new EventDispatcher({ handlers: {} })
    })

    errorEngine.step(10)
    const errored = errorEngine.runUntil(100)

    assert.equal(errored.ok, false)
    assert.equal(errored.stoppedReason, 'error')
  })
})

describe('SimulationRuntimeSessionManager', () => {
  it('maps existing commands to engine-backed snapshots and step results', () => {
    const manager = new SimulationRuntimeSessionManager()

    const started = manager.dispatch({ type: 'simulation/start' })

    assert.equal(started.ok, true)
    assert.equal(started.clock?.state, 'running')
    assert.equal(started.engine?.state.status, SimulationEngineStatus.RUNNING)

    const speed = manager.dispatch({
      type: 'simulation/set-speed',
      speed: SimulationClockSpeedMultiplier.X10
    })

    assert.equal(speed.ok, true)
    assert.equal(speed.clock?.speed, SimulationClockSpeedMultiplier.X10)

    const advanced = manager.dispatch({
      type: 'simulation/advance-clock',
      deltaRealMs: 100
    })

    assert.equal(advanced.ok, true)
    assert.equal(advanced.clock?.virtualTimeMs, 1000)
    assert.equal(advanced.step?.deltaRealMs, 100)
    assert.equal(advanced.step?.deltaSimulationMs, 1000)
    assert.equal(advanced.engine?.state.stepCount, 1)

    const reset = manager.resetForNewWorkspace()

    assert.equal(reset.ok, true)
    assert.equal(reset.clock?.virtualTimeMs, 0)
    assert.equal(reset.clock?.speed, SimulationClockSpeedMultiplier.X1)
    assert.equal(reset.engine?.state.status, SimulationEngineStatus.IDLE)
  })
})
