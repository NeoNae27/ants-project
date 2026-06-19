export type DeviceRegistryErrorCode =
  | 'REGISTRY_DEVICE_ALREADY_EXISTS'
  | 'REGISTRY_DEVICE_NOT_FOUND'
  | 'REGISTRY_DEVICE_ID_REQUIRED'
  | 'REGISTRY_ADDRESS_REQUIRED'
  | 'REGISTRY_ADDRESS_ALREADY_EXISTS'

export class DeviceRegistryError extends Error {
  constructor(
    public readonly code: DeviceRegistryErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'DeviceRegistryError'
  }
}
