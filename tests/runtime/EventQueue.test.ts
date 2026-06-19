import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  EventQueueError,
  InMemoryEventQueue,
  type EventQueueErrorCode,
  type ScheduleSimulationEventInput,
  type SimulationEventType
} from '../../src/engine/runtime/events'

function createInput(
  overrides: Partial<ScheduleSimulationEventInput> = {}
): ScheduleSimulationEventInput {
  return {
    id: 'event-a',
    type: 'scenario.step',
    scheduledAt: 10,
    createdAt: 0,
    priority: 0,
    payload: { value: 'payload' },
    ...overrides
  }
}

function assertEventQueueError(error: unknown, code: EventQueueErrorCode): void {
  assert.ok(error instanceof EventQueueError)
  assert.equal(error.code, code)
}

describe('InMemoryEventQueue', () => {
  it('schedules an event with sequence and scheduled status', () => {
    const queue = new InMemoryEventQueue()

    const event = queue.schedule(createInput({ id: 'event-1' }))

    assert.equal(event.id, 'event-1')
    assert.equal(event.sequence, 1)
    assert.equal(event.status, 'scheduled')
    assert.equal(queue.size(), 1)
  })

  it('orders events by scheduled time, priority, and stable insertion sequence', () => {
    const queue = new InMemoryEventQueue()

    queue.schedule(createInput({ id: 'later', scheduledAt: 20, priority: 0 }))
    queue.schedule(createInput({ id: 'stable-a', scheduledAt: 10, priority: 2 }))
    queue.schedule(createInput({ id: 'priority-first', scheduledAt: 10, priority: 1 }))
    queue.schedule(createInput({ id: 'stable-b', scheduledAt: 10, priority: 2 }))

    const dueEvents = queue.popDueEvents(20)

    assert.deepEqual(
      dueEvents.map((event) => event.id),
      ['priority-first', 'stable-a', 'stable-b', 'later']
    )
  })

  it('peeks next event without removing it', () => {
    const queue = new InMemoryEventQueue()

    queue.schedule(createInput({ id: 'later', scheduledAt: 20 }))
    queue.schedule(createInput({ id: 'next', scheduledAt: 5 }))

    const next = queue.peekNext()

    assert.equal(next?.id, 'next')
    assert.equal(next?.status, 'scheduled')
    assert.equal(queue.size(), 2)
  })

  it('pops only due events and returns them as processed copies', () => {
    const queue = new InMemoryEventQueue()

    queue.schedule(createInput({ id: 'due-a', scheduledAt: 5 }))
    queue.schedule(createInput({ id: 'due-b', scheduledAt: 10 }))
    queue.schedule(createInput({ id: 'future', scheduledAt: 15 }))

    const dueEvents = queue.popDueEvents(10)

    assert.deepEqual(
      dueEvents.map((event) => event.id),
      ['due-a', 'due-b']
    )
    assert.deepEqual(
      dueEvents.map((event) => event.status),
      ['processed', 'processed']
    )
    assert.equal(queue.size(), 1)
    assert.equal(queue.peekNext()?.id, 'future')
  })

  it('allows immediate events where scheduledAt equals createdAt', () => {
    const queue = new InMemoryEventQueue()

    queue.schedule(createInput({ id: 'immediate', scheduledAt: 5, createdAt: 5 }))

    assert.equal(queue.peekNext()?.id, 'immediate')
  })

  it('cancels events by id', () => {
    const queue = new InMemoryEventQueue()

    queue.schedule(createInput({ id: 'cancelled' }))
    queue.schedule(createInput({ id: 'remaining' }))

    assert.equal(queue.cancel('cancelled', 'not needed'), true)
    assert.equal(queue.cancel('missing'), false)
    assert.equal(queue.size(), 1)
    assert.deepEqual(
      queue.popDueEvents(10).map((event) => event.id),
      ['remaining']
    )
  })

  it('cancels events by a single target field', () => {
    const queue = new InMemoryEventQueue()

    queue.schedule(createInput({ id: 'device-a-1', target: { deviceId: 'device-a' } }))
    queue.schedule(
      createInput({
        id: 'device-a-2',
        target: { deviceId: 'device-a', moduleId: 'module-b', endpointId: 'endpoint-b' }
      })
    )
    queue.schedule(createInput({ id: 'device-b', target: { deviceId: 'device-b' } }))
    queue.schedule(createInput({ id: 'no-target' }))

    assert.equal(queue.cancelByTarget({ deviceId: 'device-a' }, 'device removed'), 2)
    assert.deepEqual(
      queue.popDueEvents(10).map((event) => event.id),
      ['device-b', 'no-target']
    )
  })

  it('cancels events by moduleId, endpointId, and target combinations', () => {
    const queue = new InMemoryEventQueue()

    queue.schedule(
      createInput({
        id: 'target-match',
        target: { deviceId: 'device-a', moduleId: 'module-a', endpointId: 'endpoint-a' }
      })
    )
    queue.schedule(
      createInput({
        id: 'same-module-other-device',
        target: { deviceId: 'device-b', moduleId: 'module-a', endpointId: 'endpoint-b' }
      })
    )
    queue.schedule(
      createInput({
        id: 'endpoint-only-match',
        target: { deviceId: 'device-c', moduleId: 'module-c', endpointId: 'endpoint-c' }
      })
    )

    assert.equal(queue.cancelByTarget({ endpointId: 'endpoint-c' }), 1)
    assert.equal(queue.cancelByTarget({ deviceId: 'device-a', moduleId: 'module-a' }), 1)
    assert.deepEqual(
      queue.popDueEvents(10).map((event) => event.id),
      ['same-module-other-device']
    )
  })

  it('clears the queue', () => {
    const queue = new InMemoryEventQueue()

    queue.schedule(createInput({ id: 'event-1' }))
    queue.schedule(createInput({ id: 'event-2' }))

    queue.clear()

    assert.equal(queue.size(), 0)
    assert.equal(queue.peekNext(), undefined)
    assert.deepEqual(queue.popDueEvents(10), [])
  })

  it('returns a structured snapshot for debug UI', () => {
    const queue = new InMemoryEventQueue()

    queue.schedule(
      createInput({
        id: 'debug-event',
        type: 'wireless.packet_delivery',
        scheduledAt: 25,
        createdAt: 5,
        priority: 3,
        source: { type: 'device', id: 'device-a' },
        target: {
          deviceId: 'device-b',
          moduleId: 'module-b',
          endpointId: 'endpoint-b'
        }
      })
    )

    const snapshot = queue.getSnapshot()

    assert.equal(snapshot.size, 1)
    assert.equal(snapshot.nextEventAt, 25)
    assert.deepEqual(snapshot.events, [
      {
        id: 'debug-event',
        type: 'wireless.packet_delivery',
        scheduledAt: 25,
        createdAt: 5,
        priority: 3,
        sequence: 1,
        status: 'scheduled',
        source: { type: 'device', id: 'device-a' },
        target: {
          deviceId: 'device-b',
          moduleId: 'module-b',
          endpointId: 'endpoint-b'
        },
        sourceLabel: 'device:device-a',
        targetLabel: 'device:device-b module:module-b endpoint:endpoint-b'
      }
    ])
  })

  it('rejects invalid schedule input', () => {
    const invalidType = '' as SimulationEventType

    assert.throws(
      () => new InMemoryEventQueue().schedule(createInput({ id: ' ' })),
      (error) => {
        assertEventQueueError(error, 'EVENT_ID_REQUIRED')
        return true
      }
    )

    assert.throws(
      () => new InMemoryEventQueue().schedule(createInput({ type: invalidType })),
      (error) => {
        assertEventQueueError(error, 'EVENT_TYPE_REQUIRED')
        return true
      }
    )

    assert.throws(
      () => new InMemoryEventQueue().schedule(createInput({ scheduledAt: Number.NaN })),
      (error) => {
        assertEventQueueError(error, 'EVENT_TIME_NOT_FINITE')
        return true
      }
    )

    assert.throws(
      () => new InMemoryEventQueue().schedule(createInput({ createdAt: Number.POSITIVE_INFINITY })),
      (error) => {
        assertEventQueueError(error, 'EVENT_TIME_NOT_FINITE')
        return true
      }
    )

    assert.throws(
      () => new InMemoryEventQueue().schedule(createInput({ scheduledAt: -1 })),
      (error) => {
        assertEventQueueError(error, 'EVENT_TIME_NEGATIVE')
        return true
      }
    )

    assert.throws(
      () => new InMemoryEventQueue().schedule(createInput({ createdAt: 5, scheduledAt: 4 })),
      (error) => {
        assertEventQueueError(error, 'EVENT_SCHEDULED_BEFORE_CREATED')
        return true
      }
    )

    assert.throws(
      () => new InMemoryEventQueue().schedule(createInput({ priority: Number.NaN })),
      (error) => {
        assertEventQueueError(error, 'EVENT_PRIORITY_NOT_FINITE')
        return true
      }
    )

    assert.throws(
      () => new InMemoryEventQueue().schedule(createInput({ priority: -1 })),
      (error) => {
        assertEventQueueError(error, 'EVENT_PRIORITY_NEGATIVE')
        return true
      }
    )
  })

  it('rejects duplicate scheduled ids', () => {
    const queue = new InMemoryEventQueue()

    queue.schedule(createInput({ id: 'duplicate' }))

    assert.throws(
      () => queue.schedule(createInput({ id: 'duplicate' })),
      (error) => {
        assertEventQueueError(error, 'EVENT_ID_DUPLICATE')
        return true
      }
    )
  })

  it('rejects invalid now values', () => {
    const queue = new InMemoryEventQueue()

    assert.throws(
      () => queue.popDueEvents(Number.NaN),
      (error) => {
        assertEventQueueError(error, 'EVENT_NOW_NOT_FINITE')
        return true
      }
    )

    assert.throws(
      () => queue.popDueEvents(-1),
      (error) => {
        assertEventQueueError(error, 'EVENT_NOW_NEGATIVE')
        return true
      }
    )
  })

  it('rejects empty cancellation targets', () => {
    const queue = new InMemoryEventQueue()

    assert.throws(
      () => queue.cancelByTarget({}),
      (error) => {
        assertEventQueueError(error, 'EVENT_TARGET_EMPTY')
        return true
      }
    )

    assert.throws(
      () => queue.cancelByTarget({ endpointId: ' ' }),
      (error) => {
        assertEventQueueError(error, 'EVENT_TARGET_EMPTY')
        return true
      }
    )
  })
})
