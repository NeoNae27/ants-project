export type CoreSimulationEventType =
  | 'wireless.packet_delivery'
  | 'wireless.packet_lost'
  | 'device.telemetry_sample'
  | 'device.telemetry_send'
  | 'device.sleep'
  | 'device.wake'
  | 'device.timeout'
  | 'command.timeout'
  | 'ack.timeout'
  | 'scenario.step'

export type FeatureSimulationEventType = `${string}.${string}`

export type DemoSimulationEventType = `demo.${string}`

export type SimulationEventType =
  | CoreSimulationEventType
  | FeatureSimulationEventType
  | DemoSimulationEventType

export type SimulationEventStatus = 'scheduled' | 'processed'

export const EventPriority = {
  SYSTEM: 0,
  DEVICE_STATE: 10,
  WIRELESS_DELIVERY: 20,
  TELEMETRY: 30,
  COMMAND: 40,
  SCENARIO: 50,
  LOG: 100
} as const

export type EventPriorityValue = (typeof EventPriority)[keyof typeof EventPriority]

export type SimulationEventSource = {
  type: 'device' | 'module' | 'wireless_medium' | 'scenario' | 'engine'
  id?: string
}

export type SimulationEventTarget = {
  deviceId?: string
  moduleId?: string
  endpointId?: string
}

export type SimulationEventMeta = {
  reason?: string
  correlationId?: string
  parentEventId?: string
}

export type SimulationEvent<TPayload = unknown> = {
  id: string
  type: SimulationEventType
  scheduledAt: number
  createdAt: number
  priority: number
  sequence: number
  source?: SimulationEventSource
  target?: SimulationEventTarget
  payload: TPayload
  status: SimulationEventStatus
  meta?: SimulationEventMeta
}

export type ScheduleSimulationEventInput<TPayload = unknown> = Omit<
  SimulationEvent<TPayload>,
  'sequence' | 'status'
>

export type EventQueueSnapshotItem = {
  id: string
  type: SimulationEventType
  scheduledAt: number
  createdAt: number
  priority: number
  sequence: number
  status: SimulationEventStatus
  source?: SimulationEventSource
  target?: SimulationEventTarget
  sourceLabel?: string
  targetLabel?: string
}

export type EventQueueSnapshot = {
  size: number
  nextEventAt?: number
  events: EventQueueSnapshotItem[]
}
