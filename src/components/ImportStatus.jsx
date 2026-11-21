import './ImportStatus.css'

export default function ImportStatus({ title, detail, tone = 'neutral', action, announce = true }) {
  return <div className={`import-state import-state-${tone}${tone === 'success' ? ' motion-result' : ''}`}>
    <div className="import-state-copy" role={announce ? (tone === 'error' ? 'alert' : 'status') : undefined}>
      <p className={'import-state-title' + (tone === 'working' ? ' motion-busy' : '')}>{title}</p>
      {detail && <p className="import-state-detail reading-copy">{detail}</p>}
    </div>
    {action && <div className="import-state-action">{action}</div>}
  </div>
}
