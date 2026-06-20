import {
  EventDispatcher,
  InMemoryEventQueue,
  NoopHandler,
  SimulationClock,
  SimulationClockSpeedMultiplier,
  SimulationEngine,
  SimulationLogHandler
} from '../../runtime'
import type {
  SimulationCommand,
  SimulationCommandResult
} from '../../../shared/simulationRuntime'

function toErrorResult(
  error: unknown,
  clock: SimulationClock,
  engine: SimulationEngine
): SimulationCommandResult {
  if (error instanceof Error) {
    const code = 'code' in error && typeof error.code === 'string' ? error.code : error.name

    return {
      ok: false,
      clock: clock.getSnapshot(),
      engine: engine.getSnapshot(),
      error: {
        code,
        message: error.message
      }
    }
  }

  return {
    ok: false,
    clock: clock.getSnapshot(),
    engine: engine.getSnapshot(),
    error: {
      code: 'SIMULATION_RUNTIME_UNKNOWN_ERROR',
      message: 'Unknown simulation runtime error'
    }
  }
}

export class SimulationRuntimeSessionManager {
  private readonly clock = new SimulationClock()
  private readonly eventQueue = new InMemoryEventQueue()
  private readonly dispatcher = new EventDispatcher({
    handlers: {
      'simulation.noop': NoopHandler,
      'simulation.log': SimulationLogHandler
    }
  })
  private readonly engine = new SimulationEngine({
    clock: this.clock,
    eventQueue: this.eventQueue,
    dispatcher: this.dispatcher
  })

  dispatch(command: SimulationCommand): SimulationCommandResult {
    try {
      switch (command.type) {
        case 'simulation/start':
          return this.withEngine(this.engine.start())
        case 'simulation/pause':
          return this.withEngine(this.engine.pause())
        case 'simulation/stop':
          return this.withEngine(this.engine.stop())
        case 'simulation/reset':
          return this.withEngine(this.engine.reset())
        case 'simulation/set-speed':
          this.clock.setSpeed(command.speed)
          return this.withSnapshot()
        case 'simulation/advance-clock':
          return this.withEngine(this.engine.step(command.deltaRealMs))
        case 'simulation/get-clock-snapshot':
          return this.withSnapshot()
        default:
          return {
            ok: false,
            clock: this.clock.getSnapshot(),
            engine: this.engine.getSnapshot(),
            error: {
              code: 'SIMULATION_COMMAND_UNKNOWN',
              message: `Unknown simulation command: ${(command as { type?: string }).type}`
            }
        }
      }
    } catch (error) {
      return toErrorResult(error, this.clock, this.engine)
    }
  }

  getClockSnapshot(): SimulationCommandResult {
    return this.withSnapshot()
  }

  resetForNewWorkspace(): SimulationCommandResult {
    try {
      this.clock.setSpeed(SimulationClockSpeedMultiplier.X1)
      return this.withEngine(this.engine.reset())
    } catch (error) {
      return toErrorResult(error, this.clock, this.engine)
    }
  }

  private withSnapshot(): SimulationCommandResult {
    return {
      ok: true,
      clock: this.clock.getSnapshot(),
      engine: this.engine.getSnapshot()
    }
  }

  private withEngine(
    result: ReturnType<SimulationEngine['start']> | ReturnType<SimulationEngine['step']>
  ): SimulationCommandResult {
    return {
      ok: result.ok,
      clock: this.clock.getSnapshot(),
      engine: this.engine.getSnapshot(),
      ...('deltaRealMs' in result ? { step: result } : {}),
      ...(result.errors[0]
        ? {
            error: {
              code: result.errors[0].code,
              message: result.errors[0].message
            }
          }
        : {})
    }
  }
}
