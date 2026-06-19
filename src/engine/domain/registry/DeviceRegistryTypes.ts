import type { DeviceCore } from '../device/DeviceCore'

export type DeviceId = string
export type DeviceAddress = string
export type LoRaAddress = DeviceAddress

export type RegisteredDevice = {
  device: DeviceCore
  address?: DeviceAddress
}

export type DeviceRegistryAddOptions = {
  address?: DeviceAddress
}
