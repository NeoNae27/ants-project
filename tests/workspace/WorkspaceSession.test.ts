import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { WorkspaceSession, WorkspaceSessionManager } from '../../src/engine/application/workspace'
import type { WorkspaceCommandResult } from '../../src/shared/workspaceSession'

const loraTemplate = {
  kind: 'network' as const,
  name: 'LoRa network',
  model: 'SX1276 Stub',
  communication: {
    protocol: 'lora' as const,
    maxRangeMeters: 10_000,
    maxConnections: 8,
    spreadingFactor: 12 as const,
    bandwidthHz: 125_000,
    txPowerDbm: 14,
    codingRate: '4/5' as const,
    sourceLabel: 'preset',
  },
}

function createProject(session = new WorkspaceSession()): WorkspaceCommandResult {
  return session.dispatch({
    type: 'workspace/create-project',
    name: 'Test project',
    width: 1000,
    height: 1000,
    metersPerUnit: 10,
  })
}

function assertOk(result: WorkspaceCommandResult): asserts result is WorkspaceCommandResult & { ok: true } {
  assert.equal(result.ok, true, result.error?.message)
}

describe('WorkspaceSession', () => {
  it('returns command result envelope for createProject and getSnapshot', () => {
    const session = new WorkspaceSession()
    const created = createProject(session)

    assertOk(created)
    assert.equal(created.snapshot?.name, 'Test project')
    assert.equal(created.events[0].type, 'workspace.project.created')

    const snapshot = session.dispatch({ type: 'workspace/get-snapshot' })

    assertOk(snapshot)
    assert.equal(snapshot.snapshot?.id, created.snapshot?.id)
  })

  it('adds, moves and deletes devices through Workspace', () => {
    const session = new WorkspaceSession()
    createProject(session)

    const added = session.dispatch({
      type: 'workspace/add-device',
      position: { x: 100, y: 100 },
    })

    assertOk(added)
    const deviceId = added.snapshot?.devices[0].id
    assert.ok(deviceId)
    assert.deepEqual(added.snapshot?.devices[0].position, { x: 100, y: 100 })

    const moved = session.dispatch({
      type: 'workspace/move-device',
      deviceId,
      position: { x: 150, y: 150 },
    })

    assertOk(moved)
    assert.deepEqual(moved.snapshot?.devices[0].position, { x: 150, y: 150 })

    const deleted = session.dispatch({
      type: 'workspace/delete-device',
      deviceId,
    })

    assertOk(deleted)
    assert.equal(deleted.snapshot?.devices.length, 0)
  })

  it('adds and updates real LoRa modules and calculates possible links', () => {
    const session = new WorkspaceSession()
    createProject(session)

    const source = session.dispatch({
      type: 'workspace/add-device',
      position: { x: 100, y: 100 },
      modules: [loraTemplate],
    })
    const target = session.dispatch({
      type: 'workspace/add-device',
      position: { x: 110, y: 100 },
      modules: [loraTemplate],
    })

    assertOk(source)
    assertOk(target)
    assert.equal(target.snapshot?.possibleConnections.length, 2)

    const deviceId = target.snapshot?.devices[0].id
    const moduleId = target.snapshot?.devices[0].modules[0].id
    assert.ok(deviceId)
    assert.ok(moduleId)

    const updated = session.dispatch({
      type: 'workspace/update-module',
      deviceId,
      moduleId,
      patch: {
        communication: {
          spreadingFactor: 7,
          codingRate: '4/8',
          maxRangeMeters: 50,
          maxConnections: 1,
        },
      },
    })

    assertOk(updated)
    assert.equal(updated.snapshot?.devices[0].modules[0].communication?.spreadingFactor, 7)
    assert.equal(updated.snapshot?.devices[0].modules[0].communication?.codingRate, '4/8')
    assert.equal(updated.snapshot?.devices[0].modules[0].communication?.maxRangeMeters, 50)
    assert.equal(updated.snapshot?.devices[0].modules[0].communication?.maxConnections, 1)
  })

  it('limits possible LoRa links by maxConnections per source module', () => {
    const session = new WorkspaceSession()
    createProject(session)

    const limitedTemplate = {
      ...loraTemplate,
      communication: {
        ...loraTemplate.communication,
        maxConnections: 1,
      },
    }

    const source = session.dispatch({
      type: 'workspace/add-device',
      position: { x: 100, y: 100 },
      modules: [limitedTemplate],
    })

    assertOk(source)
    const sourceId = source.snapshot?.devices[0].id
    assert.ok(sourceId)

    assertOk(
      session.dispatch({
        type: 'workspace/add-device',
        position: { x: 200, y: 100 },
        modules: [loraTemplate],
      }),
    )
    const snapshot = session.dispatch({
      type: 'workspace/add-device',
      position: { x: 300, y: 100 },
      modules: [loraTemplate],
    })

    assertOk(snapshot)

    const sourceLinks = snapshot.snapshot?.possibleConnections.filter(
      (connection) => connection.sourceDeviceId === sourceId,
    )

    assert.equal(sourceLinks?.length, 1)
    assert.equal(sourceLinks?.[0].distanceUnits, 100)
  })

  it('adds stub modules for non-LoRa templates', () => {
    const session = new WorkspaceSession()
    createProject(session)
    const addedDevice = session.dispatch({
      type: 'workspace/add-device',
      position: { x: 100, y: 100 },
    })

    assertOk(addedDevice)
    const deviceId = addedDevice.snapshot?.devices[0].id
    assert.ok(deviceId)

    const addedModule = session.dispatch({
      type: 'workspace/add-module',
      deviceId,
      template: {
        kind: 'sensor',
        name: 'Environmental sensor',
        model: 'BME280 Stub',
      },
    })

    assertOk(addedModule)
    assert.equal(addedModule.snapshot?.devices[0].modules[0].kind, 'sensor')
  })

  it('assigns LoRa addresses and rejects duplicates', () => {
    const session = new WorkspaceSession()
    createProject(session)
    const first = session.dispatch({ type: 'workspace/add-device', position: { x: 100, y: 100 } })
    const second = session.dispatch({ type: 'workspace/add-device', position: { x: 200, y: 200 } })

    assertOk(first)
    assertOk(second)
    const firstId = second.snapshot?.devices[0].id
    const secondId = second.snapshot?.devices[1].id
    assert.ok(firstId)
    assert.ok(secondId)

    const assigned = session.dispatch({
      type: 'workspace/assign-device-lora-address',
      deviceId: firstId,
      loraAddress: 'lora-node-1',
    })

    assertOk(assigned)
    assert.equal(assigned.snapshot?.devices[0].address, 'lora-node-1')

    const duplicate = session.dispatch({
      type: 'workspace/assign-device-lora-address',
      deviceId: secondId,
      loraAddress: 'lora-node-1',
    })

    assert.equal(duplicate.ok, false)
    assert.equal(duplicate.error?.code, 'REGISTRY_ADDRESS_ALREADY_EXISTS')
  })

  it('copies and pastes devices with fresh ids', () => {
    const session = new WorkspaceSession()
    createProject(session)
    const added = session.dispatch({
      type: 'workspace/add-device',
      position: { x: 100, y: 100 },
      modules: [loraTemplate],
    })

    assertOk(added)
    const sourceId = added.snapshot?.devices[0].id
    assert.ok(sourceId)

    assertOk(session.dispatch({ type: 'workspace/copy-device', deviceId: sourceId }))
    const pasted = session.dispatch({
      type: 'workspace/paste-device',
      position: { x: 100, y: 100 },
    })

    assertOk(pasted)
    assert.equal(pasted.snapshot?.devices.length, 2)
    assert.notEqual(pasted.snapshot?.devices[0].id, pasted.snapshot?.devices[1].id)
    assert.notEqual(pasted.snapshot?.devices[0].modules[0].id, pasted.snapshot?.devices[1].modules[0].id)
  })

  it('returns validation result through unified result format', () => {
    const session = new WorkspaceSession()
    createProject(session)

    const result = session.dispatch({ type: 'workspace/validate-project' })

    assertOk(result)
    assert.equal(result.validation?.valid, true)
    assert.ok(result.snapshot)
  })
})

describe('WorkspaceSessionManager', () => {
  it('rejects commands without active session', () => {
    const manager = new WorkspaceSessionManager()
    const result = manager.dispatch({
      type: 'workspace/add-device',
      position: { x: 10, y: 10 },
    })

    assert.equal(result.ok, false)
    assert.equal(result.error?.code, 'WORKSPACE_SESSION_NOT_READY')
  })

  it('creates and replaces current sessions via createProject', () => {
    const manager = new WorkspaceSessionManager()
    const first = manager.dispatch({
      type: 'workspace/create-project',
      name: 'First',
      width: 100,
      height: 100,
    })
    const second = manager.dispatch({
      type: 'workspace/create-project',
      name: 'Second',
      width: 200,
      height: 200,
    })

    assertOk(first)
    assertOk(second)
    assert.equal(manager.hasSession(), true)
    assert.equal(second.snapshot?.name, 'Second')
    assert.notEqual(first.snapshot?.id, second.snapshot?.id)
  })

  it('forwards commands to the active session and never returns raw snapshots', () => {
    const manager = new WorkspaceSessionManager()

    assertOk(
      manager.dispatch({
        type: 'workspace/create-project',
        name: 'Project',
        width: 1000,
        height: 1000,
      }),
    )

    const result = manager.dispatch({
      type: 'workspace/add-device',
      position: { x: 100, y: 100 },
    })

    assertOk(result)
    assert.equal(typeof result.ok, 'boolean')
    assert.ok(Array.isArray(result.events))
    assert.equal(result.snapshot?.devices.length, 1)
  })
})
