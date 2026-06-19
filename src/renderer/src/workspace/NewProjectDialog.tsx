import { FormEvent, useState } from 'react'
import type { NewProjectValues, WorkspaceProject } from './types'

type NewProjectDialogProps = {
  initialProject: WorkspaceProject
  onCancel: () => void
  onCreate: (values: NewProjectValues) => void
}

function normalizeDimension(value: string, fallback: number): number {
  const parsed = Number(value)

  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback
  }

  return Math.round(parsed)
}

export function NewProjectDialog({
  initialProject,
  onCancel,
  onCreate
}: NewProjectDialogProps): React.JSX.Element {
  const [name, setName] = useState(initialProject.name)
  const [width, setWidth] = useState(String(initialProject.width || 1000))
  const [height, setHeight] = useState(String(initialProject.height || 1000))

  function handleSubmit(event: FormEvent<HTMLFormElement>): void {
    event.preventDefault()

    onCreate({
      name,
      width: normalizeDimension(width, 1000),
      height: normalizeDimension(height, 1000)
    })
  }

  return (
    <div className="dialog-backdrop" role="presentation">
      <form className="project-dialog" onSubmit={handleSubmit} aria-labelledby="new-project-title">
        <div className="dialog-header">
          <h1 id="new-project-title">New project</h1>
          <p>Create a workspace for placing simulated devices.</p>
        </div>

        <label className="field">
          <span>Name</span>
          <input value={name} onChange={(event) => setName(event.target.value)} autoFocus />
        </label>

        <div className="dimension-grid">
          <label className="field">
            <span>Width</span>
            <input
              type="number"
              min="1"
              value={width}
              onChange={(event) => setWidth(event.target.value)}
            />
          </label>

          <label className="field">
            <span>Height</span>
            <input
              type="number"
              min="1"
              value={height}
              onChange={(event) => setHeight(event.target.value)}
            />
          </label>
        </div>

        <div className="scale-note">1 workspace unit = 10 meters</div>

        <div className="dialog-actions">
          <button className="secondary-button" type="button" onClick={onCancel}>
            Cancel
          </button>
          <button className="primary-button" type="submit">
            Create
          </button>
        </div>
      </form>
    </div>
  )
}
