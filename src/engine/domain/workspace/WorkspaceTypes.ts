import type { DeviceExecutionState } from '../device/DeviceExecutionState'
import type { DeviceLifecycleState } from '../device/DeviceLifecycleState'
import type { DeviceRole } from '../device/DeviceRole'
import type { DeviceCore } from '../device/DeviceCore'
import type { DeviceCoreConfig } from '../device/DeviceConfig'
import type { DeviceAddress, DeviceId, LoRaAddress } from '../registry'

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
  address?: DeviceAddress
}

export type DeviceRegistryQueryPort = {
  get(deviceId: DeviceId): DeviceCore | undefined
  getByLoRaAddress(address: LoRaAddress): DeviceCore | undefined
  has(deviceId: DeviceId): boolean
  list(): readonly DeviceCore[]
  listByRole(role: DeviceRole): readonly DeviceCore[]
  getLoRaAddress(deviceId: DeviceId): LoRaAddress | undefined
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

export type WorkspaceValidationIssue = {
  code: string
  message: string
  severity: 'error' | 'warning' | 'info'
}

export type WorkspaceValidationResult = {
  valid: boolean
  issues: WorkspaceValidationIssue[]
}
