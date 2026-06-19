import type { DeviceId, Position2D, SpatialIndexStats, SpatialSearchResult } from './spatial.types'

export interface SpatialIndex {
  insert(deviceId: DeviceId, position: Position2D): void
  update(deviceId: DeviceId, nextPosition: Position2D): void
  remove(deviceId: DeviceId): void

  getPosition(deviceId: DeviceId): Position2D | undefined

  findNearby(center: Position2D, rangeUnits: number): DeviceId[]
  findNearbyWithDistance(center: Position2D, rangeUnits: number): SpatialSearchResult[]

  clear(): void
  size(): number
  getStats(): SpatialIndexStats
}
