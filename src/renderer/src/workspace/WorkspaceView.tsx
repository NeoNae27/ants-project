import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent, type WheelEvent } from 'react'
import type {
  EventQueueSnapshot,
  SimulationClockSnapshot
} from '../../../shared/simulationRuntime'
import gatewayIconUrl from '../assets/gateway-icon.svg'
import sensorIconUrl from '../assets/sensor-icon.svg'
import type { WorkspaceDevicePreset } from '../../../shared/workspaceSession'
import { DeviceInspector } from './DeviceInspector'
import { WorkspaceNavigator } from './WorkspaceNavigator'
import type {
  AddDevicePlacement,
  WorkspaceConnectionViewMode,
  WorkspaceDevice,
  WorkspaceDeviceRole,
  WorkspaceModule,
  WorkspacePossibleConnection,
  WorkspacePoint,
  WorkspaceProject,
  WorkspaceRadioLink,
  WorkspaceSpatialGridVisibility
} from './types'
import {
  createWorkspaceConnectionLines,
  filterConnectionsForMode,
  formatRadioLinkDebugLabel,
  getRadioLinkStatusClassName
} from './workspaceConnections'

type WorkspaceViewProps = {
  project: WorkspaceProject
  devices: WorkspaceDevice[]
  selectedDeviceId: string | null
  selectedDevice: WorkspaceDevice | null
  possibleConnections: WorkspacePossibleConnection[]
  radioLinks: WorkspaceRadioLink[]
  spatialGridVisibility: WorkspaceSpatialGridVisibility
  simulationClock: SimulationClockSnapshot | null
  simulationQueue: EventQueueSnapshot | null
  addDeviceRequest: {
    id: number
    placement: AddDevicePlacement
    preset?: WorkspaceDevicePreset
  }
  pasteDeviceRequest: {
    id: number
    placement: AddDevicePlacement
  }
  onAddDeviceAt: (position: WorkspacePoint, preset?: WorkspaceDevicePreset) => void
  onPasteDeviceAt: (position: WorkspacePoint) => void
  onMoveDevice: (deviceId: string, position: WorkspacePoint) => void
  onAddModule: (deviceId: string, module: WorkspaceModule) => void
  onUpdateDeviceRole: (deviceId: string, role: WorkspaceDeviceRole) => void
  onUpdateModule: (deviceId: string, moduleId: string, module: WorkspaceModule) => void
  onRemoveModule: (deviceId: string, moduleId: string) => void
  onSelectDevice: (device: WorkspaceDevice) => void
  onClearSelection: () => void
}

type ViewTransform = {
  x: number
  y: number
  zoom: number
}

type DragState = {
  pointerId: number
  startX: number
  startY: number
  originX: number
  originY: number
  moved: boolean
}

type DeviceDragState = {
  pointerId: number
  deviceId: string
  offsetX: number
  offsetY: number
  startX: number
  startY: number
  moved: boolean
}

const WORKSPACE_PADDING = 48
const INITIAL_ZOOM = 2
const MIN_ZOOM = 1
const MAX_ZOOM = 12

function getDeviceIconUrl(device: WorkspaceDevice): string {
  return device.role === 'gateway' ? gatewayIconUrl : sensorIconUrl
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

function clampViewTransform(params: {
  project: WorkspaceProject
  viewportSize: { width: number; height: number }
  fitScale: number
  transform: ViewTransform
}): ViewTransform {
  const { project, viewportSize, fitScale, transform } = params
  const scaledWidth = project.width * fitScale * transform.zoom
  const scaledHeight = project.height * fitScale * transform.zoom

  return {
    zoom: transform.zoom,
    x:
      scaledWidth <= viewportSize.width
        ? (viewportSize.width - scaledWidth) / 2
        : clamp(transform.x, viewportSize.width - scaledWidth, 0),
    y:
      scaledHeight <= viewportSize.height
        ? (viewportSize.height - scaledHeight) / 2
        : clamp(transform.y, viewportSize.height - scaledHeight, 0)
  }
}

export function WorkspaceView({
  project,
  devices,
  selectedDeviceId,
  selectedDevice,
  possibleConnections,
  radioLinks,
  spatialGridVisibility,
  simulationClock,
  simulationQueue,
  addDeviceRequest,
  pasteDeviceRequest,
  onAddDeviceAt,
  onPasteDeviceAt,
  onMoveDevice,
  onAddModule,
  onUpdateDeviceRole,
  onUpdateModule,
  onRemoveModule,
  onSelectDevice,
  onClearSelection
}: WorkspaceViewProps): React.JSX.Element {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const dragRef = useRef<DragState | null>(null)
  const deviceDragRef = useRef<DeviceDragState | null>(null)
  const handledAddDeviceRequestIdRef = useRef(addDeviceRequest.id)
  const handledPasteDeviceRequestIdRef = useRef(pasteDeviceRequest.id)
  const cursorWorkspacePointRef = useRef<WorkspacePoint | null>(null)
  const [viewportSize, setViewportSize] = useState({ width: 0, height: 0 })
  const [viewTransform, setViewTransform] = useState<ViewTransform>({
    x: 0,
    y: 0,
    zoom: INITIAL_ZOOM
  })
  const [connectionViewMode, setConnectionViewMode] =
    useState<WorkspaceConnectionViewMode>('selected')
  const [showWirelessLinks, setShowWirelessLinks] = useState(true)
  const [showLinkDebugInfo, setShowLinkDebugInfo] = useState(false)

  useEffect(() => {
    const viewport = viewportRef.current

    if (!viewport) {
      return
    }

    const updateSize = (): void => {
      setViewportSize({
        width: viewport.clientWidth,
        height: viewport.clientHeight
      })
    }

    updateSize()

    const resizeObserver = new ResizeObserver(updateSize)
    resizeObserver.observe(viewport)

    return () => resizeObserver.disconnect()
  }, [])

  const fitScale = useMemo(() => {
    if (!viewportSize.width || !viewportSize.height) {
      return 1
    }

    const widthScale = (viewportSize.width - WORKSPACE_PADDING * 2) / project.width
    const heightScale = (viewportSize.height - WORKSPACE_PADDING * 2) / project.height

    return Math.max(0.1, Math.min(widthScale, heightScale))
  }, [project.height, project.width, viewportSize.height, viewportSize.width])

  const scale = fitScale * viewTransform.zoom
  const zoomPercent = Math.round(viewTransform.zoom * 100)
  const simulationTimeLabel = useMemo(() => {
    const totalSeconds = Math.floor((simulationClock?.virtualTimeMs ?? 0) / 1000)
    const hours = Math.floor(totalSeconds / 3600)
    const minutes = Math.floor((totalSeconds % 3600) / 60)
    const seconds = totalSeconds % 60

    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds
      .toString()
      .padStart(2, '0')}`
  }, [simulationClock?.virtualTimeMs])
  const spatialGridCellSize = useMemo(
    () => Math.max(1, Math.min(project.width, project.height, 100)),
    [project.height, project.width]
  )
  const loraSpatialGridPatternId = useMemo(
    () => `lora-spatial-grid-${project.id.replace(/[^a-zA-Z0-9_-]/g, '-')}`,
    [project.id]
  )
  const visibleConnections = useMemo(
    () =>
      filterConnectionsForMode({
        connections: possibleConnections,
        selectedDeviceId,
        mode: connectionViewMode
      }),
    [connectionViewMode, possibleConnections, selectedDeviceId]
  )
  const connectionLines = useMemo(
    () =>
      createWorkspaceConnectionLines({
        connections: visibleConnections,
        selectedDeviceId
      }),
    [selectedDeviceId, visibleConnections]
  )
  const devicesById = useMemo(() => new Map(devices.map((device) => [device.id, device])), [devices])

  const clampCurrentViewTransform = useCallback(
    (transform: ViewTransform): ViewTransform =>
      clampViewTransform({
        project,
        viewportSize,
        fitScale,
        transform
      }),
    [fitScale, project, viewportSize]
  )

  const screenToWorkspacePoint = useCallback(
    (clientX: number, clientY: number): WorkspacePoint => {
      const viewport = viewportRef.current

      if (!viewport) {
        return {
          x: project.width / 2,
          y: project.height / 2
        }
      }

      const rect = viewport.getBoundingClientRect()

      return {
        x: (clientX - rect.left - viewTransform.x) / scale,
        y: (clientY - rect.top - viewTransform.y) / scale
      }
    },
    [project.height, project.width, scale, viewTransform.x, viewTransform.y]
  )

  const getViewportCenterWorkspacePoint = useCallback(
    (): WorkspacePoint => ({
      x: (viewportSize.width / 2 - viewTransform.x) / scale,
      y: (viewportSize.height / 2 - viewTransform.y) / scale
    }),
    [scale, viewTransform.x, viewTransform.y, viewportSize.height, viewportSize.width]
  )

  useEffect(() => {
    if (!viewportSize.width || !viewportSize.height) {
      return
    }

    setViewTransform(
      clampViewTransform({
        project,
        viewportSize,
        fitScale,
        transform: {
          x: (viewportSize.width - project.width * fitScale * INITIAL_ZOOM) / 2,
          y: (viewportSize.height - project.height * fitScale * INITIAL_ZOOM) / 2,
          zoom: INITIAL_ZOOM
        }
      })
    )
  }, [fitScale, project.height, project.id, project.width, viewportSize.height, viewportSize.width])

  useEffect(() => {
    if (!viewportSize.width || !viewportSize.height) {
      return
    }

    setViewTransform((current) => clampCurrentViewTransform(current))
  }, [clampCurrentViewTransform, viewportSize.height, viewportSize.width])

  useEffect(() => {
    if (addDeviceRequest.id === handledAddDeviceRequestIdRef.current) {
      return
    }

    handledAddDeviceRequestIdRef.current = addDeviceRequest.id

    if (!viewportSize.width || !viewportSize.height) {
      onAddDeviceAt(
        {
          x: project.width / 2,
          y: project.height / 2
        },
        addDeviceRequest.preset
      )
      return
    }

    onAddDeviceAt(
      addDeviceRequest.placement === 'cursor' && cursorWorkspacePointRef.current
        ? cursorWorkspacePointRef.current
        : getViewportCenterWorkspacePoint(),
      addDeviceRequest.preset
    )
  }, [
    addDeviceRequest.id,
    addDeviceRequest.placement,
    addDeviceRequest.preset,
    getViewportCenterWorkspacePoint,
    onAddDeviceAt,
    project.height,
    project.width,
    viewportSize.height,
    viewportSize.width
  ])

  useEffect(() => {
    if (pasteDeviceRequest.id === handledPasteDeviceRequestIdRef.current) {
      return
    }

    handledPasteDeviceRequestIdRef.current = pasteDeviceRequest.id

    if (!viewportSize.width || !viewportSize.height) {
      onPasteDeviceAt({
        x: project.width / 2,
        y: project.height / 2
      })
      return
    }

    onPasteDeviceAt(
      pasteDeviceRequest.placement === 'cursor' && cursorWorkspacePointRef.current
        ? cursorWorkspacePointRef.current
        : getViewportCenterWorkspacePoint()
    )
  }, [
    getViewportCenterWorkspacePoint,
    onPasteDeviceAt,
    pasteDeviceRequest.id,
    pasteDeviceRequest.placement,
    project.height,
    project.width,
    viewportSize.height,
    viewportSize.width
  ])

  function handleWheel(event: WheelEvent<HTMLDivElement>): void {
    event.preventDefault()

    const viewport = viewportRef.current

    if (!viewport) {
      return
    }

    const rect = viewport.getBoundingClientRect()
    const pointerX = event.clientX - rect.left
    const pointerY = event.clientY - rect.top

    setViewTransform((current) => {
      const currentScale = fitScale * current.zoom
      const worldX = (pointerX - current.x) / currentScale
      const worldY = (pointerY - current.y) / currentScale
      const zoomDirection = event.deltaY > 0 ? 0.9 : 1.1
      const nextZoom = clamp(current.zoom * zoomDirection, MIN_ZOOM, MAX_ZOOM)
      const nextScale = fitScale * nextZoom

      return clampCurrentViewTransform({
        x: pointerX - worldX * nextScale,
        y: pointerY - worldY * nextScale,
        zoom: nextZoom
      })
    })
  }

  function rememberCursorPosition(event: PointerEvent<HTMLDivElement>): void {
    cursorWorkspacePointRef.current = screenToWorkspacePoint(event.clientX, event.clientY)
  }

  function handlePointerDown(event: PointerEvent<HTMLDivElement>): void {
    rememberCursorPosition(event)

    if (event.button !== 0 && event.button !== 1) {
      return
    }

    event.currentTarget.setPointerCapture(event.pointerId)
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      originX: viewTransform.x,
      originY: viewTransform.y,
      moved: false
    }
  }

  function handlePointerMove(event: PointerEvent<HTMLDivElement>): void {
    rememberCursorPosition(event)

    const drag = dragRef.current

    if (!drag || drag.pointerId !== event.pointerId) {
      return
    }

    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY

    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
      drag.moved = true
    }

    setViewTransform((current) => clampCurrentViewTransform({
      ...current,
      x: drag.originX + dx,
      y: drag.originY + dy
    }))
  }

  function handlePointerUp(event: PointerEvent<HTMLDivElement>): void {
    const drag = dragRef.current

    if (!drag || drag.pointerId !== event.pointerId) {
      return
    }

    event.currentTarget.releasePointerCapture(event.pointerId)
    dragRef.current = null

    if (!drag.moved) {
      onClearSelection()
    }
  }

  function handleDevicePointerDown(
    event: PointerEvent<HTMLButtonElement>,
    device: WorkspaceDevice
  ): void {
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)

    const pointerPosition = screenToWorkspacePoint(event.clientX, event.clientY)

    deviceDragRef.current = {
      pointerId: event.pointerId,
      deviceId: device.id,
      offsetX: pointerPosition.x - device.x,
      offsetY: pointerPosition.y - device.y,
      startX: event.clientX,
      startY: event.clientY,
      moved: false
    }

    onSelectDevice(device)
  }

  function handleDevicePointerMove(event: PointerEvent<HTMLButtonElement>): void {
    cursorWorkspacePointRef.current = screenToWorkspacePoint(event.clientX, event.clientY)

    const drag = deviceDragRef.current

    if (!drag || drag.pointerId !== event.pointerId) {
      return
    }

    event.stopPropagation()

    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY

    if (Math.abs(dx) > 2 || Math.abs(dy) > 2) {
      drag.moved = true
    }

    const pointerPosition = screenToWorkspacePoint(event.clientX, event.clientY)

    onMoveDevice(drag.deviceId, {
      x: pointerPosition.x - drag.offsetX,
      y: pointerPosition.y - drag.offsetY
    })
  }

  function handleDevicePointerUp(event: PointerEvent<HTMLButtonElement>): void {
    const drag = deviceDragRef.current

    if (!drag || drag.pointerId !== event.pointerId) {
      return
    }

    event.stopPropagation()
    event.currentTarget.releasePointerCapture(event.pointerId)
    deviceDragRef.current = null
  }

  return (
    <section className="workspace-layout">
      <div className="workspace-main">
        <WorkspaceNavigator
          devices={devices}
          connections={possibleConnections}
          radioLinks={radioLinks}
          selectedDeviceId={selectedDeviceId}
          viewMode={connectionViewMode}
          showWirelessLinks={showWirelessLinks}
          showLinkDebugInfo={showLinkDebugInfo}
          onViewModeChange={setConnectionViewMode}
          onShowWirelessLinksChange={setShowWirelessLinks}
          onShowLinkDebugInfoChange={setShowLinkDebugInfo}
          onSelectDevice={onSelectDevice}
        />

        <div
          className="workspace-viewport"
          ref={viewportRef}
          onWheel={handleWheel}
          onPointerEnter={rememberCursorPosition}
          onPointerLeave={() => {
            cursorWorkspacePointRef.current = null
          }}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onPointerCancel={handlePointerUp}
        >
          <div
            className="workspace-scene"
            style={{
              transform: `translate(${viewTransform.x}px, ${viewTransform.y}px) scale(${scale})`
            }}
          >
            <div
              className="workspace-surface"
              style={{
                width: `${project.width}px`,
                height: `${project.height}px`
              }}
            >
              {devices.length === 0 ? (
                <div className="workspace-empty">
                  <strong>Empty workspace</strong>
                  <span>Use Workspace &gt; Add Device to place a device.</span>
                </div>
              ) : null}

              {spatialGridVisibility.lora ? (
                <svg
                  className="workspace-spatial-grid-overlay workspace-spatial-grid-overlay-lora"
                  width={project.width}
                  height={project.height}
                  viewBox={`0 0 ${project.width} ${project.height}`}
                  aria-hidden="true"
                >
                  <defs>
                    <pattern
                      id={loraSpatialGridPatternId}
                      width={spatialGridCellSize}
                      height={spatialGridCellSize}
                      patternUnits="userSpaceOnUse"
                    >
                      <path
                        className="workspace-spatial-grid-line"
                        d={`M ${spatialGridCellSize} 0 L 0 0 0 ${spatialGridCellSize}`}
                      />
                    </pattern>
                  </defs>
                  <rect
                    width={project.width}
                    height={project.height}
                    fill={`url(#${loraSpatialGridPatternId})`}
                  />
                </svg>
              ) : null}

              {connectionLines.length > 0 ? (
                <svg
                  className="workspace-connection-overlay"
                  width={project.width}
                  height={project.height}
                  viewBox={`0 0 ${project.width} ${project.height}`}
                  aria-hidden="true"
                >
                  {connectionLines.map((line) => {
                    const sourceDevice = devicesById.get(line.sourceDeviceId)
                    const targetDevice = devicesById.get(line.targetDeviceId)

                    if (!sourceDevice || !targetDevice) {
                      return null
                    }

                    return (
                      <line
                        key={line.id}
                        className={line.isSelected ? 'workspace-link-line is-selected' : 'workspace-link-line'}
                        x1={sourceDevice.x}
                        y1={sourceDevice.y}
                        x2={targetDevice.x}
                        y2={targetDevice.y}
                      />
                    )
                  })}
                </svg>
              ) : null}

              {showWirelessLinks && radioLinks.length > 0 ? (
                <svg
                  className="workspace-radio-link-overlay"
                  width={project.width}
                  height={project.height}
                  viewBox={`0 0 ${project.width} ${project.height}`}
                  aria-hidden="true"
                >
                  {radioLinks.map((link) => {
                    const sourceDevice = devicesById.get(link.sourceDeviceId)
                    const targetDevice = devicesById.get(link.targetDeviceId)

                    if (!sourceDevice || !targetDevice) {
                      return null
                    }

                    const labelX = (sourceDevice.x + targetDevice.x) / 2
                    const labelY = (sourceDevice.y + targetDevice.y) / 2
                    const statusClassName = getRadioLinkStatusClassName(link.status)

                    return (
                      <g key={link.id}>
                        <line
                          className={`workspace-radio-link-line ${statusClassName}`}
                          x1={sourceDevice.x}
                          y1={sourceDevice.y}
                          x2={targetDevice.x}
                          y2={targetDevice.y}
                        >
                          <title>{formatRadioLinkDebugLabel(link)}</title>
                        </line>
                        {showLinkDebugInfo ? (
                          <text
                            className={`workspace-radio-link-label ${statusClassName}`}
                            x={labelX}
                            y={labelY - 8}
                            textAnchor="middle"
                          >
                            {formatRadioLinkDebugLabel(link)}
                          </text>
                        ) : null}
                      </g>
                    )
                  })}
                </svg>
              ) : null}

              {devices.map((device) => {
                const isSelected = device.id === selectedDeviceId

                return (
                  <button
                    key={device.id}
                    className={`workspace-device workspace-device-${device.role}${isSelected ? ' is-selected' : ''}`}
                    type="button"
                    style={{
                      left: `${device.x}px`,
                      top: `${device.y}px`
                    }}
                    aria-label={device.name}
                    title={`${device.name}: x=${device.x}, y=${device.y}`}
                    onPointerDown={(event) => handleDevicePointerDown(event, device)}
                    onPointerMove={handleDevicePointerMove}
                    onPointerUp={handleDevicePointerUp}
                    onPointerCancel={handleDevicePointerUp}
                    onClick={(event) => {
                      event.stopPropagation()
                      onSelectDevice(device)
                    }}
                  >
                    <img
                      className="workspace-device-icon"
                      src={getDeviceIconUrl(device)}
                      alt=""
                      draggable={false}
                    />
                  </button>
                )
              })}
            </div>
          </div>
        </div>

        <DeviceInspector
          device={selectedDevice}
          simulationClock={simulationClock}
          simulationQueue={simulationQueue}
          onAddModule={onAddModule}
          onUpdateDeviceRole={onUpdateDeviceRole}
          onUpdateModule={onUpdateModule}
          onRemoveModule={onRemoveModule}
        />
      </div>

      <footer className="workspace-status">
        <span className="status-item">
          {project.width} x {project.height}
        </span>
        <span className="status-item">Unit: 1 = {project.unitScaleMeters} m</span>
        <span className="status-item">Zoom: {zoomPercent}%</span>
        <span className="status-item">Links: {visibleConnections.length}</span>
        <span className="status-item">Radio: {radioLinks.length}</span>
        <span className="status-item">
          Simulation: {simulationClock?.state ?? 'stopped'} {simulationTimeLabel} x{simulationClock?.speed ?? 1}
        </span>
      </footer>
    </section>
  )
}
