import { useMemo, useState } from 'react'
import type { WorkspaceModule, WorkspaceModuleKind } from './types'
import { createWorkspaceModule } from './workspaceUtils'

type ModuleCharacteristic = {
  label: string
  value: string
}

type ModuleTemplate = {
  kind: WorkspaceModuleKind
  name: string
  model: string
  summary: string
  characteristics: ModuleCharacteristic[]
  communication?: WorkspaceModule['communication']
}

type ModuleCategory = {
  id: WorkspaceModuleKind
  label: string
  modules: ModuleTemplate[]
}

type ModuleCatalogDialogProps = {
  deviceName: string
  onClose: () => void
  onCreate: (module: WorkspaceModule) => void
}

const moduleCatalog: ModuleCategory[] = [
  {
    id: 'network',
    label: 'Network',
    modules: [
      {
        kind: 'network',
        name: 'LoRa network',
        model: 'SX1276 Stub',
        summary: 'Long range low-power radio module.',
        characteristics: [
          { label: 'Profile', value: 'LoRa mesh' },
          { label: 'Band', value: 'EU868 / US915' },
          { label: 'Tx power', value: '14 dBm' },
          { label: 'SF', value: '12' },
          { label: 'Range', value: '10,000 m' },
          { label: 'Max links', value: '8' },
          { label: 'Payload', value: '64 B' }
        ],
        communication: {
          protocol: 'lora',
          maxRangeMeters: 10_000,
          maxConnections: 8,
          spreadingFactor: 12,
          bandwidthHz: 125_000,
          txPowerDbm: 14,
          codingRate: '4/5',
          sourceLabel: 'SX1276 simulation preset (datasheet-derived placeholder)'
        }
      },
      {
        kind: 'network',
        name: 'BLE radio',
        model: 'nRF52840 Stub',
        summary: 'Short range service and provisioning radio.',
        characteristics: [
          { label: 'Profile', value: 'BLE 5' },
          { label: 'Band', value: '2.4 GHz' },
          { label: 'Range', value: '50 m' },
          { label: 'Mode', value: 'Peripheral' }
        ]
      }
    ]
  },
  {
    id: 'sensor',
    label: 'Sensor',
    modules: [
      {
        kind: 'sensor',
        name: 'Environmental sensor',
        model: 'BME280 Stub',
        summary: 'Temperature, humidity and pressure measurements.',
        characteristics: [
          { label: 'Values', value: 'T / RH / P' },
          { label: 'Bus', value: 'I2C' },
          { label: 'Rate', value: '1 Hz' },
          { label: 'Current', value: '3.6 uA' }
        ]
      },
      {
        kind: 'sensor',
        name: 'Motion sensor',
        model: 'MPU6050 Stub',
        summary: 'Basic acceleration and rotation measurements.',
        characteristics: [
          { label: 'Axes', value: '6-axis' },
          { label: 'Bus', value: 'I2C' },
          { label: 'Rate', value: '100 Hz' },
          { label: 'Range', value: '+/-16 g' }
        ]
      }
    ]
  },
  {
    id: 'power',
    label: 'Power',
    modules: [
      {
        kind: 'power',
        name: 'Battery pack',
        model: 'Li-Ion Stub',
        summary: 'Rechargeable battery source with telemetry.',
        characteristics: [
          { label: 'Chemistry', value: 'Li-Ion' },
          { label: 'Voltage', value: '3.7 V' },
          { label: 'Capacity', value: '2600 mAh' },
          { label: 'Telemetry', value: 'V / I / SOC' }
        ]
      },
      {
        kind: 'power',
        name: 'Solar charger',
        model: 'MPPT Stub',
        summary: 'Solar input controller for autonomous nodes.',
        characteristics: [
          { label: 'Input', value: '6-12 V' },
          { label: 'Output', value: '4.2 V' },
          { label: 'Power', value: '5 W' },
          { label: 'Mode', value: 'MPPT' }
        ]
      }
    ]
  },
  {
    id: 'compute',
    label: 'Compute',
    modules: [
      {
        kind: 'compute',
        name: 'Control unit',
        model: 'MCU Stub',
        summary: 'Main controller for local module coordination.',
        characteristics: [
          { label: 'Core', value: 'Cortex-M4' },
          { label: 'Clock', value: '64 MHz' },
          { label: 'RAM', value: '256 KB' },
          { label: 'Mode', value: 'Low power' }
        ]
      },
      {
        kind: 'compute',
        name: 'Edge processor',
        model: 'SBC Stub',
        summary: 'Higher level processing for gateway-like devices.',
        characteristics: [
          { label: 'Core', value: 'ARM A53' },
          { label: 'Clock', value: '1.2 GHz' },
          { label: 'RAM', value: '512 MB' },
          { label: 'OS', value: 'Linux' }
        ]
      }
    ]
  },
  {
    id: 'storage',
    label: 'Storage',
    modules: [
      {
        kind: 'storage',
        name: 'Local storage',
        model: 'Flash Stub',
        summary: 'Local telemetry and event buffer storage.',
        characteristics: [
          { label: 'Type', value: 'SPI Flash' },
          { label: 'Size', value: '8 MB' },
          { label: 'Mode', value: 'Ring buffer' },
          { label: 'Write', value: 'Buffered' }
        ]
      },
      {
        kind: 'storage',
        name: 'Config memory',
        model: 'EEPROM Stub',
        summary: 'Small persistent configuration memory.',
        characteristics: [
          { label: 'Type', value: 'EEPROM' },
          { label: 'Size', value: '64 KB' },
          { label: 'Bus', value: 'I2C' },
          { label: 'Use', value: 'Config' }
        ]
      }
    ]
  }
]

function getModuleKey(module: ModuleTemplate): string {
  return `${module.kind}:${module.model}`
}

const defaultCategory = moduleCatalog[0]
const defaultModule = defaultCategory.modules[0]

export function ModuleCatalogDialog({
  deviceName,
  onClose,
  onCreate
}: ModuleCatalogDialogProps): React.JSX.Element {
  const [selectedCategoryId, setSelectedCategoryId] = useState<WorkspaceModuleKind>(defaultCategory.id)
  const [selectedModuleKey, setSelectedModuleKey] = useState(getModuleKey(defaultModule))

  const selectedCategory = useMemo(
    () => moduleCatalog.find((category) => category.id === selectedCategoryId) ?? defaultCategory,
    [selectedCategoryId]
  )
  const selectedModule =
    selectedCategory.modules.find((module) => getModuleKey(module) === selectedModuleKey) ??
    selectedCategory.modules[0]

  function handleSelectCategory(category: ModuleCategory): void {
    setSelectedCategoryId(category.id)
    setSelectedModuleKey(getModuleKey(category.modules[0]))
  }

  function handleCreateModule(): void {
    onCreate(
      createWorkspaceModule({
        kind: selectedModule.kind,
        name: selectedModule.name,
        model: selectedModule.model,
        communication: selectedModule.communication
      })
    )
    onClose()
  }

  return (
    <div className="module-dialog-backdrop" onMouseDown={onClose}>
      <section
        className="module-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="module-dialog-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="module-dialog-header">
          <div>
            <h1 id="module-dialog-title">Add module</h1>
            <span>{deviceName}</span>
          </div>
          <button className="module-dialog-close" type="button" aria-label="Close" onClick={onClose}>
            x
          </button>
        </header>

        <div className="module-dialog-body">
          <nav className="module-dialog-categories" aria-label="Module categories">
            {moduleCatalog.map((category) => (
              <button
                className={category.id === selectedCategoryId ? 'module-category-button is-active' : 'module-category-button'}
                type="button"
                key={category.id}
                onClick={() => handleSelectCategory(category)}
              >
                <strong>{category.label}</strong>
                <span>{category.modules.length} modules</span>
              </button>
            ))}
          </nav>

          <div className="module-dialog-modules">
            {selectedCategory.modules.map((module) => {
              const moduleKey = getModuleKey(module)
              const isSelected = moduleKey === selectedModuleKey

              return (
                <button
                  className={isSelected ? 'module-card is-selected' : 'module-card'}
                  type="button"
                  key={moduleKey}
                  onClick={() => setSelectedModuleKey(moduleKey)}
                >
                  <span className="module-card-kind">{module.kind}</span>
                  <strong>{module.name}</strong>
                  <span className="module-card-model">{module.model}</span>
                  <p>{module.summary}</p>
                  <dl className="module-characteristics">
                    {module.characteristics.map((characteristic) => (
                      <div key={`${moduleKey}-${characteristic.label}`}>
                        <dt>{characteristic.label}</dt>
                        <dd>{characteristic.value}</dd>
                      </div>
                    ))}
                  </dl>
                </button>
              )
            })}
          </div>
        </div>

        <footer className="module-dialog-actions">
          <button className="custom-module-button" type="button" disabled title="Custom modules will be available later">
            New custom module
          </button>
          <div className="module-dialog-action-group">
            <button className="secondary-button" type="button" onClick={onClose}>
              Cancel
            </button>
            <button className="primary-button" type="button" onClick={handleCreateModule}>
              Add
            </button>
          </div>
        </footer>
      </section>
    </div>
  )
}
