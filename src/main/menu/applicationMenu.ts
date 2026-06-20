import { BrowserWindow, Menu, type KeyboardEvent, type MenuItemConstructorOptions } from 'electron'

type AddDeviceCommand = {
  placement: 'center' | 'cursor'
}

type PasteDeviceCommand = {
  placement: 'center' | 'cursor'
}

type DebuggingCommand = {
  enabled: boolean
}

type SpatialGridVisibilityCommand = {
  technology: 'lora'
  visible: boolean
}

type SimulationMenuCommand =
  | { action: 'start' }
  | { action: 'pause' }
  | { action: 'stop' }
  | { action: 'reset' }
  | { action: 'set-speed'; speed: 1 | 5 | 10 }
  | { action: 'advance-clock'; deltaRealMs: number }
  | { action: 'show-clock-snapshot' }

const menuChannels = {
  newProject: 'menu:new-project',
  addDevice: 'menu:add-device',
  copySelectedDevice: 'menu:copy-selected-device',
  pasteDevice: 'menu:paste-device',
  deleteSelectedDevice: 'menu:delete-selected-device',
  setSpatialGridVisibility: 'menu:set-spatial-grid-visibility',
  setDebugging: 'menu:set-debugging',
  showDevicesRegister: 'menu:show-devices-register',
  showSpatialIndex: 'menu:show-spatial-index',
  simulationCommand: 'menu:simulation-command'
} as const

function sendMenuCommand(window: BrowserWindow, channel: string, payload?: unknown): void {
  const targetWindow = BrowserWindow.getFocusedWindow() ?? window

  if (targetWindow.isDestroyed()) {
    return
  }

  targetWindow.webContents.send(channel, payload)
}

export function createApplicationMenu(mainWindow: BrowserWindow): void {
  const template: MenuItemConstructorOptions[] = [
    {
      label: 'Project',
      submenu: [
        {
          label: 'New Project',
          accelerator: 'CmdOrCtrl+N',
          click: () => sendMenuCommand(mainWindow, menuChannels.newProject)
        }
      ]
    },
    {
      label: 'Workspace',
      submenu: [
        {
          label: 'Add Device',
          accelerator: 'CmdOrCtrl+D',
          click: (_menuItem, _window, event: KeyboardEvent) => {
            const command: AddDeviceCommand = {
              placement: event.triggeredByAccelerator ? 'cursor' : 'center'
            }

            sendMenuCommand(mainWindow, menuChannels.addDevice, command)
          }
        }
      ]
    },
    {
      label: 'Simulation',
      submenu: [
        {
          label: 'Start',
          accelerator: 'F5',
          click: () =>
            sendMenuCommand(mainWindow, menuChannels.simulationCommand, {
              action: 'start'
            } satisfies SimulationMenuCommand)
        },
        {
          label: 'Pause',
          accelerator: 'F6',
          click: () =>
            sendMenuCommand(mainWindow, menuChannels.simulationCommand, {
              action: 'pause'
            } satisfies SimulationMenuCommand)
        },
        {
          label: 'Stop',
          accelerator: 'Shift+F5',
          click: () =>
            sendMenuCommand(mainWindow, menuChannels.simulationCommand, {
              action: 'stop'
            } satisfies SimulationMenuCommand)
        },
        {
          label: 'Reset',
          accelerator: 'CmdOrCtrl+Shift+F5',
          click: () =>
            sendMenuCommand(mainWindow, menuChannels.simulationCommand, {
              action: 'reset'
            } satisfies SimulationMenuCommand)
        },
        { type: 'separator' },
        {
          label: 'Speed',
          submenu: [
            {
              label: 'x1',
              type: 'radio',
              accelerator: 'CmdOrCtrl+Alt+1',
              checked: true,
              click: () =>
                sendMenuCommand(mainWindow, menuChannels.simulationCommand, {
                  action: 'set-speed',
                  speed: 1
                } satisfies SimulationMenuCommand)
            },
            {
              label: 'x5',
              type: 'radio',
              accelerator: 'CmdOrCtrl+Alt+5',
              click: () =>
                sendMenuCommand(mainWindow, menuChannels.simulationCommand, {
                  action: 'set-speed',
                  speed: 5
                } satisfies SimulationMenuCommand)
            },
            {
              label: 'x10',
              type: 'radio',
              accelerator: 'CmdOrCtrl+Alt+0',
              click: () =>
                sendMenuCommand(mainWindow, menuChannels.simulationCommand, {
                  action: 'set-speed',
                  speed: 10
                } satisfies SimulationMenuCommand)
            }
          ]
        },
        {
          label: 'Advance +1s',
          accelerator: 'F10',
          click: () =>
            sendMenuCommand(mainWindow, menuChannels.simulationCommand, {
              action: 'advance-clock',
              deltaRealMs: 1000
            } satisfies SimulationMenuCommand)
        },
        {
          label: 'Show clock snapshot',
          accelerator: 'CmdOrCtrl+Alt+T',
          click: () =>
            sendMenuCommand(mainWindow, menuChannels.simulationCommand, {
              action: 'show-clock-snapshot'
            } satisfies SimulationMenuCommand)
        }
      ]
    },
    {
      label: 'Edit',
      submenu: [
        {
          label: 'Copy Selected Device',
          accelerator: 'CmdOrCtrl+C',
          click: () => sendMenuCommand(mainWindow, menuChannels.copySelectedDevice)
        },
        {
          label: 'Paste Device',
          accelerator: 'CmdOrCtrl+V',
          click: (_menuItem, _window, event: KeyboardEvent) => {
            const command: PasteDeviceCommand = {
              placement: event.triggeredByAccelerator ? 'cursor' : 'center'
            }

            sendMenuCommand(mainWindow, menuChannels.pasteDevice, command)
          }
        },
        {
          label: 'Delete Selected Device',
          accelerator: 'Delete',
          click: () => sendMenuCommand(mainWindow, menuChannels.deleteSelectedDevice)
        }
      ]
    },
    {
      label: 'View',
      submenu: [
        {
          label: 'Spatial Grid',
          submenu: [
            {
              label: 'LoRa',
              type: 'checkbox',
              checked: false,
              click: (menuItem) => {
                const command: SpatialGridVisibilityCommand = {
                  technology: 'lora',
                  visible: menuItem.checked
                }

                sendMenuCommand(mainWindow, menuChannels.setSpatialGridVisibility, command)
              }
            }
          ]
        }
      ]
    },
    {
      label: 'Debug',
      submenu: [
        {
          label: 'Debugging',
          type: 'checkbox',
          accelerator: 'CmdOrCtrl+Shift+B',
          checked: false,
          click: (menuItem) => {
            const command: DebuggingCommand = {
              enabled: menuItem.checked
            }

            sendMenuCommand(mainWindow, menuChannels.setDebugging, command)
          }
        },
        {
          label: 'Show devices register',
          accelerator: 'CmdOrCtrl+Shift+R',
          click: () => sendMenuCommand(mainWindow, menuChannels.showDevicesRegister)
        },
        {
          label: 'Show spatial index',
          accelerator: 'CmdOrCtrl+Shift+I',
          click: () => sendMenuCommand(mainWindow, menuChannels.showSpatialIndex)
        }
      ]
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
