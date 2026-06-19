import type { DeviceModule } from '../module'
import { ModuleKind } from '../module/ModuleKind'
import { ModuleDomainError } from '../module/ModuleErrors'
import { LoRaModule } from './network/lora'
import { LoRaProfile } from './network/lora/LoRaProfile'
import { LoRaRegion } from './network/lora/LoRaRegion'
import type { WorkspaceModuleTemplateDto } from '../../../shared/workspaceSession'
import { StubModule } from './StubModule'

export type ModuleFactoryCreateOptions = {
  id?: string
  deviceId: string
  loraAddress?: string
  version?: string
}

function createId(prefix: string): string {
  return `${prefix}-${crypto.randomUUID()}`
}

function toModuleKind(kind: WorkspaceModuleTemplateDto['kind']): ModuleKind {
  switch (kind) {
    case 'network':
      return ModuleKind.NETWORK
    case 'sensor':
      return ModuleKind.SENSOR
    case 'power':
      return ModuleKind.POWER
    case 'compute':
      return ModuleKind.COMPUTE
    case 'storage':
      return ModuleKind.STORAGE
    default:
      throw new ModuleDomainError(`Unknown module kind: ${String(kind)}`, 'MODULE_KIND_UNKNOWN')
  }
}

export class ModuleFactory {
  createModule(template: WorkspaceModuleTemplateDto, options: ModuleFactoryCreateOptions): DeviceModule {
    if (!template.model.trim() || !template.name.trim()) {
      throw new ModuleDomainError('Module name and model are required', 'MODULE_TEMPLATE_INVALID')
    }

    if (template.communication?.protocol === 'lora') {
      return this.createLoRaModule(template, options)
    }

    return new StubModule(
      options.id ?? createId('module'),
      toModuleKind(template.kind),
      template.name,
      template.model,
      options.version ?? '1.0.0',
      template.config,
    )
  }

  private createLoRaModule(
    template: WorkspaceModuleTemplateDto,
    options: ModuleFactoryCreateOptions,
  ): LoRaModule {
    const communication = template.communication

    if (!communication || communication.protocol !== 'lora') {
      throw new ModuleDomainError('LoRa communication config is required', 'MODULE_LORA_CONFIG_REQUIRED')
    }

    const sourceAddress = options.loraAddress ?? `${options.deviceId}:lora`

    return new LoRaModule(
      options.id ?? createId('module'),
      template.model,
      options.version ?? '1.0.0',
      sourceAddress,
      {
        radio: {
          profile: LoRaProfile.LORA_MESH,
          region: LoRaRegion.EU868,
          frequencyHz: 868_000_000,
          bandwidthHz: communication.bandwidthHz,
          spreadingFactor: communication.spreadingFactor,
          codingRate: communication.codingRate,
          preambleLength: 8,
          crcEnabled: true,
          implicitHeader: false,
          txPowerDbm: communication.txPowerDbm,
          maxPayloadSizeBytes: 64,
          ackEnabled: false,
          retryLimit: 0,
          timeoutMs: 1_000,
          maxRangeMeters: communication.maxRangeMeters,
          maxConnections: communication.maxConnections ?? 8,
        },
        mesh: {
          enabled: true,
          nodeAddress: sourceAddress,
          relayEnabled: false,
          maxHops: 1,
        },
      },
    )
  }
}
