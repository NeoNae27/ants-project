export type WorkspaceErrorCode =
  | 'WORKSPACE_CONFIG_INVALID'
  | 'WORKSPACE_DEVICE_ALREADY_PLACED'
  | 'WORKSPACE_DEVICE_NOT_FOUND'
  | 'WORKSPACE_POSITION_INVALID'
  | 'WORKSPACE_POSITION_OUT_OF_BOUNDS'
  | 'WORKSPACE_RANGE_INVALID'
  | 'WORKSPACE_OPERATION_ROLLBACK_FAILED'

export class WorkspaceError extends Error {
  constructor(
    public readonly code: WorkspaceErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'WorkspaceError'
  }
}
