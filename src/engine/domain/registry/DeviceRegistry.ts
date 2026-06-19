import type { DeviceCore } from '../device/DeviceCore'
import { DeviceRole } from '../device/DeviceRole'
import { DeviceRegistryError } from './DeviceRegistryErrors'
import type { DeviceAddress, DeviceId, DeviceRegistryAddOptions } from './DeviceRegistryTypes'

export class DeviceRegistry {
  private readonly devices = new Map<DeviceId, DeviceCore>()
  private readonly addressIndex = new Map<DeviceAddress, DeviceId>()
  private readonly deviceAddressIndex = new Map<DeviceId, DeviceAddress>()
  private readonly roleIndex = new Map<DeviceRole, Set<DeviceId>>()

  add(device: DeviceCore, options?: DeviceRegistryAddOptions): void {
    const deviceId = this.getDeviceId(device)
    this.assertDeviceId(deviceId)

    if (this.devices.has(deviceId)) {
      throw new DeviceRegistryError(
        'REGISTRY_DEVICE_ALREADY_EXISTS',
        `Device already exists: ${deviceId}`,
        { deviceId },
      )
    }

    if (options?.address !== undefined) {
      this.assertAddress(options.address)
      this.assertAddressAvailable(options.address, deviceId)
    }

    this.devices.set(deviceId, device)
    this.addToRoleIndex(device)

    if (options?.address !== undefined) {
      this.registerAddress(deviceId, options.address)
    }
  }

  remove(deviceId: DeviceId): void {
    this.assertDeviceId(deviceId)

    const device = this.getOrThrow(deviceId)
    const address = this.deviceAddressIndex.get(deviceId)

    if (address) {
      this.addressIndex.delete(address)
      this.deviceAddressIndex.delete(deviceId)
    }

    this.removeFromRoleIndex(device)
    this.devices.delete(deviceId)
  }

  get(deviceId: DeviceId): DeviceCore | undefined {
    this.assertDeviceId(deviceId)
    return this.devices.get(deviceId)
  }

  getOrThrow(deviceId: DeviceId): DeviceCore {
    this.assertDeviceId(deviceId)

    const device = this.devices.get(deviceId)

    if (!device) {
      throw new DeviceRegistryError('REGISTRY_DEVICE_NOT_FOUND', `Device not found: ${deviceId}`, {
        deviceId,
      })
    }

    return device
  }

  has(deviceId: DeviceId): boolean {
    this.assertDeviceId(deviceId)
    return this.devices.has(deviceId)
  }

  list(): readonly DeviceCore[] {
    return Array.from(this.devices.values())
  }

  listByRole(role: DeviceRole): readonly DeviceCore[] {
    const deviceIds = this.roleIndex.get(role)

    if (!deviceIds) {
      return []
    }

    return Array.from(deviceIds, (deviceId) => this.devices.get(deviceId)).filter(
      (device): device is DeviceCore => Boolean(device),
    )
  }

  registerAddress(deviceId: DeviceId, address: DeviceAddress): void {
    this.assertDeviceId(deviceId)
    this.assertAddress(address)
    this.getOrThrow(deviceId)
    this.assertAddressAvailable(address, deviceId)

    const previousAddress = this.deviceAddressIndex.get(deviceId)

    if (previousAddress === address) {
      return
    }

    if (previousAddress) {
      this.addressIndex.delete(previousAddress)
    }

    this.addressIndex.set(address, deviceId)
    this.deviceAddressIndex.set(deviceId, address)
  }

  getByAddress(address: DeviceAddress): DeviceCore | undefined {
    this.assertAddress(address)

    const deviceId = this.addressIndex.get(address)

    return deviceId ? this.devices.get(deviceId) : undefined
  }

  getAddress(deviceId: DeviceId): DeviceAddress | undefined {
    this.assertDeviceId(deviceId)
    return this.deviceAddressIndex.get(deviceId)
  }

  clear(): void {
    this.devices.clear()
    this.addressIndex.clear()
    this.deviceAddressIndex.clear()
    this.roleIndex.clear()
  }

  size(): number {
    return this.devices.size
  }

  private getDeviceId(device: DeviceCore): DeviceId {
    return device.getInfo().id
  }

  private assertDeviceId(deviceId: DeviceId): void {
    if (!deviceId.trim()) {
      throw new DeviceRegistryError('REGISTRY_DEVICE_ID_REQUIRED', 'Device id is required')
    }
  }

  private assertAddress(address: DeviceAddress): void {
    if (!address.trim()) {
      throw new DeviceRegistryError('REGISTRY_ADDRESS_REQUIRED', 'Device address is required')
    }
  }

  private assertAddressAvailable(address: DeviceAddress, deviceId: DeviceId): void {
    const existingDeviceId = this.addressIndex.get(address)

    if (existingDeviceId && existingDeviceId !== deviceId) {
      throw new DeviceRegistryError(
        'REGISTRY_ADDRESS_ALREADY_EXISTS',
        `Device address already exists: ${address}`,
        {
          address,
          existingDeviceId,
          deviceId,
        },
      )
    }
  }

  private addToRoleIndex(device: DeviceCore): void {
    const role = device.getRole()
    const deviceId = this.getDeviceId(device)
    const roleDevices = this.roleIndex.get(role) ?? new Set<DeviceId>()

    roleDevices.add(deviceId)
    this.roleIndex.set(role, roleDevices)
  }

  private removeFromRoleIndex(device: DeviceCore): void {
    const role = device.getRole()
    const deviceId = this.getDeviceId(device)
    const roleDevices = this.roleIndex.get(role)

    if (!roleDevices) {
      return
    }

    roleDevices.delete(deviceId)

    if (roleDevices.size === 0) {
      this.roleIndex.delete(role)
    }
  }
}
