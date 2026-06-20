import type {
  EventQueueSnapshot,
  ScheduleSimulationEventInput,
  SimulationEvent,
  SimulationEventTarget
} from './EventQueueTypes'

export interface EventQueue {
  schedule<TPayload>(input: ScheduleSimulationEventInput<TPayload>): SimulationEvent<TPayload>

  popDueEvents(now: number): SimulationEvent[]

  peekNext(): SimulationEvent | undefined

  cancel(eventId: string, reason?: string): boolean

  cancelByTarget(target: SimulationEventTarget, reason?: string): number

  clear(): void

  size(): number

  getSnapshot(): EventQueueSnapshot
}
