import type { SimulationClock } from './clock'
import type {
  DispatchContext,
  DispatchLoggerPort,
  EventDispatchResult,
  EventDispatcher,
  EventQueue,
  SimulationEvent
} from './events'
import type { SimulationEngineError } from './SimulationEngineErrors'

export enum SimulationEngineStatus {
  IDLE = 'idle',
  RUNNING = 'running',
  PAUSED = 'paused',
  STOPPED = 'stopped',
  ERROR = 'error'
}

export type SimulationEngineState = {
  status: SimulationEngineStatus
  startedAtMs?: number
  stoppedAtMs?: number
  lastStepAtMs?: number
  stepCount: number
  processedEventCount: number
  failedEventCount: number
  lastError?: string
}

export type SimulationEngineSnapshot = {
  state: SimulationEngineState
  nowMs: number
  pendingEventCount: number
}

export type SimulationEngineDependencies = {
  clock: SimulationClock
  eventQueue: EventQueue
  dispatcher: EventDispatcher
  workspace?: unknown
  registry?: unknown
  wirelessMedium?: unknown
  metricsCollector?: unknown
  logger?: DispatchLoggerPort
}

export type SimulationEngineResult = {
  ok: boolean
  status: SimulationEngineStatus
  nowMs: number
  errors: SimulationEngineError[]
  error?: string
}

export type SimulationStepResult = SimulationEngineResult & {
  startedAtMs: number
  endedAtMs: number
  deltaRealMs: number
  deltaSimulationMs: number
  processedEvents: SimulationEvent[]
  dispatchResults: EventDispatchResult[]
  processedEventCount: number
  failedEventCount: number
  pendingEventCount: number
}

export type SimulationRunStoppedReason =
  | 'target_reached'
  | 'paused'
  | 'stopped'
  | 'error'
  | 'max_steps_reached'
  | 'invalid_target_time'
  | 'invalid_step'
  | 'invalid_speed'

export type SimulationRunResult = SimulationEngineResult & {
  targetTimeMs: number
  stepCount: number
  processedEventCount: number
  failedEventCount: number
  stoppedReason: SimulationRunStoppedReason
}

export type RunUntilOptions = {
  maxSteps?: number
  stepRealMs?: number
}

export interface ISimulationEngine {
  getState(): SimulationEngineState
  getSnapshot(): SimulationEngineSnapshot
  start(): SimulationEngineResult
  pause(): SimulationEngineResult
  resume(): SimulationEngineResult
  stop(): SimulationEngineResult
  reset(): SimulationEngineResult
  step(deltaRealMs: number): SimulationStepResult
  runUntil(targetTimeMs: number, options?: RunUntilOptions): SimulationRunResult
}

export type SimulationDispatchContextFactory = (simulationTimeMs: number) => DispatchContext
