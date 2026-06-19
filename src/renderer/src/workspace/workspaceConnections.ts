import { SpatialGrid } from '../../../engine/domain/spatial'
import type {
  WorkspaceConnectionLine,
  WorkspaceConnectionViewMode,
  WorkspaceDevice,
  WorkspaceModule,
  WorkspacePossibleConnection,
  WorkspaceProject
} from './types'

function getLoRaModule(device: WorkspaceDevice): WorkspaceModule | undefined {
  return device.modules.find((module) => module.communication?.protocol === 'lora')
}

function createConnectionId(sourceDeviceId: string, targetDeviceId: string, sourceModuleId: string): string {
  return `${sourceDeviceId}->${targetDeviceId}:${sourceModuleId}`
}

function createLineId(sourceDeviceId: string, targetDeviceId: string): string {
  return [sourceDeviceId, targetDeviceId].sort().join('<->')
}

export function getDeviceLoRaModule(device: WorkspaceDevice): WorkspaceModule | undefined {
  return getLoRaModule(device)
}

export function findPossibleWorkspaceConnections(params: {
  project: WorkspaceProject
  devices: readonly WorkspaceDevice[]
}): WorkspacePossibleConnection[] {
  const { project, devices } = params
  const grid = new SpatialGrid({
    width: project.width,
    height: project.height,
    metersPerUnit: project.unitScaleMeters,
    cellSize: Math.max(1, Math.min(project.width, project.height, 100))
  })
  const devicesById = new Map(devices.map((device) => [device.id, device]))

  for (const device of devices) {
    grid.insert(device.id, {
      x: device.x,
      y: device.y
    })
  }

  const connections: WorkspacePossibleConnection[] = []

  for (const sourceDevice of devices) {
    const sourceModule = getLoRaModule(sourceDevice)
    const communication = sourceModule?.communication

    if (!sourceModule || !communication || communication.maxRangeMeters <= 0) {
      continue
    }

    const rangeUnits = communication.maxRangeMeters / project.unitScaleMeters
    const nearbyDevices = grid.findNearbyWithDistance(
      {
        x: sourceDevice.x,
        y: sourceDevice.y
      },
      rangeUnits
    )

    for (const nearbyDevice of nearbyDevices) {
      if (nearbyDevice.deviceId === sourceDevice.id) {
        continue
      }

      const targetDevice = devicesById.get(nearbyDevice.deviceId)
      const targetModule = targetDevice ? getLoRaModule(targetDevice) : undefined

      if (!targetDevice || !targetModule) {
        continue
      }

      connections.push({
        id: createConnectionId(sourceDevice.id, targetDevice.id, sourceModule.id),
        protocol: communication.protocol,
        sourceDeviceId: sourceDevice.id,
        targetDeviceId: targetDevice.id,
        sourceModuleId: sourceModule.id,
        targetModuleId: targetModule.id,
        distanceUnits: nearbyDevice.distanceUnits,
        distanceMeters: nearbyDevice.distanceMeters,
        maxRangeMeters: communication.maxRangeMeters,
        sourceLabel: communication.sourceLabel
      })
    }
  }

  return connections.sort((a, b) => {
    if (a.sourceDeviceId === b.sourceDeviceId) {
      return a.distanceMeters - b.distanceMeters
    }

    return a.sourceDeviceId.localeCompare(b.sourceDeviceId)
  })
}

export function filterConnectionsForMode(params: {
  connections: readonly WorkspacePossibleConnection[]
  selectedDeviceId: string | null
  mode: WorkspaceConnectionViewMode
}): WorkspacePossibleConnection[] {
  const { connections, selectedDeviceId, mode } = params

  if (mode === 'all') {
    return [...connections]
  }

  if (!selectedDeviceId) {
    return []
  }

  return connections.filter((connection) => connection.sourceDeviceId === selectedDeviceId)
}

export function createWorkspaceConnectionLines(params: {
  connections: readonly WorkspacePossibleConnection[]
  selectedDeviceId: string | null
}): WorkspaceConnectionLine[] {
  const { connections, selectedDeviceId } = params
  const lines = new Map<string, WorkspaceConnectionLine>()

  for (const connection of connections) {
    const lineId = createLineId(connection.sourceDeviceId, connection.targetDeviceId)
    const existingLine = lines.get(lineId)
    const isSelected =
      connection.sourceDeviceId === selectedDeviceId || connection.targetDeviceId === selectedDeviceId

    if (existingLine) {
      existingLine.connectionCount += 1
      existingLine.isSelected = existingLine.isSelected || isSelected
      continue
    }

    lines.set(lineId, {
      id: lineId,
      sourceDeviceId: connection.sourceDeviceId,
      targetDeviceId: connection.targetDeviceId,
      connectionCount: 1,
      isSelected
    })
  }

  return Array.from(lines.values())
}
