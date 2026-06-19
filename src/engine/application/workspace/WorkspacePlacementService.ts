import type { WorkspacePosition, WorkspaceSnapshot } from '../../domain/workspace'

const DEFAULT_DEVICE_SIZE = 48
const DEFAULT_DEVICE_GAP = 14

export type WorkspacePlacementServiceOptions = {
  deviceSize?: number
  deviceGap?: number
}

export class WorkspacePlacementService {
  private readonly deviceSize: number
  private readonly deviceGap: number

  constructor(options?: WorkspacePlacementServiceOptions) {
    this.deviceSize = options?.deviceSize ?? DEFAULT_DEVICE_SIZE
    this.deviceGap = options?.deviceGap ?? DEFAULT_DEVICE_GAP
  }

  findFreePlacementNear(
    snapshot: WorkspaceSnapshot,
    desiredPosition: WorkspacePosition,
    excludedDeviceId?: string,
  ): WorkspacePosition {
    const start = this.clampPosition(snapshot, desiredPosition)

    if (!this.hasCollision(snapshot, start, excludedDeviceId)) {
      return start
    }

    const spacing = this.deviceSize + this.deviceGap
    const visited = new Set<string>()

    for (let radius = 1; radius <= 20; radius += 1) {
      for (let row = -radius; row <= radius; row += 1) {
        for (let column = -radius; column <= radius; column += 1) {
          if (Math.abs(row) !== radius && Math.abs(column) !== radius) {
            continue
          }

          const candidate = this.clampPosition(snapshot, {
            x: start.x + column * spacing,
            y: start.y + row * spacing,
          })
          const key = `${candidate.x}:${candidate.y}`

          if (visited.has(key)) {
            continue
          }

          visited.add(key)

          if (!this.hasCollision(snapshot, candidate, excludedDeviceId)) {
            return candidate
          }
        }
      }
    }

    return start
  }

  private clampPosition(snapshot: WorkspaceSnapshot, position: WorkspacePosition): WorkspacePosition {
    const halfSize = this.deviceSize / 2

    return {
      x: Math.min(snapshot.width - halfSize, Math.max(halfSize, Math.round(position.x))),
      y: Math.min(snapshot.height - halfSize, Math.max(halfSize, Math.round(position.y))),
    }
  }

  private hasCollision(
    snapshot: WorkspaceSnapshot,
    position: WorkspacePosition,
    excludedDeviceId?: string,
  ): boolean {
    const spacing = this.deviceSize + this.deviceGap

    return snapshot.devices.some((device) => {
      if (device.id === excludedDeviceId) {
        return false
      }

      return (
        Math.abs(device.position.x - position.x) < spacing &&
        Math.abs(device.position.y - position.y) < spacing
      )
    })
  }
}
