import { BrowserWindow, Menu, type KeyboardEvent, type MenuItemConstructorOptions } from 'electron'

type AddDeviceCommand = {
  placement: 'center' | 'cursor'
}

type PasteDeviceCommand = {
  placement: 'center' | 'cursor'
}

const menuChannels = {
  newProject: 'menu:new-project',
  addDevice: 'menu:add-device',
  copySelectedDevice: 'menu:copy-selected-device',
  pasteDevice: 'menu:paste-device',
  deleteSelectedDevice: 'menu:delete-selected-device'
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
    }
  ]

  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
