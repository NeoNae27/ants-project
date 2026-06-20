import type { EventQueue } from './EventQueue'
import type {
  ScheduleSimulationEventInput,
  SimulationEvent,
  SimulationEventType
} from './EventQueueTypes'
import type { EventDispatchError } from './EventDispatcherErrors'

export type DispatchLoggerPort = {
  debug?(message: string, details?: unknown): void
  info?(message: string, details?: unknown): void
  warn?(message: string, details?: unknown): void
  error?(message: string, details?: unknown): void
}

export type DispatchContext = {
  simulationTimeMs: number
  eventQueue: EventQueue
  workspace?: unknown
  registry?: unknown
  wirelessMedium?: unknown
  metricsCollector?: unknown
  logger?: DispatchLoggerPort
}

export type EventDispatchHandlerResult = {
  scheduledEventIds?: string[]
  notes?: string[]
}

export type EventHandler<TPayload = unknown> = (
  event: SimulationEvent<TPayload>,
  context: DispatchContext
) => EventDispatchHandlerResult | void

export type EventHandlerMap = Partial<Record<SimulationEventType, EventHandler>>

export type EventDispatchStatus = 'started' | 'completed' | 'failed' | 'skipped'

export type EventDispatchTrace = {
  dispatchId: string
  eventId: string
  eventType: SimulationEventType
  scheduledAt: number
  simulationTimeMs: number
  status: EventDispatchStatus
  startedAtWallMs: number
  finishedAtWallMs?: number
  durationWallMs?: number
  handlerFound: boolean
  handlerName?: string
  scheduledEventIds: string[]
  error?: EventDispatchError
  notes?: string[]
}

export type EventDispatchResult = {
  ok: boolean
  eventId: string
  eventType: SimulationEventType
  scheduledAt: number
  simulationTimeMs: number
  startedAtWallMs: number
  finishedAtWallMs: number
  durationWallMs: number
  handlerFound: boolean
  handlerName?: string
  scheduledEventIds: string[]
  error?: EventDispatchError
  notes?: string[]
  trace: EventDispatchTrace
}

export type EventDispatchBatchSummary = {
  total: number
  ok: number
  failed: number
  recoverable: number
  fatal: number
  stopped: boolean
}

export type EventDispatchBatchResult = EventDispatchBatchSummary & {
  results: EventDispatchResult[]
  traces: EventDispatchTrace[]
}

export interface DispatchObserver {
  onDispatchStart?(trace: EventDispatchTrace): void
  onDispatchSuccess?(trace: EventDispatchTrace): void
  onDispatchFailure?(trace: EventDispatchTrace): void
  onBatchStart?(events: SimulationEvent[]): void
  onBatchComplete?(result: EventDispatchBatchResult): void
}

export type EventDispatcherParams = {
  handlers: EventHandlerMap
  observers?: DispatchObserver[]
}

export type DispatchScheduleInput<TPayload = unknown> = ScheduleSimulationEventInput<TPayload>
