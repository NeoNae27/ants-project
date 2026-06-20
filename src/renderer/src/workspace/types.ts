export type WorkspaceProject = {
  id: string
  name: string
  width: number
  height: number
  unitScaleMeters: number
}

export type WorkspaceModuleKind = 'network' | 'sensor' | 'power' | 'compute' | 'storage'

export type WorkspaceCommunicationProtocol = 'lora'
export type WorkspaceSpatialGridTechnology = 'lora'
export type WorkspaceSpatialGridVisibility = Record<WorkspaceSpatialGridTechnology, boolean>

export type WorkspaceCommunicationConfig = {
  protocol: WorkspaceCommunicationProtocol
  maxRangeMeters: number
  maxConnections: number
  spreadingFactor: 7 | 8 | 9 | 10 | 11 | 12
  bandwidthHz: number
  txPowerDbm: number
  codingRate: '4/5' | '4/6' | '4/7' | '4/8'
  sourceLabel: string
}

export type WorkspaceModule = {
  id: string
  kind: WorkspaceModuleKind
  name: string
  model: string
  status: string
  communication?: WorkspaceCommunicationConfig
}

export type WorkspaceDevice = {
  id: string
  name: string
  model: string
  role: 'node' | 'repeater' | 'gateway'
  status: string
  executionState: string
  config: {
    heartbeatIntervalMs: number
    transmissionIntervalMs: number
    maxRetries: number
    powerMode: 'normal' | 'low_power'
  }
  modules: WorkspaceModule[]
  bufferSize: number
  receivedPacketCount: number
  x: number
  y: number
}

export type WorkspacePoint = {
  x: number
  y: number
}

export type AddDevicePlacement = 'center' | 'cursor'

export type NewProjectValues = {
  name: string
  width: number
  height: number
}

export type WorkspaceConnectionViewMode = 'selected' | 'all'

export type WorkspacePossibleConnection = {
  id: string
  protocol: WorkspaceCommunicationProtocol
  sourceDeviceId: string
  targetDeviceId: string
  sourceModuleId: string
  targetModuleId: string
  distanceUnits: number
  distanceMeters: number
  maxRangeMeters: number
  sourceLabel: string
}

export type WorkspaceConnectionLine = {
  id: string
  sourceDeviceId: string
  targetDeviceId: string
  connectionCount: number
  isSelected: boolean
}
