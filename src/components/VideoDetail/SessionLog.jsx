import { Download } from 'lucide-react'
import { detectBatchFlush } from '../../utils/velocity.js'
import { downloadFile, videoToCsv } from '../../utils/export.js'
import { formatDateTimeEAT } from '../../utils/time.js'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

export default function SessionLog({ video, points, notes }) {
  const flagged = new Set(detectBatchFlush(points))
  const exportCsv = () => downloadFile(`${video.videoId}.csv`, videoToCsv(points, notes), 'text/csv')

  return <section className="detail-mode history-mode">
    <header className="detail-mode-header">
      <div><h2>Observation history</h2><p>Raw polling evidence stored locally in this browser.</p></div>
      <div className="history-actions"><span className="metric">{points.length.toLocaleString()} samples</span><Button type="button" size="sm" variant="outline" onClick={exportCsv}><Download className="size-4" />Export CSV</Button></div>
    </header>

    {points.length ? <ScrollArea className="history-table-wrap">
      <Table className="metric text-xs">
        <TableHeader><TableRow><TableHead>Time (EAT)</TableHead><TableHead className="text-right">Views</TableHead><TableHead className="text-right">Delta</TableHead><TableHead className="text-right">V/min</TableHead><TableHead className="text-right">Likes</TableHead><TableHead className="text-right">Comments</TableHead><TableHead className="text-right">Evidence</TableHead></TableRow></TableHeader>
        <TableBody>{points.slice(-500).reverse().map((point, reverseIndex) => {
          const index = points.length - 1 - reverseIndex
          return <TableRow key={point.id || point.timestamp}><TableCell>{formatDateTimeEAT(point.timestamp)}</TableCell><TableCell className="text-right">{point.viewCount.toLocaleString()}</TableCell><TableCell className="text-right">{point.delta?.toLocaleString() ?? '-'}</TableCell><TableCell className="text-right">{point.velocityPerMin?.toFixed(2) ?? '-'}</TableCell><TableCell className="text-right">{point.likeCount?.toLocaleString() ?? '-'}</TableCell><TableCell className="text-right">{point.commentCount?.toLocaleString() ?? '-'}</TableCell><TableCell className="text-right">{flagged.has(index) ? <span className="history-flag">Batch adjusted</span> : '-'}</TableCell></TableRow>
        })}</TableBody>
      </Table>
    </ScrollArea> : <div className="detail-mode-empty"><strong>No observations yet</strong><p>The first successful poll will create the history table.</p></div>}

    {points.length > 500 && <p className="history-footnote">Showing the latest 500 rows. The CSV export includes every local observation.</p>}
  </section>
}