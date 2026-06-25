import { useQuota } from '../../hooks/useQuota.js'

export default function QuotaBar() {
  const quota = useQuota(), tone = quota.ratio >= .8 ? 'danger' : quota.ratio >= .5 ? 'warn' : 'good'
  return <div className="quota" title="Locally counted successful API requests"><span>QUOTA</span><div className="quota-track"><i className={tone} style={{ width: `${Math.min(100, quota.ratio * 100)}%` }} /></div><b>{quota.used.toLocaleString()} / {quota.limit.toLocaleString()}</b></div>
}
