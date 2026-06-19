import type { DeviceCore } from '../device/DeviceCore'
import { DeviceRole } from '../device/DeviceRole'
import type { DeviceModule } from '../module'
import { DeviceRegistryError } from './DeviceRegistryErrors'
import type {
  DeviceAddress,
  DeviceId,
  DeviceRegistryAddOptions,
  ModuleId,
  NetworkEndpoint,
  NetworkProtocol,
  RegisteredModule,
} from './DeviceRegistryTypes'

export class DeviceRegistry {
  private readonly devicesById = new Map<DeviceId, DeviceCore>()
  private readonly devicesByRole = new Map<DeviceRole, Set<DeviceId>>()
  private readonly modulesById = new Map<ModuleId, RegisteredModule>()
  private readonly modulesByDeviceId = new Map<DeviceId, Set<ModuleId>>()
  private readonly endpointsByAddress = new Map<DeviceAddress, NetworkEndpoint>()
  private readonly endpointsByModuleId = new Map<ModuleId, Set<DeviceAddress>>()
  private readonly endpointsByDeviceId = new Map<DeviceId, Set<DeviceAddress>>()

  add(device: DeviceCore, options?: DeviceRegistryAddOptions): void {
    const deviceId = this.getDeviceId(device)
    this.assertDeviceId(deviceId)

    if (this.devicesById.has(deviceId)) {
      throw new DeviceRegistryError(
        'REGISTRY_DEVICE_ALREADY_EXISTS',
        `Device already exists: ${deviceId}`,
        { deviceId },
      )
    }

    const modules = device.getModules()

    for (const module of modules) {
      this.assertModuleAvailable(module.id, deviceId)
    }

    for (const endpoint of options?.endpoints ?? []) {
      this.assertEndpoint(endpoint)
      this.assertEndpointAddressAvailable(endpoint.address, endpoint)
    }

    this.devicesById.set(deviceId, device)
    this.addToRoleIndex(device)

    for (const module of modules) {
      this.registerModule(deviceId, module)
    }

    for (const endpoint of options?.endpoints ?? []) {
      this.registerEndpoint(endpoint)
    }
  }

  remove(deviceId: DeviceId): void {
    this.assertDeviceId(deviceId)

    const device = this.getOrThrow(deviceId)
    const moduleIds = Array.from(this.modulesByDeviceId.get(deviceId) ?? [])

    for (const moduleId of moduleIds) {
      this.unregisterModule(moduleId)
    }

    this.removeFromRoleIndex(device)
    this.devicesById.delete(deviceId)
  }

  get(deviceId: DeviceId): DeviceCore | undefined {
    this.assertDeviceId(deviceId)
    return this.devicesById.get(deviceId)
  }

  getOrThrow(deviceId: DeviceId): DeviceCore {
    this.assertDeviceId(deviceId)

    const device = this.devicesById.get(deviceId)

    if (!device) {
      throw new DeviceRegistryError('REGISTRY_DEVICE_NOT_FOUND', `Device not found: ${deviceId}`, {
        deviceId,
      })
    }

    return device
  }

  has(deviceId: DeviceId): boolean {
    this.assertDeviceId(deviceId)
    return this.devicesById.has(deviceId)
  }

  list(): readonly DeviceCore[] {
    return Array.from(this.devicesById.values())
  }

  listByRole(role: DeviceRole): readonly DeviceCore[] {
    const deviceIds = this.devicesByRole.get(role)

    if (!deviceIds) {
      return []
    }

    return Array.from(deviceIds, (deviceId) => this.devicesById.get(deviceId)).filter(
      (device): device is DeviceCore => Boolean(device),
    )
  }

  registerModule(deviceId: DeviceId, module: DeviceModule): void {
    this.assertDeviceId(deviceId)
    this.assertModuleId(module.id)
    this.getOrThrow(deviceId)
    this.assertModuleAvailable(module.id, deviceId)

    this.modulesById.set(module.id, {
      deviceId,
      module,
    })

    const deviceModules = this.modulesByDeviceId.get(deviceId) ?? new Set<ModuleId>()
    deviceModules.add(module.id)
    this.modulesByDeviceId.set(deviceId, deviceModules)
  }

  unregisterModule(moduleId: ModuleId): void {
    this.assertModuleId(moduleId)

    const registeredModule = this.modulesById.get(moduleId)

    if (!registeredModule) {
      throw new DeviceRegistryError('REGISTRY_MODULE_NOT_FOUND', `Module not found: ${moduleId}`, {
        moduleId,
      })
    }

    for (const endpoint of this.getEndpointsByModule(moduleId)) {
      this.unregisterEndpoint(endpoint.address)
    }

    this.modulesById.delete(moduleId)

    const deviceModules = this.modulesByDeviceId.get(registeredModule.deviceId)
    deviceModules?.delete(moduleId)

    if (deviceModules?.size === 0) {
      this.modulesByDeviceId.delete(registeredModule.deviceId)
    }
  }

  getModule(moduleId: ModuleId): RegisteredModule | undefined {
    this.assertModuleId(moduleId)
    return this.modulesById.get(moduleId)
  }

  listModulesByDevice(deviceId: DeviceId): readonly RegisteredModule[] {
    this.assertDeviceId(deviceId)

    const moduleIds = this.modulesByDeviceId.get(deviceId)

    if (!moduleIds) {
      return []
    }

    return Array.from(moduleIds, (moduleId) => this.modulesById.get(moduleId)).filter(
      (module): module is RegisteredModule => Boolean(module),
    )
  }

  registerEndpoint(endpoint: NetworkEndpoint): void {
    this.assertEndpoint(endpoint)
    this.getOrThrow(endpoint.deviceId)

    const registeredModule = this.modulesById.get(endpoint.moduleId)

    if (!registeredModule || registeredModule.deviceId !== endpoint.deviceId) {
      throw new DeviceRegistryError(
        'REGISTRY_MODULE_NOT_FOUND',
        `Module not found for endpoint: ${endpoint.moduleId}`,
        endpoint,
      )
    }

    this.assertEndpointAddressAvailable(endpoint.address, endpoint)

    for (const previousEndpoint of this.getEndpointsByModule(endpoint.moduleId)) {
      if (previousEndpoint.protocol === endpoint.protocol && previousEndpoint.address !== endpoint.address) {
        this.unregisterEndpoint(previousEndpoint.address)
      }
    }

    this.endpointsByAddress.set(endpoint.address, { ...endpoint })
    this.addEndpointIndex(this.endpointsByModuleId, endpoint.moduleId, endpoint.address)
    this.addEndpointIndex(this.endpointsByDeviceId, endpoint.deviceId, endpoint.address)
  }

  unregisterEndpoint(address: DeviceAddress): void {
    this.assertAddress(address)

    const endpoint = this.endpointsByAddress.get(address)

    if (!endpoint) {
      return
    }

    this.endpointsByAddress.delete(address)
    this.removeEndpointIndex(this.endpointsByModuleId, endpoint.moduleId, address)
    this.removeEndpointIndex(this.endpointsByDeviceId, endpoint.deviceId, address)
  }

  getEndpointByAddress(address: DeviceAddress): NetworkEndpoint | undefined {
    this.assertAddress(address)
    const endpoint = this.endpointsByAddress.get(address)
    return endpoint ? { ...endpoint } : undefined
  }

  getEndpointsByModule(moduleId: ModuleId): readonly NetworkEndpoint[] {
    this.assertModuleId(moduleId)
    return this.getEndpointAddresses(this.endpointsByModuleId, moduleId)
  }

  getEndpointsByDevice(deviceId: DeviceId): readonly NetworkEndpoint[] {
    this.assertDeviceId(deviceId)
    return this.getEndpointAddresses(this.endpointsByDeviceId, deviceId)
  }

  getByEndpointAddress(address: DeviceAddress): DeviceCore | undefined {
    const endpoint = this.getEndpointByAddress(address)
    return endpoint ? this.devicesById.get(endpoint.deviceId) : undefined
  }

  getByProtocolAddress(protocol: NetworkProtocol, address: DeviceAddress): DeviceCore | undefined {
    const endpoint = this.getEndpointByAddress(address)

    if (!endpoint || endpoint.protocol !== protocol) {
      return undefined
    }

    return this.devicesById.get(endpoint.deviceId)
  }

  getProtocolAddress(deviceId: DeviceId, protocol: NetworkProtocol, moduleId?: ModuleId): DeviceAddress | undefined {
    const endpoints = moduleId ? this.getEndpointsByModule(moduleId) : this.getEndpointsByDevice(deviceId)

    return endpoints.find((endpoint) => endpoint.deviceId === deviceId && endpoint.protocol === protocol)?.address
  }

  getByAddress(address: DeviceAddress): DeviceCore | undefined {
    return this.getByEndpointAddress(address)
  }

  getByLoRaAddress(address: DeviceAddress): DeviceCore | undefined {
    return this.getByProtocolAddress('lora', address)
  }

  getAddress(deviceId: DeviceId): DeviceAddress | undefined {
    return this.getProtocolAddress(deviceId, 'lora')
  }

  getLoRaAddress(deviceId: DeviceId, moduleId?: ModuleId): DeviceAddress | undefined {
    return this.getProtocolAddress(deviceId, 'lora', moduleId)
  }

  clear(): void {
    this.devicesById.clear()
    this.devicesByRole.clear()
    this.modulesById.clear()
    this.modulesByDeviceId.clear()
    this.endpointsByAddress.clear()
    this.endpointsByModuleId.clear()
    this.endpointsByDeviceId.clear()
  }

  size(): number {
    return this.devicesById.size
  }

  moduleSize(): number {
    return this.modulesById.size
  }

  endpointSize(): number {
    return this.endpointsByAddress.size
  }

  private getDeviceId(device: DeviceCore): DeviceId {
    return device.getInfo().id
  }

  private assertDeviceId(deviceId: DeviceId): void {
    if (!deviceId.trim()) {
      throw new DeviceRegistryError('REGISTRY_DEVICE_ID_REQUIRED', 'Device id is required')
    }
  }

  private assertModuleId(moduleId: ModuleId): void {
    if (!moduleId.trim()) {
      throw new DeviceRegistryError('REGISTRY_MODULE_ID_REQUIRED', 'Module id is required')
    }
  }

  private assertAddress(address: DeviceAddress): void {
    if (!address.trim()) {
      throw new DeviceRegistryError('REGISTRY_ADDRESS_REQUIRED', 'Endpoint address is required')
    }
  }

  private assertProtocol(protocol: NetworkProtocol): void {
    if (!protocol.trim()) {
      throw new DeviceRegistryError('REGISTRY_PROTOCOL_REQUIRED', 'Endpoint protocol is required')
    }
  }

  private assertEndpoint(endpoint: NetworkEndpoint): void {
    this.assertDeviceId(endpoint.deviceId)
    this.assertModuleId(endpoint.moduleId)
    this.assertProtocol(endpoint.protocol)
    this.assertAddress(endpoint.address)
  }

  private assertModuleAvailable(moduleId: ModuleId, deviceId: DeviceId): void {
    const existingModule = this.modulesById.get(moduleId)

    if (existingModule && existingModule.deviceId !== deviceId) {
      throw new DeviceRegistryError(
        'REGISTRY_MODULE_ALREADY_EXISTS',
        `Module already exists in registry: ${moduleId}`,
        {
          moduleId,
          existingDeviceId: existingModule.deviceId,
          deviceId,
        },
      )
    }
  }

  private assertEndpointAddressAvailable(address: DeviceAddress, endpoint: NetworkEndpoint): void {
    const existingEndpoint = this.endpointsByAddress.get(address)

    if (
      existingEndpoint &&
      (existingEndpoint.deviceId !== endpoint.deviceId ||
        existingEndpoint.moduleId !== endpoint.moduleId ||
        existingEndpoint.protocol !== endpoint.protocol)
    ) {
      throw new DeviceRegistryError(
        'REGISTRY_ADDRESS_ALREADY_EXISTS',
        `Endpoint address already exists: ${address}`,
        {
          address,
          existingEndpoint,
          endpoint,
        },
      )
    }
  }

  private addToRoleIndex(device: DeviceCore): void {
    const role = device.getRole()
    const deviceId = this.getDeviceId(device)
    const roleDevices = this.devicesByRole.get(role) ?? new Set<DeviceId>()

    roleDevices.add(deviceId)
    this.devicesByRole.set(role, roleDevices)
  }

  private removeFromRoleIndex(device: DeviceCore): void {
    const role = device.getRole()
    const deviceId = this.getDeviceId(device)
    const roleDevices = this.devicesByRole.get(role)

    if (!roleDevices) {
      return
    }

    roleDevices.delete(deviceId)

    if (roleDevices.size === 0) {
      this.devicesByRole.delete(role)
    }
  }

  private addEndpointIndex(index: Map<string, Set<DeviceAddress>>, key: string, address: DeviceAddress): void {
    const addresses = index.get(key) ?? new Set<DeviceAddress>()
    addresses.add(address)
    index.set(key, addresses)
  }

  private removeEndpointIndex(index: Map<string, Set<DeviceAddress>>, key: string, address: DeviceAddress): void {
    const addresses = index.get(key)
    addresses?.delete(address)

    if (addresses?.size === 0) {
      index.delete(key)
    }
  }

  private getEndpointAddresses(index: Map<string, Set<DeviceAddress>>, key: string): NetworkEndpoint[] {
    const addresses = index.get(key)

    if (!addresses) {
      return []
    }

    return Array.from(addresses, (address) => this.endpointsByAddress.get(address)).filter(
      (endpoint): endpoint is NetworkEndpoint => Boolean(endpoint),
    ).map((endpoint) => ({ ...endpoint }))
  }
}
