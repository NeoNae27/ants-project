import { ipcMain } from 'electron'
import { SimulationRuntimeSessionManager } from '../../engine/application/simulation'
import { WorkspaceSessionManager } from '../../engine/application/workspace'
import type { WorkspaceCommand } from '../../shared/workspaceSession'

export function registerWorkspaceIpc(
  manager: WorkspaceSessionManager,
  simulationRuntime?: SimulationRuntimeSessionManager
): void {
  ipcMain.handle('workspace:dispatch', (_event, command: WorkspaceCommand) => {
    if (command.type === 'workspace/create-project') {
      simulationRuntime?.resetForNewWorkspace()
    }

    return manager.dispatch(command)
  })
}
