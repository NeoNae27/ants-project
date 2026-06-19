import type { DeviceCore } from '../device/DeviceCore'
import type { DeviceModule } from '../module'

export type DeviceId = string
export type ModuleId = string
export type DeviceAddress = string
export type LoRaAddress = DeviceAddress
export type NetworkProtocol = 'lora' | 'wifi' | 'ble' | 'custom'

export type NetworkEndpoint = {
  deviceId: DeviceId
  moduleId: ModuleId
  protocol: NetworkProtocol
  address: DeviceAddress
}

export type RegisteredModule = {
  deviceId: DeviceId
  module: DeviceModule
}

export type RegisteredDevice = {
  device: DeviceCore
}

export type DeviceRegistryAddOptions = {
  endpoints?: NetworkEndpoint[]
}
