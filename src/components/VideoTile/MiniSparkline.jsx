import { detectBatchFlush } from '../../utils/velocity.js'

export default function MiniSparkline({ points }) {
  const data = points.slice(-20), flags = new Set(detectBatchFlush(data))
  if (data.length < 2) return <svg className="spark spark-waiting" viewBox="0 0 100 72" preserveAspectRatio="none" aria-label="Waiting for another sample"><path d="M4 54 C24 44 42 48 60 34 C76 22 86 28 96 18" /></svg>
  const values = data.map(point => point.velocityPerMin ?? 0)
  const min = Math.min(...values, 0), max = Math.max(...values, 1), range = max - min || 1
  const coords = values.map((value, index) => ({ x: 4 + index * 92 / (values.length - 1), y: 68 - ((value - min) / range) * 60 }))
  const line = coords.map((point, index) => `${index ? 'L' : 'M'} ${point.x.toFixed(2)} ${point.y.toFixed(2)}`).join(' ')
  const first = coords[0], last = coords.at(-1)
  const area = `${line} L ${last.x.toFixed(2)} 70 L ${first.x.toFixed(2)} 70 Z`
  const recent = values.slice(-3)
  const trend = recent.at(-1) > recent[0] ? 'up' : recent.at(-1) < recent[0] ? 'down' : 'flat'
  return <svg className={`spark ${trend}`} viewBox="0 0 100 72" preserveAspectRatio="none" aria-label="Recent velocity sparkline">
    <path className="spark-area" d={area} />
    <path className="spark-line" d={line} fill="none" vectorEffect="non-scaling-stroke" />
    {coords.map((point, index) => flags.has(index) && <circle key={index} cx={point.x} cy={point.y} r="2.8" vectorEffect="non-scaling-stroke" />)}
  </svg>
}
