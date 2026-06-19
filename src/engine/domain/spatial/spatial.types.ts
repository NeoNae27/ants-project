export type DeviceId = string

export type Position2D = {
  x: number
  y: number
}

export type SpatialGridConfig = {
  width: number
  height: number
  metersPerUnit: number
  cellSize: number
}

export type SpatialSearchResult = {
  deviceId: DeviceId
  position: Position2D
  distanceUnits: number
  distanceMeters: number
}

export type SpatialIndexStats = {
  deviceCount: number
  cellCount: number
  maxDevicesInCell: number
  averageDevicesPerCell: number
  cellSize: number
}

export type CellCoord = {
  cx: number
  cy: number
}
