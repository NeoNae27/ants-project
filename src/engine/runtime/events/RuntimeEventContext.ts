import type { DeviceCore } from '../../domain/device/DeviceCore'
import { DeviceRole } from '../../domain/device/DeviceRole'
import { ModuleKind, type DeviceModule } from '../../domain/module'
import { LoRaModule } from '../../domain/modules/network/lora'
import type { NetworkEndpoint } from '../../domain/registry'
import type { DispatchContext } from './EventDispatcherTypes'

export type RuntimeContextLookupSource = Pick<DispatchContext, 'workspace' | 'registry'>

type RuntimeWorkspacePort = {
  getDevice?(deviceId: string): DeviceCore | undefined
  getDeviceByAddress?(address: string): DeviceCore | undefined
  getAddress?(deviceId: string): string | undefined
  listDevices?(): readonly DeviceCore[]
  getRegistryQueries?(): {
    getLoRaAddress(deviceId: string, moduleId?: string): string | undefined
    getEndpointsByDevice(deviceId: string): readonly NetworkEndpoint[]
    getEndpointsByModule(moduleId: string): readonly NetworkEndpoint[]
  }
}

type RuntimeRegistryPort = {
  get?(deviceId: string): DeviceCore | undefined
  getByAddress?(address: string): DeviceCore | undefined
  getByLoRaAddress?(address: string): DeviceCore | undefined
  getAddress?(deviceId: string): string | undefined
  getLoRaAddress?(deviceId: string, moduleId?: string): string | undefined
  getEndpointByAddress?(address: string): NetworkEndpoint | undefined
  getEndpointsByDevice?(deviceId: string): readonly NetworkEndpoint[]
  getEndpointsByModule?(moduleId: string): readonly NetworkEndpoint[]
  list?(): readonly DeviceCore[]
}

export function findRuntimeDeviceById(
  context: RuntimeContextLookupSource,
  deviceId: string
): DeviceCore | undefined {
  const workspace = toRuntimeWorkspace(context.workspace)
  const registry = toRuntimeRegistry(context.registry)

  return callOptional(() => workspace?.getDevice?.(deviceId)) ?? callOptional(() => registry?.get?.(deviceId))
}

export function findRuntimeDeviceByAddress(
  context: RuntimeContextLookupSource,
  address: string
): DeviceCore | undefined {
  const workspace = toRuntimeWorkspace(context.workspace)
  const registry = toRuntimeRegistry(context.registry)

  return (
    callOptional(() => workspace?.getDeviceByAddress?.(address)) ??
    callOptional(() => registry?.getByLoRaAddress?.(address)) ??
    callOptional(() => registry?.getByAddress?.(address))
  )
}

export function findRuntimeLoRaModule(device: DeviceCore): LoRaModule | undefined {
  return device.getModules().find((module): module is LoRaModule => isLoRaModule(module))
}

export function isRuntimeLoRaModule(module: DeviceModule | undefined): module is LoRaModule {
  return Boolean(module && isLoRaModule(module))
}

export function findRuntimeLoRaEndpoint(
  context: RuntimeContextLookupSource,
  deviceId: string,
  address?: string
): NetworkEndpoint | undefined {
  const endpoints = listRuntimeEndpointsByDevice(context, deviceId)

  return endpoints.find(
    (endpoint) =>
      endpoint.protocol === 'lora' && (address === undefined || endpoint.address === address)
  )
}

export function findRuntimeLoRaAddress(
  context: RuntimeContextLookupSource,
  deviceId: string,
  moduleId?: string
): string | undefined {
  const workspace = toRuntimeWorkspace(context.workspace)
  const registry = toRuntimeRegistry(context.registry)
  const queries = callOptional(() => workspace?.getRegistryQueries?.())

  return (
    callOptional(() => queries?.getLoRaAddress(deviceId, moduleId)) ??
    (moduleId ? undefined : callOptional(() => workspace?.getAddress?.(deviceId))) ??
    callOptional(() => registry?.getLoRaAddress?.(deviceId, moduleId)) ??
    (moduleId ? undefined : callOptional(() => registry?.getAddress?.(deviceId)))
  )
}

export function getRuntimeDeviceId(device: DeviceCore): string {
  return device.getInfo().id
}

export function isRuntimeGatewayDevice(device: DeviceCore): boolean {
  return device.getRole() === DeviceRole.GATEWAY
}

export function listRuntimeDevices(context: RuntimeContextLookupSource): readonly DeviceCore[] {
  const workspace = toRuntimeWorkspace(context.workspace)
  const registry = toRuntimeRegistry(context.registry)

  return callOptional(() => workspace?.listDevices?.()) ?? callOptional(() => registry?.list?.()) ?? []
}

function listRuntimeEndpointsByDevice(
  context: RuntimeContextLookupSource,
  deviceId: string
): readonly NetworkEndpoint[] {
  const workspace = toRuntimeWorkspace(context.workspace)
  const registry = toRuntimeRegistry(context.registry)
  const queries = callOptional(() => workspace?.getRegistryQueries?.())

  return (
    callOptional(() => queries?.getEndpointsByDevice(deviceId)) ??
    callOptional(() => registry?.getEndpointsByDevice?.(deviceId)) ??
    []
  )
}

function isLoRaModule(module: DeviceModule): module is LoRaModule {
  if (module instanceof LoRaModule) {
    return true
  }

  const candidate = module as Partial<LoRaModule> & {
    kind?: ModuleKind
    getConfig?: unknown
    pushInbound?: unknown
  }

  return (
    candidate.kind === ModuleKind.NETWORK &&
    typeof candidate.getConfig === 'function' &&
    typeof candidate.pushInbound === 'function'
  )
}

function toRuntimeWorkspace(value: unknown): RuntimeWorkspacePort | undefined {
  return isRecord(value) ? (value as RuntimeWorkspacePort) : undefined
}

function toRuntimeRegistry(value: unknown): RuntimeRegistryPort | undefined {
  return isRecord(value) ? (value as RuntimeRegistryPort) : undefined
}

function callOptional<T>(callback: () => T | undefined): T | undefined {
  try {
    return callback()
  } catch {
    return undefined
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}
