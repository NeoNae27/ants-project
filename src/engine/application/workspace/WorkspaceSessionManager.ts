import type {
  CreateProjectCommand,
  WorkspaceCommand,
  WorkspaceCommandResult,
} from '../../../shared/workspaceSession'
import { WorkspaceSession } from './WorkspaceSession'

export class WorkspaceSessionManager {
  private currentSession: WorkspaceSession | null = null

  createProject(command: CreateProjectCommand): WorkspaceCommandResult {
    this.currentSession = new WorkspaceSession()
    return this.currentSession.dispatch(command)
  }

  dispatch(command: WorkspaceCommand): WorkspaceCommandResult {
    if (command.type === 'workspace/create-project') {
      return this.createProject(command)
    }

    if (!this.currentSession) {
      return {
        ok: false,
        events: [],
        error: {
          code: 'WORKSPACE_SESSION_NOT_READY',
          message: 'Workspace project is not created',
        },
      }
    }

    return this.currentSession.dispatch(command)
  }

  getSnapshot(): WorkspaceCommandResult {
    if (!this.currentSession) {
      return {
        ok: false,
        events: [],
        error: {
          code: 'WORKSPACE_SESSION_NOT_READY',
          message: 'Workspace project is not created',
        },
      }
    }

    return this.currentSession.dispatch({ type: 'workspace/get-snapshot' })
  }

  hasSession(): boolean {
    return Boolean(this.currentSession)
  }
}
