export type SimulationEngineErrorCode =
  | 'SIMULATION_ENGINE_DELTA_INVALID'
  | 'SIMULATION_ENGINE_TARGET_TIME_INVALID'
  | 'SIMULATION_ENGINE_STEP_REAL_MS_INVALID'
  | 'SIMULATION_ENGINE_MAX_STEPS_INVALID'
  | 'SIMULATION_ENGINE_STATUS_BLOCKED'
  | 'SIMULATION_ENGINE_CLOCK_SPEED_INVALID'
  | 'SIMULATION_ENGINE_UNEXPECTED_ERROR'

export type SimulationEngineError = {
  code: SimulationEngineErrorCode
  message: string
  details?: Record<string, unknown>
}

export function createSimulationEngineError(
  code: SimulationEngineErrorCode,
  message: string,
  details?: Record<string, unknown>
): SimulationEngineError {
  return {
    code,
    message,
    ...(details ? { details } : {})
  }
}
