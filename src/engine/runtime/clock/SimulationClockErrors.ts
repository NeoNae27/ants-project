export type SimulationClockErrorCode =
  | 'SIMULATION_CLOCK_DELTA_NOT_FINITE'
  | 'SIMULATION_CLOCK_DELTA_NEGATIVE'
  | 'SIMULATION_CLOCK_SPEED_UNSUPPORTED'

export class SimulationClockError extends Error {
  constructor(
    public readonly code: SimulationClockErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'SimulationClockError'
  }
}
