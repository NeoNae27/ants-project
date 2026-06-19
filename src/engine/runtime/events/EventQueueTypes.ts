export type SimulationEventType =
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

export type SimulationEventStatus = 'scheduled' | 'processed'

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
