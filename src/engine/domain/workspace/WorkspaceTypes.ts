import type { DeviceExecutionState } from '../device/DeviceExecutionState'
import type { DeviceLifecycleState } from '../device/DeviceLifecycleState'
import type { DeviceRole } from '../device/DeviceRole'
import type { DeviceCoreConfig } from '../device/DeviceConfig'
import type { DeviceAddress, DeviceId, LoRaAddress, ModuleId, NetworkEndpoint } from '../registry'
import type { SpatialIndexStats } from '../spatial'

export type WorkspaceId = string
export type WorkspaceDeviceId = string

export type WorkspaceConfig = {
  id: WorkspaceId
  name: string
  width: number
  height: number
  metersPerUnit: number
  cellSize?: number
}

export type WorkspacePosition = {
  x: number
  y: number
}

export type WorkspaceModuleKind = 'network' | 'sensor' | 'power' | 'compute' | 'storage'
export type WorkspaceCommunicationProtocol = 'lora'

export type WorkspaceCommunicationConfigDto = {
  protocol: WorkspaceCommunicationProtocol
  maxRangeMeters: number
  maxConnections: number
  spreadingFactor: 7 | 8 | 9 | 10 | 11 | 12
  bandwidthHz: number
  txPowerDbm: number
  codingRate: '4/5' | '4/6' | '4/7' | '4/8'
  sourceLabel: string
}

export type WorkspaceModuleSnapshot = {
  id: string
  kind: WorkspaceModuleKind
  name: string
  model: string
  version: string
  lifecycleState: string
  executionState: string
  communication?: WorkspaceCommunicationConfigDto
  config?: Record<string, unknown>
}

export type WorkspaceAddDeviceOptions = {
  endpoints?: NetworkEndpoint[]
}

export type DeviceRegistryQueryPort = {
  has(deviceId: DeviceId): boolean
  getLoRaAddress(deviceId: DeviceId, moduleId?: ModuleId): LoRaAddress | undefined
  getEndpointsByDevice(deviceId: DeviceId): readonly NetworkEndpoint[]
  getEndpointsByModule(moduleId: ModuleId): readonly NetworkEndpoint[]
  size(): number
}

export type NearbyWorkspaceDevice = {
  deviceId: WorkspaceDeviceId
  distanceUnits: number
  distanceMeters: number
}

export type WorkspaceDeviceInfoDto = {
  id: WorkspaceDeviceId
  model: string
  name?: string
  version: string
  role: DeviceRole
  lifecycleState: DeviceLifecycleState
  executionState: DeviceExecutionState
  moduleCount: number
  bufferSize: number
}

export type WorkspaceDeviceSnapshot = {
  id: WorkspaceDeviceId
  info: WorkspaceDeviceInfoDto
  config: DeviceCoreConfig
  position: WorkspacePosition
  address?: DeviceAddress
  networkEndpoints: NetworkEndpoint[]
  modules: WorkspaceModuleSnapshot[]
}

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

export type WorkspaceSnapshot = {
  id: WorkspaceId
  name: string
  width: number
  height: number
  metersPerUnit: number
  devices: WorkspaceDeviceSnapshot[]
  possibleConnections: WorkspacePossibleConnection[]
}

export type WorkspaceSpatialIndexEntrySnapshot = {
  deviceId: WorkspaceDeviceId
  name?: string
  role: DeviceRole
  placementPosition?: WorkspacePosition
  spatialPosition?: WorkspacePosition
  cell?: {
    x: number
    y: number
    key: string
  }
  consistent: boolean
}

export type WorkspaceSpatialIndexSnapshot = {
  workspace: {
    id: WorkspaceId
    name: string
    width: number
    height: number
    metersPerUnit: number
  }
  stats: SpatialIndexStats
  entries: WorkspaceSpatialIndexEntrySnapshot[]
}

export type WorkspaceValidationIssue = {
  code: string
  message: string
  severity: 'error' | 'warning' | 'info'
  details?: Record<string, unknown>
}

export type WorkspaceValidationOptions = {
  mode?: 'project' | 'network'
}

export type WorkspaceValidationResult = {
  valid: boolean
  issues: WorkspaceValidationIssue[]
}
