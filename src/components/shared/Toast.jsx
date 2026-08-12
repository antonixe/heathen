const GLYPH = { up: '▲', down: '▼', hit: '★', warn: '!' }

export default function ToastStack({ toasts, dismiss }) {
  return <div className="toast-stack" aria-live="polite">
    {toasts.map(toast => <div className={`toast ${toast.tone || ''}`.trim()} key={toast.id}>
      {GLYPH[toast.tone] && <i aria-hidden="true">{GLYPH[toast.tone]}</i>}
      <div><strong>{toast.title}</strong><p>{toast.body}</p></div>
      <button className="plain" onClick={() => dismiss(toast.id)} aria-label="Dismiss notification">×</button>
    </div>)}
  </div>
}
