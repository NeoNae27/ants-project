import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { SimulationRuntimeSessionManager } from '../../src/engine/application/simulation'
import {
  SimulationClock,
  SimulationClockError,
  SimulationClockSpeedMultiplier,
  type SimulationClockErrorCode,
  type SimulationClockSpeed
} from '../../src/engine/runtime/clock'

function assertSimulationClockError(error: unknown, code: SimulationClockErrorCode): void {
  assert.ok(error instanceof SimulationClockError)
  assert.equal(error.code, code)
}

describe('SimulationClock', () => {
  it('starts with stopped state and zero time', () => {
    const clock = new SimulationClock()

    assert.deepEqual(clock.getSnapshot(), {
      state: 'stopped',
      virtualTimeMs: 0,
      realElapsedMs: 0,
      speed: SimulationClockSpeedMultiplier.X1,
      isRunning: false
    })
  })

  it('supports start, pause, stop, and reset semantics', () => {
    const clock = new SimulationClock()

    clock.start()
    assert.equal(clock.getSnapshot().state, 'running')

    clock.advance(1000)
    clock.pause()
    assert.deepEqual(clock.getSnapshot(), {
      state: 'paused',
      virtualTimeMs: 1000,
      realElapsedMs: 1000,
      speed: 1,
      isRunning: false
    })

    clock.start()
    clock.advance(500)
    clock.stop()
    assert.deepEqual(clock.getSnapshot(), {
      state: 'stopped',
      virtualTimeMs: 1500,
      realElapsedMs: 1500,
      speed: 1,
      isRunning: false
    })

    clock.reset()
    assert.deepEqual(clock.getSnapshot(), {
      state: 'stopped',
      virtualTimeMs: 0,
      realElapsedMs: 0,
      speed: 1,
      isRunning: false
    })
  })

  it('exposes the minimal deterministic simulation-time contract', () => {
    const clock = new SimulationClock()

    assert.equal(clock.getNowMs(), 0)
    assert.equal(clock.isPaused(), false)

    clock.resume()
    clock.advanceBy(0)
    assert.equal(clock.getNowMs(), 0)

    clock.advanceBy(100)
    assert.equal(clock.getNowMs(), 100)

    clock.pause()
    assert.equal(clock.isPaused(), true)
    clock.advanceBy(500)
    assert.equal(clock.getNowMs(), 100)

    clock.resume()
    assert.equal(clock.isPaused(), false)
    clock.advanceBy(50)
    assert.equal(clock.getNowMs(), 150)

    clock.reset()
    assert.equal(clock.getNowMs(), 0)
  })

  it('keeps speed when reset clears time', () => {
    const clock = new SimulationClock()

    clock.setSpeed(SimulationClockSpeedMultiplier.X10)
    clock.start()
    clock.advance(100)
    clock.reset()

    assert.equal(clock.getSnapshot().speed, SimulationClockSpeedMultiplier.X10)
    assert.equal(clock.getSnapshot().virtualTimeMs, 0)
    assert.equal(clock.getSnapshot().realElapsedMs, 0)
  })

  it('does not advance while stopped or paused', () => {
    const clock = new SimulationClock()

    clock.advance(1000)
    assert.equal(clock.getSnapshot().virtualTimeMs, 0)

    clock.start()
    clock.pause()
    clock.advance(1000)
    assert.equal(clock.getSnapshot().virtualTimeMs, 0)
  })

  it('applies speed multipliers during advance', () => {
    const clock = new SimulationClock()

    clock.start()
    clock.advance(100)

    clock.setSpeed(SimulationClockSpeedMultiplier.X5)
    clock.advance(100)

    clock.setSpeed(SimulationClockSpeedMultiplier.X10)
    clock.advance(100)

    assert.equal(clock.getSnapshot().realElapsedMs, 300)
    assert.equal(clock.getSnapshot().virtualTimeMs, 1600)
  })

  it('uses changed speed only for following advances', () => {
    const clock = new SimulationClock()

    clock.start()
    clock.advance(200)
    clock.setSpeed(SimulationClockSpeedMultiplier.X5)
    assert.equal(clock.getSnapshot().virtualTimeMs, 200)

    clock.advance(200)
    assert.equal(clock.getSnapshot().virtualTimeMs, 1200)
  })

  it('rejects invalid delta and speed values', () => {
    const clock = new SimulationClock()

    assert.throws(
      () => clock.advance(Number.NaN),
      (error) => {
        assertSimulationClockError(error, 'SIMULATION_CLOCK_DELTA_NOT_FINITE')
        return true
      }
    )

    assert.throws(
      () => clock.advance(-1),
      (error) => {
        assertSimulationClockError(error, 'SIMULATION_CLOCK_DELTA_NEGATIVE')
        return true
      }
    )

    assert.throws(
      () => clock.advanceBy(-1),
      (error) => {
        assertSimulationClockError(error, 'SIMULATION_CLOCK_DELTA_NEGATIVE')
        return true
      }
    )

    assert.throws(
      () => clock.setSpeed(2 as SimulationClockSpeed),
      (error) => {
        assertSimulationClockError(error, 'SIMULATION_CLOCK_SPEED_UNSUPPORTED')
        return true
      }
    )
  })
})

describe('SimulationRuntimeSessionManager', () => {
  it('dispatches clock commands and returns snapshots', () => {
    const manager = new SimulationRuntimeSessionManager()

    assert.equal(manager.dispatch({ type: 'simulation/start' }).clock?.state, 'running')
    assert.equal(
      manager.dispatch({
        type: 'simulation/set-speed',
        speed: SimulationClockSpeedMultiplier.X5
      }).clock?.speed,
      SimulationClockSpeedMultiplier.X5
    )

    const advanced = manager.dispatch({
      type: 'simulation/advance-clock',
      deltaRealMs: 1000
    })

    assert.equal(advanced.ok, true)
    assert.equal(advanced.clock?.virtualTimeMs, 5000)
    assert.equal(advanced.clock?.realElapsedMs, 1000)

    assert.equal(manager.dispatch({ type: 'simulation/pause' }).clock?.state, 'paused')
    assert.equal(manager.dispatch({ type: 'simulation/stop' }).clock?.state, 'stopped')
    assert.equal(manager.dispatch({ type: 'simulation/reset' }).clock?.virtualTimeMs, 0)
    assert.equal(manager.dispatch({ type: 'simulation/get-clock-snapshot' }).clock?.speed, 5)
  })

  it('resets clock time and speed for a new workspace', () => {
    const manager = new SimulationRuntimeSessionManager()

    manager.dispatch({ type: 'simulation/start' })
    manager.dispatch({
      type: 'simulation/set-speed',
      speed: SimulationClockSpeedMultiplier.X10
    })
    manager.dispatch({
      type: 'simulation/advance-clock',
      deltaRealMs: 1000
    })

    const result = manager.resetForNewWorkspace()

    assert.equal(result.ok, true)
    assert.deepEqual(result.clock, {
      state: 'stopped',
      virtualTimeMs: 0,
      realElapsedMs: 0,
      speed: 1,
      isRunning: false
    })
  })

  it('returns typed errors for invalid and unknown commands', () => {
    const manager = new SimulationRuntimeSessionManager()

    const invalidSpeed = manager.dispatch({
      type: 'simulation/set-speed',
      speed: 3 as SimulationClockSpeed
    })

    assert.equal(invalidSpeed.ok, false)
    assert.equal(invalidSpeed.error?.code, 'SIMULATION_CLOCK_SPEED_UNSUPPORTED')
    assert.equal(invalidSpeed.clock?.state, 'stopped')

    const unknown = manager.dispatch({ type: 'simulation/unknown' } as never)

    assert.equal(unknown.ok, false)
    assert.equal(unknown.error?.code, 'SIMULATION_COMMAND_UNKNOWN')
    assert.equal(unknown.clock?.state, 'stopped')
  })
})
