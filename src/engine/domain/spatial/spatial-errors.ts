export type SpatialIndexErrorCode =
  | 'SPATIAL_CONFIG_INVALID'
  | 'SPATIAL_CELL_SIZE_INVALID'
  | 'SPATIAL_DEVICE_ID_REQUIRED'
  | 'SPATIAL_DEVICE_ALREADY_EXISTS'
  | 'SPATIAL_DEVICE_NOT_FOUND'
  | 'SPATIAL_POSITION_INVALID'
  | 'SPATIAL_POSITION_OUT_OF_BOUNDS'
  | 'SPATIAL_RANGE_INVALID'

export class SpatialIndexError extends Error {
  constructor(
    public readonly code: SpatialIndexErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message)
    this.name = 'SpatialIndexError'
  }
}
