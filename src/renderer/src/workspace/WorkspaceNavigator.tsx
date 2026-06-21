import { useState } from 'react'
import type {
  WorkspaceConnectionViewMode,
  WorkspaceDevice,
  WorkspacePossibleConnection,
  WorkspaceRadioLink
} from './types'
import { getDeviceLoRaModule } from './workspaceConnections'

type WorkspaceNavigatorProps = {
  devices: readonly WorkspaceDevice[]
  connections: readonly WorkspacePossibleConnection[]
  radioLinks: readonly WorkspaceRadioLink[]
  selectedDeviceId: string | null
  viewMode: WorkspaceConnectionViewMode
  showWirelessLinks: boolean
  showLinkDebugInfo: boolean
  onViewModeChange: (mode: WorkspaceConnectionViewMode) => void
  onShowWirelessLinksChange: (visible: boolean) => void
  onShowLinkDebugInfoChange: (visible: boolean) => void
  onSelectDevice: (device: WorkspaceDevice) => void
  onRequestHide: () => void
}

type NavigatorSectionId = 'devices' | 'links'

function formatDistance(meters: number): string {
  if (meters >= 1000) {
    return `${(meters / 1000).toFixed(2)} km`
  }

  return `${Math.round(meters)} m`
}

function getDeviceStatusClassName(device: WorkspaceDevice): string {
  const status = `${device.status} ${device.executionState}`.toLowerCase()

  if (status.includes('fault') || status.includes('orphaned')) {
    return 'is-fault'
  }

  if (status.includes('active') || status.includes('running')) {
    return 'is-active'
  }

  if (status.includes('sleep')) {
    return 'is-sleep'
  }

  if (status.includes('decommissioned') || status.includes('stopped')) {
    return 'is-offline'
  }

  return 'is-idle'
}

function formatDeviceMeta(device: WorkspaceDevice): string {
  const loraModule = getDeviceLoRaModule(device)

  return `${device.role} · ${device.status} · ${loraModule ? loraModule.model : 'No LoRa'}`
}

export function WorkspaceNavigator({
  devices,
  connections,
  radioLinks,
  selectedDeviceId,
  viewMode,
  showWirelessLinks,
  showLinkDebugInfo,
  onViewModeChange,
  onShowWirelessLinksChange,
  onShowLinkDebugInfoChange,
  onSelectDevice,
  onRequestHide
}: WorkspaceNavigatorProps): React.JSX.Element {
  const [collapsedSections, setCollapsedSections] = useState<Record<NavigatorSectionId, boolean>>({
    devices: false,
    links: false
  })
  const [collapsedLinkGroups, setCollapsedLinkGroups] = useState<Record<string, boolean>>({})
  const devicesById = new Map(devices.map((device) => [device.id, device]))
  const selectedDevice = selectedDeviceId ? devicesById.get(selectedDeviceId) : undefined
  const sourceDevices =
    viewMode === 'selected' && selectedDevice
      ? [selectedDevice]
      : devices.filter((device) => getDeviceLoRaModule(device))

  function toggleSection(sectionId: NavigatorSectionId): void {
    setCollapsedSections((currentSections) => ({
      ...currentSections,
      [sectionId]: !currentSections[sectionId]
    }))
  }

  function toggleLinkGroup(deviceId: string): void {
    setCollapsedLinkGroups((currentGroups) => ({
      ...currentGroups,
      [deviceId]: !currentGroups[deviceId]
    }))
  }

  return (
    <aside className="workspace-navigator" aria-label="Workspace navigator">
      <header className="navigator-header">
        <span>WORKSPACE</span>
        <button
          className="side-panel-hide-button"
          type="button"
          title="Hide workspace panel"
          aria-label="Hide workspace panel"
          onClick={onRequestHide}
        >
          &lt;
        </button>
      </header>

      <div className="navigator-content">
        <section className="navigator-section">
          <button
            className="side-section-toggle"
            type="button"
            aria-expanded={!collapsedSections.devices}
            onClick={() => toggleSection('devices')}
          >
            <span
              className={collapsedSections.devices ? 'section-caret is-collapsed' : 'section-caret'}
            />
            <h2>Devices</h2>
          </button>
          {!collapsedSections.devices ? (
            devices.length > 0 ? (
              <div className="navigator-device-list">
                {devices.map((device) => {
                  const isSelected = device.id === selectedDeviceId
                  const deviceMeta = formatDeviceMeta(device)

                  return (
                    <button
                      className={isSelected ? 'navigator-device is-selected' : 'navigator-device'}
                      type="button"
                      key={device.id}
                      title={`${device.name}: ${deviceMeta}`}
                      onClick={() => onSelectDevice(device)}
                    >
                      <span
                        className={`navigator-device-status ${getDeviceStatusClassName(device)}`}
                        aria-hidden="true"
                      />
                      <strong>{device.name}</strong>
                      <span className="navigator-device-meta">{deviceMeta}</span>
                    </button>
                  )
                })}
              </div>
            ) : (
              <div className="navigator-empty-line">No devices</div>
            )
          ) : null}
        </section>

        <section className="navigator-section">
          <div className="navigator-section-header">
            <button
              className="side-section-toggle"
              type="button"
              aria-expanded={!collapsedSections.links}
              onClick={() => toggleSection('links')}
            >
              <span
                className={collapsedSections.links ? 'section-caret is-collapsed' : 'section-caret'}
              />
              <h2>Links</h2>
            </button>
            <div className="navigator-segmented" role="group" aria-label="Connection view mode">
              <button
                className={viewMode === 'selected' ? 'is-active' : ''}
                type="button"
                onClick={() => onViewModeChange('selected')}
              >
                Selected
              </button>
              <button
                className={viewMode === 'all' ? 'is-active' : ''}
                type="button"
                onClick={() => onViewModeChange('all')}
              >
                All
              </button>
            </div>
          </div>

          <div className="navigator-link-controls">
            <label className="navigator-checkbox">
              <input
                type="checkbox"
                checked={showWirelessLinks}
                onChange={(event) => onShowWirelessLinksChange(event.currentTarget.checked)}
              />
              <span>Wireless links</span>
              <strong>{radioLinks.length}</strong>
            </label>
            <label className="navigator-checkbox">
              <input
                type="checkbox"
                checked={showLinkDebugInfo}
                onChange={(event) => onShowLinkDebugInfoChange(event.currentTarget.checked)}
              />
              <span>Debug labels</span>
            </label>
          </div>

          {!collapsedSections.links ? (
            viewMode === 'selected' && !selectedDevice ? (
              <div className="navigator-empty-line">Select a device to inspect possible links</div>
            ) : sourceDevices.length > 0 ? (
              <div className="navigator-link-tree">
                {sourceDevices.map((sourceDevice) => {
                  const sourceConnections = connections.filter(
                    (connection) => connection.sourceDeviceId === sourceDevice.id
                  )
                  const hasLoRa = Boolean(getDeviceLoRaModule(sourceDevice))
                  const isLinkGroupCollapsed = Boolean(collapsedLinkGroups[sourceDevice.id])

                  return (
                    <div className="navigator-link-group" key={sourceDevice.id}>
                      <div className="navigator-link-source-row">
                        <button
                          className="link-group-toggle"
                          type="button"
                          aria-label={
                            isLinkGroupCollapsed ? 'Expand link group' : 'Collapse link group'
                          }
                          aria-expanded={!isLinkGroupCollapsed}
                          onClick={() => toggleLinkGroup(sourceDevice.id)}
                        >
                          <span
                            className={
                              isLinkGroupCollapsed ? 'section-caret is-collapsed' : 'section-caret'
                            }
                          />
                        </button>
                        <button
                          className="navigator-link-source"
                          type="button"
                          onClick={() => onSelectDevice(sourceDevice)}
                        >
                          <strong>{sourceDevice.name}</strong>
                          <span>
                            {hasLoRa
                              ? `${sourceConnections.length} possible links`
                              : 'No LoRa module'}
                          </span>
                        </button>
                      </div>

                      {!isLinkGroupCollapsed && sourceConnections.length > 0 ? (
                        <div className="navigator-link-targets">
                          {sourceConnections.map((connection) => {
                            const targetDevice = devicesById.get(connection.targetDeviceId)

                            return (
                              <button
                                className="navigator-link-target"
                                type="button"
                                key={connection.id}
                                onClick={() => {
                                  if (targetDevice) {
                                    onSelectDevice(targetDevice)
                                  }
                                }}
                              >
                                <span>{targetDevice?.name ?? connection.targetDeviceId}</span>
                                <strong>{formatDistance(connection.distanceMeters)}</strong>
                              </button>
                            )
                          })}
                        </div>
                      ) : !isLinkGroupCollapsed ? (
                        <div className="navigator-link-empty">No reachable LoRa devices</div>
                      ) : null}
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="navigator-empty-line">No LoRa-capable devices</div>
            )
          ) : null}
        </section>
      </div>
    </aside>
  )
}
