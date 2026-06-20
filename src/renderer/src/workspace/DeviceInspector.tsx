import { useState } from 'react'
import type {
  EventQueueSnapshot,
  SimulationClockSnapshot
} from '../../../shared/simulationRuntime'
import type { WorkspaceCommunicationConfig, WorkspaceDevice, WorkspaceModule } from './types'
import { ModuleCatalogDialog } from './ModuleCatalogDialog'

type DeviceInspectorProps = {
  device: WorkspaceDevice | null
  simulationClock: SimulationClockSnapshot | null
  simulationQueue: EventQueueSnapshot | null
  onAddModule: (deviceId: string, module: WorkspaceModule) => void
  onUpdateModule: (deviceId: string, moduleId: string, module: WorkspaceModule) => void
  onRemoveModule: (deviceId: string, moduleId: string) => void
}

type InspectorSectionId = 'queue' | 'general' | 'config' | 'modules' | 'statistics'

function InfoRow({ label, value }: { label: string; value: string | number }): React.JSX.Element {
  return (
    <div className="inspector-row">
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

function formatMs(value: number): string {
  return `${value.toLocaleString()} ms`
}

function formatMeters(value: number): string {
  return value >= 1000 ? `${(value / 1000).toFixed(1)} km` : `${value} m`
}

function formatTaskTime(value: number): string {
  return `${Math.round(value).toLocaleString()} ms`
}

function formatTaskDueIn(eventScheduledAt: number, simulationClock: SimulationClockSnapshot | null): string {
  const nowMs = simulationClock?.virtualTimeMs ?? 0
  const dueInMs = eventScheduledAt - nowMs

  if (dueInMs <= 0) {
    return 'due now'
  }

  return `in ${formatTaskTime(dueInMs)}`
}

const spreadingFactorOptions: WorkspaceCommunicationConfig['spreadingFactor'][] = [7, 8, 9, 10, 11, 12]
const codingRateOptions: WorkspaceCommunicationConfig['codingRate'][] = ['4/5', '4/6', '4/7', '4/8']
const bandwidthOptions = [125_000, 250_000, 500_000]

export function DeviceInspector({
  device,
  simulationClock,
  simulationQueue,
  onAddModule,
  onUpdateModule,
  onRemoveModule
}: DeviceInspectorProps): React.JSX.Element {
  const [isModuleDialogOpen, setIsModuleDialogOpen] = useState(false)
  const [collapsedSections, setCollapsedSections] = useState<Record<InspectorSectionId, boolean>>({
    queue: false,
    general: false,
    config: false,
    modules: false,
    statistics: false
  })

  function toggleSection(sectionId: InspectorSectionId): void {
    setCollapsedSections((currentSections) => ({
      ...currentSections,
      [sectionId]: !currentSections[sectionId]
    }))
  }

  function handleAddModule(module: WorkspaceModule): void {
    if (!device) {
      return
    }

    onAddModule(device.id, module)
    setIsModuleDialogOpen(false)
  }

  function updateModuleCommunication(
    module: WorkspaceModule,
    nextCommunication: WorkspaceCommunicationConfig
  ): void {
    if (!device) {
      return
    }

    onUpdateModule(device.id, module.id, {
      ...module,
      communication: nextCommunication
    })
  }

  function patchModuleCommunication(
    module: WorkspaceModule,
    patch: Partial<WorkspaceCommunicationConfig>
  ): void {
    if (!module.communication) {
      return
    }

    updateModuleCommunication(module, {
      ...module.communication,
      ...patch
    })
  }

  function removeModule(moduleId: string): void {
    if (!device) {
      return
    }

    onRemoveModule(device.id, moduleId)
  }

  return (
    <aside className="device-inspector" aria-label="Device inspector">
      <header className="inspector-header">
        <span>INSPECTOR</span>
      </header>

      <div className="inspector-content">
        <section className="inspector-section">
          <div className="inspector-section-header">
            <button
              className="side-section-toggle"
              type="button"
              aria-expanded={!collapsedSections.queue}
              onClick={() => toggleSection('queue')}
            >
              <span className={collapsedSections.queue ? 'section-caret is-collapsed' : 'section-caret'} />
              <h2>Task Queue</h2>
            </button>
            <span className="queue-count">{simulationQueue?.size ?? 0}</span>
          </div>

          {!collapsedSections.queue ? (
            simulationQueue && simulationQueue.events.length > 0 ? (
              <div className="queue-list">
                <div className="queue-summary">
                  <span>Next</span>
                  <strong>
                    {simulationQueue.nextEventAt !== undefined
                      ? formatTaskTime(simulationQueue.nextEventAt)
                      : 'none'}
                  </strong>
                </div>
                {simulationQueue.events.map((event) => (
                  <div className="queue-task" key={event.id}>
                    <div className="queue-task-header">
                      <strong title={event.type}>{event.type}</strong>
                      <span>{formatTaskDueIn(event.scheduledAt, simulationClock)}</span>
                    </div>
                    <span title={event.id}>{event.id}</span>
                    <dl className="queue-task-meta">
                      <div>
                        <dt>At</dt>
                        <dd>{formatTaskTime(event.scheduledAt)}</dd>
                      </div>
                      <div>
                        <dt>Priority</dt>
                        <dd>{event.priority}</dd>
                      </div>
                    </dl>
                  </div>
                ))}
              </div>
            ) : (
              <div className="inspector-empty-line">No queued tasks</div>
            )
          ) : null}
        </section>

        {device ? (
          <>
            <section className="inspector-section">
              <button
                className="side-section-toggle"
                type="button"
                aria-expanded={!collapsedSections.general}
                onClick={() => toggleSection('general')}
              >
                <span className={collapsedSections.general ? 'section-caret is-collapsed' : 'section-caret'} />
                <h2>General</h2>
              </button>
              {!collapsedSections.general ? (
                <>
                  <InfoRow label="Name" value={device.name} />
                  <InfoRow label="ID" value={device.id} />
                  <InfoRow label="Model" value={device.model} />
                  <InfoRow label="Role" value={device.role} />
                  <InfoRow label="Status" value={device.status} />
                  <InfoRow label="State" value={device.executionState} />
                </>
              ) : null}
            </section>

          <section className="inspector-section">
            <button
              className="side-section-toggle"
              type="button"
              aria-expanded={!collapsedSections.config}
              onClick={() => toggleSection('config')}
            >
              <span className={collapsedSections.config ? 'section-caret is-collapsed' : 'section-caret'} />
              <h2>Config</h2>
            </button>
            {!collapsedSections.config ? (
              <>
                <InfoRow label="Heartbeat" value={formatMs(device.config.heartbeatIntervalMs)} />
                <InfoRow label="Transmission" value={formatMs(device.config.transmissionIntervalMs)} />
                <InfoRow label="Max retries" value={device.config.maxRetries} />
                <InfoRow label="Power mode" value={device.config.powerMode} />
              </>
            ) : null}
          </section>

          <section className="inspector-section">
            <div className="inspector-section-header">
              <button
                className="side-section-toggle"
                type="button"
                aria-expanded={!collapsedSections.modules}
                onClick={() => toggleSection('modules')}
              >
                <span className={collapsedSections.modules ? 'section-caret is-collapsed' : 'section-caret'} />
                <h2>Modules</h2>
              </button>
              <button
                className="inspector-icon-button"
                type="button"
                title="Add module"
                aria-label="Add module"
                onClick={() => setIsModuleDialogOpen(true)}
              >
                +
              </button>
            </div>

            {!collapsedSections.modules && device.modules.length > 0 ? (
              <div className="module-list">
                {device.modules.map((module) => (
                  <div className="module-item" key={module.id}>
                    <div className="module-item-header">
                      <strong>{module.name}</strong>
                      <button
                        className="module-remove-button"
                        type="button"
                        title="Remove module"
                        aria-label={`Remove ${module.name}`}
                        onClick={() => removeModule(module.id)}
                      >
                        x
                      </button>
                    </div>
                    <span>
                      {module.kind} · {module.model}
                    </span>
                    {module.communication ? (
                      <>
                        <span>
                          {module.communication.protocol.toUpperCase()} range ·{' '}
                          {formatMeters(module.communication.maxRangeMeters)}
                        </span>
                        <div className="module-settings">
                          <label className="module-setting-field">
                            <span>SF</span>
                            <select
                              value={module.communication.spreadingFactor}
                              onChange={(event) =>
                                patchModuleCommunication(module, {
                                  spreadingFactor: Number(
                                    event.target.value
                                  ) as WorkspaceCommunicationConfig['spreadingFactor']
                                })
                              }
                            >
                              {spreadingFactorOptions.map((spreadingFactor) => (
                                <option value={spreadingFactor} key={spreadingFactor}>
                                  {spreadingFactor}
                                </option>
                              ))}
                            </select>
                          </label>

                          <label className="module-setting-field">
                            <span>Coding</span>
                            <select
                              value={module.communication.codingRate}
                              onChange={(event) =>
                                patchModuleCommunication(module, {
                                  codingRate: event.target
                                    .value as WorkspaceCommunicationConfig['codingRate']
                                })
                              }
                            >
                              {codingRateOptions.map((codingRate) => (
                                <option value={codingRate} key={codingRate}>
                                  {codingRate}
                                </option>
                              ))}
                            </select>
                          </label>

                          <label className="module-setting-field">
                            <span>Bandwidth</span>
                            <select
                              value={module.communication.bandwidthHz}
                              onChange={(event) =>
                                patchModuleCommunication(module, {
                                  bandwidthHz: Number(event.target.value)
                                })
                              }
                            >
                              {bandwidthOptions.map((bandwidthHz) => (
                                <option value={bandwidthHz} key={bandwidthHz}>
                                  {(bandwidthHz / 1000).toLocaleString()} kHz
                                </option>
                              ))}
                            </select>
                          </label>

                          <label className="module-setting-field">
                            <span>Tx power</span>
                            <input
                              type="number"
                              min="-20"
                              max="30"
                              step="1"
                              value={module.communication.txPowerDbm}
                              onChange={(event) =>
                                patchModuleCommunication(module, {
                                  txPowerDbm: Number(event.target.value)
                                })
                              }
                            />
                          </label>

                          <label className="module-setting-field module-setting-field-wide">
                            <span>Range, m</span>
                            <input
                              type="number"
                              min="1"
                              step="100"
                              value={module.communication.maxRangeMeters}
                              onChange={(event) =>
                                patchModuleCommunication(module, {
                                  maxRangeMeters: Math.max(1, Number(event.target.value) || 1)
                                })
                              }
                            />
                          </label>

                          <label className="module-setting-field module-setting-field-wide">
                            <span>Max links</span>
                            <input
                              type="number"
                              min="0"
                              max="1000"
                              step="1"
                              value={module.communication.maxConnections}
                              onChange={(event) =>
                                patchModuleCommunication(module, {
                                  maxConnections: Math.max(0, Math.floor(Number(event.target.value) || 0))
                                })
                              }
                            />
                          </label>
                        </div>
                      </>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : !collapsedSections.modules ? (
              <div className="inspector-empty-line">No modules attached</div>
            ) : null}

            {isModuleDialogOpen ? (
              <ModuleCatalogDialog
                deviceName={device.name}
                onClose={() => setIsModuleDialogOpen(false)}
                onCreate={handleAddModule}
              />
            ) : null}
          </section>

          <section className="inspector-section">
            <button
              className="side-section-toggle"
              type="button"
              aria-expanded={!collapsedSections.statistics}
              onClick={() => toggleSection('statistics')}
            >
              <span className={collapsedSections.statistics ? 'section-caret is-collapsed' : 'section-caret'} />
              <h2>Statistics</h2>
            </button>
            {!collapsedSections.statistics ? (
              <>
                <InfoRow label="Buffer size" value={device.bufferSize} />
                <InfoRow label="Received packets" value={device.receivedPacketCount} />
                <InfoRow label="Module count" value={device.modules.length} />
                <InfoRow label="Position X" value={device.x} />
                <InfoRow label="Position Y" value={device.y} />
              </>
            ) : null}
            </section>
          </>
        ) : (
          <div className="inspector-empty-state">
            <strong>No device selected</strong>
            <span>Select a device on the workspace to inspect its details.</span>
          </div>
        )}
      </div>
    </aside>
  )
}
