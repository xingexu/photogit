import { useState } from 'react'
import {
  Archive,
  ArrowDownToLine,
  ArrowUpFromLine,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock3,
  Copy,
  GitBranch,
  GitCommitHorizontal,
  GitMerge,
  History,
  Image,
  Layers3,
  MoreHorizontal,
  MoveRight,
  PanelTop,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  Type,
  Upload,
  X,
} from 'lucide-react'
import './styles.css'

const PREVIEW_URL = 'https://photogit-three.vercel.app/'

type Tab = 'history' | 'changes'
type Modal = 'commit' | 'branches' | 'merge' | null

type Change = {
  layer: string
  type: 'text' | 'image' | 'group'
  property: string
  before?: string
  after?: string
  tone: 'amber' | 'blue' | 'violet'
}

const changes: Change[] = [
  { layer: 'Headline', type: 'text', property: 'Text', before: 'Spring collection', after: 'Summer essentials', tone: 'amber' },
  { layer: 'Headline', type: 'text', property: 'Position', before: '401 px', after: '425 px', tone: 'amber' },
  { layer: 'Portrait', type: 'image', property: 'Opacity', before: '100%', after: '85%', tone: 'blue' },
  { layer: 'Portrait', type: 'image', property: 'Mask', before: 'Original', after: 'Modified', tone: 'blue' },
  { layer: 'CTA group', type: 'group', property: 'Layer order', before: 'Below Product', after: 'Above Product', tone: 'violet' },
]

const history = [
  { title: 'Adjust hero typography', author: 'You', when: '4 min ago', hash: '7c21a9', branch: 'main', kind: 'current' },
  { title: 'Move product and shadow', author: 'Maya Chen', when: 'Yesterday', hash: 'a91f02', branch: 'maya/type-experiment', kind: 'past' },
  { title: 'Add mobile layout group', author: 'You', when: 'Monday', hash: '5e114b', branch: 'main', kind: 'past' },
  { title: 'Initial composition', author: 'You', when: 'Monday', hash: '18ab77', branch: 'main', kind: 'past' },
]

function App() {
  const [tab, setTab] = useState<Tab>('history')
  const [modal, setModal] = useState<Modal>(null)
  const [branch, setBranch] = useState('main')
  const [selectedChange, setSelectedChange] = useState(0)
  const [notice, setNotice] = useState('')
  const [commitMessage, setCommitMessage] = useState('Adjust hero typography')

  const announce = (message: string) => {
    setNotice(message)
    window.setTimeout(() => setNotice(''), 2800)
  }

  const handleCommit = () => {
    setModal(null)
    announce(`Version saved to ${branch}`)
  }

  return (
    <main className="app-shell">
      <section className="studio-canvas">
        <div className="canvas-topline">
          <div className="canvas-brand"><span className="brand-mark">V</span><span>Versions</span><span className="brand-kicker">for Photoshop</span></div>
          <div className="canvas-doc-meta"><span className="live-dot" /> <span>Connected</span><span className="meta-divider" /> Product Hero.psd <span className="meta-divider" /> RGB/8</div>
          <button className="canvas-tool" aria-label="Canvas options"><MoreHorizontal size={17} /></button>
        </div>
        <div className="workarea">
          <div className="preview-wrap">
            <div className="preview-shadow" />
            <iframe className="project-snapshot" src={PREVIEW_URL} title="PhotoGit project preview" loading="eager" />
            <div className="canvas-zoom"><span>66.7%</span><ChevronDown size={13} /></div>
          </div>
        </div>
        <div className="canvas-footer"><span><Layers3 size={14} /> 12 layers</span><span><Image size={14} /> 3 linked assets</span><span className="footer-spacer" /><span>Last saved 4 min ago</span></div>
      </section>

      <aside className="versions-panel">
        <header className="panel-header">
          <div className="panel-title-row"><div><div className="eyebrow">WORKSPACE</div><h1>Versions</h1></div><button className="icon-button" aria-label="Panel settings"><Settings2 size={16} /></button></div>
          <div className="branch-row">
            <button className="branch-picker" onClick={() => setModal('branches')}><GitBranch size={14} /><span>{branch}</span><ChevronDown size={13} /></button>
            <div className="sync-state"><span className="sync-count">↕ 2</span><span className="sync-pulse" /></div>
            <button className="icon-button subtle" aria-label="More options" onClick={() => announce('More project actions are coming soon')}><MoreHorizontal size={16} /></button>
          </div>
          <div className="document-name"><span className="psd-badge">Ps</span><span>Product Hero.psd</span></div>
          <div className="dirty-state"><span className="dirty-dot" /> 6 unversioned changes <span className="dirty-detail">in 3 layers</span></div>
          <button className="save-button" onClick={() => setModal('commit')}><GitCommitHorizontal size={16} /> Save version <span className="save-shortcut">⌘ ↵</span></button>
        </header>

        <div className="tabs" role="tablist">
          <button className={tab === 'history' ? 'tab active' : 'tab'} onClick={() => setTab('history')}><History size={14} /> History <span className="tab-count">12</span></button>
          <button className={tab === 'changes' ? 'tab active' : 'tab'} onClick={() => setTab('changes')}><Sparkles size={14} /> Changes <span className="tab-count alert">6</span></button>
        </div>

        <div className="panel-content">
          {tab === 'history' ? <HistoryView onMerge={() => setModal('merge')} onAnnounce={announce} /> : <ChangesView selected={selectedChange} setSelected={setSelectedChange} onReview={() => announce('Review mode: click a layer to focus it on canvas')} />}
        </div>
        <footer className="panel-footer"><button onClick={() => announce('Fetching latest versions...')}><RefreshCw size={13} /> Fetch updates</button><span>Local project</span></footer>
      </aside>

      {notice && <div className="toast"><span className="toast-check">✓</span>{notice}</div>}
      {modal === 'commit' && <CommitModal value={commitMessage} setValue={setCommitMessage} onCancel={() => setModal(null)} onCommit={handleCommit} />}
      {modal === 'branches' && <BranchModal current={branch} onClose={() => setModal(null)} onSwitch={(next) => { setBranch(next); setModal(null); announce(`Switched to ${next}`) }} />}
      {modal === 'merge' && <MergeModal onClose={() => setModal(null)} onComplete={() => { setModal(null); announce('Merge preview applied and verified') }} />}
    </main>
  )
}

function HistoryView({ onMerge, onAnnounce }: { onMerge: () => void; onAnnounce: (message: string) => void }) {
  return <div className="history-view">
    <div className="history-summary"><div><span className="summary-number">12</span><span> versions</span></div><button className="text-action" onClick={onMerge}><GitMerge size={13} /> Merge</button></div>
    <div className="history-line">
      {history.map((item, index) => <button className={`history-item ${item.kind}`} key={item.hash} onClick={() => onAnnounce(`Opening ${item.hash} preview`)}>
        <span className="commit-rail"><span className="commit-node" /></span><span className="history-copy"><span className="history-title">{item.title}</span><span className="history-meta">{item.author} <span>·</span> {item.when}</span><span className="history-branch"><GitBranch size={11} /> {item.branch}</span></span><span className="commit-hash">{item.hash}</span>{index === 0 && <span className="current-tag">CURRENT</span>}
      </button>)}
    </div>
    <button className="load-more" onClick={() => onAnnounce('All versions are already loaded')}>View all versions <ChevronRight size={14} /></button>
    <div className="history-tip"><div className="tip-icon"><Archive size={15} /></div><div><strong>Snapshots stay exact</strong><p>Every version keeps the original PSD for perfect visual fidelity.</p></div></div>
  </div>
}

function ChangesView({ selected, setSelected, onReview }: { selected: number; setSelected: (value: number) => void; onReview: () => void }) {
  return <div className="changes-view">
    <div className="changes-summary"><div><strong>6 changes</strong><span> across 3 layers</span></div><button className="review-button" onClick={onReview}><Search size={13} /> Review on canvas</button></div>
    <div className="change-groups">{changes.map((change, index) => <button className={`change-row ${selected === index ? 'selected' : ''}`} key={`${change.layer}-${change.property}`} onClick={() => setSelected(index)}>
      <span className={`change-icon ${change.tone}`}>{change.type === 'text' ? <Type size={15} /> : change.type === 'image' ? <Image size={15} /> : <Layers3 size={15} />}</span><span className="change-details"><strong>{change.layer}</strong><span className="change-property">{change.property}</span><span className="change-values">{change.before} <b>→</b> {change.after}</span></span><ChevronRight size={14} className="row-chevron" />
    </button>)}</div>
    <div className="change-note"><CircleAlert size={14} /><span>Mask changes are preserved as an atomic layer decision.</span></div>
  </div>
}

function ModalFrame({ children, className = '' }: { children: React.ReactNode; className?: string }) { return <div className="modal-scrim"><div className={`modal ${className}`}>{children}</div></div> }
function ModalHeader({ eyebrow, title, onClose }: { eyebrow: string; title: string; onClose: () => void }) { return <div className="modal-header"><div><div className="eyebrow">{eyebrow}</div><h2>{title}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close"><X size={17} /></button></div> }

function CommitModal({ value, setValue, onCancel, onCommit }: { value: string; setValue: (value: string) => void; onCancel: () => void; onCommit: () => void }) { return <ModalFrame className="commit-modal"><ModalHeader eyebrow="NEW VERSION" title="Save a version" onClose={onCancel} /><label className="field-label" htmlFor="message">VERSION MESSAGE</label><textarea id="message" value={value} onChange={(event) => setValue(event.target.value)} autoFocus /><div className="modal-stat"><Sparkles size={14} /><span>6 changes <b>·</b> 3 layers <b>·</b> ready to save</span></div><div className="modal-actions"><button className="secondary-button" onClick={onCancel}>Cancel</button><button className="primary-button" onClick={onCommit}><GitCommitHorizontal size={15} /> Save version</button></div></ModalFrame> }

function BranchModal({ current, onClose, onSwitch }: { current: string; onClose: () => void; onSwitch: (branch: string) => void }) { const branches = ['main', 'mobile-layout', 'alternate-hero', 'maya/type-experiment']; return <ModalFrame className="branch-modal"><ModalHeader eyebrow="PROJECT BRANCHES" title="Switch branch" onClose={onClose} /><div className="branch-search"><Search size={14} /><span>Search branches...</span></div><div className="branch-list">{branches.map((item) => <button key={item} className="branch-option" onClick={() => onSwitch(item)}><span className={item === current ? 'branch-check active' : 'branch-check'}>{item === current ? '✓' : ''}</span><span>{item}</span><span className="branch-status">{item === current ? 'current' : item === 'mobile-layout' ? '2 ahead' : item === 'alternate-hero' ? 'synced' : 'remote'}</span></button>)}</div><button className="new-branch" onClick={() => onSwitch('new-layout')}><Plus size={15} /> New branch</button></ModalFrame> }

function MergeModal({ onClose, onComplete }: { onClose: () => void; onComplete: () => void }) { return <ModalFrame className="merge-modal"><ModalHeader eyebrow="MERGE BRANCH" title="Bring changes into main" onClose={onClose} /><div className="merge-route"><span>FROM</span><strong>mobile-layout</strong><MoveRight size={16} /><span>INTO</span><strong>main</strong></div><div className="merge-section"><div className="section-heading"><span className="success-mark">✓</span><strong>Automatically resolved</strong><span>7 changes</span></div><div className="resolved-list"><span>✓ 4 text and style changes</span><span>✓ 2 visibility changes</span><span>✓ 1 added group</span></div></div><div className="merge-section conflict-section"><div className="section-heading"><span className="conflict-mark">!</span><strong>Needs your decision</strong><span>2 conflicts</span></div><div className="conflict-list"><button><Type size={14} /> Headline <span>text changed on both branches</span><ChevronRight size={14} /></button><button><Image size={14} /> Portrait <span>mask changed on both branches</span><ChevronRight size={14} /></button></div></div><div className="modal-actions"><button className="secondary-button" onClick={onClose}>Cancel</button><button className="primary-button" onClick={onComplete}><GitMerge size={15} /> Review conflicts</button></div></ModalFrame> }

export default App
