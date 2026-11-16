import { FormEvent, useEffect, useMemo, useState } from 'react'
import { CalendarDays, ClipboardList, History, Plus, Search, FileDown, ShieldCheck, Menu, X, CheckCircle2, Clock3, AlertCircle, ChevronDown, ChevronLeft, ChevronRight, LogOut, LoaderCircle, Trash2, Pencil } from 'lucide-react'
import { hasSupabaseConfig, supabase } from './lib/supabase'

type TaskStatus = 'A fazer' | 'Em andamento' | 'Concluído'
type Priority = 'Baixa' | 'Média' | 'Alta' | 'Urgente'
type Task = { id: string; title: string; description: string | null; category: string; due_date: string; due_time: string | null; status: TaskStatus; priority: Priority; deleted_at?: string | null }
type PendingChange = { id: string; task: Task; deleted_at: string | null }
type Visit = { id: string; user_id: string; visit_date: string; title: string; participants: string | null; notes: string | null; created_at?: string }
type VisitTopic = { id: string; visit_id: string; user_id: string; title: string; description: string | null; responsible: string | null; protocol: string | null; due_date: string | null; status: 'Pendente' | 'Em análise' | 'Resolvido' | 'Não se aplica'; observations: string | null; origin_topic_id?: string | null }
type TopicTransfer = { id: string; topic_id: string; from_visit_id: string; to_visit_id: string; user_id: string }; type PendingVisitChange = { table: 'visits' | 'visit_topics' | 'topic_transfers'; id: string; record: Visit | VisitTopic | TopicTransfer }
const cacheKey = (id: string) => 'wattwise:' + id + ':tasks'
const queueKey = (id: string) => 'wattwise:' + id + ':queue'
const readJson = <T,>(key: string, fallback: T): T => { try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) as T : fallback } catch { return fallback } }
const savePending = (id: string, queue: PendingChange[]) => localStorage.setItem(queueKey(id), JSON.stringify(queue))
const saveTaskCache = (id: string, tasks: Task[]) => localStorage.setItem(cacheKey(id), JSON.stringify(tasks))
const visitCacheKey = (id: string) => 'wattwise:' + id + ':visits'
const topicCacheKey = (id: string) => 'wattwise:' + id + ':visit-topics'
const visitQueueKey = (id: string) => 'wattwise:' + id + ':visit-queue'

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
  const [syncFailed, setSyncFailed] = useState(false)
  const [pendingCount, setPendingCount] = useState(0)
  const [syncVersion, setSyncVersion] = useState(0)
  const [authMode, setAuthMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [tasks, setTasks] = useState<Task[]>([])
  const [visits, setVisits] = useState<Visit[]>([])
  const [visitTopics, setVisitTopics] = useState<VisitTopic[]>([])
  const [historyEvents, setHistoryEvents] = useState<Array<{id:string; created_at:string; event_type:string; old_value:any; new_value:any; entity_type:'Atividade'|'Assunto'}>>([])
  const [selectedVisitId, setSelectedVisitId] = useState('')
  const [visitDate, setVisitDate] = useState(today())
  const [visitTitle, setVisitTitle] = useState('Visita à Cemig')
  const [participants, setParticipants] = useState('')
  const [visitNotes, setVisitNotes] = useState('')
  const [topicTitle, setTopicTitle] = useState('')
  const [topicDescription, setTopicDescription] = useState('')
  const [topicResponsible, setTopicResponsible] = useState('')
  const [topicProtocol, setTopicProtocol] = useState('')
  const [topicDueDate, setTopicDueDate] = useState('')
  const [topicObservations, setTopicObservations] = useState('')
  const [topicFilter, setTopicFilter] = useState('Todos')
  const [scheduledTopicId, setScheduledTopicId] = useState('')
  const [scheduledDate, setScheduledDate] = useState('')
  const [loadingTasks, setLoadingTasks] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('Cemig')
  const [date, setDate] = useState(today())
  const [time, setTime] = useState('')
  const [priority, setPriority] = useState<Priority>('Média')
  const [statusFilter, setStatusFilter] = useState('Todos')
  const [categoryFilter, setCategoryFilter] = useState('Todas')
  const [priorityFilter, setPriorityFilter] = useState('Todas')
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [search, setSearch] = useState('')
  const [editingTask, setEditingTask] = useState<Task | null>(null)
  const [calendarView, setCalendarView] = useState<'month' | 'week' | 'day'>('month')
  const [calendarDate, setCalendarDate] = useState(today())
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
    const cachedVisits = readJson<Visit[]>(visitCacheKey(userId), [])
    const cachedTopics = readJson<VisitTopic[]>(topicCacheKey(userId), [])
    setTasks(cached.filter(t => !t.deleted_at))
    setVisits(cachedVisits)
    setVisitTopics(cachedTopics)
    setSelectedVisitId(current => current || cachedVisits[0]?.id || '')
    setPendingCount(readJson<PendingChange[]>(queueKey(userId), []).length + readJson<PendingVisitChange[]>(visitQueueKey(userId), []).length)
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
          if (!cancelled) setPendingCount(queue.length + readJson<PendingVisitChange[]>(visitQueueKey(userId), []).length)
        }
        let visitChanges = readJson<PendingVisitChange[]>(visitQueueKey(userId), [])
        for (const change of [...visitChanges].sort((a,b) => (a.table === 'visits' ? 0 : a.table === 'visit_topics' ? 1 : 2) - (b.table === 'visits' ? 0 : b.table === 'visit_topics' ? 1 : 2))) {
          const result = await supabase!.from(change.table).upsert(change.record as any, { onConflict: 'id' })
          if (result.error) throw result.error
          visitChanges = visitChanges.filter(item => !(item.table === change.table && item.id === change.id))
          localStorage.setItem(visitQueueKey(userId), JSON.stringify(visitChanges))
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
          setTasks(merged); saveTaskCache(userId, merged)
          const [visitResult, topicResult] = await Promise.all([supabase!.from('visits').select('*').order('visit_date', { ascending: false }), supabase!.from('visit_topics').select('*').order('created_at', { ascending: true })])
          if (visitResult.error) throw visitResult.error
          if (topicResult.error) throw topicResult.error
          const [taskHistory, topicHistory] = await Promise.all([supabase!.from('task_events').select('id,created_at,event_type,old_value,new_value').order('created_at',{ascending:false}).limit(100), supabase!.from('visit_topic_events').select('id,created_at,event_type,old_value,new_value').order('created_at',{ascending:false}).limit(150)])
          if (taskHistory.error) throw taskHistory.error
          if (topicHistory.error) throw topicHistory.error
          setHistoryEvents([...(taskHistory.data ?? []).map(e => ({...e,entity_type:'Atividade' as const})), ...(topicHistory.data ?? []).map(e => ({...e,entity_type:'Assunto' as const}))].sort((a,b) => b.created_at.localeCompare(a.created_at)))
          setVisits((visitResult.data ?? []) as Visit[]); saveVisitsCache(userId, (visitResult.data ?? []) as Visit[])
          setVisitTopics((topicResult.data ?? []) as VisitTopic[]); saveTopicsCache(userId, (topicResult.data ?? []) as VisitTopic[])
          setPendingCount(readJson<PendingChange[]>(queueKey(userId), []).length + readJson<PendingVisitChange[]>(visitQueueKey(userId), []).length)
          setError('')
          setSyncFailed(false)
        }
      } catch (e) {
        const syncError = e as { message?: unknown; details?: unknown; hint?: unknown; code?: unknown; status?: unknown }
        const reasonParts = [syncError?.message, syncError?.details, syncError?.hint, syncError?.code ? 'Código: ' + String(syncError.code) : null, syncError?.status ? 'Status: ' + String(syncError.status) : null]
          .filter((part): part is string => typeof part === 'string' && part.trim().length > 0)
        const reason = reasonParts.join(' | ') || (typeof e === 'string' ? e : 'Não foi possível obter os detalhes do erro.')
        if (!cancelled) { setSyncFailed(true); setError('Sincronização pendente. Seus dados continuam salvos neste dispositivo. Motivo: ' + reason) }
      } finally { if (!cancelled) setSyncing(false) }
    }
    void sync()
    return () => { cancelled = true }
  }, [userId, isOnline, syncVersion])

  const saveVisitsCache = (id: string, rows: Visit[]) => localStorage.setItem(visitCacheKey(id), JSON.stringify(rows))
  const saveTopicsCache = (id: string, rows: VisitTopic[]) => localStorage.setItem(topicCacheKey(id), JSON.stringify(rows))

  function queueVisitChange(table: PendingVisitChange['table'], record: Visit | VisitTopic | TopicTransfer) {
    if (!userId) return
    const queue = readJson<PendingVisitChange[]>(visitQueueKey(userId), [])
    const next = [...queue.filter(item => !(item.table === table && item.id === record.id)), { table, id: record.id, record }]
    localStorage.setItem(visitQueueKey(userId), JSON.stringify(next))
    setPendingCount(readJson<PendingChange[]>(queueKey(userId), []).length + next.length)
    setSyncVersion(v => v + 1)
  }

  function queueChange(task: Task, deleted_at: string | null = null) {
    if (!userId) return
    const queue = readJson<PendingChange[]>(queueKey(userId), [])
    const next = [...queue.filter(item => item.id !== task.id), { id: task.id, task, deleted_at }]
    savePending(userId, next)
    setPendingCount(next.length + readJson<PendingVisitChange[]>(visitQueueKey(userId), []).length)
    setSyncVersion(v => v + 1)
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
  function saveEditedTask(event: FormEvent) {
    event.preventDefault()
    if (!editingTask || !editingTask.title.trim()) return
    const updated = { ...editingTask, title: editingTask.title.trim(), description: editingTask.description?.trim() || null }
    const next = tasks.map(item => item.id === updated.id ? updated : item).sort((a,b) => a.due_date.localeCompare(b.due_date))
    setTasks(next); saveTaskCache(userId, next); queueChange(updated)
    setEditingTask(null)
    setNotice(isOnline ? 'Atividade editada e enviada para sincronização.' : 'Atividade editada neste dispositivo. Será sincronizada quando a internet voltar.')
  }

  function addVisit(event: FormEvent) {
    event.preventDefault()
    if (!userId || !visitTitle.trim()) return
    const visit: Visit = { id: crypto.randomUUID(), user_id: userId, visit_date: visitDate, title: visitTitle.trim(), participants: participants.trim() || null, notes: visitNotes.trim() || null }
    const next = [visit, ...visits].sort((a,b) => b.visit_date.localeCompare(a.visit_date))
    setVisits(next); saveVisitsCache(userId, next); setSelectedVisitId(visit.id); queueVisitChange('visits', visit)
    setVisitTitle('Visita à Cemig'); setParticipants(''); setVisitNotes('')
    setNotice(isOnline ? 'Visita registrada e enviada para sincronização.' : 'Visita salva neste dispositivo. Será sincronizada quando a internet voltar.')
  }

  function addVisitTopic(event: FormEvent) {
    event.preventDefault()
    if (!userId || !selectedVisitId || !topicTitle.trim()) return
    const topic: VisitTopic = { id: crypto.randomUUID(), visit_id: selectedVisitId, user_id: userId, title: topicTitle.trim(), description: topicDescription.trim() || null, responsible: topicResponsible.trim() || null, protocol: topicProtocol.trim() || null, due_date: topicDueDate || null, status: 'Pendente', observations: topicObservations.trim() || null }
    const next = [...visitTopics, topic]
    setVisitTopics(next); saveTopicsCache(userId, next); queueVisitChange('visit_topics', topic)
    setTopicTitle(''); setTopicDescription(''); setTopicResponsible(''); setTopicProtocol(''); setTopicDueDate(''); setTopicObservations('')
    setNotice(isOnline ? 'Assunto registrado e enviado para sincronização.' : 'Assunto salvo neste dispositivo. Será sincronizado quando a internet voltar.')
  }

  function exportVisitCsv() {
    const visit = visits.find(item => item.id === selectedVisitId)
    if (!visit) return
    const rows = visitTopics.filter(topic => topic.visit_id === selectedVisitId)
    const fields = ['Ata','Data da visita','Assunto','Descrição','Responsável','Protocolo','Prazo','Status','Observações','ID da ata de origem']
    const quote = (value: unknown) => '"' + String(value ?? '').replace(/"/g, '""') + '"'
    const data = [fields, ...rows.map(topic => [visit.title, visit.visit_date, topic.title, topic.description, topic.responsible, topic.protocol, topic.due_date, topic.status, topic.observations, topic.origin_topic_id])].map(row => row.map(quote).join(';')).join('\r\n')
    const blob = new Blob(['\\uFEFF' + data], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a'); link.href = url; link.download = 'ata-cemig-' + visit.visit_date + '.csv'; link.click(); URL.revokeObjectURL(url)
    setNotice('Arquivo CSV da ata preparado para exportação.')
  }
  function carryTopicForward(topic: VisitTopic) {
    if (!userId || !selectedVisitId || topic.visit_id === selectedVisitId) return
    const alreadyCarried = visitTopics.some(item => item.visit_id === selectedVisitId && item.origin_topic_id === topic.id)
    if (alreadyCarried) { setNotice('Este assunto já foi incluído nesta ata.'); return }
    const carried: VisitTopic = { ...topic, id: crypto.randomUUID(), visit_id: selectedVisitId, user_id: userId, status: 'Pendente', origin_topic_id: topic.id, observations: [topic.observations, 'Continuidade do assunto registrado na ata de ' + (visits.find(v => v.id === topic.visit_id)?.visit_date ?? '')].filter(Boolean).join(' · ') || null }
    const next = [...visitTopics, carried]
    setVisitTopics(next); saveTopicsCache(userId, next); queueVisitChange('visit_topics', carried)
    const transfer: TopicTransfer = { id: crypto.randomUUID(), topic_id: topic.id, from_visit_id: topic.visit_id, to_visit_id: selectedVisitId, user_id: userId }
    queueVisitChange('topic_transfers', transfer)
    setNotice('Assunto incluído nesta ata, mantendo o vínculo com a ata de origem.')
  }
  function scheduleTopicForDate(event: FormEvent) {
    event.preventDefault()
    const source = visitTopics.find(item => item.id === scheduledTopicId)
    if (!userId || !source || !scheduledDate) return
    const targetVisit = visits.find(item => item.visit_date === scheduledDate)
    const destination: Visit = targetVisit ?? {
      id: crypto.randomUUID(), user_id: userId, visit_date: scheduledDate,
      title: 'Ata programada - ' + new Date(scheduledDate + 'T12:00:00').toLocaleDateString('pt-BR'),
      participants: null, notes: 'Ata criada automaticamente para receber assunto programado.'
    }
    if (visitTopics.some(item => item.visit_id === destination.id && item.origin_topic_id === source.id)) {
      setNotice('Este assunto já está programado para essa ata.')
      return
    }
    if (!targetVisit) {
      const nextVisits = [destination, ...visits].sort((a,b) => b.visit_date.localeCompare(a.visit_date))
      setVisits(nextVisits); saveVisitsCache(userId, nextVisits); queueVisitChange('visits', destination)
    }
    const scheduledCopy: VisitTopic = {
      ...source, id: crypto.randomUUID(), visit_id: destination.id, user_id: userId,
      status: 'Pendente', origin_topic_id: source.id,
      observations: [source.observations, 'Programado para a ata de ' + new Date(scheduledDate + 'T12:00:00').toLocaleDateString('pt-BR')].filter(Boolean).join(' · ') || null
    }
    const nextTopics = [...visitTopics, scheduledCopy]
    setVisitTopics(nextTopics); saveTopicsCache(userId, nextTopics); queueVisitChange('visit_topics', scheduledCopy)
    queueVisitChange('topic_transfers', { id: crypto.randomUUID(), topic_id: source.id, from_visit_id: source.visit_id, to_visit_id: destination.id, user_id: userId })
    setSelectedVisitId(destination.id)
    setScheduledTopicId(''); setScheduledDate('')
    setNotice('Assunto programado para ' + new Date(scheduledDate + 'T12:00:00').toLocaleDateString('pt-BR') + '. A ata de destino foi criada ou reutilizada.')
  }

  function changeTopicStatus(id: string, status: VisitTopic['status']) {
    const topic = visitTopics.find(item => item.id === id)
    if (!topic) return
    const updated = { ...topic, status }
    const next = visitTopics.map(item => item.id === id ? updated : item)
    setVisitTopics(next); saveTopicsCache(userId, next); queueVisitChange('visit_topics', updated)
    setNotice(isOnline ? 'Status do assunto atualizado.' : 'Status atualizado off-line e aguardando sincronização.')
  }

  async function signOut() {
    if (supabase) {
      const { error } = await supabase.auth.signOut()
      if (error) { setError('Não foi possível sair da conta: ' + error.message); return }
    }
    localStorage.removeItem('wattwise:offline-user')
    setUserEmail(''); setUserId(''); setTasks([]); setVisits([]); setVisitTopics([])
    setHistoryEvents([]); setSelectedVisitId(''); setPendingCount(0)
    setNotice('Você saiu da sua conta. O acesso off-line desta sessão foi encerrado.')
  }

  const visibleTasks = useMemo(() => tasks.filter(t =>
    (statusFilter === 'Todos' || t.status === statusFilter) &&
    (categoryFilter === 'Todas' || t.category === categoryFilter) &&
    (priorityFilter === 'Todas' || t.priority === priorityFilter) &&
    (!dateFrom || t.due_date >= dateFrom) && (!dateTo || t.due_date <= dateTo) &&
    (t.title.toLowerCase().includes(search.toLowerCase()) || t.category.toLowerCase().includes(search.toLowerCase()) || (t.description ?? '').toLowerCase().includes(search.toLowerCase()))
  ), [tasks,statusFilter,categoryFilter,priorityFilter,dateFrom,dateTo,search])
  const overdueTasks = tasks.filter(t => t.status !== 'Concluído' && t.due_date < today())
  const clearTaskFilters = () => { setStatusFilter('Todos'); setCategoryFilter('Todas'); setPriorityFilter('Todas'); setDateFrom(''); setDateTo(''); setSearch('') }
  const calendarStart = (() => {
    const d = new Date(calendarDate + 'T12:00:00')
    if (calendarView === 'day') return d
    if (calendarView === 'week') { const offset = (d.getDay() + 6) % 7; d.setDate(d.getDate() - offset); return d }
    d.setDate(1); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return d
  })()
  const calendarDays = Array.from({length: calendarView === 'month' ? 42 : calendarView === 'week' ? 7 : 1}, (_,i) => {
    const d = new Date(calendarStart); d.setDate(d.getDate() + i); return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-')
  })
  const moveCalendar = (direction: number) => {
    const d = new Date(calendarDate + 'T12:00:00')
    if (calendarView === 'month') d.setMonth(d.getMonth() + direction)
    else d.setDate(d.getDate() + (calendarView === 'week' ? 7 : 1) * direction)
    setCalendarDate([d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-'))
  }
  const calendarHeading = calendarView === 'day'
    ? new Date(calendarDate + 'T12:00:00').toLocaleDateString('pt-BR',{day:'2-digit',month:'long',year:'numeric'})
    : calendarView === 'week'
      ? new Date(calendarDays[0] + 'T12:00:00').toLocaleDateString('pt-BR',{day:'2-digit',month:'short'}) + ' – ' + new Date(calendarDays[6] + 'T12:00:00').toLocaleDateString('pt-BR',{day:'2-digit',month:'short',year:'numeric'})
      : new Date(calendarDate + 'T12:00:00').toLocaleDateString('pt-BR',{month:'long',year:'numeric'})

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
      <header className="topbar"><button className="menu-button" onClick={() => setMobileOpen(true)}><Menu/></button><div className="breadcrumb">Watt-Wise <span>/</span> {nav.find(n => n.id === section)?.label}</div><div className={'sync-indicator ' + (!isOnline ? 'offline' : syncing ? 'syncing' : syncFailed ? 'pending' : pendingCount ? 'pending' : 'online')}><span className="sync-dot"/>{!isOnline ? 'Off-line' : syncing ? 'Sincronizando...' : syncFailed ? 'Falha na sincronização' : pendingCount ? pendingCount + ' pendente(s)' : 'Sincronizado'}</div><button className="profile" onClick={signOut} title="Sair da conta"><LogOut size={14}/> Sair <ChevronDown size={14}/></button></header>
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
            <div className="stat-card overdue-stat"><span>Atrasadas</span><strong>{overdueTasks.length}</strong><AlertCircle/></div>
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
            <div className="panel-heading list-heading"><div><h2>Suas atividades</h2><p>As atividades ficam salvas na sua conta.</p></div><label className="filter">Status<select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}><option>Todos</option><option>A fazer</option><option>Em andamento</option><option>Concluído</option></select></label></div>
            <div className="calendar-toolbar"><div className="calendar-modes"><button type="button" className={calendarView === 'month' ? 'active' : ''} onClick={() => setCalendarView('month')}>Mês</button><button type="button" className={calendarView === 'week' ? 'active' : ''} onClick={() => setCalendarView('week')}>Semana</button><button type="button" className={calendarView === 'day' ? 'active' : ''} onClick={() => setCalendarView('day')}>Dia</button></div><div className="calendar-navigation"><button type="button" onClick={() => moveCalendar(-1)} aria-label="Período anterior"><ChevronLeft size={16}/></button><strong>{calendarHeading}</strong><button type="button" onClick={() => moveCalendar(1)} aria-label="Próximo período"><ChevronRight size={16}/></button><button type="button" onClick={() => setCalendarDate(today())}>Hoje</button></div></div>
            <div className={'calendar-grid ' + calendarView}>{calendarView !== 'day' && ['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'].map(day => <div className="calendar-weekday" key={day}>{day}</div>)}{calendarDays.map(day => <div key={day} className={'calendar-cell ' + (day.slice(0,7) !== calendarDate.slice(0,7) && calendarView === 'month' ? 'outside-month' : '') + (day === today() ? ' is-today' : '')}><button type="button" className="calendar-day" onClick={() => {setCalendarDate(day);setCalendarView('day')}}>{new Date(day + 'T12:00:00').toLocaleDateString('pt-BR',{day:'2-digit', ...(calendarView === 'day' ? {month:'long'} : {})})}</button>{tasks.filter(task => task.due_date === day).map(task => <button type="button" key={task.id} className={'calendar-event ' + (task.status === 'Concluído' ? 'done' : task.priority === 'Urgente' ? 'urgent' : '')} onClick={() => { clearTaskFilters(); setEditingTask({...task}) }} title={task.title}>{task.due_time ? task.due_time.slice(0,5) + ' · ' : ''}{task.title}</button>)}</div>)}</div>
            <div className="search-line"><Search size={15}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por atividade, descrição ou categoria..."/></div>
            <div className="task-filters"><label>Categoria<select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}><option>Todas</option>{categories.map(c => <option key={c[0]}>{c[0]}</option>)}</select></label><label>Prioridade<select value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)}><option>Todas</option><option>Baixa</option><option>Média</option><option>Alta</option><option>Urgente</option></select></label><label>De<input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)}/></label><label>Até<input type="date" value={dateTo} min={dateFrom || undefined} onChange={e => setDateTo(e.target.value)}/></label><button type="button" className="secondary-button" onClick={clearTaskFilters}>Limpar filtros</button></div>
            {loadingTasks ? <div className="empty"><LoaderCircle className="spin"/><span>Carregando atividades...</span></div> : visibleTasks.length === 0 ? <div className="empty"><CalendarDays size={28}/><strong>Nenhuma atividade por aqui</strong><span>Adicione uma atividade acima para começar.</span></div> : <div className="task-list">{visibleTasks.map(task => <div className={'task-row ' + (task.status !== 'Concluído' && task.due_date < today() ? 'task-overdue' : '')} key={task.id}><div className="task-dot" style={{background: categories.find(c => c[0] === task.category)?.[1]}}/><div className="task-info"><strong>{task.title}</strong><span>{task.category} · {new Date(`${task.due_date}T12:00:00`).toLocaleDateString('pt-BR')}{task.due_time ? ` · ${task.due_time.slice(0,5)}` : ''} · Prioridade {task.priority}</span>{task.description && <small>{task.description}</small>}</div><select aria-label={`Status de ${task.title}`} value={task.status} onChange={e => changeStatus(task.id, e.target.value as TaskStatus)}><option>A fazer</option><option>Em andamento</option><option>Concluído</option></select><button type="button" className="icon-button" onClick={() => setEditingTask({...task})} title="Editar atividade"><Pencil size={15}/></button><button type="button" className="icon-button" onClick={() => deleteTask(task.id)} title="Arquivar atividade"><Trash2 size={15}/></button>{editingTask?.id === task.id && <form className="edit-task-form" onSubmit={saveEditedTask}><label>Título<input required value={editingTask.title} onChange={e => setEditingTask({...editingTask,title:e.target.value})}/></label><label>Descrição<input value={editingTask.description ?? ''} onChange={e => setEditingTask({...editingTask,description:e.target.value})}/></label><label>Categoria<select value={editingTask.category} onChange={e => setEditingTask({...editingTask,category:e.target.value})}>{categories.map(item => <option key={item[0]}>{item[0]}</option>)}</select></label><label>Data<input type="date" required value={editingTask.due_date} onChange={e => setEditingTask({...editingTask,due_date:e.target.value})}/></label><label>Horário<input type="time" value={editingTask.due_time ?? ''} onChange={e => setEditingTask({...editingTask,due_time:e.target.value || null})}/></label><label>Prioridade<select value={editingTask.priority} onChange={e => setEditingTask({...editingTask,priority:e.target.value as Priority})}><option>Baixa</option><option>Média</option><option>Alta</option><option>Urgente</option></select></label><div className="edit-actions"><button className="primary-button" type="submit">Salvar alterações</button><button className="secondary-button" type="button" onClick={() => setEditingTask(null)}>Cancelar</button></div></form>}</div>)}</div>}
          </section>
        </>}
        {section === 'visitas' && <>
          <div className="stats">
            <div className="stat-card"><span>Visitas registradas</span><strong>{visits.length}</strong><ClipboardList/></div>
            <div className="stat-card"><span>Assuntos pendentes</span><strong>{visitTopics.filter(t => t.status === 'Pendente').length}</strong><AlertCircle/></div>
            <div className="stat-card"><span>Em análise</span><strong>{visitTopics.filter(t => t.status === 'Em análise').length}</strong><Clock3/></div>
            <div className="stat-card"><span>Resolvidos</span><strong>{visitTopics.filter(t => t.status === 'Resolvido').length}</strong><CheckCircle2/></div>
          </div>
          <section className="panel">
            <div className="panel-heading"><div><h2>Registrar visita / ata</h2><p>Cadastre uma visita e seus dados principais.</p></div><span className="soft-tag">NOVA VISITA</span></div>
            <form className="form-grid" onSubmit={addVisit}>
              <label>Data da visita<input type="date" required value={visitDate} onChange={e => setVisitDate(e.target.value)}/></label>
              <label className="wide">Título da ata<input required value={visitTitle} onChange={e => setVisitTitle(e.target.value)}/></label>
              <label className="wide">Participantes<input value={participants} onChange={e => setParticipants(e.target.value)} placeholder="Nomes dos participantes"/></label>
              <label className="wide">Observações gerais<input value={visitNotes} onChange={e => setVisitNotes(e.target.value)} placeholder="Anotações da visita"/></label>
              <div className="wide form-action"><button className="primary-button"><Plus size={17}/>Salvar visita</button></div>
            </form>
          </section>
          <section className="panel">
            <div className="panel-heading"><div><h2>Atas registradas</h2><p>Selecione uma visita para consultar ou incluir assuntos.</p></div><span className="soft-tag">{visits.length} VISITA(S)</span></div>
            {visits.length === 0 ? <div className="empty"><ClipboardList size={28}/><strong>Nenhuma visita cadastrada</strong><span>Cadastre a primeira visita acima. Você também poderá fazer isso off-line.</span></div> : <div className="visit-list">{visits.map(visit => <button key={visit.id} className={'visit-card ' + (selectedVisitId === visit.id ? 'selected' : '')} onClick={() => setSelectedVisitId(visit.id)}><span><strong>{visit.title}</strong><small>{new Date(visit.visit_date + 'T12:00:00').toLocaleDateString('pt-BR')} · {visitTopics.filter(t => t.visit_id === visit.id).length} assunto(s)</small></span><ChevronDown size={16}/></button>)}</div>}
          </section>
          {selectedVisitId && visits.some(v => v.id === selectedVisitId) && <section className="panel">
            <div className="panel-heading"><div><h2>Assuntos da ata</h2><p>{visits.find(v => v.id === selectedVisitId)?.title} · {new Date((visits.find(v => v.id === selectedVisitId)?.visit_date ?? today()) + 'T12:00:00').toLocaleDateString('pt-BR')}</p></div><div className="heading-actions"><span className="soft-tag">{visitTopics.filter(t => t.visit_id === selectedVisitId).length} ASSUNTO(S)</span><button type="button" className="secondary-button export-button" onClick={exportVisitCsv}><FileDown size={14}/> Exportar CSV</button></div></div>
            <form className="form-grid" onSubmit={addVisitTopic}>
              <label className="wide">Assunto<input required value={topicTitle} onChange={e => setTopicTitle(e.target.value)} placeholder="Ex.: Retorno sobre solicitação"/></label>
              <label className="wide">Descrição<input value={topicDescription} onChange={e => setTopicDescription(e.target.value)} placeholder="Detalhes do assunto"/></label>
              <label>Responsável<input value={topicResponsible} onChange={e => setTopicResponsible(e.target.value)} placeholder="Responsável"/></label>
              <label>Protocolo<input value={topicProtocol} onChange={e => setTopicProtocol(e.target.value)} placeholder="Nº do protocolo"/></label>
              <label>Prazo<input type="date" value={topicDueDate} onChange={e => setTopicDueDate(e.target.value)}/></label>
              <label className="wide">Observações<input value={topicObservations} onChange={e => setTopicObservations(e.target.value)} placeholder="Observações e encaminhamentos"/></label>
              <div className="wide form-action"><button className="primary-button"><Plus size={17}/>Adicionar assunto</button></div>
            </form>
            <div className="carry-panel schedule-panel"><div><strong>Programar assunto para uma data futura</strong><p>Escolha uma pendência e a data. O Watt-Wise criará uma ata nessa data ou aproveitará uma já cadastrada.</p></div><form className="schedule-form" onSubmit={scheduleTopicForDate}><label>Assunto pendente<select required value={scheduledTopicId} onChange={e => setScheduledTopicId(e.target.value)}><option value="">Selecione um assunto</option>{visitTopics.filter(t => t.status !== 'Resolvido' && t.status !== 'Não se aplica').map(t => <option key={t.id} value={t.id}>{t.title} · {visits.find(v => v.id === t.visit_id)?.visit_date ?? 'Sem data'}</option>)}</select></label><label>Data da ata futura<input type="date" required min={today()} value={scheduledDate} onChange={e => setScheduledDate(e.target.value)}/></label><button className="secondary-button" type="submit" disabled={!scheduledTopicId || !scheduledDate}>Programar assunto</button></form></div>
            {visitTopics.filter(t => t.visit_id !== selectedVisitId && t.status !== "Resolvido" && t.status !== "Não se aplica" && !visitTopics.some(copy => copy.visit_id === selectedVisitId && copy.origin_topic_id === t.id)).length > 0 && <div className="carry-panel"><div><strong>Pendências de outras atas</strong><p>Escolha individualmente quais assuntos devem continuar nesta ata.</p></div>{visitTopics.filter(t => t.visit_id !== selectedVisitId && t.status !== "Resolvido" && t.status !== "Não se aplica" && !visitTopics.some(copy => copy.visit_id === selectedVisitId && copy.origin_topic_id === t.id)).map(topic => <div className="carry-row" key={topic.id}><span><strong>{topic.title}</strong><small>{visits.find(v => v.id === topic.visit_id)?.title ?? "Ata anterior"} · {topic.status}</small></span><button type="button" className="secondary-button" onClick={() => carryTopicForward(topic)}>Incluir nesta ata</button></div>)}</div>}
            <div className="panel-heading list-heading topic-list-heading"><div><h2>Assuntos cadastrados</h2><p>Atualize o andamento de cada assunto.</p></div><label className="filter"><select value={topicFilter} onChange={e => setTopicFilter(e.target.value)}><option>Todos</option><option>Pendente</option><option>Em análise</option><option>Resolvido</option><option>Não se aplica</option></select></label></div>
            {visitTopics.filter(t => t.visit_id === selectedVisitId && (topicFilter === 'Todos' || t.status === topicFilter)).length === 0 ? <div className="empty"><strong>Nenhum assunto cadastrado nesta ata</strong><span>Adicione um assunto no formulário acima.</span></div> : <div className="task-list">{visitTopics.filter(t => t.visit_id === selectedVisitId && (topicFilter === 'Todos' || t.status === topicFilter)).map(topic => <div className="topic-row" key={topic.id}><div className="task-info"><strong>{topic.title}</strong><span>{topic.responsible ? 'Responsável: ' + topic.responsible + ' · ' : ''}{topic.protocol ? 'Protocolo: ' + topic.protocol + ' · ' : ''}{topic.due_date ? 'Prazo: ' + new Date(topic.due_date + 'T12:00:00').toLocaleDateString('pt-BR') : 'Sem prazo'}</span>{topic.description && <small>{topic.description}</small>}{topic.observations && <small>Observações: {topic.observations}</small>}</div><select aria-label={'Status de ' + topic.title} value={topic.status} onChange={e => changeTopicStatus(topic.id, e.target.value as VisitTopic['status'])}><option>Pendente</option><option>Em análise</option><option>Resolvido</option><option>Não se aplica</option></select></div>)}</div>}
          </section>}
        </>}
        {section === 'historico' && <section className="panel"><div className="panel-heading"><div><h2>Histórico de movimentações</h2><p>Últimas alterações registradas nas atividades e nos assuntos das atas.</p></div><span className="soft-tag">{historyEvents.length} REGISTRO(S)</span></div>{historyEvents.length === 0 ? <div className="empty"><History size={28}/><strong>Nenhuma movimentação encontrada</strong><span>As próximas inclusões e alterações aparecerão aqui após a sincronização.</span></div> : <div className="history-list">{historyEvents.map(event => { const value = event.new_value ?? {}; const old = event.old_value ?? {}; const label = event.event_type === 'created' ? 'Criado' : event.event_type === 'status_changed' ? 'Status alterado' : event.event_type === 'schedule_changed' ? 'Data ou horário alterado' : 'Dados atualizados'; const detail = event.event_type === 'status_changed' ? `${old.status ?? '—'} → ${value.status ?? '—'}` : event.event_type === 'schedule_changed' ? `${old.date ?? '—'} ${old.time ?? ''} → ${value.date ?? '—'} ${value.time ?? ''}` : (value.title ?? old.title ?? 'Registro atualizado'); return <article className="history-item" key={event.id}><span className="history-marker"/><div className="history-copy"><div><strong>{detail}</strong><span className="history-kind">{event.entity_type} · {label}</span></div><time>{new Date(event.created_at).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'})}</time></div></article> })}</div>}</section>}
        <footer>Watt-Wise <span>•</span> Em desenvolvimento</footer>
      </div>
    </main>
  </div>
}
