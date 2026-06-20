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

  getNowMs(): number {
    return this.virtualTimeMs
  }

  start(): SimulationClockSnapshot {
    return this.resume()
  }

  resume(): SimulationClockSnapshot {
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

  isPaused(): boolean {
    return this.state === 'paused'
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

  advanceBy(deltaMs: number): SimulationClockSnapshot {
    if (!Number.isFinite(deltaMs)) {
      throw new SimulationClockError(
        'SIMULATION_CLOCK_DELTA_NOT_FINITE',
        'Clock advance delta must be a finite number',
        { deltaMs }
      )
    }

    if (deltaMs < 0) {
      throw new SimulationClockError(
        'SIMULATION_CLOCK_DELTA_NEGATIVE',
        'Clock advance delta must be non-negative',
        { deltaMs }
      )
    }

    if (this.state !== 'running') {
      return this.getSnapshot()
    }

    this.realElapsedMs += deltaMs
    this.virtualTimeMs += deltaMs * this.speed

    return this.getSnapshot()
  }

  advance(deltaRealMs: number): SimulationClockSnapshot {
    return this.advanceBy(deltaRealMs)
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
