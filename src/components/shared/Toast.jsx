export default function ToastStack({ toasts, dismiss }) {
  return <div className="toast-stack" aria-live="polite">
    {toasts.map(toast => <div className="toast" key={toast.id}>
      <div><strong>{toast.title}</strong><p>{toast.body}</p></div>
      <button className="plain" onClick={() => dismiss(toast.id)} aria-label="Dismiss notification">×</button>
    </div>)}
  </div>
}
