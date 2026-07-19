import { useQuota } from '../../hooks/useQuota.js'
import { Progress } from '@/components/ui/progress'

export default function QuotaBar({ compact = false }) {
  const quota = useQuota()
  const tone = quota.ratio >= .8 ? 'bg-destructive' : quota.ratio >= .5 ? 'bg-warning' : 'bg-primary'
  const percentage = Math.min(100, Math.round(quota.ratio * 100))

  if (compact) {
    const quotaTone = quota.ratio >= .8 ? 'danger' : quota.ratio >= .5 ? 'warning' : 'normal'
    return <div className="quota-compact metric" data-tone={quotaTone} title="Locally counted successful API requests" aria-label={'Daily quota ' + percentage + ' percent used'}>
      <div className="quota-compact-copy">
        <span className="quota-compact-label">Daily quota</span>
        <strong>{percentage}%</strong>
        <span className="quota-compact-value">{quota.used.toLocaleString()} / {quota.limit.toLocaleString()}</span>
      </div>
      <span className="quota-compact-meter" aria-hidden="true"><span style={{ width: percentage + '%' }} /></span>
    </div>
  }

  return <div className="quota-panel space-y-2 p-3" title="Locally counted successful API requests">
    <div className="flex items-center justify-between text-[10px] font-medium text-muted-foreground"><span>Quota</span><span>Daily</span></div>
    <Progress value={percentage} className="h-1 bg-background" indicatorClassName={tone} />
    <div className="flex justify-end gap-1 text-xs metric"><strong className="text-foreground">{quota.used.toLocaleString()}</strong><span className="text-muted-foreground">/ {quota.limit.toLocaleString()}</span></div>
  </div>
}