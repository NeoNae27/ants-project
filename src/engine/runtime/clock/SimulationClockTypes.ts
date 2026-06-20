export type SimulationClockState = 'stopped' | 'running' | 'paused'

export type SimulationClockSpeed = 1 | 5 | 10

export const SimulationClockSpeedMultiplier = {
  X1: 1,
  X5: 5,
  X10: 10
} as const

export type SimulationClockSnapshot = {
  state: SimulationClockState
  virtualTimeMs: number
  realElapsedMs: number
  speed: SimulationClockSpeed
  isRunning: boolean
}
