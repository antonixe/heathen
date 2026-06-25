import { detectBatchFlush } from '../../utils/velocity.js'

export default function MiniSparkline({ points }) {
  const data = points.slice(-30), flags = new Set(detectBatchFlush(data))
  if (data.length < 2) return <div className="spark-empty">Waiting for a second sample</div>
  const values = data.map(point => point.velocityPerMin ?? 0)
  const min = Math.min(...values, 0), max = Math.max(...values, 1), range = max - min || 1
  const coords = values.map((value, index) => ({ x: index * 100 / (values.length - 1), y: 72 - ((value - min) / range) * 64 }))
  const path = coords.map((point, index) => `${index ? 'L' : 'M'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ')
  const recent = values.slice(-3)
  const trend = recent.at(-1) > recent[0] ? 'up' : recent.at(-1) < recent[0] ? 'down' : 'flat'
  return <svg className={`spark ${trend}`} viewBox="0 0 100 80" preserveAspectRatio="none" aria-label="Recent velocity sparkline">
    <path d={path} fill="none" vectorEffect="non-scaling-stroke" />
    {coords.map((point, index) => flags.has(index) && <circle key={index} cx={point.x} cy={point.y} r="2" vectorEffect="non-scaling-stroke" />)}
  </svg>
}
