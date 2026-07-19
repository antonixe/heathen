import { X } from 'lucide-react'
import { Button } from '@/components/ui/button'

export default function ToastStack({ toasts, dismiss }) {
  return <div className="toast-stack" aria-live="polite">
    {toasts.map(toast => <div className="operator-toast" key={toast.id}>
      <div className="min-w-0"><strong className="block text-sm">{toast.title}</strong><p className="mt-1 text-xs text-muted-foreground">{toast.body}</p></div>
      <Button size="icon-xs" variant="ghost" onClick={() => dismiss(toast.id)} aria-label="Dismiss notification"><X className="size-3.5" /></Button>
    </div>)}
  </div>
}
