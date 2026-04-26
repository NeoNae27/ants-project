import { DeviceCore } from "./DeviceCore"
import { DeviceRole } from "./DeviceRole"
import { DeviceModule } from "../module"

// TODO: Add params for 'config' 
export class DeviceFactory {
  static createNode(params: {
    id: string
    model: string
    version: string
    name?: string
    x: number
    y: number
    modules?: readonly DeviceModule[]
  }): DeviceCore {
    const device = new DeviceCore({
      id: params.id,
      model: params.model,
      version: params.version,
      role: DeviceRole.NODE,
      name: params.name,
      config: {
        heartbeatIntervalMs: 60_000,
        transmissionIntervalMs: 300_000,
        maxRetries: 3,
        powerMode: 'normal',
      },
      meta: {
        createdAt: Date.now(),
        updatedAt: Date.now(),
        location: {
          x: params.x,
          y: params.y,
        },
      },
    })

    params.modules?.forEach((module) => device.addModule(module))

    return device
  }
}
