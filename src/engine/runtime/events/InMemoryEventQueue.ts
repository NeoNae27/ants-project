import { EventQueueError } from './EventQueueErrors'
import type { EventQueue } from './EventQueue'
import type {
  EventQueueSnapshot,
  EventQueueSnapshotItem,
  ScheduleSimulationEventInput,
  SimulationEvent,
  SimulationEventSource,
  SimulationEventStatus,
  SimulationEventTarget
} from './EventQueueTypes'

const targetKeys: Array<keyof SimulationEventTarget> = ['deviceId', 'moduleId', 'endpointId']

export class InMemoryEventQueue implements EventQueue {
  private readonly events: SimulationEvent[] = []
  private readonly eventsById = new Map<string, SimulationEvent>()
  private nextSequence = 1

  schedule<TPayload>(input: ScheduleSimulationEventInput<TPayload>): SimulationEvent<TPayload> {
    this.assertEventInput(input)

    const event: SimulationEvent<TPayload> = {
      id: input.id,
      type: input.type,
      scheduledAt: input.scheduledAt,
      createdAt: input.createdAt,
      priority: input.priority,
      sequence: this.nextSequence,
      payload: input.payload,
      status: 'scheduled',
      ...(input.source ? { source: { ...input.source } } : {}),
      ...(input.target ? { target: { ...input.target } } : {}),
      ...(input.meta ? { meta: { ...input.meta } } : {})
    }

    this.nextSequence += 1
    this.insertSorted(event)
    this.eventsById.set(event.id, event)

    return this.cloneEvent(event)
  }

  popDueEvents(now: number): SimulationEvent[] {
    this.assertNow(now)

    const dueEvents: SimulationEvent[] = []

    while (this.events.length > 0) {
      const next = this.events[0]

      if (!next || next.scheduledAt > now) {
        break
      }

      this.events.shift()
      this.eventsById.delete(next.id)
      dueEvents.push(this.cloneEvent(next, 'processed'))
    }

    return dueEvents
  }

  peekNext(): SimulationEvent | undefined {
    const next = this.events[0]
    return next ? this.cloneEvent(next) : undefined
  }

  cancel(eventId: string, reason?: string): boolean {
    void reason

    if (!eventId.trim()) {
      return false
    }

    const event = this.eventsById.get(eventId)

    if (!event) {
      return false
    }

    this.removeById(event.id)
    return true
  }

  cancelByTarget(target: SimulationEventTarget, reason?: string): number {
    void reason

    const criteria = this.getTargetCriteria(target)
    let removedCount = 0

    for (let index = this.events.length - 1; index >= 0; index -= 1) {
      const event = this.events[index]

      if (!event || !this.matchesTarget(event.target, criteria)) {
        continue
      }

      this.events.splice(index, 1)
      this.eventsById.delete(event.id)
      removedCount += 1
    }

    return removedCount
  }

  clear(): void {
    this.events.length = 0
    this.eventsById.clear()
  }

  size(): number {
    return this.events.length
  }

  getSnapshot(): EventQueueSnapshot {
    const next = this.events[0]

    return {
      size: this.size(),
      ...(next ? { nextEventAt: next.scheduledAt } : {}),
      events: this.events.map((event) => this.toSnapshotItem(event))
    }
  }

  private assertEventInput<TPayload>(input: ScheduleSimulationEventInput<TPayload>): void {
    if (!input.id.trim()) {
      throw new EventQueueError('EVENT_ID_REQUIRED', 'Event id is required')
    }

    if (this.eventsById.has(input.id)) {
      throw new EventQueueError('EVENT_ID_DUPLICATE', `Event id already exists: ${input.id}`, {
        eventId: input.id
      })
    }

    if (typeof input.type !== 'string' || !input.type.trim()) {
      throw new EventQueueError('EVENT_TYPE_REQUIRED', 'Event type is required', {
        eventId: input.id
      })
    }

    if (!Number.isFinite(input.scheduledAt) || !Number.isFinite(input.createdAt)) {
      throw new EventQueueError('EVENT_TIME_NOT_FINITE', 'Event times must be finite numbers', {
        eventId: input.id,
        scheduledAt: input.scheduledAt,
        createdAt: input.createdAt
      })
    }

    if (input.scheduledAt < 0 || input.createdAt < 0) {
      throw new EventQueueError('EVENT_TIME_NEGATIVE', 'Event times must be non-negative', {
        eventId: input.id,
        scheduledAt: input.scheduledAt,
        createdAt: input.createdAt
      })
    }

    if (input.scheduledAt < input.createdAt) {
      throw new EventQueueError(
        'EVENT_SCHEDULED_BEFORE_CREATED',
        'Event cannot be scheduled before it is created',
        {
          eventId: input.id,
          scheduledAt: input.scheduledAt,
          createdAt: input.createdAt
        }
      )
    }

    if (!Number.isFinite(input.priority)) {
      throw new EventQueueError('EVENT_PRIORITY_NOT_FINITE', 'Event priority must be a finite number', {
        eventId: input.id,
        priority: input.priority
      })
    }

    if (input.priority < 0) {
      throw new EventQueueError('EVENT_PRIORITY_NEGATIVE', 'Event priority must be non-negative', {
        eventId: input.id,
        priority: input.priority
      })
    }
  }

  private assertNow(now: number): void {
    if (!Number.isFinite(now)) {
      throw new EventQueueError('EVENT_NOW_NOT_FINITE', 'Current simulation time must be a finite number', {
        now
      })
    }

    if (now < 0) {
      throw new EventQueueError('EVENT_NOW_NEGATIVE', 'Current simulation time must be non-negative', {
        now
      })
    }
  }

  private getTargetCriteria(
    target: SimulationEventTarget
  ): Array<[keyof SimulationEventTarget, string]> {
    const criteria: Array<[keyof SimulationEventTarget, string]> = []

    for (const key of targetKeys) {
      const value = target[key]

      if (value === undefined) {
        continue
      }

      if (!value.trim()) {
        throw new EventQueueError('EVENT_TARGET_EMPTY', 'Event target must include a non-empty field', {
          target
        })
      }

      criteria.push([key, value])
    }

    if (criteria.length === 0) {
      throw new EventQueueError('EVENT_TARGET_EMPTY', 'Event target must include at least one field', {
        target
      })
    }

    return criteria
  }

  private matchesTarget(
    eventTarget: SimulationEventTarget | undefined,
    criteria: Array<[keyof SimulationEventTarget, string]>
  ): boolean {
    if (!eventTarget) {
      return false
    }

    return criteria.every(([key, value]) => eventTarget[key] === value)
  }

  private insertSorted(event: SimulationEvent): void {
    const index = this.events.findIndex((candidate) => this.compareEvents(event, candidate) < 0)

    if (index === -1) {
      this.events.push(event)
      return
    }

    this.events.splice(index, 0, event)
  }

  private compareEvents(a: SimulationEvent, b: SimulationEvent): number {
    if (a.scheduledAt !== b.scheduledAt) {
      return a.scheduledAt - b.scheduledAt
    }

    if (a.priority !== b.priority) {
      return a.priority - b.priority
    }

    return a.sequence - b.sequence
  }

  private removeById(eventId: string): void {
    const index = this.events.findIndex((event) => event.id === eventId)

    if (index >= 0) {
      this.events.splice(index, 1)
    }

    this.eventsById.delete(eventId)
  }

  private toSnapshotItem(event: SimulationEvent): EventQueueSnapshotItem {
    const sourceLabel = this.formatSourceLabel(event.source)
    const targetLabel = this.formatTargetLabel(event.target)

    return {
      id: event.id,
      type: event.type,
      scheduledAt: event.scheduledAt,
      createdAt: event.createdAt,
      priority: event.priority,
      sequence: event.sequence,
      status: event.status,
      ...(event.source ? { source: { ...event.source } } : {}),
      ...(event.target ? { target: { ...event.target } } : {}),
      ...(sourceLabel ? { sourceLabel } : {}),
      ...(targetLabel ? { targetLabel } : {})
    }
  }

  private formatSourceLabel(source: SimulationEventSource | undefined): string | undefined {
    if (!source) {
      return undefined
    }

    return source.id ? `${source.type}:${source.id}` : source.type
  }

  private formatTargetLabel(target: SimulationEventTarget | undefined): string | undefined {
    if (!target) {
      return undefined
    }

    const parts: string[] = []

    if (target.deviceId) {
      parts.push(`device:${target.deviceId}`)
    }

    if (target.moduleId) {
      parts.push(`module:${target.moduleId}`)
    }

    if (target.endpointId) {
      parts.push(`endpoint:${target.endpointId}`)
    }

    return parts.length > 0 ? parts.join(' ') : undefined
  }

  private cloneEvent<TPayload>(
    event: SimulationEvent<TPayload>,
    status: SimulationEventStatus = event.status
  ): SimulationEvent<TPayload> {
    return {
      id: event.id,
      type: event.type,
      scheduledAt: event.scheduledAt,
      createdAt: event.createdAt,
      priority: event.priority,
      sequence: event.sequence,
      payload: event.payload,
      status,
      ...(event.source ? { source: { ...event.source } } : {}),
      ...(event.target ? { target: { ...event.target } } : {}),
      ...(event.meta ? { meta: { ...event.meta } } : {})
    }
  }
}
