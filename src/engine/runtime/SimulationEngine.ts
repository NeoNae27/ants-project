import type { SimulationClock } from './clock'
import type {
  DispatchContext,
  EventDispatchResult,
  EventDispatcher,
  EventQueue,
  SimulationEvent
} from './events'
import {
  createSimulationEngineError,
  type SimulationEngineError
} from './SimulationEngineErrors'
import {
  SimulationEngineStatus,
  type ISimulationEngine,
  type RunUntilOptions,
  type SimulationEngineDependencies,
  type SimulationEngineResult,
  type SimulationEngineSnapshot,
  type SimulationEngineState,
  type SimulationRunResult,
  type SimulationRunStoppedReason,
  type SimulationStepResult
} from './SimulationEngineTypes'

const DEFAULT_MAX_STEPS = 10_000

export class SimulationEngine implements ISimulationEngine {
  private readonly clock: SimulationClock
  private readonly eventQueue: EventQueue
  private readonly dispatcher: EventDispatcher
  private readonly workspace?: unknown
  private readonly registry?: unknown
  private readonly wirelessMedium?: unknown
  private readonly metricsCollector?: unknown
  private readonly logger?: SimulationEngineDependencies['logger']

  private state: SimulationEngineState = {
    status: SimulationEngineStatus.IDLE,
    stepCount: 0,
    processedEventCount: 0,
    failedEventCount: 0
  }

  constructor(dependencies: SimulationEngineDependencies) {
    this.clock = dependencies.clock
    this.eventQueue = dependencies.eventQueue
    this.dispatcher = dependencies.dispatcher
    this.workspace = dependencies.workspace
    this.registry = dependencies.registry
    this.wirelessMedium = dependencies.wirelessMedium
    this.metricsCollector = dependencies.metricsCollector
    this.logger = dependencies.logger
  }

  getState(): SimulationEngineState {
    return { ...this.state }
  }

  getSnapshot(): SimulationEngineSnapshot {
    return {
      state: this.getState(),
      nowMs: this.clock.getNowMs(),
      pendingEventCount: this.eventQueue.size()
    }
  }

  start(): SimulationEngineResult {
    if (this.state.status === SimulationEngineStatus.ERROR) {
      return this.createBlockedResult('Cannot start simulation engine while it is in error state')
    }

    if (this.state.status !== SimulationEngineStatus.RUNNING) {
      this.clock.resume()
      this.state = {
        ...this.state,
        status: SimulationEngineStatus.RUNNING,
        startedAtMs: this.state.startedAtMs ?? this.clock.getNowMs(),
        stoppedAtMs: undefined,
        lastError: undefined
      }
    }

    return this.createResult(true)
  }

  pause(): SimulationEngineResult {
    if (this.state.status === SimulationEngineStatus.RUNNING) {
      this.clock.pause()
      this.state = {
        ...this.state,
        status: SimulationEngineStatus.PAUSED
      }
    }

    return this.createResult(true)
  }

  resume(): SimulationEngineResult {
    if (this.state.status === SimulationEngineStatus.ERROR) {
      return this.createBlockedResult('Cannot resume simulation engine while it is in error state')
    }

    if (this.state.status === SimulationEngineStatus.PAUSED) {
      this.clock.resume()
      this.state = {
        ...this.state,
        status: SimulationEngineStatus.RUNNING,
        lastError: undefined
      }
    } else if (this.state.status === SimulationEngineStatus.RUNNING) {
      this.clock.resume()
    }

    return this.createResult(true)
  }

  stop(): SimulationEngineResult {
    this.clock.stop()
    this.state = {
      ...this.state,
      status: SimulationEngineStatus.STOPPED,
      stoppedAtMs: this.clock.getNowMs()
    }

    return this.createResult(true)
  }

  reset(): SimulationEngineResult {
    this.eventQueue.clear()
    this.clock.reset()
    this.state = {
      status: SimulationEngineStatus.IDLE,
      stepCount: 0,
      processedEventCount: 0,
      failedEventCount: 0
    }

    return this.createResult(true)
  }

  step(deltaRealMs: number): SimulationStepResult {
    const startedAtMs = this.clock.getNowMs()

    if (!Number.isFinite(deltaRealMs) || deltaRealMs < 0) {
      const error = createSimulationEngineError(
        'SIMULATION_ENGINE_DELTA_INVALID',
        'Step deltaRealMs must be a non-negative finite number',
        { deltaRealMs }
      )

      return this.createStepResult(false, deltaRealMs, startedAtMs, [], [], [error])
    }

    if (this.state.status === SimulationEngineStatus.ERROR) {
      const error = createSimulationEngineError(
        'SIMULATION_ENGINE_STATUS_BLOCKED',
        'Simulation engine is in error state and must be reset before stepping',
        { status: this.state.status }
      )

      return this.createStepResult(false, deltaRealMs, startedAtMs, [], [], [error])
    }

    if (
      this.state.status === SimulationEngineStatus.PAUSED ||
      this.state.status === SimulationEngineStatus.STOPPED
    ) {
      return this.createStepResult(true, deltaRealMs, startedAtMs, [], [], [])
    }

    if (this.state.status === SimulationEngineStatus.IDLE) {
      const started = this.start()

      if (!started.ok) {
        return this.createStepResult(false, deltaRealMs, startedAtMs, [], [], started.errors)
      }
    }

    if (deltaRealMs === 0) {
      return this.createStepResult(true, deltaRealMs, startedAtMs, [], [], [])
    }

    try {
      this.clock.advanceBy(deltaRealMs)
      const endedAtMs = this.clock.getNowMs()
      const dueEvents = this.eventQueue.popDueEvents(endedAtMs)
      const context = this.createDispatchContext(endedAtMs)
      const dispatchResults = dueEvents.map((event) => this.dispatcher.dispatch(event, context))
      const failedEventCount = dispatchResults.filter((result) => !result.ok).length

      this.recordStep(endedAtMs, dispatchResults.length, failedEventCount)

      return this.createStepResult(
        failedEventCount === 0,
        deltaRealMs,
        startedAtMs,
        dueEvents,
        dispatchResults,
        []
      )
    } catch (error) {
      const engineError = this.toEngineError(error)
      this.state = {
        ...this.state,
        status: SimulationEngineStatus.ERROR,
        lastError: engineError.message
      }

      return this.createStepResult(false, deltaRealMs, startedAtMs, [], [], [engineError])
    }
  }

  runUntil(targetTimeMs: number, options: RunUntilOptions = {}): SimulationRunResult {
    if (!Number.isFinite(targetTimeMs) || targetTimeMs < 0) {
      const error = createSimulationEngineError(
        'SIMULATION_ENGINE_TARGET_TIME_INVALID',
        'Target simulation time must be a non-negative finite number',
        { targetTimeMs }
      )

      return this.createRunResult(targetTimeMs, 0, 0, 0, 'invalid_target_time', [error], false)
    }

    const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS

    if (!Number.isInteger(maxSteps) || maxSteps < 0) {
      const error = createSimulationEngineError(
        'SIMULATION_ENGINE_MAX_STEPS_INVALID',
        'maxSteps must be a non-negative integer',
        { maxSteps }
      )

      return this.createRunResult(targetTimeMs, 0, 0, 0, 'invalid_step', [error], false)
    }

    if (
      options.stepRealMs !== undefined &&
      (!Number.isFinite(options.stepRealMs) || options.stepRealMs < 0)
    ) {
      const error = createSimulationEngineError(
        'SIMULATION_ENGINE_STEP_REAL_MS_INVALID',
        'stepRealMs must be a non-negative finite number',
        { stepRealMs: options.stepRealMs }
      )

      return this.createRunResult(targetTimeMs, 0, 0, 0, 'invalid_step', [error], false)
    }

    if (targetTimeMs <= this.clock.getNowMs()) {
      return this.createRunResult(targetTimeMs, 0, 0, 0, 'target_reached', [], true)
    }

    let stepCount = 0
    let processedEventCount = 0
    let failedEventCount = 0

    while (this.clock.getNowMs() < targetTimeMs) {
      const blockedReason = this.getRunBlockedReason()

      if (blockedReason) {
        return this.createRunResult(
          targetTimeMs,
          stepCount,
          processedEventCount,
          failedEventCount,
          blockedReason,
          [],
          blockedReason !== 'error'
        )
      }

      if (stepCount >= maxSteps) {
        return this.createRunResult(
          targetTimeMs,
          stepCount,
          processedEventCount,
          failedEventCount,
          'max_steps_reached',
          [],
          true
        )
      }

      const speed = this.clock.getSnapshot().speed

      if (!Number.isFinite(speed) || speed <= 0) {
        const error = createSimulationEngineError(
          'SIMULATION_ENGINE_CLOCK_SPEED_INVALID',
          'Clock speed must be greater than zero to run until a target simulation time',
          { speed }
        )

        return this.createRunResult(
          targetTimeMs,
          stepCount,
          processedEventCount,
          failedEventCount,
          'invalid_speed',
          [error],
          false
        )
      }

      const remainingSimulationMs = targetTimeMs - this.clock.getNowMs()
      const realDeltaForTarget = remainingSimulationMs / speed
      const nextRealDeltaMs = Math.min(options.stepRealMs ?? realDeltaForTarget, realDeltaForTarget)
      const result = this.step(nextRealDeltaMs)

      stepCount += 1
      processedEventCount += result.processedEventCount
      failedEventCount += result.failedEventCount

      if (!result.ok && this.state.status === SimulationEngineStatus.ERROR) {
        return this.createRunResult(
          targetTimeMs,
          stepCount,
          processedEventCount,
          failedEventCount,
          'error',
          result.errors,
          false
        )
      }
    }

    return this.createRunResult(
      targetTimeMs,
      stepCount,
      processedEventCount,
      failedEventCount,
      'target_reached',
      [],
      true
    )
  }

  private createDispatchContext(simulationTimeMs: number): DispatchContext {
    return {
      simulationTimeMs,
      eventQueue: this.eventQueue,
      workspace: this.workspace,
      registry: this.registry,
      wirelessMedium: this.wirelessMedium,
      metricsCollector: this.metricsCollector,
      logger: this.logger
    }
  }

  private createResult(ok: boolean, errors: SimulationEngineError[] = []): SimulationEngineResult {
    return {
      ok,
      status: this.state.status,
      nowMs: this.clock.getNowMs(),
      errors,
      ...(errors[0] ? { error: errors[0].message } : {})
    }
  }

  private createBlockedResult(message: string): SimulationEngineResult {
    const error = createSimulationEngineError('SIMULATION_ENGINE_STATUS_BLOCKED', message, {
      status: this.state.status
    })

    return this.createResult(false, [error])
  }

  private createStepResult(
    ok: boolean,
    deltaRealMs: number,
    startedAtMs: number,
    processedEvents: SimulationEvent[],
    dispatchResults: EventDispatchResult[],
    errors: SimulationEngineError[]
  ): SimulationStepResult {
    const endedAtMs = this.clock.getNowMs()
    const failedEventCount = dispatchResults.filter((result) => !result.ok).length

    return {
      ...this.createResult(ok, errors),
      startedAtMs,
      endedAtMs,
      deltaRealMs,
      deltaSimulationMs: endedAtMs - startedAtMs,
      processedEvents,
      dispatchResults,
      processedEventCount: dispatchResults.length,
      failedEventCount,
      pendingEventCount: this.eventQueue.size()
    }
  }

  private createRunResult(
    targetTimeMs: number,
    stepCount: number,
    processedEventCount: number,
    failedEventCount: number,
    stoppedReason: SimulationRunStoppedReason,
    errors: SimulationEngineError[],
    ok: boolean
  ): SimulationRunResult {
    return {
      ...this.createResult(ok, errors),
      targetTimeMs,
      stepCount,
      processedEventCount,
      failedEventCount,
      stoppedReason
    }
  }

  private recordStep(endedAtMs: number, processedEventCount: number, failedEventCount: number): void {
    this.state = {
      ...this.state,
      lastStepAtMs: endedAtMs,
      stepCount: this.state.stepCount + 1,
      processedEventCount: this.state.processedEventCount + processedEventCount,
      failedEventCount: this.state.failedEventCount + failedEventCount
    }
  }

  private getRunBlockedReason(): SimulationRunStoppedReason | undefined {
    switch (this.state.status) {
      case SimulationEngineStatus.PAUSED:
        return 'paused'
      case SimulationEngineStatus.STOPPED:
        return 'stopped'
      case SimulationEngineStatus.ERROR:
        return 'error'
      default:
        return undefined
    }
  }

  private toEngineError(error: unknown): SimulationEngineError {
    if (error instanceof Error) {
      const code =
        'code' in error && typeof error.code === 'string'
          ? error.code
          : 'SIMULATION_ENGINE_UNEXPECTED_ERROR'

      return createSimulationEngineError('SIMULATION_ENGINE_UNEXPECTED_ERROR', error.message, {
        causeCode: code,
        errorName: error.name
      })
    }

    return createSimulationEngineError(
      'SIMULATION_ENGINE_UNEXPECTED_ERROR',
      'Unknown simulation engine error',
      { error }
    )
  }
}
