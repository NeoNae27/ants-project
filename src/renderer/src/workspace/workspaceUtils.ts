import type { WorkspaceDevice, WorkspaceModule, WorkspacePoint, WorkspaceProject } from './types'

const DEFAULT_WORKSPACE_SIZE = 1000
const UNIT_SCALE_METERS = 10
export const WORKSPACE_DEVICE_SIZE = 48
const DEVICE_GAP = 14
const DEVICE_SPACING = WORKSPACE_DEVICE_SIZE + DEVICE_GAP

function createId(prefix: string): string {
  if (crypto.randomUUID) {
    return `${prefix}-${crypto.randomUUID()}`
  }

  return `${prefix}-${Date.now()}-${Math.round(Math.random() * 1_000_000)}`
}

export function createWorkspaceModule(params: {
  kind: WorkspaceModule['kind']
  name: string
  model: string
  communication?: WorkspaceModule['communication']
}): WorkspaceModule {
  return {
    id: createId('module'),
    kind: params.kind,
    name: params.name,
    model: params.model,
    status: 'new',
    communication: params.communication
  }
}

export function createWorkspaceProject(
  name: string,
  width = DEFAULT_WORKSPACE_SIZE,
  height = DEFAULT_WORKSPACE_SIZE
): WorkspaceProject {
  return {
    id: createId('project'),
    name: name.trim() || 'Untitled project',
    width,
    height,
    unitScaleMeters: UNIT_SCALE_METERS
  }
}

export function createDefaultProject(): WorkspaceProject {
  return createWorkspaceProject('New project')
}

export function clampDevicePosition(
  project: WorkspaceProject,
  position: WorkspacePoint
): WorkspacePoint {
  const halfSize = WORKSPACE_DEVICE_SIZE / 2

  return {
    x: Math.min(project.width - halfSize, Math.max(halfSize, Math.round(position.x))),
    y: Math.min(project.height - halfSize, Math.max(halfSize, Math.round(position.y)))
  }
}

function hasDeviceCollision(
  position: WorkspacePoint,
  devices: readonly WorkspaceDevice[],
  excludedDeviceId?: string
): boolean {
  return devices.some((device) => {
    if (device.id === excludedDeviceId) {
      return false
    }

    return Math.abs(device.x - position.x) < DEVICE_SPACING && Math.abs(device.y - position.y) < DEVICE_SPACING
  })
}

export function findFreeDevicePosition(params: {
  project: WorkspaceProject
  devices: readonly WorkspaceDevice[]
  desiredPosition: WorkspacePoint
  excludedDeviceId?: string
}): WorkspacePoint {
  const { project, devices, desiredPosition, excludedDeviceId } = params
  const start = clampDevicePosition(project, desiredPosition)

  if (!hasDeviceCollision(start, devices, excludedDeviceId)) {
    return start
  }

  const visited = new Set<string>()

  for (let radius = 1; radius <= 20; radius += 1) {
    for (let row = -radius; row <= radius; row += 1) {
      for (let column = -radius; column <= radius; column += 1) {
        if (Math.abs(row) !== radius && Math.abs(column) !== radius) {
          continue
        }

        const candidate = clampDevicePosition(project, {
          x: start.x + column * DEVICE_SPACING,
          y: start.y + row * DEVICE_SPACING
        })
        const key = `${candidate.x}:${candidate.y}`

        if (visited.has(key)) {
          continue
        }

        visited.add(key)

        if (!hasDeviceCollision(candidate, devices, excludedDeviceId)) {
          return candidate
        }
      }
    }
  }

  return start
}

export function createWorkspaceDevice(
  project: WorkspaceProject,
  deviceIndex: number,
  devices: readonly WorkspaceDevice[] = [],
  desiredPosition: WorkspacePoint = {
    x: project.width / 2,
    y: project.height / 2
  }
): WorkspaceDevice {
  const position = findFreeDevicePosition({
    project,
    devices,
    desiredPosition
  })

  return {
    id: createId('device'),
    name: `Device ${deviceIndex + 1}`,
    model: 'ANT-UI-100',
    role: 'node',
    status: 'new',
    executionState: 'idle',
    config: {
      heartbeatIntervalMs: 60_000,
      transmissionIntervalMs: 300_000,
      maxRetries: 3,
      powerMode: 'normal'
    },
    modules: [],
    bufferSize: 0,
    x: position.x,
    y: position.y
  }
}

export function cloneWorkspaceDevice(params: {
  project: WorkspaceProject
  sourceDevice: WorkspaceDevice
  deviceIndex: number
  devices: readonly WorkspaceDevice[]
  desiredPosition: WorkspacePoint
}): WorkspaceDevice {
  const { project, sourceDevice, deviceIndex, devices, desiredPosition } = params
  const position = findFreeDevicePosition({
    project,
    devices,
    desiredPosition
  })

  return {
    ...sourceDevice,
    id: createId('device'),
    name: `${sourceDevice.name} Copy ${deviceIndex + 1}`,
    modules: sourceDevice.modules.map((module) => ({
      ...module,
      id: createId('module'),
      communication: module.communication ? { ...module.communication } : undefined
    })),
    x: position.x,
    y: position.y
  }
}
