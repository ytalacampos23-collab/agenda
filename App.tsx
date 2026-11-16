import { useState } from 'react'
import { CalendarDays, ClipboardList, History, Plus, Search, ShieldCheck, Menu, X, CheckCircle2, Clock3, AlertCircle, ChevronDown } from 'lucide-react'
import { hasSupabaseConfig, supabase } from './lib/supabase'

type TaskStatus = 'A fazer' | 'Em andamento' | 'Concluído'
type Task = { id: number; title: string; category: string; date: string; status: TaskStatus; priority: string }

const categories = [
  ['Cemig', '#B9D3F2'], ['Ouvidorias', '#D9C7F0'], ['Auditorias', '#F6D6B8'],
  ['CRM / Whatsapp', '#C7E5D0'], ['Parceiro', '#F2C9D8'], ['Comissão', '#BDE5E8'],
  ['Gerador', '#D9DDE3'], ['Auditoria Clientes Cemig', '#E8D2BD'],
  ['Impressão Cemig', '#C9CCF0'], ['Reunião', '#F2C4C4'],
  ['Cliente Wege / Smartben', '#BFDCD5'], ['Cliente Transferencia', '#E8C7EA'],
] as const

const today = new Date().toISOString().slice(0, 10)

export default function App() {
  const [section, setSection] = useState<'agenda' | 'visitas' | 'historico'>('agenda')
  const [tasks, setTasks] = useState<Task[]>([])
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('Cemig')
  const [date, setDate] = useState(today)
  const [statusFilter, setStatusFilter] = useState('Todos')
  const [mobileOpen, setMobileOpen] = useState(false)
  const [notice, setNotice] = useState('')

  async function signOutOrInfo() {
    if (supabase) await supabase.auth.signOut()
    setNotice('A conexão com o banco será configurada na próxima etapa.')
  }

  function addTask() {
    if (!title.trim()) return
    setTasks(current => [...current, { id: Date.now(), title: title.trim(), category, date, status: 'A fazer', priority: 'Média' }])
    setTitle('')
    setNotice('Atividade adicionada nesta prévia. A gravação permanente será ativada após configurar o banco de dados.')
  }

  function changeStatus(id: number, status: TaskStatus) {
    setTasks(current => current.map(task => task.id === id ? { ...task, status } : task))
  }

  const visibleTasks = tasks.filter(t => statusFilter === 'Todos' || t.status === statusFilter)
  const nav = [
    { id: 'agenda' as const, label: 'Minha Agenda', icon: CalendarDays },
    { id: 'visitas' as const, label: 'Visitas à Cemig', icon: ClipboardList },
    { id: 'historico' as const, label: 'Histórico', icon: History },
  ]

  return <div className="app-shell">
    <aside className={`sidebar ${mobileOpen ? 'open' : ''}`}>
      <div className="brand"><div className="brand-mark">W</div><div><strong>Watt-Wise</strong><small>Organização & acompanhamento</small></div><button className="mobile-close" onClick={() => setMobileOpen(false)}><X size={18}/></button></div>
      <div className="nav-caption">ESPAÇO DE TRABALHO</div>
      {nav.map(item => <button key={item.id} className={`nav-item ${section === item.id ? 'active' : ''}`} onClick={() => {setSection(item.id); setMobileOpen(false)}}><item.icon size={18}/>{item.label}</button>)}
      <div className="sidebar-bottom"><ShieldCheck size={17}/><span>Área privada</span><small>Seus dados protegidos após configuração.</small></div>
    </aside>
    {mobileOpen && <button className="scrim" onClick={() => setMobileOpen(false)} aria-label="Fechar menu"/>}
    <main className="main">
      <header className="topbar"><button className="menu-button" onClick={() => setMobileOpen(true)}><Menu/></button><div className="breadcrumb">Watt-Wise <span>/</span> {nav.find(n => n.id === section)?.label}</div><button className="profile" onClick={signOutOrInfo}>WW <ChevronDown size={14}/></button></header>
      <div className="content">
        <div className="welcome"><div><div className="eyebrow">PAINEL DE CONTROLE</div><h1>{section === 'agenda' ? 'Minha Agenda' : section === 'visitas' ? 'Visitas à Cemig' : 'Histórico'}</h1><p>{section === 'agenda' ? 'Organize suas atividades e acompanhe suas prioridades.' : section === 'visitas' ? 'Registre atas, encaminhamentos e pendências das visitas.' : 'Acompanhe as movimentações registradas no sistema.'}</p></div><div className="date-chip"><CalendarDays size={16}/>{new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}</div></div>
        {!hasSupabaseConfig && <div className="setup-note"><ShieldCheck size={18}/><div><strong>Configuração inicial</strong><span>Esta é uma prévia de desenvolvimento. Login e salvamento permanente serão ativados depois de conectar o banco de dados.</span></div></div>}
        {notice && <div className="notice" role="status">{notice}<button onClick={() => setNotice('')}>Fechar</button></div>}
        {section === 'agenda' && <>
          <div className="stats">
            <div className="stat-card"><span>Atividades cadastradas</span><strong>{tasks.length}</strong><CalendarDays/></div>
            <div className="stat-card"><span>A fazer</span><strong>{tasks.filter(t => t.status === 'A fazer').length}</strong><AlertCircle/></div>
            <div className="stat-card"><span>Em andamento</span><strong>{tasks.filter(t => t.status === 'Em andamento').length}</strong><Clock3/></div>
            <div className="stat-card"><span>Concluídas</span><strong>{tasks.filter(t => t.status === 'Concluído').length}</strong><CheckCircle2/></div>
          </div>
          <section className="panel">
            <div className="panel-heading"><div><h2>Adicionar atividade</h2><p>Cadastre uma nova obrigação ou lembrete.</p></div><span className="soft-tag">NOVA TAREFA</span></div>
            <div className="form-grid"><label className="wide">Título da atividade<input value={title} onChange={e => setTitle(e.target.value)} placeholder="Ex.: Retornar solicitação do cliente"/></label><label>Categoria<select value={category} onChange={e => setCategory(e.target.value)}>{categories.map(c => <option key={c[0]}>{c[0]}</option>)}</select></label><label>Data<input type="date" value={date} onChange={e => setDate(e.target.value)}/></label><div className="wide form-action"><button className="primary-button" onClick={addTask}><Plus size={17}/>Adicionar atividade</button></div></div>
          </section>
          <section className="panel">
            <div className="panel-heading list-heading"><div><h2>Suas atividades</h2><p>Atualize o andamento sempre que precisar.</p></div><label className="filter"><Search size={15}/><select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}><option>Todos</option><option>A fazer</option><option>Em andamento</option><option>Concluído</option></select></label></div>
            {visibleTasks.length === 0 ? <div className="empty"><CalendarDays size={28}/><strong>Nenhuma atividade por aqui</strong><span>Adicione uma atividade acima para começar.</span></div> : <div className="task-list">{visibleTasks.map(task => <div className="task-row" key={task.id}><div className="task-dot" style={{background: categories.find(c => c[0] === task.category)?.[1]}}/><div className="task-info"><strong>{task.title}</strong><span>{task.category} · {new Date(`${task.date}T12:00:00`).toLocaleDateString('pt-BR')}</span></div><select aria-label={`Status de ${task.title}`} value={task.status} onChange={e => changeStatus(task.id, e.target.value as TaskStatus)}><option>A fazer</option><option>Em andamento</option><option>Concluído</option></select></div>)}</div>}
          </section>
        </>}
        {section === 'visitas' && <section className="panel coming"><div className="coming-icon"><ClipboardList size={28}/></div><h2>Atas e acompanhamentos da Cemig</h2><p>A estrutura desta área será implementada na próxima etapa, incluindo tópicos individuais, responsáveis, protocolos, prazos e continuidade manual de pendências entre atas.</p><ul><li>Uma ata por visita, com quantos tópicos forem necessários.</li><li>Sugestão de pendências para a próxima ata, sempre com sua aprovação.</li><li>Histórico preservado e vínculo com a ata de origem.</li></ul></section>}
        {section === 'historico' && <section className="panel coming"><div className="coming-icon"><History size={28}/></div><h2>Histórico de movimentações</h2><p>O histórico completo será ligado ao banco de dados para registrar alterações de status, prazos, responsáveis e transferências entre atas.</p></section>}
        <footer>Watt-Wise <span>•</span> Primeira versão em desenvolvimento</footer>
      </div>
    </main>
  </div>
}
