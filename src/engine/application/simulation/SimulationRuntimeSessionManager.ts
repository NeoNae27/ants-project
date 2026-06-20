import { SimulationClock } from '../../runtime/clock'
import { SimulationClockSpeedMultiplier } from '../../runtime/clock'
import type {
  SimulationCommand,
  SimulationCommandResult
} from '../../../shared/simulationRuntime'

function toErrorResult(error: unknown, clock: SimulationClock): SimulationCommandResult {
  if (error instanceof Error) {
    const code = 'code' in error && typeof error.code === 'string' ? error.code : error.name

    return {
      ok: false,
      clock: clock.getSnapshot(),
      error: {
        code,
        message: error.message
      }
    }
  }

  return {
    ok: false,
    clock: clock.getSnapshot(),
    error: {
      code: 'SIMULATION_RUNTIME_UNKNOWN_ERROR',
      message: 'Unknown simulation runtime error'
    }
  }
}

export class SimulationRuntimeSessionManager {
  private readonly clock = new SimulationClock()

  dispatch(command: SimulationCommand): SimulationCommandResult {
    try {
      switch (command.type) {
        case 'simulation/start':
          return this.withClock(this.clock.start())
        case 'simulation/pause':
          return this.withClock(this.clock.pause())
        case 'simulation/stop':
          return this.withClock(this.clock.stop())
        case 'simulation/reset':
          return this.withClock(this.clock.reset())
        case 'simulation/set-speed':
          return this.withClock(this.clock.setSpeed(command.speed))
        case 'simulation/advance-clock':
          return this.withClock(this.clock.advance(command.deltaRealMs))
        case 'simulation/get-clock-snapshot':
          return this.withClock(this.clock.getSnapshot())
        default:
          return {
            ok: false,
            clock: this.clock.getSnapshot(),
            error: {
              code: 'SIMULATION_COMMAND_UNKNOWN',
              message: `Unknown simulation command: ${(command as { type?: string }).type}`
            }
          }
      }
    } catch (error) {
      return toErrorResult(error, this.clock)
    }
  }

  getClockSnapshot(): SimulationCommandResult {
    return this.withClock(this.clock.getSnapshot())
  }

  resetForNewWorkspace(): SimulationCommandResult {
    try {
      this.clock.setSpeed(SimulationClockSpeedMultiplier.X1)
      return this.withClock(this.clock.reset())
    } catch (error) {
      return toErrorResult(error, this.clock)
    }
  }

  private withClock(clock: ReturnType<SimulationClock['getSnapshot']>): SimulationCommandResult {
    return {
      ok: true,
      clock
    }
  }
}
