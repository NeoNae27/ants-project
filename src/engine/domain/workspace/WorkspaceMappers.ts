import type { DeviceCore } from '../device/DeviceCore'
import type { DeviceModule } from '../module'
import type { DeviceAddress } from '../registry'
import type {
  WorkspaceConfig,
  WorkspaceCommunicationConfigDto,
  WorkspaceDeviceInfoDto,
  WorkspaceDeviceSnapshot,
  WorkspaceModuleKind,
  WorkspaceModuleSnapshot,
  WorkspacePosition,
  WorkspacePossibleConnection,
  WorkspaceSnapshot,
} from './WorkspaceTypes'

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getString(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback
}

function getNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function getCommunicationFromSnapshot(snapshot: Record<string, unknown>): WorkspaceCommunicationConfigDto | undefined {
  const config = isRecord(snapshot.config) ? snapshot.config : undefined
  const radio = config && isRecord(config.radio) ? config.radio : undefined

  if (!radio) {
    return undefined
  }

  return {
    protocol: 'lora',
    maxRangeMeters: getNumber(radio.maxRangeMeters, 1),
    maxConnections: getNumber(radio.maxConnections, 8),
    spreadingFactor: getNumber(radio.spreadingFactor, 12) as WorkspaceCommunicationConfigDto['spreadingFactor'],
    bandwidthHz: getNumber(radio.bandwidthHz, 125_000),
    txPowerDbm: getNumber(radio.txPowerDbm, 14),
    codingRate: getString(radio.codingRate, '4/5') as WorkspaceCommunicationConfigDto['codingRate'],
    sourceLabel: 'LoRa module config',
  }
}

export function moduleToWorkspaceModuleSnapshot(module: DeviceModule): WorkspaceModuleSnapshot {
  const rawSnapshot = module.getSnapshot()
  const snapshot = isRecord(rawSnapshot) ? rawSnapshot : {}
  const config = isRecord(snapshot.config) ? snapshot.config : undefined
  const communication =
    isRecord(snapshot.communication) && snapshot.communication.protocol === 'lora'
      ? (snapshot.communication as WorkspaceCommunicationConfigDto)
      : getCommunicationFromSnapshot(snapshot)

  return {
    id: module.id,
    kind: module.kind as WorkspaceModuleKind,
    name: getString(snapshot.name, module.model),
    model: module.model,
    version: module.version,
    lifecycleState: getString(snapshot.lifecycleState, String(module.getLifecycleState())),
    executionState: getString(snapshot.executionState, String(module.getExecutionState())),
    communication,
    config: config ? { ...config } : undefined,
  }
}

export function deviceToWorkspaceDeviceInfoDto(device: DeviceCore): WorkspaceDeviceInfoDto {
  const info = device.getInfo()

  return {
    id: info.id,
    model: info.model,
    name: info.name,
    version: info.version,
    role: info.role,
    lifecycleState: info.lifecycleState,
    executionState: info.executionState,
    moduleCount: info.moduleCount,
    bufferSize: info.bufferSize,
  }
}

export function createWorkspaceDeviceSnapshot(params: {
  device: DeviceCore
  position: WorkspacePosition
  address?: DeviceAddress
}): WorkspaceDeviceSnapshot {
  const info = deviceToWorkspaceDeviceInfoDto(params.device)

  return {
    id: info.id,
    info,
    config: params.device.getConfig(),
    position: { ...params.position },
    address: params.address,
    modules: params.device.getModules().map(moduleToWorkspaceModuleSnapshot),
  }
}

export function createWorkspaceSnapshot(
  config: Pick<WorkspaceConfig, 'id' | 'name' | 'width' | 'height' | 'metersPerUnit'>,
  devices: WorkspaceDeviceSnapshot[],
  possibleConnections: WorkspacePossibleConnection[] = [],
): WorkspaceSnapshot {
  return {
    id: config.id,
    name: config.name,
    width: config.width,
    height: config.height,
    metersPerUnit: config.metersPerUnit,
    devices: devices.map((device) => ({
      ...device,
      info: { ...device.info },
      config: { ...device.config },
      position: { ...device.position },
      modules: device.modules.map((module) => ({
        ...module,
        communication: module.communication ? { ...module.communication } : undefined,
        config: module.config ? { ...module.config } : undefined,
      })),
    })),
    possibleConnections: possibleConnections.map((connection) => ({ ...connection })),
  }
}
