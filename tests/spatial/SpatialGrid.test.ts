import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { SpatialGrid, SpatialIndexError } from '../../src/engine/domain/spatial'

function createGrid(): SpatialGrid {
  return new SpatialGrid({
    width: 1000,
    height: 1000,
    metersPerUnit: 10,
    cellSize: 100
  })
}

function assertSpatialError(error: unknown, code: string): void {
  assert.ok(error instanceof SpatialIndexError)
  assert.equal(error.code, code)
}

describe('SpatialGrid', () => {
  it('creates grid with valid config', () => {
    const grid = createGrid()

    assert.equal(grid.size(), 0)
    assert.deepEqual(grid.getStats(), {
      deviceCount: 0,
      cellCount: 0,
      maxDevicesInCell: 0,
      averageDevicesPerCell: 0,
      cellSize: 100
    })
  })

  it('rejects invalid config', () => {
    assert.throws(
      () =>
        new SpatialGrid({
          width: 0,
          height: 1000,
          metersPerUnit: 10,
          cellSize: 100
        }),
      (error) => {
        assertSpatialError(error, 'SPATIAL_CONFIG_INVALID')
        return true
      }
    )

    assert.throws(
      () =>
        new SpatialGrid({
          width: 1000,
          height: 1000,
          metersPerUnit: 10,
          cellSize: 0
        }),
      (error) => {
        assertSpatialError(error, 'SPATIAL_CELL_SIZE_INVALID')
        return true
      }
    )
  })

  it('inserts a device and returns copied position', () => {
    const grid = createGrid()
    const position = { x: 120, y: 160 }

    grid.insert('device-a', position)
    position.x = 999

    assert.equal(grid.size(), 1)
    assert.deepEqual(grid.getPosition('device-a'), { x: 120, y: 160 })
  })

  it('rejects duplicate devices and out-of-bounds positions', () => {
    const grid = createGrid()

    grid.insert('device-a', { x: 120, y: 160 })

    assert.throws(
      () => grid.insert('device-a', { x: 200, y: 200 }),
      (error) => {
        assertSpatialError(error, 'SPATIAL_DEVICE_ALREADY_EXISTS')
        return true
      }
    )

    assert.throws(
      () => grid.insert('device-b', { x: 1001, y: 200 }),
      (error) => {
        assertSpatialError(error, 'SPATIAL_POSITION_OUT_OF_BOUNDS')
        return true
      }
    )
  })

  it('updates a device inside the same cell and another cell', () => {
    const grid = createGrid()

    grid.insert('device-a', { x: 120, y: 160 })
    grid.update('device-a', { x: 130, y: 170 })

    assert.deepEqual(grid.getPosition('device-a'), { x: 130, y: 170 })
    assert.equal(grid.getStats().cellCount, 1)

    grid.update('device-a', { x: 260, y: 320 })

    assert.deepEqual(grid.getPosition('device-a'), { x: 260, y: 320 })
    assert.equal(grid.getStats().cellCount, 1)
  })

  it('removes a device and deletes empty cell', () => {
    const grid = createGrid()

    grid.insert('device-a', { x: 120, y: 160 })
    grid.remove('device-a')

    assert.equal(grid.size(), 0)
    assert.equal(grid.getStats().cellCount, 0)
    assert.equal(grid.getPosition('device-a'), undefined)
  })

  it('finds nearby devices in same and neighbor cells with exact circular filtering', () => {
    const grid = createGrid()

    grid.insert('source', { x: 100, y: 100 })
    grid.insert('same-cell', { x: 130, y: 140 })
    grid.insert('neighbor-cell', { x: 210, y: 100 })
    grid.insert('outside-circle', { x: 190, y: 190 })

    const nearby = grid.findNearby({ x: 100, y: 100 }, 110)

    assert.deepEqual(new Set(nearby), new Set(['source', 'same-cell', 'neighbor-cell']))
  })

  it('returns distance in units and meters', () => {
    const grid = createGrid()

    grid.insert('device-a', { x: 3, y: 4 })

    const [result] = grid.findNearbyWithDistance({ x: 0, y: 0 }, 5)

    assert.equal(result.deviceId, 'device-a')
    assert.equal(result.distanceUnits, 5)
    assert.equal(result.distanceMeters, 50)
  })

  it('returns empty array when no devices are nearby', () => {
    const grid = createGrid()

    grid.insert('device-a', { x: 900, y: 900 })

    assert.deepEqual(grid.findNearby({ x: 100, y: 100 }, 50), [])
  })

  it('reports stats after insert and remove', () => {
    const grid = createGrid()

    grid.insert('device-a', { x: 10, y: 10 })
    grid.insert('device-b', { x: 20, y: 20 })
    grid.insert('device-c', { x: 250, y: 250 })

    assert.deepEqual(grid.getStats(), {
      deviceCount: 3,
      cellCount: 2,
      maxDevicesInCell: 2,
      averageDevicesPerCell: 1.5,
      cellSize: 100
    })

    grid.remove('device-a')

    assert.deepEqual(grid.getStats(), {
      deviceCount: 2,
      cellCount: 2,
      maxDevicesInCell: 1,
      averageDevicesPerCell: 1,
      cellSize: 100
    })
  })

  it('allows boundary positions and boundary queries', () => {
    const grid = createGrid()

    grid.insert('edge', { x: 1000, y: 1000 })

    assert.deepEqual(grid.findNearby({ x: 1000, y: 1000 }, 1), ['edge'])
  })

  it('rejects invalid range and unknown update/remove', () => {
    const grid = createGrid()

    assert.throws(
      () => grid.findNearby({ x: 0, y: 0 }, 0),
      (error) => {
        assertSpatialError(error, 'SPATIAL_RANGE_INVALID')
        return true
      }
    )

    assert.throws(
      () => grid.update('missing', { x: 0, y: 0 }),
      (error) => {
        assertSpatialError(error, 'SPATIAL_DEVICE_NOT_FOUND')
        return true
      }
    )

    assert.throws(
      () => grid.remove('missing'),
      (error) => {
        assertSpatialError(error, 'SPATIAL_DEVICE_NOT_FOUND')
        return true
      }
    )
  })
})
