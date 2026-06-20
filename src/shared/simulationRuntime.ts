import type {
  SimulationClockSnapshot,
  SimulationClockSpeed
} from '../engine/runtime/clock'
import type {
  SimulationEngineSnapshot,
  SimulationStepResult
} from '../engine/runtime'

export type { SimulationClockSnapshot, SimulationClockSpeed } from '../engine/runtime/clock'
export type { SimulationEngineSnapshot, SimulationStepResult } from '../engine/runtime'

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

export type SimulationCommand =
  | SimulationStartCommand
  | SimulationPauseCommand
  | SimulationStopCommand
  | SimulationResetCommand
  | SimulationSetSpeedCommand
  | SimulationAdvanceClockCommand
  | SimulationGetClockSnapshotCommand

export type SimulationCommandResult = {
  ok: boolean
  clock?: SimulationClockSnapshot
  engine?: SimulationEngineSnapshot
  step?: SimulationStepResult
  error?: {
    code: string
    message: string
  }
}
