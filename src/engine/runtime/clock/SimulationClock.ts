import { SimulationClockError } from './SimulationClockErrors'
import {
  SimulationClockSpeedMultiplier,
  type SimulationClockSnapshot,
  type SimulationClockSpeed,
  type SimulationClockState
} from './SimulationClockTypes'

const supportedSpeeds = new Set<number>([
  SimulationClockSpeedMultiplier.X1,
  SimulationClockSpeedMultiplier.X5,
  SimulationClockSpeedMultiplier.X10
])

export class SimulationClock {
  private state: SimulationClockState = 'stopped'
  private virtualTimeMs = 0
  private realElapsedMs = 0
  private speed: SimulationClockSpeed = SimulationClockSpeedMultiplier.X1

  start(): SimulationClockSnapshot {
    this.state = 'running'
    return this.getSnapshot()
  }

  pause(): SimulationClockSnapshot {
    this.state = 'paused'
    return this.getSnapshot()
  }

  stop(): SimulationClockSnapshot {
    this.state = 'stopped'
    return this.getSnapshot()
  }

  reset(): SimulationClockSnapshot {
    this.state = 'stopped'
    this.virtualTimeMs = 0
    this.realElapsedMs = 0
    return this.getSnapshot()
  }

  setSpeed(speed: SimulationClockSpeed): SimulationClockSnapshot {
    if (!supportedSpeeds.has(speed)) {
      throw new SimulationClockError(
        'SIMULATION_CLOCK_SPEED_UNSUPPORTED',
        `Unsupported simulation clock speed: ${String(speed)}`,
        { speed }
      )
    }

    this.speed = speed
    return this.getSnapshot()
  }

  advance(deltaRealMs: number): SimulationClockSnapshot {
    if (!Number.isFinite(deltaRealMs)) {
      throw new SimulationClockError(
        'SIMULATION_CLOCK_DELTA_NOT_FINITE',
        'Clock advance delta must be a finite number',
        { deltaRealMs }
      )
    }

    if (deltaRealMs < 0) {
      throw new SimulationClockError(
        'SIMULATION_CLOCK_DELTA_NEGATIVE',
        'Clock advance delta must be non-negative',
        { deltaRealMs }
      )
    }

    if (this.state !== 'running') {
      return this.getSnapshot()
    }

    this.realElapsedMs += deltaRealMs
    this.virtualTimeMs += deltaRealMs * this.speed

    return this.getSnapshot()
  }

  getSnapshot(): SimulationClockSnapshot {
    return {
      state: this.state,
      virtualTimeMs: this.virtualTimeMs,
      realElapsedMs: this.realElapsedMs,
      speed: this.speed,
      isRunning: this.state === 'running'
    }
  }
}
