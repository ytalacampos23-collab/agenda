import { FormEvent, useEffect, useMemo, useState } from 'react'
import { CalendarDays, ClipboardList, History, Plus, Search, ShieldCheck, Menu, X, CheckCircle2, Clock3, AlertCircle, ChevronDown, LogOut, LoaderCircle, Trash2 } from 'lucide-react'
import { hasSupabaseConfig, supabase } from './lib/supabase'

type TaskStatus = 'A fazer' | 'Em andamento' | 'Concluído'
type Priority = 'Baixa' | 'Média' | 'Alta' | 'Urgente'
type Task = { id: string; title: string; description: string | null; category: string; due_date: string; due_time: string | null; status: TaskStatus; priority: Priority; deleted_at?: string | null }
type PendingChange = { id: string; task: Task; deleted_at: string | null }
const cacheKey = (id: string) => 'wattwise:' + id + ':tasks'
const queueKey = (id: string) => 'wattwise:' + id + ':queue'
const readJson = <T,>(key: string, fallback: T): T => { try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback } catch { return fallback } }
const savePending = (id: string, queue: PendingChange[]) => localStorage.setItem(queueKey(id), JSON.stringify(queue))
const saveTaskCache = (id: string, tasks: Task[]) => localStorage.setItem(cacheKey(id), JSON.stringify(tasks))

const categories = [
  ['Cemig', '#B9D3F2'], ['Ouvidorias', '#D9C7F0'], ['Auditorias', '#F6D6B8'],
  ['CRM / Whatsapp', '#C7E5D0'], ['Parceiro', '#F2C9D8'], ['Comissão', '#BDE5E8'],
  ['Gerador', '#D9DDE3'], ['Auditoria Clientes Cemig', '#E8D2BD'],
  ['Impressão Cemig', '#C9CCF0'], ['Reunião', '#F2C4C4'],
  ['Cliente Wege / Smartben', '#BFDCD5'], ['Cliente Transferencia', '#E8C7EA'],
] as const
const today = () => { const d = new Date(); return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-') }

export default function App() {
  const [section, setSection] = useState<'agenda' | 'visitas' | 'historico'>('agenda')
  const [sessionReady, setSessionReady] = useState(false)
  const [userEmail, setUserEmail] = useState('')
  const [userId, setUserId] = useState('')
  const [isOnline, setIsOnline] = useState(navigator.onLine)
  const [syncing, setSyncing] = useState(false)
  const [pendingCount, setPendingCount] = useState(0)
  const [syncVersion, setSyncVersion] = useState(0)
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [tasks, setTasks] = useState<Task[]>([])
  const [loadingTasks, setLoadingTasks] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('Cemig')
  const [date, setDate] = useState(today())
  const [time, setTime] = useState('')
  const [priority, setPriority] = useState<Priority>('Média')
  const [statusFilter, setStatusFilter] = useState('Todos')
  const [search, setSearch] = useState('')
  const [mobileOpen, setMobileOpen] = useState(false)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    if (!supabase) { setSessionReady(true); return }
    supabase.auth.getSession().then(({ data, error }) => {
      if (error) setError(error.message)
      const sessionUser = data.session?.user
      if (sessionUser) { setUserEmail(sessionUser.email ?? ''); setUserId(sessionUser.id); localStorage.setItem('wattwise:offline-user', JSON.stringify({ id: sessionUser.id, email: sessionUser.email ?? '' })) }
      else if (!navigator.onLine) { const cached = readJson<{id:string;email:string}|null>('wattwise:offline-user', null); if (cached) { setUserEmail(cached.email); setUserId(cached.id) } }
      setSessionReady(true)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserEmail(session?.user.email ?? '')
      setUserId(session?.user.id ?? '')
      if (session?.user) localStorage.setItem('wattwise:offline-user', JSON.stringify({ id: session.user.id, email: session.user.email ?? '' }))
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    const update = () => setIsOnline(navigator.onLine)
    window.addEventListener('online', update); window.addEventListener('offline', update)
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update) }
  }, [])

  useEffect(() => {
    if (!userId) return
    const cached = readJson<Task[]>(cacheKey(userId), [])
    setTasks(cached.filter(t => !t.deleted_at))
    setPendingCount(readJson<PendingChange[]>(queueKey(userId), []).length)
    if (!isOnline || !supabase) return
    let cancelled = false
    const sync = async () => {
      setSyncing(true)
      try {
        let queue = readJson<PendingChange[]>(queueKey(userId), [])
        for (const change of queue) {
          const row = { ...change.task, user_id: userId, deleted_at: change.deleted_at }
          const result = await supabase!.from('tasks').upsert(row, { onConflict: 'id' })
          if (result.error) throw result.error
          queue = queue.filter(item => item.id !== change.id)
          savePending(userId, queue)
          if (!cancelled) setPendingCount(queue.length)
        }
        const result = await supabase!.from('tasks').select('id,title,description,category,due_date,due_time,status,priority,deleted_at').order('due_date', { ascending: true })
        if (result.error) throw result.error
        if (!cancelled) {
          const merged = ((result.data ?? []) as Task[]).filter(t => !t.deleted_at)
          const pending = readJson<PendingChange[]>(queueKey(userId), [])
          for (const change of pending) {
            const index = merged.findIndex(t => t.id === change.id)
            if (change.deleted_at) { if (index >= 0) merged.splice(index, 1) }
            else if (index >= 0) merged[index] = change.task
            else merged.push(change.task)
          }
          merged.sort((x,y) => x.due_date.localeCompare(y.due_date))
          setTasks(merged); saveTaskCache(userId, merged); setError('')
        }
      } catch (e) {
        if (!cancelled) setError('Sincronização pendente. Seus dados continuam salvos neste dispositivo. ' + (e instanceof Error ? e.message : ''))
      } finally { if (!cancelled) setSyncing(false) }
    }
    void sync()
    return () => { cancelled = true }
  }, [userId, isOnline, syncVersion])

  function queueChange(task: Task, deleted_at: string | null = null) {
    if (!userId) return
    const queue = readJson<PendingChange[]>(queueKey(userId), [])
    const next = [...queue.filter(item => item.id !== task.id), { id: task.id, task, deleted_at }]
    savePending(userId, next); setPendingCount(next.length); setSyncVersion(v => v + 1)
  }

  async function handleAuth(event: FormEvent) {
    event.preventDefault()
    if (!supabase) return
    setAuthBusy(true); setError(''); setNotice('')
    try {
      if (authMode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email: email.trim(), password })
        if (error) throw error
        if (data.session) setNotice('Conta criada! Você já está conectado.')
        else setNotice('Cadastro iniciado. Confira seu e-mail para confirmar a conta e depois entre.')
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
        if (error) throw error
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível concluir o acesso.') }
    finally { setAuthBusy(false) }
  }

  async function addTask(event: FormEvent) {
    event.preventDefault()
    if (!userId || !title.trim()) return
    setError(''); setNotice('')
    const task: Task = { id: crypto.randomUUID(), title: title.trim(), description: description.trim() || null, category, due_date: date, due_time: time || null, priority, status: 'A fazer', deleted_at: null }
    const nextTasks = [...tasks, task].sort((a,b) => a.due_date.localeCompare(b.due_date))
    setTasks(nextTasks); saveTaskCache(userId, nextTasks)
    queueChange(task)
    setTitle(''); setDescription(''); setTime(''); setPriority('Média'); setDate(today())
    setNotice(isOnline ? 'Atividade salva neste dispositivo e enviada para sincronização.' : 'Atividade salva neste dispositivo. Será sincronizada quando a internet voltar.')
  }

  async function changeStatus(id: string, status: TaskStatus) {
    const task = tasks.find(t => t.id === id)
    if (!task) return
    const updated = { ...task, status }
    const nextTasks = tasks.map(t => t.id === id ? updated : t)
    setTasks(nextTasks); saveTaskCache(userId, nextTasks)
    queueChange(updated)
    setNotice(isOnline ? 'Status atualizado. Sincronização iniciada.' : 'Status atualizado neste dispositivo e aguardando sincronização.')
  }

  async function deleteTask(id: string) {
    if (!window.confirm('Deseja arquivar esta atividade? Ela deixará de aparecer na agenda.')) return
    const task = tasks.find(t => t.id === id)
    if (!task) return
    queueChange(task, new Date().toISOString())
    const nextTasks = tasks.filter(t => t.id !== id)
    setTasks(nextTasks); saveTaskCache(userId, nextTasks)
    setNotice(isOnline ? 'Atividade arquivada. Sincronização iniciada.' : 'Atividade arquivada neste dispositivo e aguardando sincronização.')
  }

  async function signOut() { if (supabase) await supabase.auth.signOut(); setTasks([]); setNotice('Você saiu da sua conta.') }

  const visibleTasks = useMemo(() => tasks.filter(t => (statusFilter === 'Todos' || t.status === statusFilter) && (t.title.toLowerCase().includes(search.toLowerCase()) || t.category.toLowerCase().includes(search.toLowerCase()))), [tasks,statusFilter,search])
  const nav = [
    { id: 'agenda' as const, label: 'Minha Agenda', icon: CalendarDays },
    { id: 'visitas' as const, label: 'Visitas à Cemig', icon: ClipboardList },
    { id: 'historico' as const, label: 'Histórico', icon: History },
  ]

  if (!sessionReady) return <div className="auth-screen"><div className="auth-card"><LoaderCircle className="spin"/><p>Conectando ao Watt-Wise...</p></div></div>
  if (!hasSupabaseConfig || !supabase) return <div className="auth-screen"><div className="auth-card"><div className="brand-mark auth-mark">W</div><h1>Watt-Wise</h1><p>Falta configurar a conexão com o Supabase para liberar o acesso.</p><div className="setup-note"><ShieldCheck size={18}/><span>O endereço do projeto e a chave pública precisam estar nas variáveis de ambiente da hospedagem.</span></div></div></div>
  if (!userEmail) return <div className="auth-screen"><form className="auth-card" onSubmit={handleAuth}><div className="brand-mark auth-mark">W</div><div className="eyebrow">ORGANIZAÇÃO & ACOMPANHAMENTO</div><h1>Watt-Wise</h1><p>{authMode === 'login' ? 'Entre para acessar sua agenda.' : 'Crie sua conta para começar a usar sua agenda.'}</p>{!isOnline && <div className="notice">Você está sem internet. Para entrar off-line, é necessário já ter acessado esta conta neste dispositivo.</div>}
    {error && <div className="error-message">{error}</div>}{notice && <div className="notice">{notice}</div>}
    <label>E-mail<input type="email" autoComplete="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="seu@email.com"/></label>
    <label>Senha<input type="password" autoComplete={authMode === 'login' ? 'current-password' : 'new-password'} minLength={6} required value={password} onChange={e => setPassword(e.target.value)} placeholder="Mínimo de 6 caracteres"/></label>
    <button className="primary-button auth-submit" disabled={authBusy}>{authBusy ? 'Aguarde...' : authMode === 'login' ? 'Entrar' : 'Criar minha conta'}</button>
    <button type="button" className="text-button" onClick={() => {setAuthMode(authMode === 'login' ? 'signup' : 'login');setError('');setNotice('')}}>{authMode === 'login' ? 'Ainda não tem conta? Criar acesso' : 'Já tem uma conta? Voltar ao login'}</button>
    <small className="auth-foot"><ShieldCheck size={14}/> Seus registros são separados por conta.</small>
  </form></div>

  return <div className="app-shell">
    <aside className={`sidebar ${mobileOpen ? 'open' : ''}`}>
      <div className="brand"><div className="brand-mark">W</div><div><strong>Watt-Wise</strong><small>Organização & acompanhamento</small></div><button className="mobile-close" onClick={() => setMobileOpen(false)}><X size={18}/></button></div>
      <div className="nav-caption">ESPAÇO DE TRABALHO</div>
      {nav.map(item => <button key={item.id} className={`nav-item ${section === item.id ? 'active' : ''}`} onClick={() => {setSection(item.id); setMobileOpen(false)}}><item.icon size={18}/>{item.label}</button>)}
      <div className="sidebar-bottom"><ShieldCheck size={17}/><span>Área privada</span><small>Conectado como {userEmail}</small></div>
    </aside>
    {mobileOpen && <button className="scrim" onClick={() => setMobileOpen(false)} aria-label="Fechar menu"/>}
    <main className="main">
      <header className="topbar"><button className="menu-button" onClick={() => setMobileOpen(true)}><Menu/></button><div className="breadcrumb">Watt-Wise <span>/</span> {nav.find(n => n.id === section)?.label}</div><div className={'sync-indicator ' + (!isOnline ? 'offline' : syncing ? 'syncing' : pendingCount ? 'pending' : 'online')}><span className="sync-dot"/>{!isOnline ? 'Off-line' : syncing ? 'Sincronizando...' : pendingCount ? pendingCount + ' pendente(s)' : 'Sincronizado'}</div><button className="profile" onClick={signOut} title="Sair da conta"><LogOut size={14}/> Sair <ChevronDown size={14}/></button></header>
      <div className="content">
        <div className="welcome"><div><div className="eyebrow">PAINEL DE CONTROLE</div><h1>{section === 'agenda' ? 'Minha Agenda' : section === 'visitas' ? 'Visitas à Cemig' : 'Histórico'}</h1><p>{section === 'agenda' ? 'Organize suas atividades e acompanhe suas prioridades.' : section === 'visitas' ? 'Registre atas, encaminhamentos e pendências das visitas.' : 'Acompanhe as movimentações registradas no sistema.'}</p></div><div className="date-chip"><CalendarDays size={16}/>{new Date().toLocaleDateString('pt-BR', { day: '2-digit', month: 'long', year: 'numeric' })}</div></div>
        {error && <div className="error-message">{error}<button onClick={() => setError('')}>Fechar</button></div>}
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
            <form className="form-grid" onSubmit={addTask}>
              <label className="wide">Título da atividade<input required value={title} onChange={e => setTitle(e.target.value)} placeholder="Ex.: Retornar solicitação do cliente"/></label>
              <label className="wide">Descrição (opcional)<input value={description} onChange={e => setDescription(e.target.value)} placeholder="Detalhes ou orientações"/></label>
              <label>Categoria<select value={category} onChange={e => setCategory(e.target.value)}>{categories.map(c => <option key={c[0]}>{c[0]}</option>)}</select></label>
              <label>Data<input type="date" required value={date} onChange={e => setDate(e.target.value)}/></label>
              <label>Horário (opcional)<input type="time" value={time} onChange={e => setTime(e.target.value)}/></label>
              <label>Prioridade<select value={priority} onChange={e => setPriority(e.target.value as Priority)}><option>Baixa</option><option>Média</option><option>Alta</option><option>Urgente</option></select></label>
              <div className="wide form-action"><button className="primary-button" disabled={!title.trim()}><Plus size={17}/>Salvar atividade</button></div>
            </form>
          </section>
          <section className="panel">
            <div className="panel-heading list-heading"><div><h2>Suas atividades</h2><p>As atividades ficam salvas na sua conta.</p></div><label className="filter"><Search size={15}/><select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}><option>Todos</option><option>A fazer</option><option>Em andamento</option><option>Concluído</option></select></label></div>
            <div className="search-line"><Search size={15}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por atividade ou categoria..."/></div>
            {loadingTasks ? <div className="empty"><LoaderCircle className="spin"/><span>Carregando atividades...</span></div> : visibleTasks.length === 0 ? <div className="empty"><CalendarDays size={28}/><strong>Nenhuma atividade por aqui</strong><span>Adicione uma atividade acima para começar.</span></div> : <div className="task-list">{visibleTasks.map(task => <div className="task-row" key={task.id}><div className="task-dot" style={{background: categories.find(c => c[0] === task.category)?.[1]}}/><div className="task-info"><strong>{task.title}</strong><span>{task.category} · {new Date(`${task.due_date}T12:00:00`).toLocaleDateString('pt-BR')}{task.due_time ? ` · ${task.due_time.slice(0,5)}` : ''} · Prioridade {task.priority}</span>{task.description && <small>{task.description}</small>}</div><select aria-label={`Status de ${task.title}`} value={task.status} onChange={e => changeStatus(task.id, e.target.value as TaskStatus)}><option>A fazer</option><option>Em andamento</option><option>Concluído</option></select><button className="icon-button" onClick={() => deleteTask(task.id)} title="Arquivar atividade"><Trash2 size={15}/></button></div>)}</div>}
          </section>
        </>}
        {section === 'visitas' && <section className="panel coming"><div className="coming-icon"><ClipboardList size={28}/></div><h2>Atas e acompanhamentos da Cemig</h2><p>Esta área será implementada na próxima etapa, incluindo tópicos individuais, responsáveis, protocolos, prazos e continuidade manual de pendências entre atas.</p><ul><li>Uma ata por visita, com quantos tópicos forem necessários.</li><li>Sugestão de pendências para a próxima ata, sempre com sua aprovação.</li><li>Histórico preservado e vínculo com a ata de origem.</li></ul></section>}
        {section === 'historico' && <section className="panel coming"><div className="coming-icon"><History size={28}/></div><h2>Histórico de movimentações</h2><p>O banco já registra automaticamente as alterações de status e de dados das atividades. A tela de consulta do histórico será ligada na próxima etapa.</p></section>}
        <footer>Watt-Wise <span>•</span> Em desenvolvimento</footer>
      </div>
    </main>
  </div>
}
