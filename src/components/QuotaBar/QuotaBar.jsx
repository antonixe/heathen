import { useQuota } from '../../hooks/useQuota.js'

export default function QuotaBar() {
  const quota = useQuota(), tone = quota.ratio >= .8 ? 'danger' : quota.ratio >= .5 ? 'warn' : 'good'
  // lives in Settings beside the API key now rather than the top bar, where it was the most
  // prominent thing on screen and the least often needed
  return <div className="quota">
    <span>Daily quota</span>
    <div className="quota-track"><i className={tone} style={{ width: `${Math.min(100, quota.ratio * 100)}%` }} /></div>
    <b>{quota.used.toLocaleString()} / {quota.limit.toLocaleString()}</b>
  </div>
}
