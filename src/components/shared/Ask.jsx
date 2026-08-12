import { useEffect, useRef } from 'react'

// Replaces confirm()/prompt(). Native <dialog> supplies the top layer, backdrop and focus trap;
// the decision itself rides on explicit submit/click/Escape handlers rather than the dialog's
// `close` event, which does not bubble and is awkward to observe reliably.
// onDone receives null when dismissed, true when confirmed, or the trimmed string when `input` is set.
export default function Ask({ title, body, confirmLabel = 'Confirm', danger, input, onDone }) {
  const dialog = useRef(null), field = useRef(null), settled = useRef(false)
  const wantsInput = input !== undefined

  useEffect(() => { dialog.current.showModal() }, [])

  const finish = value => {
    if (settled.current) return
    settled.current = true
    dialog.current?.close()
    onDone(value)
  }

  return <dialog
    ref={dialog}
    className="ask"
    onKeyDown={event => {
      if (event.key !== 'Escape') return
      event.preventDefault()      // take Escape off the native cancel path so it settles once
      event.stopPropagation()     // and keep it from reaching the app-wide shortcut handler
      finish(null)
    }}
  >
    <form onSubmit={event => { event.preventDefault(); finish(wantsInput ? (field.current?.value ?? '').trim() : true) }}>
      <h2>{title}</h2>
      {body && <p className="help">{body}</p>}
      {wantsInput && <input ref={field} defaultValue={input} autoFocus />}
      <menu>
        <button type="button" onClick={() => finish(null)}>Cancel</button>
        <button className={danger ? 'danger-button' : 'primary'}>{confirmLabel}</button>
      </menu>
    </form>
  </dialog>
}
