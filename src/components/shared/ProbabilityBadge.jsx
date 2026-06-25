export default function ProbabilityBadge({ probability, confidence }) {
  const percent = Math.round((probability || 0) * 100)
  const tone = percent >= 70 ? 'good' : percent >= 40 ? 'warn' : 'bad'
  return <span className={`badge probability ${tone}`} title={`${confidence || 'low'} confidence`}>{percent}%</span>
}
