import type {
  SimulationClockSnapshot,
  SimulationClockSpeed
} from '../engine/runtime/clock'
import type {
  EventQueueSnapshot,
  SimulationEngineSnapshot,
  SimulationStepResult
} from '../engine/runtime'

export type { SimulationClockSnapshot, SimulationClockSpeed } from '../engine/runtime/clock'
export type { EventQueueSnapshot, SimulationEngineSnapshot, SimulationStepResult } from '../engine/runtime'

export type SimulationStartCommand = {
  type: 'simulation/start'
}

export type SimulationPauseCommand = {
  type: 'simulation/pause'
}

export type SimulationStopCommand = {
  type: 'simulation/stop'
}

export type SimulationResetCommand = {
  type: 'simulation/reset'
}

export type SimulationSetSpeedCommand = {
  type: 'simulation/set-speed'
  speed: SimulationClockSpeed
}

export type SimulationAdvanceClockCommand = {
  type: 'simulation/advance-clock'
  deltaRealMs: number
}

export type SimulationGetClockSnapshotCommand = {
  type: 'simulation/get-clock-snapshot'
}

export type SimulationScheduleBasicTelemetryCommand = {
  type: 'simulation/schedule-basic-telemetry'
  deviceId: string
  targetAddress: string
  dueInMs?: number
  repeat?: boolean
  intervalMs?: number
  sendDelayMs?: number
  deliveryDelayMs?: number
}

export type SimulationCommand =
  | SimulationStartCommand
  | SimulationPauseCommand
  | SimulationStopCommand
  | SimulationResetCommand
  | SimulationSetSpeedCommand
  | SimulationAdvanceClockCommand
  | SimulationGetClockSnapshotCommand
  | SimulationScheduleBasicTelemetryCommand

export type SimulationRuntimeExecutionLogEntry = {
  sequence: number
  mode: 'manual' | 'auto'
  ok: boolean
  status: string
  startedAtMs: number
  endedAtMs: number
  deltaRealMs: number
  deltaSimulationMs: number
  processedEventCount: number
  failedEventCount: number
  pendingEventCount: number
  processedEvents: Array<{
    id: string
    type: string
    scheduledAt: number
  }>
  dispatchResults: Array<{
    eventId: string
    eventType: string
    ok: boolean
    handlerName?: string
    scheduledEventIds: string[]
    notes?: string[]
    error?: {
      code: string
      message: string
      severity: string
    }
  }>
  errors: Array<{
    code: string
    message: string
  }>
}

export type SimulationCommandResult = {
  ok: boolean
  clock?: SimulationClockSnapshot
  engine?: SimulationEngineSnapshot
  queue?: EventQueueSnapshot
  step?: SimulationStepResult
  executions?: SimulationRuntimeExecutionLogEntry[]
  scheduledEventIds?: string[]
  error?: {
    code: string
    message: string
  }
}
