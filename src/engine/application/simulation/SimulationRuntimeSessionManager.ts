import {
  createDefaultRuntimeEventHandlers,
  EventDispatcher,
  EventPriority,
  findRuntimeDeviceByAddress,
  findRuntimeDeviceById,
  findRuntimeLoRaAddress,
  findRuntimeLoRaEndpoint,
  findRuntimeLoRaModule,
  getRuntimeDeviceId,
  InMemoryEventQueue,
  isRuntimeGatewayDevice,
  isRuntimeLoRaModule,
  NoopHandler,
  RuntimeEventType,
  SimulationClock,
  SimulationClockSpeedMultiplier,
  SimulationEngine,
  SimulationLogHandler,
  WirelessMedium,
  LinkBudgetChannelModel,
  type DispatchLoggerPort,
  type RadioLinkSnapshot,
  type RuntimeContextProvider,
  type LoRaCodecSendPayload,
  type LoRaPingSendPayload,
  type TelemetrySamplePayload
} from '../../runtime'
import { TelemetryMessageFactory } from '../../domain/lora/codec'
import type {
  SimulationCommand,
  SimulationCommandResult,
  SimulationLoRaCodecMode,
  SimulationRuntimeExecutionLogEntry,
  SimulationScheduleBasicTelemetryCommand,
  SimulationSendPingToGatewayCommand,
  SimulationSendTypicalLoRaMessageCommand
} from '../../../shared/simulationRuntime'
import {
  loraAddressToNumericAddress
} from './LoRaCodecReportService'

const DEFAULT_PING_DUE_IN_MS = 0
const DEFAULT_PING_DELIVERY_DELAY_MS = 100
const DEFAULT_TELEMETRY_DUE_IN_MS = 1000
const DEFAULT_TELEMETRY_SEND_DELAY_MS = 1
const DEFAULT_TELEMETRY_DELIVERY_DELAY_MS = 100
const DEFAULT_AUTO_STEP_REAL_MS = 250
const MAX_EXECUTION_LOG_ENTRIES = 50

type SimulationRuntimeSessionManagerDependencies = {
  runtimeContextProvider?: RuntimeContextProvider
  logger?: DispatchLoggerPort
  autoRun?: boolean
  autoStepRealMs?: number
}

type NormalizedTelemetryScheduleCommand = {
  deviceId: string
  targetAddress: string
  dueInMs: number
  repeat: boolean
  intervalMs?: number
  sendDelayMs: number
  deliveryDelayMs: number
}

type NormalizedPingCommand = {
  deviceId: string
  targetAddress: string
  targetDeviceId: string
  dueInMs: number
  deliveryDelayMs: number
}

type NormalizedTypicalLoRaMessageCommand = {
  deviceId: string
  targetAddress: string
  targetDeviceId: string
  mode: SimulationLoRaCodecMode
  sourceAddress: string
  sourceNumericAddress: number
}

function toErrorResult(
  error: unknown,
  clock: SimulationClock,
  engine: SimulationEngine,
  eventQueue?: InMemoryEventQueue,
  radioLinks?: readonly RadioLinkSnapshot[]
): SimulationCommandResult {
  if (error instanceof Error) {
    const code = 'code' in error && typeof error.code === 'string' ? error.code : error.name

    return {
      ok: false,
      clock: clock.getSnapshot(),
      engine: engine.getSnapshot(),
      ...(eventQueue ? { queue: eventQueue.getSnapshot() } : {}),
      ...(radioLinks ? { radioLinks: [...radioLinks] } : {}),
      error: {
        code,
        message: error.message
      }
    }
  }

  return {
    ok: false,
    clock: clock.getSnapshot(),
    engine: engine.getSnapshot(),
    ...(eventQueue ? { queue: eventQueue.getSnapshot() } : {}),
    ...(radioLinks ? { radioLinks: [...radioLinks] } : {}),
    error: {
      code: 'SIMULATION_RUNTIME_UNKNOWN_ERROR',
      message: 'Unknown simulation runtime error'
    }
  }
}

export class SimulationRuntimeSessionManager {
  private readonly clock: SimulationClock
  private readonly eventQueue: InMemoryEventQueue
  private readonly dispatcher: EventDispatcher
  private readonly wirelessMedium: WirelessMedium
  private readonly engine: SimulationEngine
  private readonly runtimeContextProvider?: RuntimeContextProvider
  private readonly logger?: DispatchLoggerPort
  private readonly autoRun: boolean
  private readonly autoStepRealMs: number
  private readonly typicalTelemetryFactories = new Map<string, TelemetryMessageFactory>()
  private autoStepTimer?: ReturnType<typeof setInterval>
  private nextPingScenarioSequence = 1
  private lastPingSentAtUnix = 0
  private nextTelemetryScenarioSequence = 1
  private lastTelemetryMeasuredAtUnix = 0
  private nextExecutionSequence = 1
  private executionLog: SimulationRuntimeExecutionLogEntry[] = []

  constructor(dependencies: SimulationRuntimeSessionManagerDependencies = {}) {
    this.clock = new SimulationClock()
    this.eventQueue = new InMemoryEventQueue()
    this.runtimeContextProvider = dependencies.runtimeContextProvider
    this.logger = dependencies.logger
    this.autoRun = dependencies.autoRun ?? false
    this.autoStepRealMs = dependencies.autoStepRealMs ?? DEFAULT_AUTO_STEP_REAL_MS
    this.dispatcher = new EventDispatcher({
      handlers: {
        ...createDefaultRuntimeEventHandlers(),
        'simulation.noop': NoopHandler,
        'simulation.log': SimulationLogHandler
      }
    })
    this.wirelessMedium = new WirelessMedium({
      eventQueue: this.eventQueue,
      channelModel: new LinkBudgetChannelModel(),
      now: () => this.clock.getNowMs(),
      runtimeContextProvider: () => this.runtimeContextProvider?.() ?? {},
      logger: this.logger
    })
    this.engine = new SimulationEngine({
      clock: this.clock,
      eventQueue: this.eventQueue,
      dispatcher: this.dispatcher,
      runtimeContextProvider: () => ({
        ...(this.runtimeContextProvider?.() ?? {}),
        wirelessMedium: this.wirelessMedium
      }),
      logger: this.logger
    })
  }

  dispatch(command: SimulationCommand): SimulationCommandResult {
    try {
      switch (command.type) {
        case 'simulation/start': {
          const result = this.engine.start()

          if (result.ok) {
            this.startAutoStepLoop()
          }

          return this.withEngine(result)
        }
        case 'simulation/pause':
          this.stopAutoStepLoop()
          return this.withEngine(this.engine.pause())
        case 'simulation/stop':
          this.stopAutoStepLoop()
          return this.withEngine(this.engine.stop())
        case 'simulation/reset':
          this.stopAutoStepLoop()
          this.clearExecutionLog()
          this.wirelessMedium.clearLinks()
          this.typicalTelemetryFactories.clear()
          this.lastPingSentAtUnix = 0
          this.lastTelemetryMeasuredAtUnix = 0
          return this.withEngine(this.engine.reset())
        case 'simulation/set-speed':
          this.clock.setSpeed(command.speed)
          return this.withSnapshot()
        case 'simulation/advance-clock': {
          const result = this.engine.step(command.deltaRealMs)

          this.recordExecution('manual', result)

          return this.withEngine(result)
        }
        case 'simulation/get-clock-snapshot':
          return this.withSnapshot()
        case 'simulation/schedule-basic-telemetry':
          return this.scheduleBasicTelemetry(command)
        case 'simulation/send-ping-to-gateway':
          return this.sendPingToGateway(command)
        case 'simulation/send-typical-lora-message':
          return this.sendTypicalLoRaMessage(command)
        default:
          return {
            ok: false,
            clock: this.clock.getSnapshot(),
            engine: this.engine.getSnapshot(),
            queue: this.eventQueue.getSnapshot(),
            radioLinks: [...this.wirelessMedium.getLinks()],
            error: {
              code: 'SIMULATION_COMMAND_UNKNOWN',
              message: `Unknown simulation command: ${(command as { type?: string }).type}`
            }
          }
      }
    } catch (error) {
      return toErrorResult(
        error,
        this.clock,
        this.engine,
        this.eventQueue,
        this.wirelessMedium.getLinks()
      )
    }
  }

  getClockSnapshot(): SimulationCommandResult {
    return this.withSnapshot()
  }

  resetForNewWorkspace(): SimulationCommandResult {
    try {
      this.stopAutoStepLoop()
      this.clearExecutionLog()
      this.wirelessMedium.clearLinks()
      this.typicalTelemetryFactories.clear()
      this.lastPingSentAtUnix = 0
      this.lastTelemetryMeasuredAtUnix = 0
      this.clock.setSpeed(SimulationClockSpeedMultiplier.X1)
      return this.withEngine(this.engine.reset())
    } catch (error) {
      return toErrorResult(
        error,
        this.clock,
        this.engine,
        this.eventQueue,
        this.wirelessMedium.getLinks()
      )
    }
  }

  private withSnapshot(): SimulationCommandResult {
    return {
      ok: true,
      clock: this.clock.getSnapshot(),
      engine: this.engine.getSnapshot(),
      queue: this.eventQueue.getSnapshot(),
      radioLinks: [...this.wirelessMedium.getLinks()],
      executions: [...this.executionLog]
    }
  }

  private withEngine(
    result: ReturnType<SimulationEngine['start']> | ReturnType<SimulationEngine['step']>
  ): SimulationCommandResult {
    return {
      ok: result.ok,
      clock: this.clock.getSnapshot(),
      engine: this.engine.getSnapshot(),
      queue: this.eventQueue.getSnapshot(),
      radioLinks: [...this.wirelessMedium.getLinks()],
      executions: [...this.executionLog],
      ...('deltaRealMs' in result ? { step: result } : {}),
      ...(result.errors[0]
        ? {
            error: {
              code: result.errors[0].code,
              message: result.errors[0].message
            }
          }
        : {})
    }
  }

  private sendPingToGateway(command: SimulationSendPingToGatewayCommand): SimulationCommandResult {
    const validation = this.validatePingCommand(command)

    if (!validation.ok) {
      return this.withError(validation.code, validation.message)
    }

    const normalized = validation.command
    const nowMs = this.clock.getNowMs()
    const sequence = this.nextPingScenarioSequence
    this.nextPingScenarioSequence += 1
    const sentAtUnix = this.nextMonotonicPingUnix(nowMs)

    const scheduled = this.eventQueue.schedule<LoRaPingSendPayload>({
      id: `scenario:ping:${normalized.deviceId}:${nowMs}:${sequence}`,
      type: RuntimeEventType.LORA_PING_SEND,
      scheduledAt: nowMs + normalized.dueInMs,
      createdAt: nowMs,
      priority: EventPriority.COMMAND,
      source: { type: 'device', id: normalized.deviceId },
      target: { deviceId: normalized.targetDeviceId },
      payload: {
        deviceId: normalized.deviceId,
        targetAddress: normalized.targetAddress,
        deliveryDelayMs: normalized.deliveryDelayMs,
        mode: 'direct',
        ping: {
          schemaVersion: 1,
          messageId: `ping-${normalized.deviceId}-${sequence}-${sentAtUnix}`,
          sequence,
          sentAtUnix
        }
      },
      meta: {
        reason: 'ui.ping_gateway'
      }
    })

    return {
      ok: true,
      clock: this.clock.getSnapshot(),
      engine: this.engine.getSnapshot(),
      queue: this.eventQueue.getSnapshot(),
      executions: [...this.executionLog],
      radioLinks: [...this.wirelessMedium.getLinks()],
      scheduledEventIds: [scheduled.id]
    }
  }

  private sendTypicalLoRaMessage(
    command: SimulationSendTypicalLoRaMessageCommand
  ): SimulationCommandResult {
    const validation = this.validateTypicalLoRaMessageCommand(command)

    if (!validation.ok) {
      return this.withError(validation.code, validation.message)
    }

    const normalized = validation.command
    const factory = this.getTypicalTelemetryFactory(
      normalized.sourceAddress,
      normalized.sourceNumericAddress
    )
    const telemetry = factory.next()
    const nowMs = this.clock.getNowMs()
    const scheduled = this.eventQueue.schedule<LoRaCodecSendPayload>({
      id: `scenario:lora-codec:${normalized.deviceId}:${nowMs}:${telemetry.sequence}`,
      type: RuntimeEventType.LORA_CODEC_SEND,
      scheduledAt: nowMs,
      createdAt: nowMs,
      priority: EventPriority.COMMAND,
      source: { type: 'device', id: normalized.deviceId },
      target: { deviceId: normalized.targetDeviceId },
      payload: {
        deviceId: normalized.deviceId,
        targetAddress: normalized.targetAddress,
        telemetry,
        mode: normalized.mode
      },
      meta: {
        reason: 'ui.typical_lora_message'
      }
    })

    return {
      ok: true,
      clock: this.clock.getSnapshot(),
      engine: this.engine.getSnapshot(),
      queue: this.eventQueue.getSnapshot(),
      executions: [...this.executionLog],
      radioLinks: [...this.wirelessMedium.getLinks()],
      scheduledEventIds: [scheduled.id]
    }
  }

  private scheduleBasicTelemetry(
    command: SimulationScheduleBasicTelemetryCommand
  ): SimulationCommandResult {
    const validation = this.validateTelemetryScheduleCommand(command)

    if (!validation.ok) {
      return this.withError(validation.code, validation.message)
    }

    const normalized = validation.command
    const nowMs = this.clock.getNowMs()
    const sampleAtMs = nowMs + normalized.dueInMs
    const sequence = this.nextTelemetryScenarioSequence
    this.nextTelemetryScenarioSequence += 1
    const measuredAtUnix = this.nextMonotonicTelemetryUnix(sampleAtMs)

    const scheduled = this.eventQueue.schedule<TelemetrySamplePayload>({
      id: `scenario:telemetry:${normalized.deviceId}:${nowMs}:${sequence}`,
      type: RuntimeEventType.TELEMETRY_SAMPLE,
      scheduledAt: sampleAtMs,
      createdAt: nowMs,
      priority: EventPriority.TELEMETRY,
      source: { type: 'scenario', id: 'basic-telemetry' },
      target: { deviceId: normalized.deviceId },
      payload: {
        deviceId: normalized.deviceId,
        targetAddress: normalized.targetAddress,
        repeat: normalized.repeat,
        ...(normalized.intervalMs !== undefined ? { intervalMs: normalized.intervalMs } : {}),
        sendDelayMs: normalized.sendDelayMs,
        deliveryDelayMs: normalized.deliveryDelayMs,
        sequence,
        measuredAtUnix
      },
      meta: {
        reason: 'debug.basic_telemetry'
      }
    })

    return {
      ok: true,
      clock: this.clock.getSnapshot(),
      engine: this.engine.getSnapshot(),
      queue: this.eventQueue.getSnapshot(),
      executions: [...this.executionLog],
      radioLinks: [...this.wirelessMedium.getLinks()],
      scheduledEventIds: [scheduled.id]
    }
  }

  private validateTelemetryScheduleCommand(
    command: SimulationScheduleBasicTelemetryCommand
  ):
    | { ok: true; command: NormalizedTelemetryScheduleCommand }
    | { ok: false; code: string; message: string } {
    const deviceId = typeof command.deviceId === 'string' ? command.deviceId.trim() : ''
    const targetAddress =
      typeof command.targetAddress === 'string' ? command.targetAddress.trim() : ''
    const dueInMs = command.dueInMs ?? DEFAULT_TELEMETRY_DUE_IN_MS
    const repeat = command.repeat ?? false
    const sendDelayMs = command.sendDelayMs ?? DEFAULT_TELEMETRY_SEND_DELAY_MS
    const deliveryDelayMs = command.deliveryDelayMs ?? DEFAULT_TELEMETRY_DELIVERY_DELAY_MS

    if (!deviceId) {
      return this.validationError('SIMULATION_TELEMETRY_DEVICE_ID_REQUIRED', 'deviceId is required')
    }

    if (!targetAddress) {
      return this.validationError(
        'SIMULATION_TELEMETRY_TARGET_ADDRESS_REQUIRED',
        'targetAddress is required'
      )
    }

    if (!Number.isFinite(dueInMs) || dueInMs < 0) {
      return this.validationError(
        'SIMULATION_TELEMETRY_DUE_IN_INVALID',
        'dueInMs must be greater than or equal to zero'
      )
    }

    if (repeat && (!Number.isFinite(command.intervalMs) || Number(command.intervalMs) <= 0)) {
      return this.validationError(
        'SIMULATION_TELEMETRY_INTERVAL_INVALID',
        'intervalMs must be greater than zero when repeat is true'
      )
    }

    if (!Number.isFinite(sendDelayMs) || sendDelayMs <= 0) {
      return this.validationError(
        'SIMULATION_TELEMETRY_SEND_DELAY_INVALID',
        'sendDelayMs must be greater than zero'
      )
    }

    if (!Number.isFinite(deliveryDelayMs) || deliveryDelayMs <= 0) {
      return this.validationError(
        'SIMULATION_TELEMETRY_DELIVERY_DELAY_INVALID',
        'deliveryDelayMs must be greater than zero'
      )
    }

    const runtimeContext = this.runtimeContextProvider?.() ?? {}
    const sourceDevice = findRuntimeDeviceById(runtimeContext, deviceId)

    if (!sourceDevice) {
      return this.validationError(
        'SIMULATION_TELEMETRY_SOURCE_DEVICE_NOT_FOUND',
        `Source device not found: ${deviceId}`
      )
    }

    const sourceModule = findRuntimeLoRaModule(sourceDevice)

    if (!sourceModule) {
      return this.validationError(
        'SIMULATION_TELEMETRY_SOURCE_LORA_MODULE_NOT_FOUND',
        `Source LoRa module not found: ${deviceId}`
      )
    }

    if (!findRuntimeLoRaAddress(runtimeContext, deviceId, sourceModule.id)) {
      return this.validationError(
        'SIMULATION_TELEMETRY_SOURCE_LORA_ADDRESS_NOT_FOUND',
        `Source LoRa address not found: ${deviceId}`
      )
    }

    const targetDevice = findRuntimeDeviceByAddress(runtimeContext, targetAddress)

    if (!targetDevice) {
      return this.validationError(
        'SIMULATION_TELEMETRY_TARGET_DEVICE_NOT_FOUND',
        `Target device not found for LoRa address: ${targetAddress}`
      )
    }

    if (!isRuntimeGatewayDevice(targetDevice)) {
      return this.validationError(
        'SIMULATION_TELEMETRY_TARGET_NOT_GATEWAY',
        `Target address does not belong to a Gateway device: ${targetAddress}`
      )
    }

    const targetDeviceId = getRuntimeDeviceId(targetDevice)
    const targetEndpoint = findRuntimeLoRaEndpoint(runtimeContext, targetDeviceId, targetAddress)

    if (!targetEndpoint) {
      return this.validationError(
        'SIMULATION_TELEMETRY_TARGET_LORA_ADDRESS_NOT_FOUND',
        `Target LoRa endpoint not found: ${targetAddress}`
      )
    }

    if (!isRuntimeLoRaModule(targetDevice.getModule(targetEndpoint.moduleId))) {
      return this.validationError(
        'SIMULATION_TELEMETRY_TARGET_LORA_MODULE_NOT_FOUND',
        `Target LoRa module not found: ${targetEndpoint.moduleId}`
      )
    }

    return {
      ok: true,
      command: {
        deviceId,
        targetAddress,
        dueInMs,
        repeat,
        ...(repeat ? { intervalMs: command.intervalMs } : {}),
        sendDelayMs,
        deliveryDelayMs
      }
    }
  }

  private validatePingCommand(
    command: SimulationSendPingToGatewayCommand
  ): { ok: true; command: NormalizedPingCommand } | { ok: false; code: string; message: string } {
    const deviceId = typeof command.deviceId === 'string' ? command.deviceId.trim() : ''
    const targetAddress =
      typeof command.targetAddress === 'string' ? command.targetAddress.trim() : ''
    const dueInMs = command.dueInMs ?? DEFAULT_PING_DUE_IN_MS
    const deliveryDelayMs = command.deliveryDelayMs ?? DEFAULT_PING_DELIVERY_DELAY_MS

    if (!deviceId) {
      return this.validationError('SIMULATION_PING_DEVICE_ID_REQUIRED', 'deviceId is required')
    }

    if (!targetAddress) {
      return this.validationError(
        'SIMULATION_PING_TARGET_ADDRESS_REQUIRED',
        'targetAddress is required'
      )
    }

    if (!Number.isFinite(dueInMs) || dueInMs < 0) {
      return this.validationError(
        'SIMULATION_PING_DUE_IN_INVALID',
        'dueInMs must be greater than or equal to zero'
      )
    }

    if (!Number.isFinite(deliveryDelayMs) || deliveryDelayMs <= 0) {
      return this.validationError(
        'SIMULATION_PING_DELIVERY_DELAY_INVALID',
        'deliveryDelayMs must be greater than zero'
      )
    }

    const runtimeContext = this.runtimeContextProvider?.() ?? {}
    const sourceDevice = findRuntimeDeviceById(runtimeContext, deviceId)

    if (!sourceDevice) {
      return this.validationError(
        'SIMULATION_PING_SOURCE_DEVICE_NOT_FOUND',
        `Source device not found: ${deviceId}`
      )
    }

    const sourceModule = findRuntimeLoRaModule(sourceDevice)

    if (!sourceModule) {
      return this.validationError(
        'SIMULATION_PING_SOURCE_LORA_MODULE_NOT_FOUND',
        `Source LoRa module not found: ${deviceId}`
      )
    }

    if (!findRuntimeLoRaAddress(runtimeContext, deviceId, sourceModule.id)) {
      return this.validationError(
        'SIMULATION_PING_SOURCE_LORA_ADDRESS_NOT_FOUND',
        `Source LoRa address not found: ${deviceId}`
      )
    }

    const targetDevice = findRuntimeDeviceByAddress(runtimeContext, targetAddress)

    if (!targetDevice) {
      return this.validationError(
        'SIMULATION_PING_TARGET_DEVICE_NOT_FOUND',
        `Target device not found for LoRa address: ${targetAddress}`
      )
    }

    if (!isRuntimeGatewayDevice(targetDevice)) {
      return this.validationError(
        'SIMULATION_PING_TARGET_NOT_GATEWAY',
        `Target address does not belong to a Gateway device: ${targetAddress}`
      )
    }

    const targetDeviceId = getRuntimeDeviceId(targetDevice)
    const targetEndpoint = findRuntimeLoRaEndpoint(runtimeContext, targetDeviceId, targetAddress)

    if (!targetEndpoint) {
      return this.validationError(
        'SIMULATION_PING_TARGET_LORA_ADDRESS_NOT_FOUND',
        `Target LoRa endpoint not found: ${targetAddress}`
      )
    }

    if (!isRuntimeLoRaModule(targetDevice.getModule(targetEndpoint.moduleId))) {
      return this.validationError(
        'SIMULATION_PING_TARGET_LORA_MODULE_NOT_FOUND',
        `Target LoRa module not found: ${targetEndpoint.moduleId}`
      )
    }

    return {
      ok: true,
      command: {
        deviceId,
        targetAddress,
        targetDeviceId,
        dueInMs,
        deliveryDelayMs
      }
    }
  }

  private validateTypicalLoRaMessageCommand(
    command: SimulationSendTypicalLoRaMessageCommand
  ):
    | { ok: true; command: NormalizedTypicalLoRaMessageCommand }
    | { ok: false; code: string; message: string } {
    const deviceId = typeof command.deviceId === 'string' ? command.deviceId.trim() : ''
    const targetAddress =
      typeof command.targetAddress === 'string' ? command.targetAddress.trim() : ''
    const mode = command.mode ?? 'both'

    if (!deviceId) {
      return this.validationError('SIMULATION_LORA_CODEC_DEVICE_ID_REQUIRED', 'deviceId is required')
    }

    if (!targetAddress) {
      return this.validationError(
        'SIMULATION_LORA_CODEC_TARGET_ADDRESS_REQUIRED',
        'targetAddress is required'
      )
    }

    if (mode !== 'direct' && mode !== 'mesh' && mode !== 'both') {
      return this.validationError(
        'SIMULATION_LORA_CODEC_MODE_INVALID',
        'mode must be direct, mesh, or both'
      )
    }

    const runtimeContext = this.runtimeContextProvider?.() ?? {}
    const sourceDevice = findRuntimeDeviceById(runtimeContext, deviceId)

    if (!sourceDevice) {
      return this.validationError(
        'SIMULATION_LORA_CODEC_SOURCE_DEVICE_NOT_FOUND',
        `Source device not found: ${deviceId}`
      )
    }

    const sourceModule = findRuntimeLoRaModule(sourceDevice)

    if (!sourceModule) {
      return this.validationError(
        'SIMULATION_LORA_CODEC_SOURCE_LORA_MODULE_NOT_FOUND',
        `Source LoRa module not found: ${deviceId}`
      )
    }

    const sourceAddress = findRuntimeLoRaAddress(runtimeContext, deviceId, sourceModule.id)

    if (!sourceAddress) {
      return this.validationError(
        'SIMULATION_LORA_CODEC_SOURCE_LORA_ADDRESS_NOT_FOUND',
        `Source LoRa address not found: ${deviceId}`
      )
    }

    const targetDevice = findRuntimeDeviceByAddress(runtimeContext, targetAddress)

    if (!targetDevice) {
      return this.validationError(
        'SIMULATION_LORA_CODEC_TARGET_DEVICE_NOT_FOUND',
        `Target device not found for LoRa address: ${targetAddress}`
      )
    }

    if (!isRuntimeGatewayDevice(targetDevice)) {
      return this.validationError(
        'SIMULATION_LORA_CODEC_TARGET_NOT_GATEWAY',
        `Target address does not belong to a Gateway device: ${targetAddress}`
      )
    }

    const targetDeviceId = getRuntimeDeviceId(targetDevice)
    const targetEndpoint = findRuntimeLoRaEndpoint(runtimeContext, targetDeviceId, targetAddress)

    if (!targetEndpoint) {
      return this.validationError(
        'SIMULATION_LORA_CODEC_TARGET_LORA_ADDRESS_NOT_FOUND',
        `Target LoRa endpoint not found: ${targetAddress}`
      )
    }

    if (!isRuntimeLoRaModule(targetDevice.getModule(targetEndpoint.moduleId))) {
      return this.validationError(
        'SIMULATION_LORA_CODEC_TARGET_LORA_MODULE_NOT_FOUND',
        `Target LoRa module not found: ${targetEndpoint.moduleId}`
      )
    }

    return {
      ok: true,
      command: {
        deviceId,
        targetAddress,
        targetDeviceId,
        mode,
        sourceAddress,
        sourceNumericAddress: loraAddressToNumericAddress(sourceAddress)
      }
    }
  }

  private getTypicalTelemetryFactory(
    sourceAddress: string,
    sourceNumericAddress: number
  ): TelemetryMessageFactory {
    const key = `${sourceAddress}:${sourceNumericAddress}`
    const existing = this.typicalTelemetryFactories.get(key)

    if (existing) {
      return existing
    }

    const factory = new TelemetryMessageFactory({
      sourceAddress: sourceNumericAddress,
      sequenceStart: 1
    })

    this.typicalTelemetryFactories.set(key, factory)
    return factory
  }

  private nextMonotonicPingUnix(nowMs: number): number {
    const candidate = Math.floor(nowMs / 1000)
    this.lastPingSentAtUnix = Math.max(candidate, this.lastPingSentAtUnix + 1)
    return this.lastPingSentAtUnix
  }

  private nextMonotonicTelemetryUnix(nowMs: number): number {
    const candidate = Math.floor(nowMs / 1000)
    this.lastTelemetryMeasuredAtUnix = Math.max(candidate, this.lastTelemetryMeasuredAtUnix + 1)
    return this.lastTelemetryMeasuredAtUnix
  }

  private validationError(
    code: string,
    message: string
  ): { ok: false; code: string; message: string } {
    return { ok: false, code, message }
  }

  private withError(code: string, message: string): SimulationCommandResult {
    return {
      ok: false,
      clock: this.clock.getSnapshot(),
      engine: this.engine.getSnapshot(),
      queue: this.eventQueue.getSnapshot(),
      radioLinks: [...this.wirelessMedium.getLinks()],
      executions: [...this.executionLog],
      error: {
        code,
        message
      }
    }
  }

  private startAutoStepLoop(): void {
    if (!this.autoRun || this.autoStepTimer) {
      return
    }

    this.autoStepTimer = setInterval(() => {
      const result = this.engine.step(this.autoStepRealMs)

      this.recordExecution('auto', result)

      if (this.engine.getState().status !== 'running') {
        this.stopAutoStepLoop()
      }
    }, this.autoStepRealMs)

    this.autoStepTimer.unref?.()
  }

  private stopAutoStepLoop(): void {
    if (!this.autoStepTimer) {
      return
    }

    clearInterval(this.autoStepTimer)
    this.autoStepTimer = undefined
  }

  private recordExecution(
    mode: SimulationRuntimeExecutionLogEntry['mode'],
    result: ReturnType<SimulationEngine['step']>
  ): void {
    if (
      result.processedEventCount === 0 &&
      result.failedEventCount === 0 &&
      result.errors.length === 0
    ) {
      return
    }

    const entry: SimulationRuntimeExecutionLogEntry = {
      sequence: this.nextExecutionSequence,
      mode,
      ok: result.ok,
      status: result.status,
      startedAtMs: result.startedAtMs,
      endedAtMs: result.endedAtMs,
      deltaRealMs: result.deltaRealMs,
      deltaSimulationMs: result.deltaSimulationMs,
      processedEventCount: result.processedEventCount,
      failedEventCount: result.failedEventCount,
      pendingEventCount: result.pendingEventCount,
      processedEvents: result.processedEvents.map((event) => ({
        id: event.id,
        type: event.type,
        scheduledAt: event.scheduledAt
      })),
      dispatchResults: result.dispatchResults.map((dispatchResult) => ({
        eventId: dispatchResult.eventId,
        eventType: dispatchResult.eventType,
        ok: dispatchResult.ok,
        ...(dispatchResult.handlerName ? { handlerName: dispatchResult.handlerName } : {}),
        scheduledEventIds: [...dispatchResult.scheduledEventIds],
        ...(dispatchResult.notes ? { notes: [...dispatchResult.notes] } : {}),
        ...(dispatchResult.error
          ? {
              error: {
                code: dispatchResult.error.code,
                message: dispatchResult.error.message,
                severity: dispatchResult.error.severity
              }
            }
          : {})
      })),
      errors: result.errors.map((error) => ({
        code: error.code,
        message: error.message
      }))
    }

    this.nextExecutionSequence += 1
    this.executionLog.push(entry)

    if (this.executionLog.length > MAX_EXECUTION_LOG_ENTRIES) {
      this.executionLog = this.executionLog.slice(-MAX_EXECUTION_LOG_ENTRIES)
    }

    this.logExecution(entry)
  }

  private clearExecutionLog(): void {
    this.executionLog = []
  }

  private logExecution(entry: SimulationRuntimeExecutionLogEntry): void {
    const payload = {
      sequence: entry.sequence,
      mode: entry.mode,
      ok: entry.ok,
      endedAtMs: entry.endedAtMs,
      processedEventCount: entry.processedEventCount,
      failedEventCount: entry.failedEventCount,
      pendingEventCount: entry.pendingEventCount,
      processedEvents: entry.processedEvents,
      dispatchResults: entry.dispatchResults
    }

    if (entry.ok) {
      this.logger?.info?.('simulation.step_executed', payload)
      return
    }

    this.logger?.warn?.('simulation.step_failed', {
      ...payload,
      errors: entry.errors
    })
  }
}
