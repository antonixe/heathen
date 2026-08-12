const BARS = { high: 3, medium: 2, low: 1 }

export default function ProbabilityBadge({ probability, confidence = 'low' }) {
  const percent = Math.round((probability || 0) * 100)
  const tone = percent >= 70 ? 'good' : percent >= 40 ? 'warn' : 'bad'
  const filled = BARS[confidence] ?? 1
  // the percentage alone hid how much history it rests on: 67% off three samples read the same
  // as 67% off a fitted curve over four days
  return <span className={`badge probability ${tone}`} title={`${percent}% · ${confidence} confidence`}>
    {percent}%
    <i className="confidence" role="img" aria-label={`${confidence} confidence`}>
      {[0, 1, 2].map(n => <b key={n} className={n < filled ? 'on' : ''} />)}
    </i>
  </span>
}
