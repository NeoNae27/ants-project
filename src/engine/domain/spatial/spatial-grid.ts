import { SpatialIndexError } from './spatial-errors'
import type { SpatialIndex } from './spatial-index'
import type {
  CellCoord,
  DeviceId,
  Position2D,
  SpatialGridConfig,
  SpatialIndexStats,
  SpatialSearchResult
} from './spatial.types'

export class SpatialGrid implements SpatialIndex {
  private readonly cells = new Map<string, Set<DeviceId>>()
  private readonly positions = new Map<DeviceId, Position2D>()
  private readonly deviceCells = new Map<DeviceId, string>()

  constructor(private readonly config: SpatialGridConfig) {
    this.assertConfig(config)
  }

  insert(deviceId: DeviceId, position: Position2D): void {
    this.assertDeviceId(deviceId)
    this.assertPosition(position)

    if (this.positions.has(deviceId)) {
      throw new SpatialIndexError('SPATIAL_DEVICE_ALREADY_EXISTS', `Device already exists: ${deviceId}`, {
        deviceId
      })
    }

    const cellKey = this.getCellKeyForPosition(position)
    this.getOrCreateCell(cellKey).add(deviceId)
    this.positions.set(deviceId, { ...position })
    this.deviceCells.set(deviceId, cellKey)
  }

  update(deviceId: DeviceId, nextPosition: Position2D): void {
    this.assertDeviceId(deviceId)
    this.assertPosition(nextPosition)

    if (!this.positions.has(deviceId)) {
      throw new SpatialIndexError('SPATIAL_DEVICE_NOT_FOUND', `Device not found: ${deviceId}`, {
        deviceId
      })
    }

    const previousCellKey = this.deviceCells.get(deviceId)
    const nextCellKey = this.getCellKeyForPosition(nextPosition)

    if (previousCellKey !== nextCellKey) {
      if (previousCellKey) {
        this.removeFromCell(deviceId, previousCellKey)
      }

      this.getOrCreateCell(nextCellKey).add(deviceId)
      this.deviceCells.set(deviceId, nextCellKey)
    }

    this.positions.set(deviceId, { ...nextPosition })
  }

  remove(deviceId: DeviceId): void {
    this.assertDeviceId(deviceId)

    if (!this.positions.has(deviceId)) {
      throw new SpatialIndexError('SPATIAL_DEVICE_NOT_FOUND', `Device not found: ${deviceId}`, {
        deviceId
      })
    }

    const cellKey = this.deviceCells.get(deviceId)

    if (cellKey) {
      this.removeFromCell(deviceId, cellKey)
    }

    this.positions.delete(deviceId)
    this.deviceCells.delete(deviceId)
  }

  getPosition(deviceId: DeviceId): Position2D | undefined {
    const position = this.positions.get(deviceId)
    return position ? { ...position } : undefined
  }

  findNearby(center: Position2D, rangeUnits: number): DeviceId[] {
    return this.findNearbyWithDistance(center, rangeUnits).map((result) => result.deviceId)
  }

  findNearbyWithDistance(center: Position2D, rangeUnits: number): SpatialSearchResult[] {
    this.assertPosition(center)

    if (!Number.isFinite(rangeUnits) || rangeUnits <= 0) {
      throw new SpatialIndexError('SPATIAL_RANGE_INVALID', 'Range must be a positive finite number', {
        rangeUnits
      })
    }

    const minCx = Math.floor((center.x - rangeUnits) / this.config.cellSize)
    const maxCx = Math.floor((center.x + rangeUnits) / this.config.cellSize)
    const minCy = Math.floor((center.y - rangeUnits) / this.config.cellSize)
    const maxCy = Math.floor((center.y + rangeUnits) / this.config.cellSize)
    const result: SpatialSearchResult[] = []
    const visited = new Set<DeviceId>()

    for (let cx = minCx; cx <= maxCx; cx += 1) {
      for (let cy = minCy; cy <= maxCy; cy += 1) {
        const cell = this.cells.get(this.toCellKey({ cx, cy }))

        if (!cell) {
          continue
        }

        for (const deviceId of cell) {
          if (visited.has(deviceId)) {
            continue
          }

          visited.add(deviceId)

          const position = this.positions.get(deviceId)

          if (!position) {
            continue
          }

          const distanceUnits = this.distance(center, position)

          if (distanceUnits <= rangeUnits) {
            result.push({
              deviceId,
              position: { ...position },
              distanceUnits,
              distanceMeters: distanceUnits * this.config.metersPerUnit
            })
          }
        }
      }
    }

    return result
  }

  clear(): void {
    this.cells.clear()
    this.positions.clear()
    this.deviceCells.clear()
  }

  size(): number {
    return this.positions.size
  }

  getStats(): SpatialIndexStats {
    const cellSizes = Array.from(this.cells.values(), (cell) => cell.size)
    const deviceCount = this.size()
    const cellCount = this.cells.size
    const maxDevicesInCell = cellSizes.length > 0 ? Math.max(...cellSizes) : 0
    const averageDevicesPerCell =
      cellCount > 0 ? cellSizes.reduce((sum, cellSize) => sum + cellSize, 0) / cellCount : 0

    return {
      deviceCount,
      cellCount,
      maxDevicesInCell,
      averageDevicesPerCell,
      cellSize: this.config.cellSize
    }
  }

  private assertConfig(config: SpatialGridConfig): void {
    if (
      !Number.isFinite(config.width) ||
      !Number.isFinite(config.height) ||
      !Number.isFinite(config.metersPerUnit)
    ) {
      throw new SpatialIndexError('SPATIAL_CONFIG_INVALID', 'Spatial grid config values must be finite')
    }

    if (config.width <= 0 || config.height <= 0 || config.metersPerUnit <= 0) {
      throw new SpatialIndexError('SPATIAL_CONFIG_INVALID', 'Spatial grid dimensions and scale must be positive')
    }

    if (!Number.isFinite(config.cellSize) || config.cellSize <= 0) {
      throw new SpatialIndexError('SPATIAL_CELL_SIZE_INVALID', 'Cell size must be a positive finite number')
    }
  }

  private assertDeviceId(deviceId: DeviceId): void {
    if (!deviceId.trim()) {
      throw new SpatialIndexError('SPATIAL_DEVICE_ID_REQUIRED', 'Device id is required')
    }
  }

  private assertPosition(position: Position2D): void {
    if (!Number.isFinite(position.x) || !Number.isFinite(position.y)) {
      throw new SpatialIndexError('SPATIAL_POSITION_INVALID', 'Position coordinates must be finite', {
        position
      })
    }

    if (
      position.x < 0 ||
      position.y < 0 ||
      position.x > this.config.width ||
      position.y > this.config.height
    ) {
      throw new SpatialIndexError('SPATIAL_POSITION_OUT_OF_BOUNDS', 'Position is outside workspace bounds', {
        position
      })
    }
  }

  private getCellKeyForPosition(position: Position2D): string {
    return this.toCellKey(this.toCellCoord(position))
  }

  private toCellCoord(position: Position2D): CellCoord {
    return {
      cx: Math.floor(position.x / this.config.cellSize),
      cy: Math.floor(position.y / this.config.cellSize)
    }
  }

  private toCellKey(coord: CellCoord): string {
    return `${coord.cx}:${coord.cy}`
  }

  private getOrCreateCell(cellKey: string): Set<DeviceId> {
    const existingCell = this.cells.get(cellKey)

    if (existingCell) {
      return existingCell
    }

    const nextCell = new Set<DeviceId>()
    this.cells.set(cellKey, nextCell)
    return nextCell
  }

  private removeFromCell(deviceId: DeviceId, cellKey: string): void {
    const cell = this.cells.get(cellKey)
    cell?.delete(deviceId)

    if (cell?.size === 0) {
      this.cells.delete(cellKey)
    }
  }

  private distance(a: Position2D, b: Position2D): number {
    const dx = a.x - b.x
    const dy = a.y - b.y
    return Math.sqrt(dx * dx + dy * dy)
  }
}
