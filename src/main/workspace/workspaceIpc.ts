import { ipcMain } from 'electron'
import { WorkspaceSessionManager } from '../../engine/application/workspace'
import type { WorkspaceCommand } from '../../shared/workspaceSession'

export function registerWorkspaceIpc(manager: WorkspaceSessionManager): void {
  ipcMain.handle('workspace:dispatch', (_event, command: WorkspaceCommand) => {
    return manager.dispatch(command)
  })
}
