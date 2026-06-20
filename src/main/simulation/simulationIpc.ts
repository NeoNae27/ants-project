import { ipcMain } from 'electron'
import { SimulationRuntimeSessionManager } from '../../engine/application/simulation'
import type { SimulationCommand } from '../../shared/simulationRuntime'

export function registerSimulationIpc(manager: SimulationRuntimeSessionManager): void {
  ipcMain.handle('simulation:dispatch', (_event, command: SimulationCommand) => {
    return manager.dispatch(command)
  })
}
