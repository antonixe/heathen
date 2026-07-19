import { cn } from '@/lib/utils'

export default function ProbabilityBadge({ probability, confidence, confidenceScore, reasons = [], label = 'probability' }) {
  const percent = Math.round((probability || 0) * 100)
  const className = percent >= 70 ? 'text-success' : percent >= 40 ? 'text-warning' : 'text-destructive'
  const confidenceText = confidence || 'low'
  const reasonText = reasons.length ? `, ${reasons.slice(0, 5).join(', ')}` : ''
  const scoreText = Number.isFinite(Number(confidenceScore)) ? `, score ${Math.round(confidenceScore * 100)}%` : ''
  const description = `Heuristic ${label}: ${percent}%, confidence: ${confidenceText}${scoreText}${reasonText}`
  return <span className={cn('metric text-[11px] font-medium', className)} aria-label={description} title={`${label}: ${percent}%, confidence: ${confidenceText}${scoreText}${reasonText}`}>{percent}% est. <span className="text-muted-foreground">{confidenceText}</span></span>
}
