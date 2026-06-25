import { useLiveQuery } from 'dexie-react-hooks'
import { useState } from 'react'
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { db } from '../../db/db.js'

export default function CompareView({ videos, initial, onClose }) {
  const [a, setA] = useState(initial?.videoId || videos[0]?.videoId || ''), [b, setB] = useState(videos.find(v => v.videoId !== (initial?.videoId || videos[0]?.videoId))?.videoId || '')
  const rowsA = useLiveQuery(() => a ? db.datapoints.where('videoId').equals(a).sortBy('timestamp') : [], [a], [])
  const rowsB = useLiveQuery(() => b ? db.datapoints.where('videoId').equals(b).sortBy('timestamp') : [], [b], [])
  const map = new Map(); const startA = rowsA[0]?.timestamp || 0, startB = rowsB[0]?.timestamp || 0
  rowsA.forEach(point => map.set(Math.round((point.timestamp - startA) / 300000) * 5, { minute: Math.round((point.timestamp - startA) / 300000) * 5, a: point.viewCount - (rowsA[0]?.viewCount || 0) }))
  rowsB.forEach(point => { const minute = Math.round((point.timestamp - startB) / 300000) * 5; map.set(minute, { ...(map.get(minute) || { minute }), b: point.viewCount - (rowsB[0]?.viewCount || 0) }) })
  const data = [...map.values()].sort((x, y) => x.minute - y.minute)
  return <div className="overlay"><section className="modal compare"><header><div><span className="eyebrow">RELATIVE MOMENTUM</span><h2>Compare tracked releases</h2></div><button className="plain close" onClick={onClose}>ESC</button></header><div className="compare-controls"><select value={a} onChange={event => setA(event.target.value)}>{videos.map(v => <option key={v.videoId} value={v.videoId}>{v.customLabel || v.title}</option>)}</select><span>VS</span><select value={b} onChange={event => setB(event.target.value)}>{videos.map(v => <option key={v.videoId} value={v.videoId}>{v.customLabel || v.title}</option>)}</select></div><div className="compare-chart"><ResponsiveContainer width="100%" height="100%"><LineChart data={data}><CartesianGrid vertical={false} stroke="oklch(0.22 0.014 268)" strokeDasharray="2 4"/><XAxis dataKey="minute" axisLine={false} tick={{ fill: 'oklch(0.40 0.008 268)', fontFamily: 'DM Mono' }} /><YAxis axisLine={false} tick={{ fill: 'oklch(0.40 0.008 268)', fontFamily: 'DM Mono' }} /><Tooltip contentStyle={{ background: 'oklch(0.16 0.018 265)', border: '1px solid oklch(0.22 0.014 268)', boxShadow: 'none' }} /><Line dataKey="a" stroke="oklch(0.84 0.14 82)" dot={false} isAnimationActive={false}/><Line dataKey="b" stroke="oklch(0.74 0.14 148)" dot={false} isAnimationActive={false}/></LineChart></ResponsiveContainer></div><footer>Views gained · X-axis minutes since tracking began</footer></section></div>
}
