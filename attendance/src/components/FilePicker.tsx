import { useRef, useState } from 'react'
import { prepareFile, openStoredFile, type PickedFile } from '../lib/files'
import { friendlyError } from '../lib/errors'

export function FilePicker(props: {
  label: string
  existingPath?: string | null
  picked: PickedFile | null
  onPick: (f: PickedFile | null) => void
  onRemoveExisting?: () => void
  hint?: string
}) {
  const input = useRef<HTMLInputElement>(null)
  const [error, setError] = useState('')
  return (
    <div className="field">
      <span className="label">{props.label}</span>
      {props.picked ? (
        <div className="row">
          {props.picked.previewUrl ? <img className="photo-thumb" src={props.picked.previewUrl} alt="Attachment preview" /> : <span className="chip info">📄 {props.picked.name}</span>}
          <button type="button" className="btn small ghost" onClick={() => props.onPick(null)}>
            Remove
          </button>
        </div>
      ) : props.existingPath ? (
        <div className="row">
          <button type="button" className="btn small secondary" onClick={() => openStoredFile(props.existingPath!).catch((e) => setError(friendlyError(e)))}>
            📎 View attachment
          </button>
          {props.onRemoveExisting && (
            <button type="button" className="btn small ghost" onClick={props.onRemoveExisting}>
              Remove
            </button>
          )}
        </div>
      ) : (
        <button type="button" className="btn secondary" onClick={() => input.current?.click()}>
          📷 Take photo or choose file
        </button>
      )}
      <input
        ref={input}
        type="file"
        accept="image/*,application/pdf"
        hidden
        data-testid="file-input"
        onChange={async (e) => {
          const f = e.target.files?.[0]
          e.target.value = ''
          if (!f) return
          setError('')
          try {
            props.onPick(await prepareFile(f))
          } catch (err) {
            setError(friendlyError(err))
          }
        }}
      />
      {props.hint && <div className="hint">{props.hint}</div>}
      {error && <div className="hint" style={{ color: 'var(--danger)' }}>{error}</div>}
    </div>
  )
}
