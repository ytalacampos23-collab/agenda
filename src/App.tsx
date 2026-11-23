import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import { CalendarDays, CalendarClock, ClipboardList, History, Plus, Search, FileDown, FileSpreadsheet, Upload, ShieldCheck, Menu, X, CheckCircle2, Clock3, AlertCircle, ChevronDown, ChevronLeft, ChevronRight, LogOut, LoaderCircle, Trash2, Pencil, BookOpen, Copy, Save } from 'lucide-react'
import ExcelJS from 'exceljs'
import JSZip from 'jszip'
import { hasSupabaseConfig, supabase } from './lib/supabase'

type TaskStatus = 'A fazer' | 'Em andamento' | 'Concluído'
type Priority = 'Baixa' | 'Média' | 'Alta' | 'Urgente'
type Task = { id: string; title: string; description: string | null; category: string; due_date: string; due_time: string | null; status: TaskStatus; priority: Priority; assigned_to?: string | null; show_on_calendar?: boolean; deleted_at?: string | null }
type PendingChange = { id: string; task: Task; deleted_at: string | null }
type Visit = { id: string; user_id: string; visit_date: string; title: string; participants: string | null; notes: string | null; created_at?: string }
type VisitTopic = { id: string; visit_id: string; user_id: string; category?: string; title: string; description: string | null; responsible: string | null; protocol: string | null; due_date: string | null; status: 'Pendente' | 'Em análise' | 'Em andamento' | 'Acompanhar Chamado' | 'Resolvido' | 'Não se aplica'; observations: string | null; origin_topic_id?: string | null }
type LibraryItem = { id: string; user_id: string; kind: 'message' | 'documents'; title: string; content: string; created_at?: string; updated_at?: string }
type AgendaNote = { id: string; user_id: string; title: string; content: string; created_at?: string; updated_at?: string }
type TopicTransfer = { id: string; topic_id: string; from_visit_id: string; to_visit_id: string; user_id: string }; type PendingVisitChange = { table: 'visits' | 'visit_topics' | 'topic_transfers'; id: string; record: Visit | VisitTopic | TopicTransfer; action?: 'upsert' | 'delete' }
function safeRichHtml(value: string | null | undefined) {
  let raw = String(value ?? '');
  // Normaliza quebras vindas de texto copiado (inclusive barra invertida antes da quebra).
  raw = raw.replace(/\\[ \t]*\r?\n/g, '\n').replace(/\\n/g, '\n').replace(/\\([\-.*])/g, '$1');
  if (/&lt;\/?(?:span|b|strong|mark|br|p|div|h[2-4]|ul|ol|li)\b/i.test(raw)) {
    raw = raw.replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;/gi, "'");
  }
  const escapeText = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/==(.*?)==/g, '<mark>$1</mark>');
  // Converte texto simples/Markdown em blocos reais para manter a formatação após salvar.
  if (!/<\/?[a-z][^>]*>/i.test(raw)) {
    const lines = raw.split(/\r?\n/);
    const out: string[] = [];
    let list: 'ul' | 'ol' | null = null;
    const closeList = () => { if (list) { out.push('</' + list + '>'); list = null; } };
    const addLine = (line: string) => {
      const numbered = line.match(/^(\d+)[.)]\s+([A-ZÀ-Ú][^*]+?)\s+\*\*(.+?)\*\*:?\s*$/i);
      const bullet = line.match(/^[-•]\s+(.+)$/);
      if (numbered) {
        closeList();
        out.push('<h3>' + escapeText(numbered[1] + '. ' + numbered[2].trim()) + '</h3>');
        out.push('<h4>' + escapeText(numbered[3].replace(/:$/, '')) + '</h4>');
        return;
      }
      if (bullet) {
        if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; }
        out.push('<li>' + escapeText(bullet[1]) + '</li>');
        return;
      }
      const numberedItem = line.match(/^\d+[.)]\s+(.+)$/);
      if (numberedItem) {
        if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; }
        out.push('<li>' + escapeText(numberedItem[1]) + '</li>');
        return;
      }
      closeList();
      const attention = line.match(/^(PONTOS DE ATENÇÃO|REUNIÃO)(?:\s*[–—:-]\s*(.*))?$/i);
      if (attention) {
        out.push('<h2>' + escapeText(attention[1]) + '</h2>');
        if (attention[2]) addLine(attention[2].trim());
        return;
      }
      const inlineHeading = line.match(/^(.*?)(\*\*[^*]+:\*\*)(.*)$/);
      if (inlineHeading) {
        const prefix = inlineHeading[1].trim();
        if (prefix) out.push('<h2>' + escapeText(prefix) + '</h2>');
        out.push('<h4>' + escapeText(inlineHeading[2].replace(/^\*\*|\*\*$/g, '').replace(/:$/, '')) + '</h4>');
        const suffix = inlineHeading[3].trim();
        if (suffix) addLine(suffix);
        return;
      }
      if (/^\*\*.+\*\*:?$/.test(line)) {
        out.push('<h4>' + escapeText(line.replace(/^\*\*|\*\*:?$/g, '').replace(/:$/, '')) + '</h4>');
      } else {
        out.push('<p>' + escapeText(line) + '</p>');
      }
    };
    for (const original of lines) {
      const line = original.trim();
      if (line) addLine(line);
      else closeList();
    }
    closeList();
    return out.join('');
  }
  const doc = new DOMParser().parseFromString(raw, 'text/html');
  const clean = (node: Node): string => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = (node.textContent ?? '').replace(/\\[ \t]*\r?\n/g, '\n').replace(/\\n/g, '\n');
      return escapeText(text).replace(/\r?\n/g, '<br>');
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return '';
    const el = node as HTMLElement;
    const tag = el.tagName.toLowerCase();
    const content = Array.from(el.childNodes).map(clean).join('');
    if (tag === 'b' || tag === 'strong') return '<strong>' + content + '</strong>';
    if (tag === 'mark') return '<mark>' + content + '</mark>';
    if (tag === 'span') {
      const style = (el.getAttribute('style') ?? '').toLowerCase();
      if (/background(-color)?\s*:\s*(#fff176|yellow|rgb\(255,\s*241,\s*118\))/i.test(style)) return '<mark>' + content + '</mark>';
      if (/font-weight\s*:\s*(bold|bolder|[6-9]00)/i.test(style)) return '<strong>' + content + '</strong>';
      return content;
    }
    if (tag === 'br') return '<br>';
    if (tag === 'h2' || tag === 'h3' || tag === 'h4') return '<' + tag + '>' + content + '</' + tag + '>';
    if (tag === 'ul' || tag === 'ol') return '<' + tag + '>' + content + '</' + tag + '>';
    if (tag === 'li') return '<li>' + content + '</li>';
    if (tag === 'blockquote') return '<blockquote>' + content + '</blockquote>';
    if (tag === 'p' || tag === 'div') return '<p>' + content + '</p>';
    return content;
  };
  return Array.from(doc.body.childNodes).map(clean).join('');
}
function RichNotesEditor({ editorRef, value, onChange, placeholder }: { editorRef: { current: HTMLDivElement | null }; value: string | null | undefined; onChange: (value: string) => void; placeholder?: string }) {
  const localRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = localRef.current;
    const currentValue = String(value ?? '');
    // Não reescreve o HTML produzido pela própria digitação: isso preserva o cursor
    // e impede que o Enter faça o texto voltar para o início do campo.
    if (el && el.innerHTML !== currentValue) el.innerHTML = safeRichHtml(value);
    editorRef.current = el;
  }, [value, editorRef]);
  return <div ref={localRef} className="rich-notes-editor" contentEditable="true" suppressContentEditableWarning role="textbox" aria-multiline="true" tabIndex={0} data-placeholder={placeholder} onPointerDown={e => { if (document.activeElement !== e.currentTarget) e.currentTarget.focus() }} onInput={e => onChange(e.currentTarget.innerHTML)}/>;
}
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
  ['Cliente', '#D7E8B5'], ['Financeiro', '#F4D77A'],
] as const
const today = () => { const d = new Date(); return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-') }

export default function App() {
  const [section, setSection] = useState<'agenda' | 'visitas' | 'ouvidoria' | 'historico'>('agenda')
  const [visitPageTab, setVisitPageTab] = useState<'visits' | 'library'>('visits')
  const [agendaPageTab, setAgendaPageTab] = useState<'agenda' | 'meetings' | 'notes'>('agenda')
  const [sessionReady, setSessionReady] = useState(false)
  const [authVerified, setAuthVerified] = useState(false)
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
  const [currentDate, setCurrentDate] = useState(today())
  const [selectedAgendaDate, setSelectedAgendaDate] = useState(today())
  const [showAddTaskForm, setShowAddTaskForm] = useState(false)
  const [meetingFormOpen, setMeetingFormOpen] = useState(false)
  const [meetingTitle, setMeetingTitle] = useState('')
  const [meetingDate, setMeetingDate] = useState(today())
  const [meetingTime, setMeetingTime] = useState('')
  const [meetingPriority, setMeetingPriority] = useState<Priority>('Média')
  const [meetingStatus, setMeetingStatus] = useState<TaskStatus>('A fazer')
  const [meetingNotes, setMeetingNotes] = useState('')
  const [editingMeetingId, setEditingMeetingId] = useState<string | null>(null)
  const [visits, setVisits] = useState<Visit[]>([])
  const [visitTopics, setVisitTopics] = useState<VisitTopic[]>([])
  const [libraryItems, setLibraryItems] = useState<LibraryItem[]>([])
  const [libraryKind, setLibraryKind] = useState<'message' | 'documents'>('message')
  const [libraryTitle, setLibraryTitle] = useState('')
  const [libraryContent, setLibraryContent] = useState('')
  const [editingLibraryItem, setEditingLibraryItem] = useState<string | null>(null)
  const [libraryBusy, setLibraryBusy] = useState(false)
  const [librarySearch, setLibrarySearch] = useState('')
  const [libraryFormOpen, setLibraryFormOpen] = useState(false)
  const [expandedLibraryMessageId, setExpandedLibraryMessageId] = useState<string | null>(null)
  const [expandedLibraryDocumentId, setExpandedLibraryDocumentId] = useState<string | null>(null)
  const [expandedMeetingId, setExpandedMeetingId] = useState<string | null>(null)
  const [agendaNotes, setAgendaNotes] = useState<AgendaNote[]>([])
  const [agendaNoteTitle, setAgendaNoteTitle] = useState('')
  const [agendaNoteContent, setAgendaNoteContent] = useState('')
  const [editingAgendaNoteId, setEditingAgendaNoteId] = useState<string | null>(null)
  const [agendaNoteFormOpen, setAgendaNoteFormOpen] = useState(false)
  const [agendaNoteBusy, setAgendaNoteBusy] = useState(false)
  const [agendaNoteSearch, setAgendaNoteSearch] = useState('')
  const [expandedAgendaNoteId, setExpandedAgendaNoteId] = useState<string | null>(null)
  const [historyEvents, setHistoryEvents] = useState<Array<{id:string; created_at:string; event_type:string; old_value:any; new_value:any; entity_type:'Atividade'|'Assunto'}>>([])
  const [historyFilter, setHistoryFilter] = useState<'agenda' | 'visitas'>('agenda')
  const [selectedVisitId, setSelectedVisitId] = useState('')
  const [editingVisit, setEditingVisit] = useState<Visit | null>(null)
  const [editingTopic, setEditingTopic] = useState<VisitTopic | null>(null)
  const [topicStatusFilter, setTopicStatusFilter] = useState('Todos')
  const [topicCategoryFilter, setTopicCategoryFilter] = useState('Todas')
  const [globalTopicStatusFilter, setGlobalTopicStatusFilter] = useState('Todos')
  const [globalTopicCategoryFilter, setGlobalTopicCategoryFilter] = useState('Todas')
  const [dashboardVisitFilter, setDashboardVisitFilter] = useState<'all' | 'visits' | 'Pendente' | 'Em análise' | 'Em andamento' | 'Acompanhar Chamado' | 'Resolvido'>('all')
  const [selectedDashboardDate, setSelectedDashboardDate] = useState(today())
  const [visitDate, setVisitDate] = useState(today())
  const [visitTitle, setVisitTitle] = useState('Visita à Cemig')
  const [participants, setParticipants] = useState('')
  const [visitNotes, setVisitNotes] = useState('')
  const [visitFormOpen, setVisitFormOpen] = useState(false)
  const [globalTopicFilterOpen, setGlobalTopicFilterOpen] = useState(false)
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [activitiesOpen, setActivitiesOpen] = useState(false)
  const visitNotesRef = useRef<HTMLDivElement>(null)
  const meetingNotesRef = useRef<HTMLDivElement>(null)
  const topicObservationsRef = useRef<HTMLDivElement>(null)
  const editTopicObservationsRef = useRef<HTMLDivElement>(null)
  const editVisitNotesRef = useRef<HTMLDivElement>(null)
  function applyBoldToNotes(ref: { current: HTMLDivElement | null }, _value: string, update: (value: string) => void) {
    const field = ref.current
    if (!field) return
    const selection = window.getSelection()
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null
    const selectionInsideField = !!range && field.contains(range.commonAncestorContainer)
    if (!selectionInsideField) field.focus()
    document.execCommand('bold', false)
    update(field.innerHTML)
  }
  function applyHighlightToNotes(ref: { current: HTMLDivElement | null }, _value: string, update: (value: string) => void) {
    const field = ref.current
    if (!field) return
    const selection = window.getSelection()
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null
    const selectionInsideField = !!range && field.contains(range.commonAncestorContainer)
    if (!selectionInsideField) field.focus()
    const applied = document.execCommand('hiliteColor', false, '#fff176')
    if (!applied) document.execCommand('backColor', false, '#fff176')
    update(field.innerHTML)
  }
  function applyStructureToNotes(ref: { current: HTMLDivElement | null }, command: 'formatBlock' | 'insertUnorderedList' | 'insertOrderedList', value: string | undefined, update: (value: string) => void) {
    const field = ref.current
    if (!field) return
    const selection = window.getSelection()
    const range = selection?.rangeCount ? selection.getRangeAt(0) : null
    if (!range || !field.contains(range.commonAncestorContainer)) field.focus()
    document.execCommand(command, false, value)
    update(field.innerHTML)
  }
  const [topicCategory, setTopicCategory] = useState('Troca de titularidade')
  const [topicTitle, setTopicTitle] = useState('')
  const [topicDescription, setTopicDescription] = useState('')
  const [topicResponsible, setTopicResponsible] = useState('')
  const [topicProtocol, setTopicProtocol] = useState('')
  const [topicDueDate, setTopicDueDate] = useState('')
  const [topicObservations, setTopicObservations] = useState('')
  const [scheduledTopicId, setScheduledTopicId] = useState('')
  const [scheduledDate, setScheduledDate] = useState('')
  const [loadingTasks, setLoadingTasks] = useState(false)
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [category, setCategory] = useState('Cemig')
  const [date, setDate] = useState(today())
  const [time, setTime] = useState('')
  const [priority, setPriority] = useState<Priority>('Média')
  const [assignedTo, setAssignedTo] = useState('')
  const [showOnCalendar, setShowOnCalendar] = useState(false)
  const [assigneeFilter, setAssigneeFilter] = useState('Todas')
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
  const [auditBusy, setAuditBusy] = useState(false)
  const [auditTab, setAuditTab] = useState<'invoices' | 'contracts'>('invoices')
  const [contractAuditBusy, setContractAuditBusy] = useState(false)
  const [contractListFile, setContractListFile] = useState<File|null>(null)
  const [invoiceListFile, setInvoiceListFile] = useState<File|null>(null)
  const [contractAuditResult, setContractAuditResult] = useState<{fileNames:string[];total:number;matched:number;missing:Array<{client:string;installation:string;uc:string}>;warnings:string[]}|null>(null)
  const [auditResult, setAuditResult] = useState<{ fileName: string; months: string[]; markedCount: number; missing: Array<{ installation: string; client: string }>; rowCount: number; uniqueInstallations: number; invalidRows: number; duplicateInstallationMonths: number; warnings: string[] } | null>(null)
  const auditWorkbookRef = useRef<ExcelJS.Workbook | null>(null)
  const auditFileNameRef = useRef('')

  useEffect(() => {
    if (!supabase) { setSessionReady(true); return }
    let active = true
    const verifySession = async () => {
      if (active) setSessionReady(false)
      try {
        if (!navigator.onLine) { if (active) { setAuthVerified(false); setUserEmail(''); setUserId('') }; return }
        const { data: sessionData, error: sessionError } = await supabase!.auth.getSession()
        if (sessionError) throw sessionError
        if (!sessionData.session) { if (active) { setAuthVerified(false); setUserEmail(''); setUserId('') }; return }
        const { data: userData, error: userError } = await supabase!.auth.getUser()
        if (userError) throw userError
        if (active && userData.user && userData.user.id === sessionData.session.user.id) {
          setUserEmail(userData.user.email ?? '')
          setUserId(userData.user.id)
          setAuthVerified(true)
        } else if (active) { setAuthVerified(false); setUserEmail(''); setUserId('') }
      } catch {
        if (active) { setAuthVerified(false); setUserEmail(''); setUserId(''); setError('Não foi possível validar sua sessão. Conecte-se à internet e entre novamente.') }
      } finally { if (active) setSessionReady(true) }
    }
    void verifySession()
    const { data: listener } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        setAuthVerified(false); setUserEmail(''); setUserId('')
      }
    })
    return () => { active = false; listener.subscription.unsubscribe() }
  }, [isOnline])

  useEffect(() => {
    const update = () => setIsOnline(navigator.onLine)
    window.addEventListener('online', update); window.addEventListener('offline', update)
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update) }
  }, [])

  useEffect(() => {
    if (!userId) return
    if (!authVerified || !isOnline || !supabase) return
    // Mantém os dados atuais na tela enquanto a sincronização ocorre.
    // A atualização visual já é feita localmente; a busca remota não deve limpar a interface.
    setPendingCount(readJson<PendingChange[]>(queueKey(userId), []).length + readJson<PendingVisitChange[]>(visitQueueKey(userId), []).length)
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
        for (const change of [...visitChanges].sort((a,b) => { const rank = (x: PendingVisitChange) => x.action === 'delete' ? (x.table === 'visit_topics' ? 0 : x.table === 'visits' ? 1 : 2) : (x.table === 'visits' ? 3 : x.table === 'visit_topics' ? 4 : 5); return rank(a) - rank(b) })) {
          const result = change.action === 'delete' ? await supabase!.from(change.table).delete().eq('id', change.id) : await supabase!.from(change.table).upsert(change.record as any, { onConflict: 'id' })
          if (result.error) throw result.error
          visitChanges = visitChanges.filter(item => !(item.table === change.table && item.id === change.id))
          localStorage.setItem(visitQueueKey(userId), JSON.stringify(visitChanges))
        }
        const result = await supabase!.from('tasks').select('id,title,description,category,due_date,due_time,status,priority,assigned_to,show_on_calendar,deleted_at').order('due_date', { ascending: true })
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
          const libraryResult = await supabase!.from('cemig_library_items').select('id,user_id,kind,title,content,created_at,updated_at').order('created_at', { ascending: false })
          if (libraryResult.error) throw libraryResult.error
          setLibraryItems((libraryResult.data ?? []) as LibraryItem[])
          const notesResult = await supabase!.from('agenda_notes').select('id,user_id,title,content,created_at,updated_at').order('created_at', { ascending: false })
          if (notesResult.error) throw notesResult.error
          setAgendaNotes((notesResult.data ?? []) as AgendaNote[])
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
  }, [userId, isOnline, syncVersion, authVerified])

  const saveVisitsCache = (id: string, rows: Visit[]) => localStorage.setItem(visitCacheKey(id), JSON.stringify(rows))
  const saveTopicsCache = (id: string, rows: VisitTopic[]) => localStorage.setItem(topicCacheKey(id), JSON.stringify(rows))

  function queueVisitChange(table: PendingVisitChange['table'], record: Visit | VisitTopic | TopicTransfer) {
    if (!userId) return
    const queue = readJson<PendingVisitChange[]>(visitQueueKey(userId), [])
    const next = [...queue.filter(item => !(item.table === table && item.id === record.id)), { table, id: record.id, record, action: 'upsert' as const }]
    localStorage.setItem(visitQueueKey(userId), JSON.stringify(next))
    setPendingCount(readJson<PendingChange[]>(queueKey(userId), []).length + next.length)
    setSyncVersion(v => v + 1)
  }


  function queueVisitDelete(table: PendingVisitChange['table'], id: string, record: Visit | VisitTopic | TopicTransfer) {
    if (!userId) return
    const queue = readJson<PendingVisitChange[]>(visitQueueKey(userId), [])
    const next = [...queue.filter(item => !(item.table === table && item.id === id)), { table, id, record, action: 'delete' as const }]
    localStorage.setItem(visitQueueKey(userId), JSON.stringify(next))
    setPendingCount(readJson<PendingChange[]>(queueKey(userId), []).length + next.length)
    setSyncVersion(v => v + 1)
  }

  function resetLibraryForm() { setEditingLibraryItem(null); setLibraryTitle(''); setLibraryContent(''); setLibraryFormOpen(false) }
  function editLibraryItem(item: LibraryItem) { setLibraryKind(item.kind); setEditingLibraryItem(item.id); setLibraryTitle(item.title); setLibraryContent(item.content); setLibraryFormOpen(true) }
  async function saveLibraryItem(event: FormEvent) {
    event.preventDefault()
    if (!supabase || !userId || !libraryTitle.trim() || !libraryContent.trim()) return
    setLibraryBusy(true); setError('')
    try {
      const payload = { id: editingLibraryItem ?? crypto.randomUUID(), user_id: userId, kind: libraryKind, title: libraryTitle.trim(), content: libraryContent.trim() }
      const result = await supabase.from('cemig_library_items').upsert(payload, { onConflict: 'id' }).select('id,user_id,kind,title,content,created_at,updated_at').single()
      if (result.error) throw result.error
      setLibraryItems(current => [result.data as LibraryItem, ...current.filter(item => item.id !== payload.id)])
      resetLibraryForm(); setNotice('Registro salvo na biblioteca.')
    } catch (e) { setError('Não foi possível salvar na biblioteca: ' + ((e as {message?:string}).message ?? 'erro inesperado')) }
    finally { setLibraryBusy(false) }
  }
  async function deleteLibraryItem(item: LibraryItem) {
    if (!supabase || !userId || !window.confirm('Excluir "' + item.title + '" da biblioteca?')) return
    setLibraryBusy(true)
    try {
      const result = await supabase.from('cemig_library_items').delete().eq('id', item.id).eq('user_id', userId)
      if (result.error) throw result.error
      setLibraryItems(current => current.filter(entry => entry.id !== item.id))
      if (editingLibraryItem === item.id) resetLibraryForm()
      setNotice('Registro excluído da biblioteca.')
    } catch (e) { setError('Não foi possível excluir: ' + ((e as {message?:string}).message ?? 'erro inesperado')) }
    finally { setLibraryBusy(false) }
  }

  function resetAgendaNoteForm() { setEditingAgendaNoteId(null); setAgendaNoteTitle(''); setAgendaNoteContent(''); setAgendaNoteFormOpen(false) }
  function editAgendaNote(note: AgendaNote) { setEditingAgendaNoteId(note.id); setAgendaNoteTitle(note.title); setAgendaNoteContent(note.content); setAgendaNoteFormOpen(true) }
  async function saveAgendaNote(event: FormEvent) {
    event.preventDefault()
    if (!supabase || !userId || !agendaNoteTitle.trim() || !agendaNoteContent.trim()) return
    setAgendaNoteBusy(true); setError('')
    try {
      const payload = { id: editingAgendaNoteId ?? crypto.randomUUID(), user_id: userId, title: agendaNoteTitle.trim(), content: agendaNoteContent.trim() }
      const result = await supabase.from('agenda_notes').upsert(payload, { onConflict: 'id' }).select('id,user_id,title,content,created_at,updated_at').single()
      if (result.error) throw result.error
      setAgendaNotes(current => [result.data as AgendaNote, ...current.filter(item => item.id !== payload.id)])
      resetAgendaNoteForm(); setNotice('Anotação salva com sucesso.')
    } catch (e) { setError('Não foi possível salvar a anotação: ' + ((e as {message?:string}).message ?? 'erro inesperado')) }
    finally { setAgendaNoteBusy(false) }
  }
  async function deleteAgendaNote(note: AgendaNote) {
    if (!supabase || !userId || !window.confirm('Excluir a anotação "' + note.title + '"?')) return
    setAgendaNoteBusy(true)
    try {
      const result = await supabase.from('agenda_notes').delete().eq('id', note.id).eq('user_id', userId)
      if (result.error) throw result.error
      setAgendaNotes(current => current.filter(item => item.id !== note.id))
      if (editingAgendaNoteId === note.id) resetAgendaNoteForm()
      if (expandedAgendaNoteId === note.id) setExpandedAgendaNoteId(null)
      setNotice('Anotação excluída.')
    } catch (e) { setError('Não foi possível excluir a anotação: ' + ((e as {message?:string}).message ?? 'erro inesperado')) }
    finally { setAgendaNoteBusy(false) }
  }

  function collectTopicDescendants(rootIds: string[]) {
    const ids = new Set(rootIds)
    let changed = true
    while (changed) {
      changed = false
      for (const topic of visitTopics) {
        if (topic.origin_topic_id && ids.has(topic.origin_topic_id) && !ids.has(topic.id)) {
          ids.add(topic.id)
          changed = true
        }
      }
    }
    return ids
  }

  function deleteVisit(id: string) {
    const visit = visits.find(item => item.id === id)
    if (!visit || !userId) return
    if (!window.confirm('Excluir esta visita/ata e todos os assuntos vinculados? As continuidades desses assuntos em outras atas também serão excluídas. Esta ação não poderá ser desfeita.')) return
    const rootIds = visitTopics.filter(topic => topic.visit_id === id).map(topic => topic.id)
    const ids = collectTopicDescendants(rootIds)
    const depth = (topic: VisitTopic): number => {
      let value = 0, parent = topic.origin_topic_id
      while (parent && ids.has(parent)) {
        value++
        parent = visitTopics.find(item => item.id === parent)?.origin_topic_id
      }
      return value
    }
    const affected = visitTopics.filter(topic => ids.has(topic.id)).sort((a,b) => depth(b) - depth(a))
    for (const topic of affected) queueVisitDelete('visit_topics', topic.id, topic)
    queueVisitDelete('visits', visit.id, visit)
    const nextTopics = visitTopics.filter(topic => !ids.has(topic.id))
    const nextVisits = visits.filter(item => item.id !== id)
    setVisitTopics(nextTopics); saveTopicsCache(userId, nextTopics)
    setVisits(nextVisits); saveVisitsCache(userId, nextVisits)
    if (selectedVisitId === id) { setSelectedVisitId(nextVisits[0]?.id ?? ''); setEditingVisit(null) }
    setNotice(isOnline ? 'Visita excluída. Sincronização iniciada.' : 'Visita excluída deste dispositivo e aguardando sincronização.')
  }

  function deleteVisitTopic(id: string) {
    const topic = visitTopics.find(item => item.id === id)
    if (!topic || !userId) return
    if (!window.confirm('Excluir este assunto? As cópias de continuidade em outras atas também serão excluídas. Esta ação não poderá ser desfeita.')) return
    const ids = collectTopicDescendants([id])
    const depth = (item: VisitTopic): number => {
      let value = 0, parent = item.origin_topic_id
      while (parent && ids.has(parent)) {
        value++
        parent = visitTopics.find(candidate => candidate.id === parent)?.origin_topic_id
      }
      return value
    }
    const affected = visitTopics.filter(item => ids.has(item.id)).sort((a,b) => depth(b) - depth(a))
    for (const item of affected) queueVisitDelete('visit_topics', item.id, item)
    const next = visitTopics.filter(item => !ids.has(item.id))
    setVisitTopics(next); saveTopicsCache(userId, next)
    setNotice(isOnline ? 'Assunto excluído. Sincronização iniciada.' : 'Assunto excluído deste dispositivo e aguardando sincronização.')
  }

  function queueChange(task: Task, deleted_at: string | null = null) {
    if (!userId) return
    const queue = readJson<PendingChange[]>(queueKey(userId), [])
    const next = [...queue.filter(item => item.id !== task.id), { id: task.id, task, deleted_at }]
    savePending(userId, next)
    setPendingCount(next.length + readJson<PendingVisitChange[]>(visitQueueKey(userId), []).length)
    setSyncVersion(v => v + 1)
  }

  useEffect(() => {
    const refreshDay = () => setCurrentDate(today())
    const timer = window.setInterval(refreshDay, 60000)
    window.addEventListener('focus', refreshDay)
    return () => { window.clearInterval(timer); window.removeEventListener('focus', refreshDay) }
  }, [])

  useEffect(() => {
    if (!userId || tasks.length === 0) return
    const rolledTasks = tasks.map(task =>
      task.category !== 'Reunião' && task.due_date < currentDate && task.status !== 'Concluído'
        ? { ...task, due_date: currentDate }
        : task
    )
    const changed = rolledTasks.filter((task, index) => task.due_date !== tasks[index].due_date)
    if (changed.length === 0) return
    setTasks(rolledTasks)
    saveTaskCache(userId, rolledTasks)
    changed.forEach(task => queueChange(task))
    setNotice(changed.length === 1
      ? 'Uma atividade pendente foi transferida para hoje.'
      : changed.length + ' atividades pendentes foram transferidas para hoje.')
  }, [userId, currentDate, tasks])

  async function handleAuth(event: FormEvent) {
    event.preventDefault()
    if (!supabase) return
    setAuthBusy(true); setError(''); setNotice('')
    try {
      if (!navigator.onLine) throw new Error('É necessário estar conectado à internet para entrar no Watt-Wise.')
      if (authMode === 'signup') {
        const { data, error } = await supabase.auth.signUp({ email: email.trim(), password })
        if (error) throw error
        if (data.session) setNotice('Conta criada! Você já está conectado.')
        else { setNotice('Cadastro iniciado. Confira seu e-mail para confirmar a conta e depois entre.'); return }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
        if (error) throw error
      }
      const { data: verified, error: verifyError } = await supabase.auth.getUser()
      if (verifyError || !verified.user) throw verifyError ?? new Error('Não foi possível validar sua conta.')
      setUserEmail(verified.user.email ?? '')
      setUserId(verified.user.id)
      setAuthVerified(true)
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível concluir o acesso.') }
    finally { setAuthBusy(false) }
  }

  async function addTask(event: FormEvent) {
    event.preventDefault()
    if (!userId || !title.trim()) return
    setError(''); setNotice('')
    const task: Task = { id: crypto.randomUUID(), title: title.trim(), description: description.trim() || null, category, due_date: date, due_time: time || null, priority, assigned_to: assignedTo.trim() || null, show_on_calendar: showOnCalendar, status: 'A fazer', deleted_at: null }
    const nextTasks = [...tasks, task].sort((a,b) => a.due_date.localeCompare(b.due_date))
    setTasks(nextTasks); saveTaskCache(userId, nextTasks)
    queueChange(task)
    setTitle(''); setDescription(''); setTime(''); setPriority('Média'); setAssignedTo(''); setShowOnCalendar(false); setDate(today())
    setNotice(isOnline ? 'Atividade salva neste dispositivo e enviada para sincronização.' : 'Atividade salva neste dispositivo. Será sincronizada quando a internet voltar.')
  }

  function saveMeeting(event: FormEvent) {
    event.preventDefault()
    if (!userId || !meetingTitle.trim()) return
    const existing = editingMeetingId ? tasks.find(item => item.id === editingMeetingId) : null
    const meeting: Task = {
      id: editingMeetingId ?? crypto.randomUUID(),
      title: meetingTitle.trim(),
      description: meetingNotes.trim() || null,
      category: 'Reunião',
      due_date: meetingDate,
      due_time: meetingTime || null,
      status: meetingStatus,
      priority: meetingPriority,
      assigned_to: null,
      show_on_calendar: true,
      deleted_at: null
    }
    const next = [...tasks.filter(item => item.id !== meeting.id), meeting].sort((a,b) => a.due_date.localeCompare(b.due_date) || (a.due_time ?? '').localeCompare(b.due_time ?? ''))
    setTasks(next); saveTaskCache(userId, next); queueChange(meeting)
    setMeetingTitle(''); setMeetingDate(today()); setMeetingTime(''); setMeetingPriority('Média'); setMeetingStatus('A fazer'); setMeetingNotes(''); setEditingMeetingId(null); setMeetingFormOpen(false)
    setNotice(isOnline ? (existing ? 'Reunião atualizada e enviada para sincronização.' : 'Reunião cadastrada e enviada para sincronização.') : 'Reunião salva neste dispositivo. Será sincronizada quando a internet voltar.')
  }

  function editMeeting(meeting: Task) {
    setEditingMeetingId(meeting.id); setMeetingTitle(meeting.title); setMeetingDate(meeting.due_date); setMeetingTime(meeting.due_time ?? ''); setMeetingPriority(meeting.priority); setMeetingStatus(meeting.status); setMeetingNotes(meeting.description ?? ''); setMeetingFormOpen(true)
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }

  async function changeStatus(id: string, status: TaskStatus) {
    const task = tasks.find(t => t.id === id)
    if (!task) return
    const updated = { ...task, status, ...(status === 'Concluído' ? { due_date: today() } : {}) }
    const nextTasks = tasks.map(t => t.id === id ? updated : t)
    setTasks(nextTasks); saveTaskCache(userId, nextTasks)
    queueChange(updated)
    setNotice(isOnline ? 'Status atualizado. Sincronização iniciada.' : 'Status atualizado neste dispositivo e aguardando sincronização.')
  }

  async function deleteTask(id: string) {
    if (!window.confirm('Deseja excluir esta atividade? Ela deixará de aparecer na agenda e será removida da sua conta após a sincronização.')) return
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

  function saveEditedVisit(event: FormEvent) {
    event.preventDefault()
    if (!userId || !editingVisit || !editingVisit.title.trim()) return
    const updated: Visit = { ...editingVisit, title: editingVisit.title.trim(), participants: editingVisit.participants?.trim() || null, notes: editingVisit.notes?.trim() || null }
    const next = visits.map(item => item.id === updated.id ? updated : item).sort((a,b) => b.visit_date.localeCompare(a.visit_date))
    setVisits(next); saveVisitsCache(userId, next); queueVisitChange('visits', updated)
    setEditingVisit(null)
    setNotice(isOnline ? 'Visita editada e enviada para sincronização.' : 'Visita editada neste dispositivo. Será sincronizada quando a internet voltar.')
  }

  function addVisitTopic(event: FormEvent) {
    event.preventDefault()
    if (!userId || !selectedVisitId || !topicTitle.trim()) return
    const topic: VisitTopic = { id: crypto.randomUUID(), visit_id: selectedVisitId, user_id: userId, category: topicCategory, title: topicTitle.trim(), description: topicDescription.trim() || null, responsible: topicResponsible.trim() || null, protocol: topicProtocol.trim() || null, due_date: topicDueDate || null, status: 'Pendente', observations: topicObservations.trim() || null }
    const next = [...visitTopics, topic]
    setVisitTopics(next); saveTopicsCache(userId, next); queueVisitChange('visit_topics', topic)
    setTopicCategory('Troca de titularidade'); setTopicTitle(''); setTopicDescription(''); setTopicResponsible(''); setTopicProtocol(''); setTopicDueDate(''); setTopicObservations('')
    setNotice(isOnline ? 'Assunto registrado e enviado para sincronização.' : 'Assunto salvo neste dispositivo. Será sincronizado quando a internet voltar.')
  }

  const normalizeAuditText = (value: unknown) => String(value ?? '').trim().toLocaleLowerCase('pt-BR').normalize('NFD').replace(/[\u0300-\u036f]/g, '')
  const auditCellValue = (cell: ExcelJS.Cell): unknown => {
    const value = cell.value
    if (value && typeof value === 'object' && 'result' in value) return (value as { result?: unknown }).result ?? cell.text
    return value ?? cell.text
  }
  const parseAuditMonth = (value: unknown): number | null => {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value.getFullYear() * 12 + value.getMonth()
    if (typeof value === 'number' && Number.isFinite(value)) {
      if (value > 200000 && value < 300000) {
        const year = Math.floor(value / 100), month = value % 100
        if (month >= 1 && month <= 12) return year * 12 + month - 1
      }
      if (value > 1 && value < 100000) {
        const date = new Date(Date.UTC(1899, 11, 30) + value * 86400000)
        if (!Number.isNaN(date.getTime())) return date.getUTCFullYear() * 12 + date.getUTCMonth()
      }
    }
    const raw = normalizeAuditText(value)
    if (!raw) return null
    const months: Record<string, number> = { janeiro:1, jan:1, fevereiro:2, fev:2, marco:3, mar:3, abril:4, abr:4, maio:5, mai:5, junho:6, jun:6, julho:7, jul:7, agosto:8, ago:8, setembro:9, set:9, outubro:10, out:10, novembro:11, nov:11, dezembro:12, dez:12 }
    const yearMatch = raw.match(/(?:19|20)\d{2}/)
    const year = yearMatch ? Number(yearMatch[0]) : new Date().getFullYear()
    const numeric = raw.match(/(?:^|\D)(0?[1-9]|1[0-2])\s*[\/.-]\s*((?:19|20)\d{2})(?:\D|$)/) || raw.match(/^((?:19|20)\d{2})\s*[\/.-]\s*(0?[1-9]|1[0-2])$/)
    if (numeric) {
      const month = numeric[0].startsWith(String(yearMatch?.[0] ?? '')) && numeric[0].startsWith('20') ? Number(numeric[2]) : Number(numeric[1])
      const parsedYear = Number(yearMatch?.[0] ?? (numeric[2] && numeric[2].length === 4 ? numeric[2] : numeric[1]))
      if (month >= 1 && month <= 12 && parsedYear >= 1900 && parsedYear <= 2200) return parsedYear * 12 + month - 1
    }
    const monthName = Object.keys(months).find(name => new RegExp('(?:^|\\b)' + name + '(?:\\b|$)').test(raw))
    if (monthName) return year * 12 + months[monthName] - 1
    return null
  }
  const auditMonthLabel = (monthIndex: number) => new Date(Math.floor(monthIndex / 12), monthIndex % 12, 1).toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' })

  async function auditInvoices(file?: File) {
    if (!file) return
    setError(''); setNotice(''); setAuditResult(null); auditWorkbookRef.current = null
    if (!file.name.toLowerCase().endsWith('.xlsx')) { setError('Envie uma planilha no formato .xlsx. Arquivos .xls, .xlsm, CSV e outros formatos não são aceitos nesta primeira versão.'); return }
    if (file.size === 0 || file.size > 10 * 1024 * 1024) { setError('O arquivo está vazio ou ultrapassa o limite de 10 MB.'); return }
    setAuditBusy(true)
    try {
      const workbook = new ExcelJS.Workbook()
      await workbook.xlsx.load(await file.arrayBuffer())
      if (workbook.worksheets.length > 30) throw new Error('A planilha possui mais de 30 abas. Reduza o arquivo e tente novamente por segurança.')
      for (const sheet of workbook.worksheets) {
        if (sheet.rowCount > 100000) throw new Error('A aba "' + sheet.name + '" possui mais de 100 mil linhas. Reduza o arquivo para evitar uso excessivo de memória.')
        if (sheet.columnCount > 500) throw new Error('A aba "' + sheet.name + '" possui mais de 500 colunas. Confira a estrutura do arquivo antes de continuar.')
      }
      let target: { worksheet: ExcelJS.Worksheet; headerRow: number; installationCol: number; referenceCol: number; clientCol: number } | null = null
      for (const worksheet of workbook.worksheets) {
        const scanLimit = Math.min(worksheet.rowCount, 20)
        for (let rowNumber = 1; rowNumber <= scanLimit; rowNumber++) {
          const row = worksheet.getRow(rowNumber)
          let installationCol = 0, referenceCol = 0, clientCol = 0
          row.eachCell({ includeEmpty: false }, (cell, columnNumber) => {
            const heading = normalizeAuditText(auditCellValue(cell))
            if (!installationCol && heading.includes('instal')) installationCol = columnNumber
            if (!referenceCol && (heading.includes('refer') || heading.includes('compet') || heading === 'mes' || heading.includes('mes ref'))) referenceCol = columnNumber
            if (!clientCol && (heading.includes('cliente') || heading === 'nome' || heading.includes('nome do cliente'))) clientCol = columnNumber
          })
          if (installationCol && referenceCol) { target = { worksheet, headerRow: rowNumber, installationCol, referenceCol, clientCol }; break }
        }
        if (target) break
      }
      if (!target) throw new Error('Não encontrei os cabeçalhos de Instalação e Mês de referência. Confira se a planilha contém essas colunas na primeira parte da aba.')
      const { worksheet, headerRow, installationCol, referenceCol, clientCol } = target
      const records: Array<{ rowNumber: number; installation: string; client: string; month: number }> = []
      const monthsFound = new Set<number>()
      let invalidRows = 0
      const seenInstallationMonth = new Set<string>()
      let duplicateInstallationMonths = 0
      const clientsByInstallation = new Map<string, Set<string>>()
      worksheet.eachRow((row, rowNumber) => {
        if (rowNumber <= headerRow) return
        const rawInstallation = auditCellValue(row.getCell(installationCol))
        const installation = String(rawInstallation ?? '').replace(/\.0$/, '').replace(/[^\dA-Za-z]/g, '')
        if (!installation) return
        const month = parseAuditMonth(auditCellValue(row.getCell(referenceCol)) ?? row.getCell(referenceCol).text)
        if (month === null) { invalidRows++; return }
        const rawClient = clientCol ? auditCellValue(row.getCell(clientCol)) : ''
        const client = String(rawClient ?? '').trim()
        records.push({ rowNumber, installation, client, month })
        monthsFound.add(month)
        const pair = installation + '|' + month
        if (seenInstallationMonth.has(pair)) duplicateInstallationMonths++
        else seenInstallationMonth.add(pair)
        if (client) {
          if (!clientsByInstallation.has(installation)) clientsByInstallation.set(installation, new Set())
          clientsByInstallation.get(installation)!.add(client)
        }
      })
      if (!records.length) throw new Error('Nenhum registro válido com número de instalação e mês de referência foi encontrado. O arquivo não foi alterado.')
      const latestMonths = [...monthsFound].sort((a, b) => b - a).slice(0, 3)
      if (latestMonths.length < 3) throw new Error('A planilha precisa conter pelo menos três meses de referência diferentes para realizar a comparação. O arquivo não foi alterado.')
      const [latest, previousOne, previousTwo] = latestMonths
      const byInstallation = new Map<string, Set<number>>()
      const clientByInstallation = new Map<string, string>()
      for (const record of records) {
        if (!byInstallation.has(record.installation)) byInstallation.set(record.installation, new Set())
        byInstallation.get(record.installation)!.add(record.month)
        if (record.client && !clientByInstallation.has(record.installation)) clientByInstallation.set(record.installation, record.client)
      }
      const marked = new Set<string>()
      const missing: Array<{ installation: string; client: string }> = []
      for (const [installation, references] of byInstallation) {
        if (latestMonths.every(month => references.has(month))) marked.add(installation)
        else if (references.has(previousOne) && references.has(previousTwo) && !references.has(latest)) {
          missing.push({ installation, client: clientByInstallation.get(installation) || 'Nome não informado' })
        }
      }
      const warnings: string[] = []
      if (monthsFound.size > 3) warnings.push('Foram encontrados ' + monthsFound.size + ' meses de referência. A comparação utilizou somente os três mais recentes; os meses anteriores foram ignorados.')
      if (invalidRows > 0) warnings.push(invalidRows + ' linha(s) com instalação, mas referência de mês inválida, foram ignoradas.')
      if (duplicateInstallationMonths > 0) warnings.push('Há ' + duplicateInstallationMonths + ' registro(s) repetidos para a mesma instalação e mês. Confira antes de interpretar os resultados.')
      const conflictingClients = [...clientsByInstallation.values()].filter(names => names.size > 1).length
      if (conflictingClients > 0) warnings.push(conflictingClients + ' instalação(ões) aparecem associadas a mais de um nome de cliente.')
      if (records.length > 50000) warnings.push('Arquivo grande: foram processados mais de 50 mil registros. Confira se o resultado corresponde ao esperado.')
      const orangeFill: ExcelJS.Fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFD08A' } }
      for (const record of records) {
        if (!marked.has(record.installation)) continue
        const row = worksheet.getRow(record.rowNumber)
        row.eachCell({ includeEmpty: true }, cell => { cell.fill = orangeFill })
      }
      auditWorkbookRef.current = workbook
      auditFileNameRef.current = file.name
      setAuditResult({ fileName: file.name, months: latestMonths.map(auditMonthLabel), markedCount: marked.size, missing: missing.sort((a, b) => a.installation.localeCompare(b.installation, 'pt-BR')), rowCount: records.length, uniqueInstallations: byInstallation.size, invalidRows, duplicateInstallationMonths, warnings })
      setNotice('Auditoria concluída. O arquivo foi processado somente neste dispositivo; ele não foi enviado ao servidor.')
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Não foi possível ler a planilha.'
      setError(message)
    } finally {
      setAuditBusy(false)
    }
  }
  async function downloadAuditedWorkbook() {
    if (!auditWorkbookRef.current || !auditFileNameRef.current) return
    try {
      const output = await auditWorkbookRef.current.xlsx.writeBuffer()
      const blob = new Blob([output as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = auditFileNameRef.current.replace(/\.xlsx$/i, '') + '_auditada.xlsx'
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      setNotice('Planilha auditada preparada para download.')
    } catch {
      setError('Não foi possível gerar a cópia auditada. Tente anexar a planilha novamente.')
    }
  }

  function clearAudit() {
    auditWorkbookRef.current = null
    auditFileNameRef.current = ''
    setAuditResult(null)
    setError('')
    setNotice('')
  }
  const normalizeContractAuditKey = (value: unknown) => String(value ?? '').trim().replace(/\.0$/, '').replace(/[^\dA-Za-z]/g, '')
  type ParsedXlsxRow = { number: number; cells: Map<number, string> }
  type ParsedXlsxSheet = { name: string; rows: ParsedXlsxRow[] }
  const parseXlsxXml = (xml: string, part: string) => {
    const doc = new DOMParser().parseFromString(xml.replace(/^\uFEFF/, ''), 'application/xml')
    if (doc.getElementsByTagName('parsererror').length) throw new Error('XML inválido no componente ' + part + '.')
    return doc
  }
  const xmlElements = (node: Document | Element, localName: string) =>
    Array.from(node.getElementsByTagNameNS('*', localName))
  const resolveXlsxTarget = (sourcePart: string, target: string) => {
    const clean = target.replace(/\\/g, '/')
    if (clean.startsWith('/')) return clean.slice(1)
    const parts = sourcePart.split('/').slice(0, -1)
    for (const part of clean.split('/')) {
      if (!part || part === '.') continue
      if (part === '..') parts.pop()
      else parts.push(part)
    }
    return parts.join('/')
  }
  async function readXlsxSheets(file: File): Promise<ParsedXlsxSheet[]> {
    const zip = await JSZip.loadAsync(await file.arrayBuffer())
    const readXml = async (path: string) => {
      const entry = zip.file(path)
      if (!entry) throw new Error('Componente ausente no Excel: ' + path)
      return parseXlsxXml(await entry.async('string'), path)
    }
    const workbook = await readXml('xl/workbook.xml')
    const relationships = await readXml('xl/_rels/workbook.xml.rels')
    const relationMap = new Map<string, string>()
    for (const rel of xmlElements(relationships, 'Relationship')) {
      const id = rel.getAttribute('Id')
      const target = rel.getAttribute('Target')
      if (id && target) relationMap.set(id, resolveXlsxTarget('xl/workbook.xml', target))
    }
    const sharedStrings: string[] = []
    if (zip.file('xl/sharedStrings.xml')) {
      const shared = await readXml('xl/sharedStrings.xml')
      for (const item of xmlElements(shared, 'si')) {
        sharedStrings.push(xmlElements(item, 't').map(t => t.textContent ?? '').join(''))
      }
    }
    const sheets: ParsedXlsxSheet[] = []
    for (const sheetNode of xmlElements(workbook, 'sheet')) {
      const name = sheetNode.getAttribute('name') || 'Planilha ' + (sheets.length + 1)
      const relationId = sheetNode.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id')
        || sheetNode.getAttribute('r:id')
      const sheetPath = relationId ? relationMap.get(relationId) : undefined
      if (!sheetPath) continue
      const sheetXml = await readXml(sheetPath)
      const sheetData = xmlElements(sheetXml, 'sheetData')[0]
      if (!sheetData) continue
      const rows: ParsedXlsxRow[] = []
      for (const rowNode of xmlElements(sheetData, 'row')) {
        const rowNumber = Number(rowNode.getAttribute('r')) || rows.length + 1
        const cells = new Map<number, string>()
        let fallbackColumn = 0
        for (const cellNode of xmlElements(rowNode, 'c')) {
          const ref = cellNode.getAttribute('r') || ''
          const letters = ref.match(/[A-Z]+/i)?.[0] || ''
          let column = 0
          for (const letter of letters.toUpperCase()) column = column * 26 + letter.charCodeAt(0) - 64
          if (!column) column = fallbackColumn + 1
          fallbackColumn = column
          const type = cellNode.getAttribute('t') || ''
          const valueNode = xmlElements(cellNode, 'v')[0]
          let value = valueNode?.textContent ?? ''
          if (type === 's' && value !== '') {
            const index = Number(value)
            value = Number.isInteger(index) ? (sharedStrings[index] ?? '') : ''
          } else if (type === 'inlineStr') {
            const inline = xmlElements(cellNode, 'is')[0]
            value = inline ? xmlElements(inline, 't').map(t => t.textContent ?? '').join('') : ''
          } else if (type === 'b') {
            value = value === '1' ? 'TRUE' : 'FALSE'
          }
          cells.set(column, value)
        }
        rows.push({ number: rowNumber, cells })
      }
      sheets.push({ name, rows })
    }
    if (!sheets.length) throw new Error('O arquivo não contém abas de dados reconhecidas.')
    return sheets
  }
  async function auditContracts(contractFile?: File, invoiceFile?: File) {
    if (!contractFile || !invoiceFile) return
    setError(''); setNotice(''); setContractAuditResult(null); setContractAuditBusy(true)
    const validFile = (file: File) => file.name.toLowerCase().endsWith('.xlsx') && file.size > 0 && file.size <= 10 * 1024 * 1024
    if (!validFile(contractFile) || !validFile(invoiceFile)) { setError('Envie duas planilhas .xlsx válidas, com até 10 MB cada.'); setContractAuditBusy(false); return }
    try {
      const [contractSheets, invoiceSheets] = await Promise.all([readXlsxSheets(contractFile), readXlsxSheets(invoiceFile)])
      const findHeaders = (sheets: ParsedXlsxSheet[], expected: string[]) => {
        for (const sheet of sheets) {
          for (const row of sheet.rows.slice(0, 30)) {
            const map = new Map<string, number>()
            for (const [column, value] of row.cells) map.set(normalizeAuditText(value), column)
            if (expected.every(header => map.has(normalizeAuditText(header)))) return { sheet, row: row.number, map }
          }
        }
        return null
      }
      const contractHead = findHeaders(contractSheets, ['Número instalação', 'Nº unidade consumidora', 'Titular conta', 'Situação Contrato'])
      const invoiceHead = findHeaders(invoiceSheets, ['Instalação', 'Unid. Consumidora', 'Geração de Faturas', 'Status da Fatura', 'Status de Boleto Gerado'])
      if (!contractHead) throw new Error('Não localizei na planilha de contratos as colunas Número instalação, Nº unidade consumidora, Titular conta e Situação Contrato. Abas lidas: ' + contractSheets.map(s => s.name).join(', '))
      if (!invoiceHead) throw new Error('Não localizei na planilha de faturas as colunas Instalação, Unid. Consumidora, Geração de Faturas, Status da Fatura e Status de Boleto Gerado. Abas lidas: ' + invoiceSheets.map(s => s.name).join(', '))
      const get = (row: ParsedXlsxRow, map: Map<string, number>, header: string) => row.cells.get(map.get(normalizeAuditText(header)) ?? -1) ?? ''
      const activeContracts = new Map<string, { client: string; installation: string; uc: string }>()
      let duplicates = 0, skipped = 0
      for (const row of contractHead.sheet.rows) {
        if (row.number <= contractHead.row) continue
        if (normalizeAuditText(get(row, contractHead.map, 'Situação Contrato')) !== 'ativo') continue
        const installation = normalizeContractAuditKey(get(row, contractHead.map, 'Número instalação'))
        const uc = normalizeContractAuditKey(get(row, contractHead.map, 'Nº unidade consumidora'))
        const client = get(row, contractHead.map, 'Titular conta').trim()
        if (!installation || !uc) { skipped++; continue }
        const key = installation + '|' + uc
        if (activeContracts.has(key)) duplicates++
        else activeContracts.set(key, { client, installation, uc })
      }
      if (!activeContracts.size) throw new Error('A planilha foi lida, mas nenhum contrato com Situação Contrato = Ativo e instalação + UC preenchidas foi encontrado.')
      const billed = new Set<string>()
      let ignoredInvoiceRows = 0, invoiceRowsWithKeys = 0
      for (const row of invoiceHead.sheet.rows) {
        if (row.number <= invoiceHead.row) continue
        const installation = normalizeContractAuditKey(get(row, invoiceHead.map, 'Instalação'))
        const uc = normalizeContractAuditKey(get(row, invoiceHead.map, 'Unid. Consumidora'))
        if (!installation || !uc) continue
        invoiceRowsWithKeys++
        const generation = normalizeAuditText(get(row, invoiceHead.map, 'Geração de Faturas'))
        const invoiceStatus = normalizeAuditText(get(row, invoiceHead.map, 'Status da Fatura'))
        const boletoStatus = normalizeAuditText(get(row, invoiceHead.map, 'Status de Boleto Gerado'))
        if (invoiceStatus.includes('cancelado') || generation !== 'ativo' || boletoStatus !== 'sucesso') { ignoredInvoiceRows++; continue }
        billed.add(installation + '|' + uc)
      }
      if (!invoiceRowsWithKeys) throw new Error('A aba de faturas foi aberta, mas não há registros com Instalação e Unid. Consumidora preenchidas.')
      const missing = [...activeContracts.entries()].filter(([key]) => !billed.has(key)).map(([, value]) => value).sort((a, b) => a.client.localeCompare(b.client, 'pt-BR'))
      const warnings: string[] = []
      if (duplicates) warnings.push(duplicates + ' contrato(s) ativo(s) duplicado(s) pela combinação instalação + UC foram consolidados.')
      if (skipped) warnings.push(skipped + ' contrato(s) ativo(s) sem instalação ou UC foram ignorados.')
      if (ignoredInvoiceRows) warnings.push(ignoredInvoiceRows + ' linha(s) de faturas sem geração ativa, boleto com sucesso ou com status cancelado não foram consideradas como faturamento válido.')
      setContractAuditResult({ fileNames: [contractFile.name, invoiceFile.name], total: activeContracts.size, matched: activeContracts.size - missing.length, missing, warnings })
      setNotice('Comparativo concluído. ' + activeContracts.size.toLocaleString('pt-BR') + ' contratos ativos comparados com ' + billed.size.toLocaleString('pt-BR') + ' combinações com fatura válida. Os arquivos foram processados localmente.')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Falha ao comparar as planilhas.')
    } finally {
      setContractAuditBusy(false)
    }
  }
  async function exportContractAudit() {
    if (!contractAuditResult || !contractListFile) return
    try {
      // Use the uploaded contract workbook itself as the template so its styles,
      // columns, formulas, sheets, and original layout remain intact.
      const zip = await JSZip.loadAsync(await contractListFile.arrayBuffer())
      const readXml = async (path: string) => {
        const entry = zip.file(path)
        if (!entry) throw new Error('Componente ausente no Excel: ' + path)
        return parseXlsxXml(await entry.async('string'), path)
      }
      const workbookXml = await readXml('xl/workbook.xml')
      const relsXml = await readXml('xl/_rels/workbook.xml.rels')
      const relMap = new Map<string, string>()
      for (const rel of xmlElements(relsXml, 'Relationship')) {
        const id = rel.getAttribute('Id'), target = rel.getAttribute('Target')
        if (id && target) relMap.set(id, resolveXlsxTarget('xl/workbook.xml', target))
      }
      const sharedStrings: string[] = []
      if (zip.file('xl/sharedStrings.xml')) {
        const sharedXml = await readXml('xl/sharedStrings.xml')
        for (const item of xmlElements(sharedXml, 'si')) sharedStrings.push(xmlElements(item, 't').map(t => t.textContent ?? '').join(''))
      }
      const missingKeys = new Set(contractAuditResult.missing.map(item => normalizeContractAuditKey(item.installation) + '|' + normalizeContractAuditKey(item.uc)))
      let targetPath = ''
      for (const sheetNode of xmlElements(workbookXml, 'sheet')) {
        const relationId = sheetNode.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id') || sheetNode.getAttribute('r:id')
        const sheetPath = relationId ? relMap.get(relationId) : undefined
        if (!sheetPath) continue
        const xml = await readXml(sheetPath)
        const sheetData = xmlElements(xml, 'sheetData')[0]
        if (!sheetData) continue
        const rows = xmlElements(sheetData, 'row')
        const headerRow = rows.find(rowNode => {
          const cells = new Map<number, string>()
          for (const cell of xmlElements(rowNode, 'c')) {
            const letters = (cell.getAttribute('r') || '').match(/[A-Z]+/i)?.[0] || ''
            let col = 0
            for (const letter of letters.toUpperCase()) col = col * 26 + letter.charCodeAt(0) - 64
            const type = cell.getAttribute('t') || ''
            const v = xmlElements(cell, 'v')[0]
            let value = v?.textContent ?? ''
            if (type === 's' && value) value = sharedStrings[Number(value)] ?? ''
            else if (type === 'inlineStr') value = xmlElements(xmlElements(cell, 'is')[0] ?? cell, 't').map(t => t.textContent ?? '').join('')
            cells.set(col, normalizeAuditText(value))
          }
          return ['número instalação','nº unidade consumidora','titular conta','situação contrato'].every(h => [...cells.values()].includes(normalizeAuditText(h)))
        })
        if (!headerRow) continue
        const headerNumber = Number(headerRow.getAttribute('r')) || 1
        const headerMap = new Map<string, number>()
        for (const cell of xmlElements(headerRow, 'c')) {
          const letters = (cell.getAttribute('r') || '').match(/[A-Z]+/i)?.[0] || ''
          let col = 0
          for (const letter of letters.toUpperCase()) col = col * 26 + letter.charCodeAt(0) - 64
          const type = cell.getAttribute('t') || ''
          const v = xmlElements(cell, 'v')[0]
          let value = v?.textContent ?? ''
          if (type === 's' && value) value = sharedStrings[Number(value)] ?? ''
          else if (type === 'inlineStr') value = xmlElements(xmlElements(cell, 'is')[0] ?? cell, 't').map(t => t.textContent ?? '').join('')
          headerMap.set(normalizeAuditText(value), col)
        }
        const getValue = (rowNode: Element, col: number) => {
          const cell = xmlElements(rowNode, 'c').find(c => {
            const letters = (c.getAttribute('r') || '').match(/[A-Z]+/i)?.[0] || ''
            let n = 0
            for (const letter of letters.toUpperCase()) n = n * 26 + letter.charCodeAt(0) - 64
            return n === col
          })
          if (!cell) return ''
          const type = cell.getAttribute('t') || ''
          const v = xmlElements(cell, 'v')[0]
          let value = v?.textContent ?? ''
          if (type === 's' && value) value = sharedStrings[Number(value)] ?? ''
          else if (type === 'inlineStr') value = xmlElements(xmlElements(cell, 'is')[0] ?? cell, 't').map(t => t.textContent ?? '').join('')
          return value
        }
        const installationCol = headerMap.get(normalizeAuditText('Número instalação'))
        const ucCol = headerMap.get(normalizeAuditText('Nº unidade consumidora'))
        const statusCol = headerMap.get(normalizeAuditText('Situação Contrato'))
        if (installationCol == null || ucCol == null || statusCol == null) continue
        for (const rowNode of rows) {
          const number = Number(rowNode.getAttribute('r')) || 0
          if (number <= headerNumber) continue
          if (normalizeAuditText(getValue(rowNode, statusCol)) !== 'ativo') { sheetData.removeChild(rowNode); continue }
          const installation = normalizeContractAuditKey(getValue(rowNode, installationCol))
          const uc = normalizeContractAuditKey(getValue(rowNode, ucCol))
          // Exclude empty/incomplete records that can appear as blank formatted rows in the source workbook.
          if (!installation || !uc) { sheetData.removeChild(rowNode); continue }
          const key = installation + '|' + uc
          if (!missingKeys.has(key)) sheetData.removeChild(rowNode)
        }
        targetPath = sheetPath
        zip.file(sheetPath, new XMLSerializer().serializeToString(xml))
        break
      }
      if (!targetPath) throw new Error('Não foi possível localizar a aba de contratos no arquivo modelo.')
      const buffer = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' })
      const url = URL.createObjectURL(buffer)
      const link = document.createElement('a')
      link.href = url
      link.download = 'contratos_sem_faturas_modelo_original.xlsx'
      link.click()
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      setNotice('Exportação concluída usando a planilha original de contratos como modelo, preservando a formatação.')
    } catch (err) {
      setError('Não foi possível exportar usando a planilha original: ' + (err instanceof Error ? err.message : 'erro inesperado.'))
    }
  }

  function exportVisitCsv() {
    const visit = visits.find(item => item.id === selectedVisitId)
    if (!visit) return
    const rows = visitTopics.filter(topic => topic.visit_id === selectedVisitId)
    const fields = ['Ata','Data da visita','Categoria','Assunto','Descrição','Responsável','Protocolo','Prazo','Status','Observações','ID da ata de origem']
    const quote = (value: unknown) => '"' + String(value ?? '').replace(/"/g, '""') + '"'
    const data = [fields, ...rows.map(topic => [visit.title, visit.visit_date, topic.category ?? 'Não categorizado', topic.title, topic.description, topic.responsible, topic.protocol, topic.due_date, topic.status, topic.observations, topic.origin_topic_id])].map(row => row.map(quote).join(';')).join('\r\n')
    const blob = new Blob(['\\uFEFF' + data], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a'); link.href = url; link.download = 'ata-cemig-' + visit.visit_date + '.csv'; link.click(); URL.revokeObjectURL(url)
    setNotice('Arquivo CSV da ata preparado para exportação.')
  }
  function exportVisitExcel() {
    const visit = visits.find(item => item.id === selectedVisitId)
    if (!visit) return
    const rows = visitTopics.filter(topic => topic.visit_id === selectedVisitId)
    const escapeCell = (value: unknown) => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
    const table = [['Ata','Data da visita','Observações gerais','Categoria','Assunto','Descrição','Responsável','Protocolo','Prazo','Status','Observações'], ...rows.map(topic => [visit.title, visit.visit_date, visit.notes, topic.category ?? 'Não categorizado', topic.title, topic.description, topic.responsible, topic.protocol, topic.due_date, topic.status, topic.observations])]
    const html = '<html><head><meta charset="UTF-8"></head><body><table border="1">' + table.map(row => '<tr>' + row.map(cell => '<td>' + escapeCell(cell) + '</td>').join('') + '</tr>').join('') + '</table></body></html>'
    const blob = new Blob(['\\uFEFF', html], { type: 'application/vnd.ms-excel;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a'); link.href = url; link.download = 'ata-cemig-' + visit.visit_date + '.xls'; link.click(); URL.revokeObjectURL(url)
    setNotice('Planilha Excel da ata preparada para exportação.')
  }
  function exportVisitPdf() {
    const visit = visits.find(item => item.id === selectedVisitId)
    if (!visit) return
    const rows = visitTopics.filter(topic => topic.visit_id === selectedVisitId)
    const popup = window.open('', '_blank')
    if (!popup) { setError('O navegador bloqueou a janela de impressão. Permita pop-ups para gerar o PDF.'); return }
    const escapeHtml = (value: unknown) => String(value ?? '—').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/\\n/g, '<br>').replace(/\\*\\*(.+?)\\*\\*/g, '<strong>$1</strong>')
    popup.document.write('<!doctype html><html><head><meta charset="UTF-8"><title>' + escapeHtml(visit.title) + '</title><style>@page{size:A4;margin:0}html,body{margin:0;min-height:297mm}body{font:12px Arial,sans-serif;color:#222;box-sizing:border-box;padding:27mm 18mm 28mm;background-image:url("/agenda/timbrado-wattwise.svg");background-repeat:repeat-y;background-size:210mm 297mm;background-position:top left}h1{font-size:20px}h2{font-size:14px;margin-top:22px}p{white-space:pre-wrap;line-height:1.5}.meta{color:#555}table{width:100%;border-collapse:collapse;margin-top:12px}th,td{border:1px solid #bbb;padding:7px;text-align:left;vertical-align:top}th{background:#eee}tr{break-inside:avoid}@media print{html,body{-webkit-print-color-adjust:exact;print-color-adjust:exact}body{padding:27mm 18mm 28mm}}</style></head><body><h1>' + escapeHtml(visit.title) + '</h1><p class="meta">Data: ' + escapeHtml(new Date(visit.visit_date + 'T12:00:00').toLocaleDateString('pt-BR')) + '<br>Participantes: ' + escapeHtml(visit.participants) + '</p><h2>Observações gerais</h2><p>' + escapeHtml(visit.notes) + '</p><h2>Assuntos registrados</h2><table><thead><tr><th>Categoria</th><th>Assunto / descrição</th><th>Responsável</th><th>Protocolo</th><th>Prazo</th><th>Status</th><th>Observações</th></tr></thead><tbody>' + rows.map(topic => '<tr><td>' + escapeHtml(topic.category ?? 'Não categorizado') + '</td><td><strong>' + escapeHtml(topic.title) + '</strong><br>' + escapeHtml(topic.description) + '</td><td>' + escapeHtml(topic.responsible) + '</td><td>' + escapeHtml(topic.protocol) + '</td><td>' + escapeHtml(topic.due_date) + '</td><td>' + escapeHtml(topic.status) + '</td><td>' + escapeHtml(topic.observations) + '</td></tr>').join('') + '</tbody></table><script>window.onload=()=>window.print()</script></body></html>')
    popup.document.close()
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

  function saveEditedTopic(event: FormEvent) {
    event.preventDefault()
    if (!editingTopic || !userId || !editingTopic.title.trim()) return
    const updated: VisitTopic = { ...editingTopic, title: editingTopic.title.trim(), description: editingTopic.description?.trim() || null, responsible: editingTopic.responsible?.trim() || null, protocol: editingTopic.protocol?.trim() || null, due_date: editingTopic.due_date || null, observations: editingTopic.observations?.trim() || null }
    const next = visitTopics.map(item => item.id === updated.id ? updated : item)
    setVisitTopics(next); saveTopicsCache(userId, next); queueVisitChange('visit_topics', updated)
    setEditingTopic(null)
    setNotice(isOnline ? 'Assunto atualizado e enviado para sincronização.' : 'Assunto atualizado off-line e aguardando sincronização.')
  }

  async function signOut() {
    const unsynced = pendingCount
    if (unsynced > 0 && !window.confirm('Existem ' + unsynced + ' alteração(ões) ainda não sincronizada(s). Ao sair, os dados locais e essas alterações pendentes serão apagados e não poderão ser recuperados. Deseja continuar?')) return
    if (supabase) {
      const { error } = await supabase.auth.signOut({ scope: 'local' })
      if (error) { setError('Não foi possível sair da conta: ' + error.message); return }
    }
    Object.keys(localStorage).filter(key => key.startsWith('wattwise:')).forEach(key => localStorage.removeItem(key))
    setAuthVerified(false)
    setUserEmail(''); setUserId(''); setTasks([]); setVisits([]); setVisitTopics([])
    setHistoryEvents([]); setSelectedVisitId(''); setPendingCount(0)
    setNotice('Você saiu da sua conta. Os dados e arquivos temporários locais do Watt-Wise foram apagados.')
  }

  const visibleTasks = useMemo(() => tasks.filter(t => t.category !== 'Reunião' && t.due_date === selectedAgendaDate &&
    (statusFilter === 'Todos' || t.status === statusFilter) &&
    (categoryFilter === 'Todas' || t.category === categoryFilter) &&
    (priorityFilter === 'Todas' || t.priority === priorityFilter) &&
    (assigneeFilter === 'Todas' || (t.assigned_to ?? '') === assigneeFilter) &&
    (t.title.toLowerCase().includes(search.toLowerCase()) || t.category.toLowerCase().includes(search.toLowerCase()) || (t.description ?? '').toLowerCase().includes(search.toLowerCase()))
  ), [tasks,selectedAgendaDate,statusFilter,categoryFilter,priorityFilter,assigneeFilter,search])
  const overdueTasks = tasks.filter(t => t.status !== 'Concluído' && t.due_date < currentDate)
  const dashboardVisits = dashboardVisitFilter === 'Pendente' || dashboardVisitFilter === 'Em análise' || dashboardVisitFilter === 'Em andamento' || dashboardVisitFilter === 'Acompanhar Chamado' || dashboardVisitFilter === 'Resolvido' ? visits.filter(v => visitTopics.some(t => t.visit_id === v.id && t.status === dashboardVisitFilter)) : visits
  const clearTaskFilters = () => { setStatusFilter('Todos'); setCategoryFilter('Todas'); setPriorityFilter('Todas'); setAssigneeFilter('Todas'); setDateFrom(''); setDateTo(''); setSearch('') }
  const assignees = [...new Set(tasks.map(task => task.assigned_to?.trim()).filter((name): name is string => Boolean(name)))].sort((a,b) => a.localeCompare(b,'pt-BR'))
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
    { id: 'visitas' as const, label: 'Visita à Cemig', icon: ClipboardList },
    { id: 'biblioteca' as const, label: 'Biblioteca', icon: BookOpen },
    { id: 'ouvidoria' as const, label: 'Auditoria', icon: ClipboardList },
    { id: 'historico' as const, label: 'Histórico', icon: History },
  ]

  if (!sessionReady) return <div className="auth-screen"><div className="auth-card"><LoaderCircle className="spin"/><p>Conectando ao Watt-Wise...</p></div></div>
  if (!hasSupabaseConfig || !supabase) return <div className="auth-screen"><div className="auth-card"><div className="brand-mark auth-mark">W</div><h1>Watt-Wise</h1><p>Falta configurar a conexão com o Supabase para liberar o acesso.</p><div className="setup-note"><ShieldCheck size={18}/><span>O endereço do projeto e a chave pública precisam estar nas variáveis de ambiente da hospedagem.</span></div></div></div>
  if (!isOnline) return <div className="auth-screen"><div className="auth-card"><div className="brand-mark auth-mark">W</div><h1>Watt-Wise</h1><p>Por segurança, o acesso exige uma conexão ativa com a internet para validar sua sessão.</p><div className="setup-note"><ShieldCheck size={18}/><span>Conecte-se à internet e atualize a página para entrar. Seus dados não ficam disponíveis off-line.</span></div></div></div>
  if (!authVerified || !userEmail) return <div className="auth-screen"><form className="auth-card" onSubmit={handleAuth}><div className="brand-mark auth-mark">W</div><div className="eyebrow">ORGANIZAÇÃO & ACOMPANHAMENTO</div><h1>Watt-Wise</h1><p>{authMode === 'login' ? 'Entre para acessar sua agenda.' : 'Crie sua conta para começar a usar sua agenda.'}</p>{!isOnline && <div className="notice">Você está sem internet. Para entrar off-line, é necessário já ter acessado esta conta neste dispositivo.</div>}
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
      {nav.map(item => <button key={item.id} className={`nav-item ${(item.id === 'biblioteca' ? section === 'visitas' && visitPageTab === 'library' : section === item.id) ? 'active' : ''}`} onClick={() => {if (item.id === 'biblioteca') {setSection('visitas'); setVisitPageTab('library'); resetLibraryForm()} else {setSection(item.id); if (item.id === 'visitas') setVisitPageTab('visits')} setMobileOpen(false)}}><item.icon size={18}/>{item.label}</button>)}
      <div className="sidebar-bottom"><ShieldCheck size={17}/><span>Área privada</span><small>Conectado como {userEmail}</small></div>
    </aside>
    {mobileOpen && <button className="scrim" onClick={() => setMobileOpen(false)} aria-label="Fechar menu"/>}
    <main className="main">
      <header className="topbar"><button className="menu-button" onClick={() => setMobileOpen(true)}><Menu/></button><div className="breadcrumb">Watt-Wise <span>/</span> {nav.find(n => n.id === section)?.label}</div><div className={'sync-indicator ' + (!isOnline ? 'offline' : syncing ? 'syncing' : syncFailed ? 'pending' : pendingCount ? 'pending' : 'online')}><span className="sync-dot"/>{!isOnline ? 'Off-line' : syncing ? 'Sincronizando...' : syncFailed ? 'Falha na sincronização' : pendingCount ? pendingCount + ' pendente(s)' : 'Sincronizado'}</div><button className="profile" onClick={signOut} title="Sair da conta"><LogOut size={14}/> Sair <ChevronDown size={14}/></button></header>
      <div className="content">
        <div className="welcome"><div><div className="eyebrow">PAINEL DE CONTROLE</div><h1>{section === 'agenda' ? 'Minha Agenda' : section === 'visitas' && visitPageTab === 'library' ? 'Biblioteca' : section === 'visitas' ? 'Visita à Cemig' : section === 'ouvidoria' ? 'Auditoria' : 'Histórico'}</h1><p>{section === 'agenda' ? 'Organize suas atividades, reuniões e agendamentos.' : section === 'visitas' && visitPageTab === 'library' ? 'Consulte, cadastre e organize suas mensagens prontas.' : section === 'visitas' ? 'Registre atas, encaminhamentos e pendências das visitas.' : section === 'ouvidoria' ? 'Área reservada para desenvolvimento dos registros e acompanhamentos da Auditoria.' : 'Acompanhe as movimentações registradas no sistema.'}</p></div><label className="date-chip"><CalendarDays size={16}/><span>Data</span><input aria-label="Selecionar data" type="date" value={selectedDashboardDate} onChange={e => { const day = e.target.value; setSelectedDashboardDate(day); setSelectedAgendaDate(day); setCalendarDate(day); setCalendarView('day') }}/></label></div>

        {error && <div className="error-message">{error}<button onClick={() => setError('')}>Fechar</button></div>}
        {notice && (section === 'agenda' || !notice.includes('transferida para hoje')) && <div className="notice" role="status">{notice}<button onClick={() => setNotice('')}>Fechar</button></div>}
        {section === 'agenda' && <>
          <div className="visit-page-tabs" role="tablist" aria-label="Seções da Minha Agenda">
            <button type="button" role="tab" aria-selected={agendaPageTab === 'agenda'} className={agendaPageTab === 'agenda' ? 'active' : ''} onClick={() => setAgendaPageTab('agenda')}><CalendarDays size={16}/> Agenda</button>
            <button type="button" role="tab" aria-selected={agendaPageTab === 'meetings'} className={agendaPageTab === 'meetings' ? 'active' : ''} onClick={() => setAgendaPageTab('meetings')}><CalendarClock size={16}/> Reunião</button>
            <button type="button" role="tab" aria-selected={agendaPageTab === 'notes'} className={agendaPageTab === 'notes' ? 'active' : ''} onClick={() => setAgendaPageTab('notes')}><BookOpen size={16}/> Anotações</button>
          </div>
          {agendaPageTab === 'agenda' && <>
          <div className="stats">
            <div className="stat-card"><span>Atividades do dia</span><strong>{tasks.filter(t => t.due_date === selectedAgendaDate && t.category !== 'Reunião').length}</strong><CalendarDays/></div>
            <div className="stat-card"><span>A fazer</span><strong>{tasks.filter(t => t.due_date === selectedAgendaDate && t.status === 'A fazer' && t.category !== 'Reunião').length}</strong><AlertCircle/></div>
            <div className="stat-card"><span>Em andamento</span><strong>{tasks.filter(t => t.due_date === selectedAgendaDate && t.status === 'Em andamento' && t.category !== 'Reunião').length}</strong><Clock3/></div>
            <div className="stat-card"><span>Concluídas</span><strong>{tasks.filter(t => t.due_date === selectedAgendaDate && t.status === 'Concluído' && t.category !== 'Reunião').length}</strong><CheckCircle2/></div>
            <div className="stat-card overdue-stat"><span>Atrasadas</span><strong>{overdueTasks.length}</strong><AlertCircle/></div>
          </div>
          <section className="panel">
            <button type="button" className="panel-heading collapsible-panel-heading" aria-expanded={showAddTaskForm} onClick={() => setShowAddTaskForm(value => !value)}><div><h2>Adicionar atividade</h2><p>Cadastre uma nova obrigação ou lembrete.</p></div><span className="collapse-heading-action">{showAddTaskForm ? 'Recolher' : 'Adicionar'} <ChevronDown className={showAddTaskForm ? 'chevron-open' : ''} size={18}/></span></button>
            {showAddTaskForm && <form className="form-grid" onSubmit={addTask}>
              <label className="wide">Título da atividade<input required value={title} onChange={e => setTitle(e.target.value)} placeholder="Ex.: Retornar solicitação do cliente"/></label>
              <label className="wide">Descrição (opcional)<input value={description} onChange={e => setDescription(e.target.value)} placeholder="Detalhes ou orientações"/></label>
              <label>Categoria<select value={category} onChange={e => setCategory(e.target.value)}>{categories.map(c => <option key={c[0]}>{c[0]}</option>)}</select></label>
              <label>Data<input type="date" required value={date} onChange={e => setDate(e.target.value)}/></label>
              <label>Horário (opcional)<input type="time" value={time} onChange={e => setTime(e.target.value)}/></label>
              <label>Prioridade<select value={priority} onChange={e => setPriority(e.target.value as Priority)}><option>Baixa</option><option>Média</option><option>Alta</option><option>Urgente</option></select></label>
              <label>Responsável pela execução<input value={assignedTo} onChange={e => setAssignedTo(e.target.value)} placeholder="Nome do estagiário ou responsável"/></label>
              <label className="calendar-choice"><input type="checkbox" checked={showOnCalendar} onChange={e => setShowOnCalendar(e.target.checked)}/> Exibir esta tarefa no calendário</label>
              <div className="wide form-action"><button className="primary-button" disabled={!title.trim()}><Plus size={17}/>Salvar atividade</button></div>
            </form>}
          </section>
          <section className="panel">
            <div className="panel-heading list-heading"><button type="button" className="collapsible-panel-heading" aria-expanded={activitiesOpen} onClick={() => setActivitiesOpen(open => !open)}><span><h2>Suas atividades</h2><p>As atividades ficam salvas na sua conta.</p></span><span className="collapse-heading-action">{activitiesOpen ? 'Recolher' : 'Expandir'} <ChevronDown className={activitiesOpen ? 'chevron-open' : ''} size={17}/></span></button></div>{activitiesOpen && <><div className="list-filter-group"><label className="filter">Status<select value={statusFilter} onChange={e => setStatusFilter(e.target.value)}><option>Todos</option><option>A fazer</option><option>Em andamento</option><option>Concluído</option></select></label><label className="filter">Categoria<select value={categoryFilter} onChange={e => setCategoryFilter(e.target.value)}><option>Todas</option>{categories.map(c => <option key={c[0]}>{c[0]}</option>)}</select></label><label className="filter">Prioridade<select value={priorityFilter} onChange={e => setPriorityFilter(e.target.value)}><option>Todas</option><option>Baixa</option><option>Média</option><option>Alta</option><option>Urgente</option></select></label><label className="filter">Responsável<select value={assigneeFilter} onChange={e => setAssigneeFilter(e.target.value)}><option>Todas</option>{assignees.map(name => <option key={name}>{name}</option>)}</select></label></div>
            <div className="search-line"><Search size={15}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar por atividade, descrição ou categoria..."/></div>
            <div className="task-filters"><button type="button" className="secondary-button" onClick={clearTaskFilters}>Limpar filtros</button></div>
            {loadingTasks ? <div className="empty"><LoaderCircle className="spin"/><span>Carregando atividades...</span></div> : visibleTasks.length === 0 ? <div className="empty"><CalendarDays size={28}/><strong>Nenhuma atividade por aqui</strong><span>Adicione uma atividade acima para começar.</span></div> : <div className="task-list">{visibleTasks.map(task => <div className={'task-row ' + (task.status !== 'Concluído' && task.due_date < today() ? 'task-overdue' : '')} key={task.id}><div className="task-dot" style={{background: categories.find(c => c[0] === task.category)?.[1]}}/><div className="task-info"><strong>{task.title}</strong><span>{task.category} · {new Date(`${task.due_date}T12:00:00`).toLocaleDateString('pt-BR')}{task.due_time ? ` · ${task.due_time.slice(0,5)}` : ''} · <span className={'priority-badge priority-' + task.priority.toLowerCase().normalize('NFD').replace(/[\\u0300-\\u036f]/g,'')}>{task.priority}</span>{task.assigned_to ? ' · Responsável: ' + task.assigned_to : ''}</span>{task.description && <small>{task.description}</small>}</div><select className={'status-select status-' + task.status.toLowerCase().replace(/ /g,'-').replace('í','i')} aria-label={`Status de ${task.title}`} value={task.status} onChange={e => changeStatus(task.id, e.target.value as TaskStatus)}><option>A fazer</option><option>Em andamento</option><option>Concluído</option></select><button type="button" className="icon-button" onClick={() => setEditingTask({...task})} title="Editar atividade"><Pencil size={15}/></button><button type="button" className="icon-button" onClick={() => deleteTask(task.id)} title="Excluir atividade"><Trash2 size={15}/></button>{editingTask?.id === task.id && <form className="edit-task-form" onSubmit={saveEditedTask}><label>Título<input required value={editingTask.title} onChange={e => setEditingTask({...editingTask,title:e.target.value})}/></label><label>Descrição<input value={editingTask.description ?? ''} onChange={e => setEditingTask({...editingTask,description:e.target.value})}/></label><label>Categoria<select value={editingTask.category} onChange={e => setEditingTask({...editingTask,category:e.target.value})}>{categories.map(item => <option key={item[0]}>{item[0]}</option>)}</select></label><label>Data<input type="date" required value={editingTask.due_date} onChange={e => setEditingTask({...editingTask,due_date:e.target.value})}/></label><label>Horário<input type="time" value={editingTask.due_time ?? ''} onChange={e => setEditingTask({...editingTask,due_time:e.target.value || null})}/></label><label>Prioridade<select value={editingTask.priority} onChange={e => setEditingTask({...editingTask,priority:e.target.value as Priority})}><option>Baixa</option><option>Média</option><option>Alta</option><option>Urgente</option></select></label><label>Responsável pela execução<input value={editingTask.assigned_to ?? ''} onChange={e => setEditingTask({...editingTask,assigned_to:e.target.value || null})} placeholder="Nome do responsável"/></label><label className="calendar-choice"><input type="checkbox" checked={editingTask.show_on_calendar !== false} onChange={e => setEditingTask({...editingTask,show_on_calendar:e.target.checked})}/> Exibir esta tarefa no calendário</label><div className="edit-actions"><button className="primary-button" type="submit">Salvar alterações</button><button className="secondary-button" type="button" onClick={() => setEditingTask(null)}>Cancelar</button></div></form>}</div>)}</div>}</>}
          </section>
          <section className="panel calendar-panel">
            <div className="panel-heading"><button type="button" className="collapsible-panel-heading" aria-expanded={calendarOpen} onClick={() => setCalendarOpen(open => !open)}><span><h2>Calendário</h2><p>Somente atividades marcadas para aparecer no calendário.</p></span><span className="collapse-heading-action">{calendarOpen ? 'Recolher' : 'Expandir'} <ChevronDown className={calendarOpen ? 'chevron-open' : ''} size={17}/></span></button></div>{calendarOpen && <>
            <div className="calendar-toolbar"><div className="calendar-modes"><button type="button" className={calendarView === 'month' ? 'active' : ''} onClick={() => setCalendarView('month')}>Mês</button><button type="button" className={calendarView === 'week' ? 'active' : ''} onClick={() => setCalendarView('week')}>Semana</button><button type="button" className={calendarView === 'day' ? 'active' : ''} onClick={() => setCalendarView('day')}>Dia</button></div><div className="calendar-navigation"><button type="button" onClick={() => moveCalendar(-1)} aria-label="Período anterior"><ChevronLeft size={16}/></button><strong>{calendarHeading}</strong><button type="button" onClick={() => moveCalendar(1)} aria-label="Próximo período"><ChevronRight size={16}/></button><button type="button" onClick={() => {setCalendarDate(today());setSelectedAgendaDate(today());setSelectedDashboardDate(today());setCalendarView('day')}}>Hoje</button></div></div>
            <div className={'calendar-grid ' + calendarView}>{calendarView !== 'day' && ['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'].map(day => <div className="calendar-weekday" key={day}>{day}</div>)}{calendarDays.map(day => <div key={day} className={'calendar-cell ' + (day.slice(0,7) !== calendarDate.slice(0,7) && calendarView === 'month' ? 'outside-month' : '') + (day === today() ? ' is-today' : '') + (day === selectedAgendaDate ? ' is-selected' : '')}><button type="button" className="calendar-day" onClick={() => {setCalendarDate(day);setSelectedAgendaDate(day);setSelectedDashboardDate(day);setCalendarView('day')}}>{new Date(day + 'T12:00:00').toLocaleDateString('pt-BR',{day:'2-digit', ...(calendarView === 'day' ? {month:'long'} : {})})}</button>{tasks.filter(task => task.due_date === day && task.show_on_calendar !== false).map(task => <button type="button" key={task.id} className={'calendar-event ' + (task.status === 'Concluído' ? 'done' : task.priority === 'Urgente' ? 'urgent' : '')} onClick={() => { clearTaskFilters(); setEditingTask({...task}) }} title={task.title}>{task.due_time ? task.due_time.slice(0,5) + ' · ' : ''}{task.title}</button>)}</div>)}</div></>}
          </section>
          </>}
          {agendaPageTab === 'meetings' && <>
          <section className="panel meetings-panel">
            <button type="button" className="panel-heading collapsible-panel-heading" aria-expanded={meetingFormOpen} onClick={() => setMeetingFormOpen(open => !open)}>
              <div><h2>{editingMeetingId ? 'Editar reunião / agendamento' : 'Cadastrar reunião / agendamento'}</h2><p>Registre data, horário e todas as informações importantes.</p></div>
              <span className="collapse-heading-action">{meetingFormOpen ? 'Recolher' : 'Adicionar'} <ChevronDown className={meetingFormOpen ? 'chevron-open' : ''} size={18}/></span>
            </button>
            {meetingFormOpen && <form className="form-grid meeting-form" onSubmit={saveMeeting}>
              <label className="wide">Título<input required value={meetingTitle} onChange={e => setMeetingTitle(e.target.value)} placeholder="Ex.: Reunião de alinhamento com a equipe"/></label>
              <label>Data<input type="date" required value={meetingDate} onChange={e => setMeetingDate(e.target.value)}/></label>
              <label>Horário<input type="time" value={meetingTime} onChange={e => setMeetingTime(e.target.value)}/></label>
              <div className="wide notes-field"><span className="notes-field-title">Observações</span><div className="notes-toolbar"><button type="button" className="format-button" onMouseDown={e => e.preventDefault()} onClick={() => applyBoldToNotes(meetingNotesRef, meetingNotes, setMeetingNotes)}><strong>B</strong> Negrito</button><button type="button" className="format-button highlight-format" onMouseDown={e => e.preventDefault()} onClick={() => applyHighlightToNotes(meetingNotesRef, meetingNotes, setMeetingNotes)}>Marca-texto</button><button type="button" className="format-button" title="Título" onMouseDown={e => e.preventDefault()} onClick={() => applyStructureToNotes(meetingNotesRef, 'formatBlock', 'h2', setMeetingNotes)}>Título</button><button type="button" className="format-button" title="Subtítulo" onMouseDown={e => e.preventDefault()} onClick={() => applyStructureToNotes(meetingNotesRef, 'formatBlock', 'h3', setMeetingNotes)}>Subtítulo</button><button type="button" className="format-button" title="Lista com marcadores" onMouseDown={e => e.preventDefault()} onClick={() => applyStructureToNotes(meetingNotesRef, 'insertUnorderedList', undefined, setMeetingNotes)}>• Lista</button><button type="button" className="format-button" title="Lista numerada" onMouseDown={e => e.preventDefault()} onClick={() => applyStructureToNotes(meetingNotesRef, 'insertOrderedList', undefined, setMeetingNotes)}>1. Lista</button><small>Enter cria uma nova linha. Use os botões para organizar títulos e listas.</small></div><RichNotesEditor editorRef={meetingNotesRef} value={meetingNotes} onChange={setMeetingNotes} placeholder="Anote pautas, decisões, participantes e informações importantes..."/></div>
              <div className="wide form-action"><button className="primary-button" type="submit"><Plus size={17}/>{editingMeetingId ? 'Salvar alterações' : 'Salvar reunião'}</button>{editingMeetingId && <button type="button" className="secondary-button" onClick={() => {setEditingMeetingId(null);setMeetingTitle('');setMeetingDate(today());setMeetingTime('');setMeetingPriority('Média');setMeetingStatus('A fazer');setMeetingNotes('');setMeetingFormOpen(false)}}>Cancelar edição</button>}</div>
            </form>}
          </section>
          <section className="panel">
            <div className="panel-heading list-heading"><div><h2>Reuniões e agendamentos</h2><p>Organizados por data e horário.</p></div><span className="soft-tag">{tasks.filter(item => item.category === 'Reunião').length} REGISTRO(S)</span></div>
            {tasks.filter(item => item.category === 'Reunião').length === 0 ? <div className="empty"><CalendarClock size={28}/><strong>Nenhuma reunião cadastrada</strong><span>Adicione sua primeira reunião ou compromisso no formulário acima.</span></div> : <div className="meeting-list">{tasks.filter(item => item.category === 'Reunião').slice().sort((a,b) => a.due_date.localeCompare(b.due_date) || (a.due_time ?? '').localeCompare(b.due_time ?? '')).map(meeting => <article className="meeting-card" key={meeting.id}>
              <div className="meeting-card-title"><div className="meeting-item-title"><button type="button" className="library-message-toggle" aria-expanded={expandedMeetingId === meeting.id} onClick={() => setExpandedMeetingId(expandedMeetingId === meeting.id ? null : meeting.id)}>{meeting.title}<span>{expandedMeetingId === meeting.id ? 'Ocultar mensagem' : 'Ver mensagem'}</span></button></div><div className="meeting-actions"><button type="button" className="icon-button" title="Editar reunião" onClick={() => editMeeting(meeting)}><Pencil size={15}/></button><button type="button" className="icon-button danger-icon" title="Excluir reunião" onClick={() => deleteTask(meeting.id)}><Trash2 size={15}/></button></div></div>
              <div className="meeting-status-control"><label>Status</label><select className="status-select" value={meeting.status} onChange={e => changeStatus(meeting.id, e.target.value as TaskStatus)}><option>A fazer</option><option>Em andamento</option><option>Concluído</option></select></div>
              {expandedMeetingId === meeting.id && <>
                <div className="meeting-date"><CalendarDays size={15}/>{new Date(meeting.due_date + 'T12:00:00').toLocaleDateString('pt-BR')}{meeting.due_time ? <><span>·</span><Clock3 size={14}/>{meeting.due_time.slice(0,5)}</> : <span>· Horário não definido</span>}</div>
                {meeting.description && <div className="meeting-notes rich-notes-display" dangerouslySetInnerHTML={{__html:safeRichHtml(meeting.description)}}/>}
              </>}
            </article>)}</div>}
          </section>
          </>}
          {agendaPageTab === 'notes' && <section className="panel agenda-notes-panel">
            <div className="library-hero">
              <div className="library-hero-icon"><BookOpen size={23}/></div>
              <div className="library-hero-copy"><span>REGISTROS PESSOAIS</span><h2>Minhas anotações</h2><p>Guarde conhecimentos, orientações e informações importantes para consultar sempre que precisar.</p></div>
              <div className="library-total"><strong>{agendaNotes.length}</strong><span>anotações salvas</span></div>
            </div>
            <div className="library-toolbar agenda-notes-toolbar">
              <label className="library-search"><Search size={17}/><input aria-label="Pesquisar anotações" value={agendaNoteSearch} onChange={e => setAgendaNoteSearch(e.target.value)} placeholder="Buscar anotação pelo título ou conteúdo..."/>{agendaNoteSearch && <button type="button" onClick={() => setAgendaNoteSearch('')} aria-label="Limpar pesquisa"><X size={15}/></button>}</label>
              <button type="button" className="primary-button library-new-button" onClick={() => { if (agendaNoteFormOpen && !editingAgendaNoteId) resetAgendaNoteForm(); else { resetAgendaNoteForm(); setAgendaNoteFormOpen(true) } }}><Plus size={16}/>{agendaNoteFormOpen && !editingAgendaNoteId ? 'Fechar cadastro' : 'Nova anotação'}</button>
            </div>
            {agendaNoteFormOpen && <form className="library-editor" onSubmit={saveAgendaNote}>
              <div className="library-editor-title"><div><span>{editingAgendaNoteId ? 'EDIÇÃO' : 'NOVO REGISTRO'}</span><h3>{editingAgendaNoteId ? 'Editar anotação' : 'Cadastrar anotação'}</h3></div><button type="button" className="icon-button" onClick={resetAgendaNoteForm} aria-label="Fechar formulário"><X size={17}/></button></div>
              <label>Título da anotação<input required value={agendaNoteTitle} onChange={e => setAgendaNoteTitle(e.target.value)} placeholder="Ex.: Orientações sobre determinado processo"/></label>
              <label>Conteúdo da anotação<textarea required rows={8} value={agendaNoteContent} onChange={e => setAgendaNoteContent(e.target.value)} placeholder="Registre conhecimentos, orientações, lembretes e informações que deseja consultar depois..."/></label>
              <div className="library-editor-actions"><button className="primary-button" type="submit" disabled={agendaNoteBusy || !agendaNoteTitle.trim() || !agendaNoteContent.trim()}><Save size={15}/>{agendaNoteBusy ? 'Salvando...' : editingAgendaNoteId ? 'Salvar alterações' : 'Salvar anotação'}</button><button type="button" className="secondary-button" onClick={resetAgendaNoteForm}>Cancelar</button></div>
            </form>}
            <div className="library-list-heading"><div><h3>Suas anotações</h3><p>Os registros ficam guardados na sua conta, separados das reuniões e atividades.</p></div><span>{agendaNotes.filter(note => (note.title + ' ' + note.content).toLocaleLowerCase('pt-BR').includes(agendaNoteSearch.toLocaleLowerCase('pt-BR'))).length} resultado(s)</span></div>
            <div className="library-items">{agendaNotes.filter(note => (note.title + ' ' + note.content).toLocaleLowerCase('pt-BR').includes(agendaNoteSearch.toLocaleLowerCase('pt-BR'))).length === 0 ? <div className="library-empty"><div><BookOpen size={25}/></div><strong>{agendaNoteSearch ? 'Nenhuma anotação encontrada' : 'Você ainda não tem anotações'}</strong><span>{agendaNoteSearch ? 'Tente buscar por outro termo.' : 'Cadastre aqui conhecimentos e orientações que não são pautas de reunião. Eles ficarão disponíveis para consulta sempre que precisar.'}</span>{!agendaNoteSearch && <button type="button" className="secondary-button" onClick={() => setAgendaNoteFormOpen(true)}><Plus size={15}/> Criar primeira anotação</button>}</div> : agendaNotes.filter(note => (note.title + ' ' + note.content).toLocaleLowerCase('pt-BR').includes(agendaNoteSearch.toLocaleLowerCase('pt-BR'))).map(note => <article className="library-item" key={note.id}>
              <div className="library-item-heading"><div className="library-item-title"><button type="button" className="library-message-toggle" aria-expanded={expandedAgendaNoteId === note.id} onClick={() => setExpandedAgendaNoteId(expandedAgendaNoteId === note.id ? null : note.id)}>{note.title}<span>{expandedAgendaNoteId === note.id ? 'Ocultar anotação' : 'Ver anotação'}</span></button></div><div className="library-item-actions"><button type="button" className="icon-button" title="Editar anotação" aria-label={'Editar ' + note.title} onClick={() => editAgendaNote(note)}><Pencil size={15}/></button><button type="button" className="icon-button danger-icon" title="Excluir anotação" aria-label={'Excluir ' + note.title} onClick={() => deleteAgendaNote(note)}><Trash2 size={15}/></button></div></div>
              {expandedAgendaNoteId === note.id && <p>{note.content}</p>}
            </article>)}</div>
          </section>}
        </>}
        {section === 'visitas' && <>
          <div className="visit-page-tabs" role="tablist" aria-label="Seções da Visita à Cemig">
            <button type="button" role="tab" aria-selected={visitPageTab === 'visits'} className={visitPageTab === 'visits' ? 'active' : ''} onClick={() => setVisitPageTab('visits')}><ClipboardList size={16}/> Visitas</button>
            <button type="button" role="tab" aria-selected={visitPageTab === 'library'} className={visitPageTab === 'library' ? 'active' : ''} onClick={() => {setVisitPageTab('library');resetLibraryForm()}}><BookOpen size={16}/> Biblioteca</button>
          </div>
          {visitPageTab === 'visits' && <>
          <div className="stats">
            <button type="button" className={'stat-card stat-card-button ' + (dashboardVisitFilter === 'visits' ? 'active' : '')} aria-pressed={dashboardVisitFilter === 'visits'} onClick={() => { setDashboardVisitFilter('visits'); setGlobalTopicStatusFilter('Todos') }}><span>Visitas registradas</span><strong>{visits.length}</strong><ClipboardList/></button>
            <button type="button" className={'stat-card stat-card-button ' + (dashboardVisitFilter === 'Pendente' ? 'active' : '')} aria-pressed={dashboardVisitFilter === 'Pendente'} onClick={() => { setDashboardVisitFilter('Pendente'); setGlobalTopicStatusFilter('Pendente') }}><span>Assuntos pendentes</span><strong>{visitTopics.filter(t => t.status === 'Pendente').length}</strong><AlertCircle/></button>
            <button type="button" className={'stat-card stat-card-button ' + (dashboardVisitFilter === 'Em análise' ? 'active' : '')} aria-pressed={dashboardVisitFilter === 'Em análise'} onClick={() => { setDashboardVisitFilter('Em análise'); setGlobalTopicStatusFilter('Em análise') }}><span>Em análise</span><strong>{visitTopics.filter(t => t.status === 'Em análise').length}</strong><Clock3/></button>
            <button type="button" className={'stat-card stat-card-button ' + (dashboardVisitFilter === 'Resolvido' ? 'active' : '')} aria-pressed={dashboardVisitFilter === 'Resolvido'} onClick={() => { setDashboardVisitFilter('Resolvido'); setGlobalTopicStatusFilter('Resolvido') }}><span>Resolvidos</span><strong>{visitTopics.filter(t => t.status === 'Resolvido').length}</strong><CheckCircle2/></button>
          </div>
          <section className="panel">
            <div className="panel-heading"><button type="button" className="collapsible-panel-heading" aria-expanded={visitFormOpen} onClick={() => setVisitFormOpen(open => !open)}><span><h2>Registrar visita / ata</h2><p>Cadastre uma visita e seus dados principais.</p></span><span className="collapse-heading-action">{visitFormOpen ? 'Recolher' : 'Expandir'} <ChevronDown className={visitFormOpen ? 'chevron-open' : ''} size={17}/></span></button></div>
            {visitFormOpen && <form className="form-grid" onSubmit={addVisit}>
              <label>Data da visita<input type="date" required value={visitDate} onChange={e => setVisitDate(e.target.value)}/></label>
              <label className="wide">Título da ata<input required value={visitTitle} onChange={e => setVisitTitle(e.target.value)}/></label>
              <label className="wide">Participantes<input value={participants} onChange={e => setParticipants(e.target.value)} placeholder="Nomes dos participantes"/></label>
              <div className="wide notes-field"><span className="notes-field-title">Observações gerais</span><div className="notes-toolbar"><button type="button" className="format-button" onMouseDown={e => e.preventDefault()} onClick={() => applyBoldToNotes(visitNotesRef, visitNotes, setVisitNotes)}><strong>B</strong> Negrito</button><button type="button" className="format-button highlight-format" onMouseDown={e => e.preventDefault()} onClick={() => applyHighlightToNotes(visitNotesRef, visitNotes, setVisitNotes)}>Marca-texto</button><button type="button" className="format-button" title="Título" onMouseDown={e => e.preventDefault()} onClick={() => applyStructureToNotes(visitNotesRef, 'formatBlock', 'h2', setVisitNotes)}>Título</button><button type="button" className="format-button" title="Subtítulo" onMouseDown={e => e.preventDefault()} onClick={() => applyStructureToNotes(visitNotesRef, 'formatBlock', 'h3', setVisitNotes)}>Subtítulo</button><button type="button" className="format-button" title="Lista com marcadores" onMouseDown={e => e.preventDefault()} onClick={() => applyStructureToNotes(visitNotesRef, 'insertUnorderedList', undefined, setVisitNotes)}>• Lista</button><button type="button" className="format-button" title="Lista numerada" onMouseDown={e => e.preventDefault()} onClick={() => applyStructureToNotes(visitNotesRef, 'insertOrderedList', undefined, setVisitNotes)}>1. Lista</button><small>Enter cria uma nova linha. Use os botões para organizar títulos e listas.</small></div><RichNotesEditor editorRef={visitNotesRef} value={visitNotes} onChange={setVisitNotes} placeholder="Registre aqui todas as informações importantes da visita..."/></div>
              <div className="wide form-action"><button className="primary-button"><Plus size={17}/>Salvar visita</button></div>
            </form>}
          </section>
          <section className="panel">
            <div className="panel-heading"><div><h2>Atas registradas</h2><p>Selecione uma visita para consultar ou incluir assuntos.</p></div><span className="soft-tag">{visits.length} VISITA(S)</span></div>
            {dashboardVisits.length === 0 ? <div className="empty"><ClipboardList size={28}/><strong>Nenhuma visita encontrada</strong><span>{dashboardVisitFilter === 'Pendente' || dashboardVisitFilter === 'Em análise' || dashboardVisitFilter === 'Resolvido' ? 'Não há atas com assuntos neste status.' : 'Cadastre a primeira visita acima. Você também poderá fazer isso off-line.'}</span></div> : <div className="visit-list">{dashboardVisits.map(visit => <div className="visit-card-wrap" key={visit.id}><button type="button" className={'visit-card ' + (selectedVisitId === visit.id ? 'selected expanded' : '')} aria-expanded={selectedVisitId === visit.id} onClick={() => setSelectedVisitId(selectedVisitId === visit.id ? '' : visit.id)}><span><strong>{visit.title}</strong><small>{new Date(visit.visit_date + 'T12:00:00').toLocaleDateString('pt-BR')} · {visitTopics.filter(t => t.visit_id === visit.id).length} assunto(s)</small></span><ChevronDown size={16}/></button><button type="button" className="icon-button danger-icon" title="Excluir visita" aria-label={'Excluir visita ' + visit.title} onClick={() => deleteVisit(visit.id)}><Trash2 size={15}/></button>{selectedVisitId === visit.id && <div className="visit-topics-preview"><strong>Assuntos vinculados a esta ata</strong>{visitTopics.filter(t => t.visit_id === visit.id).length === 0 ? <small>Nenhum assunto cadastrado nesta ata.</small> : <><div className="topic-filters"><label>Status<select value={topicStatusFilter} onChange={e => setTopicStatusFilter(e.target.value)}><option>Todos</option><option>Pendente</option><option>Em análise</option><option>Em andamento</option><option>Acompanhar Chamado</option><option>Resolvido</option><option>Não se aplica</option></select></label><label>Categoria<select value={topicCategoryFilter} onChange={e => setTopicCategoryFilter(e.target.value)}><option>Todas</option><option>Troca de titularidade</option><option>Transferência saldo de geração</option><option>Fatura Cemig</option><option>Primeira Ligação</option><option>CPF divergente na Cemig</option><option>Não categorizado</option></select></label><button type="button" className="secondary-button" onClick={() => { setTopicStatusFilter('Todos'); setTopicCategoryFilter('Todas') }}>Limpar filtros</button></div>{visitTopics.filter(t => t.visit_id === visit.id && (topicStatusFilter === 'Todos' || t.status === topicStatusFilter) && (topicCategoryFilter === 'Todas' || (t.category ?? 'Não categorizado') === topicCategoryFilter)).length === 0 ? <small>Nenhum assunto encontrado com esses filtros.</small> : visitTopics.filter(t => t.visit_id === visit.id && (topicStatusFilter === 'Todos' || t.status === topicStatusFilter) && (topicCategoryFilter === 'Todas' || (t.category ?? 'Não categorizado') === topicCategoryFilter)).map(topic => <div className="visit-preview-topic" key={topic.id}>{editingTopic?.id === topic.id ? <form className="topic-inline-edit" onSubmit={saveEditedTopic}><label>Categoria<select value={editingTopic.category ?? 'Não categorizado'} onChange={e => setEditingTopic({ ...editingTopic, category: e.target.value })}><option>Troca de titularidade</option><option>Transferência saldo de geração</option><option>Fatura Cemig</option><option>Primeira Ligação</option><option>CPF divergente na Cemig</option><option>Não categorizado</option></select></label><label>Assunto<input required value={editingTopic.title} onChange={e => setEditingTopic({ ...editingTopic, title: e.target.value })}/></label><label>Descrição<input value={editingTopic.description ?? ''} onChange={e => setEditingTopic({ ...editingTopic, description: e.target.value })}/></label><label>Responsável<input value={editingTopic.responsible ?? ''} onChange={e => setEditingTopic({ ...editingTopic, responsible: e.target.value })}/></label><label>Protocolo<input value={editingTopic.protocol ?? ''} onChange={e => setEditingTopic({ ...editingTopic, protocol: e.target.value })}/></label><label>Prazo<input type="date" value={editingTopic.due_date ?? ''} onChange={e => setEditingTopic({ ...editingTopic, due_date: e.target.value })}/></label><div className="wide notes-field"><span className="notes-field-title">Observações</span><div className="notes-toolbar"><button type="button" className="format-button" onMouseDown={e => e.preventDefault()} onClick={() => applyBoldToNotes(editTopicObservationsRef, editingTopic.observations ?? '', value => setEditingTopic({ ...editingTopic, observations: value }))}><strong>B</strong> Negrito</button><button type="button" className="format-button highlight-format" onMouseDown={e => e.preventDefault()} onClick={() => applyHighlightToNotes(editTopicObservationsRef, editingTopic.observations ?? '', value => setEditingTopic({ ...editingTopic, observations: value }))}>Marca-texto</button><button type="button" className="format-button" title="Título" onMouseDown={e => e.preventDefault()} onClick={() => applyStructureToNotes(editTopicObservationsRef, 'formatBlock', 'h2', value => setEditingTopic({ ...editingTopic, observations: value }))}>Título</button><button type="button" className="format-button" title="Subtítulo" onMouseDown={e => e.preventDefault()} onClick={() => applyStructureToNotes(editTopicObservationsRef, 'formatBlock', 'h3', value => setEditingTopic({ ...editingTopic, observations: value }))}>Subtítulo</button><button type="button" className="format-button" title="Lista com marcadores" onMouseDown={e => e.preventDefault()} onClick={() => applyStructureToNotes(editTopicObservationsRef, 'insertUnorderedList', undefined, value => setEditingTopic({ ...editingTopic, observations: value }))}>• Lista</button><button type="button" className="format-button" title="Lista numerada" onMouseDown={e => e.preventDefault()} onClick={() => applyStructureToNotes(editTopicObservationsRef, 'insertOrderedList', undefined, value => setEditingTopic({ ...editingTopic, observations: value }))}>1. Lista</button><small>Enter cria uma nova linha. Use os botões para organizar títulos e listas.</small></div><RichNotesEditor editorRef={editTopicObservationsRef} value={editingTopic.observations} onChange={value => setEditingTopic({ ...editingTopic, observations: value })}/></div><div className="topic-inline-actions"><button className="primary-button" type="submit">Salvar</button><button className="secondary-button" type="button" onClick={() => setEditingTopic(null)}>Cancelar</button></div></form> : <><span><b>{topic.title}</b><small>{topic.category ?? 'Não categorizado'} · {topic.responsible ? topic.responsible + ' · ' : ''}{topic.status}{topic.due_date ? ' · Prazo: ' + new Date(topic.due_date + 'T12:00:00').toLocaleDateString('pt-BR') : ''}</small></span><div className="topic-preview-actions"><select className={'topic-status-select topic-status-' + topic.status.toLowerCase().replace(/ /g, '-')} aria-label={'Status de ' + topic.title} value={topic.status} onChange={e => changeTopicStatus(topic.id, e.target.value as VisitTopic['status'])}><option>Pendente</option><option>Em análise</option><option>Em andamento</option><option>Acompanhar Chamado</option><option>Resolvido</option><option>Não se aplica</option></select><button type="button" className="icon-button" title="Editar assunto" aria-label={'Editar assunto ' + topic.title} onClick={() => setEditingTopic({ ...topic })}><Pencil size={14}/></button><button type="button" className="icon-button danger-icon" title="Excluir assunto" aria-label={'Excluir assunto ' + topic.title} onClick={() => deleteVisitTopic(topic.id)}><Trash2 size={14}/></button></div></>}</div>)}</>}</div>}</div>)}</div>}
          </section>

          {selectedVisitId && visits.some(v => v.id === selectedVisitId) && <section className="panel">
            <div className="panel-heading"><div><h2>Assuntos da ata</h2><p>{visits.find(v => v.id === selectedVisitId)?.title} · {new Date((visits.find(v => v.id === selectedVisitId)?.visit_date ?? today()) + 'T12:00:00').toLocaleDateString('pt-BR')}</p></div><div className="heading-actions"><button type="button" className="secondary-button" onClick={() => setEditingVisit({ ...visits.find(v => v.id === selectedVisitId)! })}><Pencil size={14}/> Editar visita</button><span className="soft-tag">{visitTopics.filter(t => t.visit_id === selectedVisitId).length} ASSUNTO(S)</span><button type="button" className="secondary-button export-button" onClick={exportVisitPdf}><FileDown size={14}/> PDF</button><button type="button" className="secondary-button export-button" onClick={exportVisitExcel}><FileDown size={14}/> Excel</button></div></div>
            {editingVisit?.id === selectedVisitId && <form className="form-grid edit-task-form visit-edit-form" onSubmit={saveEditedVisit}>
              <label>Data da visita<input type="date" required value={editingVisit.visit_date} onChange={e => setEditingVisit({ ...editingVisit, visit_date: e.target.value })}/></label>
              <label className="wide">Título da ata<input required value={editingVisit.title} onChange={e => setEditingVisit({ ...editingVisit, title: e.target.value })}/></label>
              <label className="wide">Participantes<input value={editingVisit.participants ?? ''} onChange={e => setEditingVisit({ ...editingVisit, participants: e.target.value })}/></label>
              <div className="wide notes-field"><span className="notes-field-title">Observações gerais</span><div className="notes-toolbar"><button type="button" className="format-button" onMouseDown={e => e.preventDefault()} onClick={() => applyBoldToNotes(editVisitNotesRef, editingVisit.notes ?? '', value => setEditingVisit({ ...editingVisit, notes: value }))}><strong>B</strong> Negrito</button><button type="button" className="format-button highlight-format" onMouseDown={e => e.preventDefault()} onClick={() => applyHighlightToNotes(editVisitNotesRef, editingVisit.notes ?? '', value => setEditingVisit({ ...editingVisit, notes: value }))}>Marca-texto</button><button type="button" className="format-button" title="Título" onMouseDown={e => e.preventDefault()} onClick={() => applyStructureToNotes(editVisitNotesRef, 'formatBlock', 'h2', value => setEditingVisit({ ...editingVisit, notes: value }))}>Título</button><button type="button" className="format-button" title="Subtítulo" onMouseDown={e => e.preventDefault()} onClick={() => applyStructureToNotes(editVisitNotesRef, 'formatBlock', 'h3', value => setEditingVisit({ ...editingVisit, notes: value }))}>Subtítulo</button><button type="button" className="format-button" title="Lista com marcadores" onMouseDown={e => e.preventDefault()} onClick={() => applyStructureToNotes(editVisitNotesRef, 'insertUnorderedList', undefined, value => setEditingVisit({ ...editingVisit, notes: value }))}>• Lista</button><button type="button" className="format-button" title="Lista numerada" onMouseDown={e => e.preventDefault()} onClick={() => applyStructureToNotes(editVisitNotesRef, 'insertOrderedList', undefined, value => setEditingVisit({ ...editingVisit, notes: value }))}>1. Lista</button><small>Enter cria uma nova linha. Use os botões para organizar títulos e listas.</small></div><RichNotesEditor editorRef={editVisitNotesRef} value={editingVisit.notes} onChange={value => setEditingVisit({ ...editingVisit, notes: value })}/></div>
              <div className="wide edit-actions"><button className="primary-button" type="submit">Salvar alterações</button><button className="secondary-button" type="button" onClick={() => setEditingVisit(null)}>Cancelar</button></div>
            </form>}
            <form className="form-grid" onSubmit={addVisitTopic}>
              <label>Categoria<select value={topicCategory} onChange={e => setTopicCategory(e.target.value)}><option>Troca de titularidade</option><option>Transferência saldo de geração</option><option>Fatura Cemig</option><option>Primeira Ligação</option><option>CPF divergente na Cemig</option></select></label>
              <label className="wide">Assunto<input required value={topicTitle} onChange={e => setTopicTitle(e.target.value)} placeholder="Ex.: Retorno sobre solicitação"/></label>
              <label className="wide">Descrição<input value={topicDescription} onChange={e => setTopicDescription(e.target.value)} placeholder="Detalhes do assunto"/></label>
              <label>Responsável<input value={topicResponsible} onChange={e => setTopicResponsible(e.target.value)} placeholder="Responsável"/></label>
              <label>Protocolo<input value={topicProtocol} onChange={e => setTopicProtocol(e.target.value)} placeholder="Nº do protocolo"/></label>
              <label>Prazo<input type="date" value={topicDueDate} onChange={e => setTopicDueDate(e.target.value)}/></label>
              <div className="wide notes-field"><span className="notes-field-title">Observações</span><div className="notes-toolbar"><button type="button" className="format-button" onMouseDown={e => e.preventDefault()} onClick={() => applyBoldToNotes(topicObservationsRef, topicObservations, setTopicObservations)}><strong>B</strong> Negrito</button><button type="button" className="format-button highlight-format" onMouseDown={e => e.preventDefault()} onClick={() => applyHighlightToNotes(topicObservationsRef, topicObservations, setTopicObservations)}>Marca-texto</button><button type="button" className="format-button" title="Título" onMouseDown={e => e.preventDefault()} onClick={() => applyStructureToNotes(topicObservationsRef, 'formatBlock', 'h2', setTopicObservations)}>Título</button><button type="button" className="format-button" title="Subtítulo" onMouseDown={e => e.preventDefault()} onClick={() => applyStructureToNotes(topicObservationsRef, 'formatBlock', 'h3', setTopicObservations)}>Subtítulo</button><button type="button" className="format-button" title="Lista com marcadores" onMouseDown={e => e.preventDefault()} onClick={() => applyStructureToNotes(topicObservationsRef, 'insertUnorderedList', undefined, setTopicObservations)}>• Lista</button><button type="button" className="format-button" title="Lista numerada" onMouseDown={e => e.preventDefault()} onClick={() => applyStructureToNotes(topicObservationsRef, 'insertOrderedList', undefined, setTopicObservations)}>1. Lista</button><small>Enter cria uma nova linha. Use os botões para organizar títulos e listas.</small></div><RichNotesEditor editorRef={topicObservationsRef} value={topicObservations} onChange={setTopicObservations} placeholder="Observações e encaminhamentos"/></div>
              <div className="wide form-action"><button className="primary-button"><Plus size={17}/>Adicionar assunto</button></div>
            </form>
            <div className="carry-panel schedule-panel"><div><strong>Programar assunto para uma data futura</strong><p>Escolha uma pendência e a data. O Watt-Wise criará uma ata nessa data ou aproveitará uma já cadastrada.</p></div><form className="schedule-form" onSubmit={scheduleTopicForDate}><label>Assunto pendente<select required value={scheduledTopicId} onChange={e => setScheduledTopicId(e.target.value)}><option value="">Selecione um assunto</option>{visitTopics.filter(t => t.status !== 'Resolvido' && t.status !== 'Não se aplica').map(t => <option key={t.id} value={t.id}>{t.title} · {visits.find(v => v.id === t.visit_id)?.visit_date ?? 'Sem data'}</option>)}</select></label><label>Data da ata futura<input type="date" required min={today()} value={scheduledDate} onChange={e => setScheduledDate(e.target.value)}/></label><button className="secondary-button" type="submit" disabled={!scheduledTopicId || !scheduledDate}>Programar assunto</button></form></div>
            {visitTopics.filter(t => t.visit_id !== selectedVisitId && t.status !== "Resolvido" && t.status !== "Não se aplica" && !visitTopics.some(copy => copy.visit_id === selectedVisitId && copy.origin_topic_id === t.id)).length > 0 && <div className="carry-panel"><div><strong>Pendências de outras atas</strong><p>Escolha individualmente quais assuntos devem continuar nesta ata.</p></div>{visitTopics.filter(t => t.visit_id !== selectedVisitId && t.status !== "Resolvido" && t.status !== "Não se aplica" && !visitTopics.some(copy => copy.visit_id === selectedVisitId && copy.origin_topic_id === t.id)).map(topic => <div className="carry-row" key={topic.id}><span><strong>{topic.title}</strong><small>{visits.find(v => v.id === topic.visit_id)?.title ?? "Ata anterior"} · {topic.status}</small></span><button type="button" className="secondary-button" onClick={() => carryTopicForward(topic)}>Incluir nesta ata</button></div>)}</div>}

          </section>}
          </>}
        </>}
          {section === 'visitas' && visitPageTab === 'visits' && <section className="panel global-topic-search">
            <div className="panel-heading"><button type="button" className="collapsible-panel-heading" aria-expanded={globalTopicFilterOpen} onClick={() => setGlobalTopicFilterOpen(open => !open)}><span><h2>Filtro geral de assuntos</h2><p>Pesquise assuntos de todas as atas cadastradas, sem precisar abrir cada uma.</p></span><span className="collapse-heading-action">{globalTopicFilterOpen ? 'Recolher' : 'Expandir'} <ChevronDown className={globalTopicFilterOpen ? 'chevron-open' : ''} size={17}/></span></button><span className="soft-tag">{visitTopics.filter(t => (globalTopicStatusFilter === 'Todos' || t.status === globalTopicStatusFilter) && (globalTopicCategoryFilter === 'Todas' || (t.category ?? 'Não categorizado') === globalTopicCategoryFilter)).length} ASSUNTO(S)</span></div>{globalTopicFilterOpen && <>
            <div className="topic-filters">
              <label>Status<select value={globalTopicStatusFilter} onChange={e => setGlobalTopicStatusFilter(e.target.value)}><option>Todos</option><option>Pendente</option><option>Em análise</option><option>Em andamento</option><option>Resolvido</option><option>Não se aplica</option></select></label>
              <label>Categoria<select value={globalTopicCategoryFilter} onChange={e => setGlobalTopicCategoryFilter(e.target.value)}><option>Todas</option><option>Troca de titularidade</option><option>Transferência saldo de geração</option><option>Fatura Cemig</option><option>Primeira Ligação</option><option>CPF divergente na Cemig</option><option>Não categorizado</option></select></label>
              <button type="button" className="secondary-button" onClick={() => { setGlobalTopicStatusFilter('Todos'); setGlobalTopicCategoryFilter('Todas') }}>Limpar filtros</button>
            </div>
            {visitTopics.filter(t => (globalTopicStatusFilter === 'Todos' || t.status === globalTopicStatusFilter) && (globalTopicCategoryFilter === 'Todas' || (t.category ?? 'Não categorizado') === globalTopicCategoryFilter)).length === 0 ? <div className="empty"><strong>Nenhum assunto encontrado</strong><span>Não há assuntos que correspondam aos filtros selecionados.</span></div> : <div className="global-topic-results">{visitTopics.filter(t => (globalTopicStatusFilter === 'Todos' || t.status === globalTopicStatusFilter) && (globalTopicCategoryFilter === 'Todas' || (t.category ?? 'Não categorizado') === globalTopicCategoryFilter)).map(topic => <div className="global-topic-row" key={topic.id}><span><strong>{topic.title}</strong><small>{topic.category ?? 'Não categorizado'} · {topic.status} · {visits.find(v => v.id === topic.visit_id)?.title ?? 'Ata não encontrada'} · {visits.find(v => v.id === topic.visit_id)?.visit_date ? new Date(visits.find(v => v.id === topic.visit_id)!.visit_date + 'T12:00:00').toLocaleDateString('pt-BR') : 'Sem data'}</small></span><button type="button" className="secondary-button" onClick={() => setSelectedVisitId(topic.visit_id)}>Abrir ata</button></div>)}</div>}
          </>}
          </section>}
          {section === 'visitas' && visitPageTab === 'library' && <section className="panel library-panel">
            <div className="library-hero">
              <div className="library-hero-icon"><BookOpen size={23}/></div>
              <div className="library-hero-copy"><span>BASE DE APOIO</span><h2>Biblioteca da Cemig</h2><p>Encontre rapidamente mensagens e documentos usados nos atendimentos.</p></div>
              <div className="library-total"><strong>{libraryItems.length}</strong><span>itens salvos</span></div>
            </div>
            <div className="library-tabs" role="tablist" aria-label="Conteúdo da biblioteca">
              <button type="button" role="tab" aria-selected={libraryKind === 'message'} className={libraryKind === 'message' ? 'active' : ''} onClick={() => {setLibraryKind('message');resetLibraryForm();setLibrarySearch('')}}><Copy size={16}/> Mensagens prontas <small>{libraryItems.filter(item => item.kind === 'message').length}</small></button>
              <button type="button" role="tab" aria-selected={libraryKind === 'documents'} className={libraryKind === 'documents' ? 'active' : ''} onClick={() => {setLibraryKind('documents');resetLibraryForm();setLibrarySearch('')}}><ClipboardList size={16}/> Documentos necessários <small>{libraryItems.filter(item => item.kind === 'documents').length}</small></button>
            </div>
            <div className="library-toolbar">
              <label className="library-search"><Search size={17}/><input aria-label="Pesquisar na biblioteca" value={librarySearch} onChange={e => setLibrarySearch(e.target.value)} placeholder={libraryKind === 'message' ? 'Buscar mensagem pelo título ou texto...' : 'Buscar tipo de solicitação ou documento...'}/>{librarySearch && <button type="button" onClick={() => setLibrarySearch('')} aria-label="Limpar pesquisa"><X size={15}/></button>}</label>
              <button type="button" className="primary-button library-new-button" onClick={() => {if (libraryFormOpen && !editingLibraryItem) resetLibraryForm(); else {resetLibraryForm();setLibraryFormOpen(true)}}}><Plus size={16}/>{libraryFormOpen && !editingLibraryItem ? 'Fechar cadastro' : libraryKind === 'message' ? 'Nova mensagem' : 'Novo tipo de solicitação'}</button>
            </div>
            {libraryFormOpen && <form className="library-editor" onSubmit={saveLibraryItem}>
              <div className="library-editor-title"><div><span>{editingLibraryItem ? 'EDIÇÃO' : 'NOVO CADASTRO'}</span><h3>{editingLibraryItem ? 'Editar registro' : libraryKind === 'message' ? 'Cadastrar mensagem pronta' : 'Cadastrar documentos necessários'}</h3></div><button type="button" className="icon-button" onClick={resetLibraryForm} aria-label="Fechar formulário"><X size={17}/></button></div>
              <label>{libraryKind === 'message' ? 'Nome para identificar a mensagem' : 'Tipo de solicitação'}<input required value={libraryTitle} onChange={e => setLibraryTitle(e.target.value)} placeholder={libraryKind === 'message' ? 'Ex.: Solicitação aprovada' : 'Ex.: Troca de titularidade'}/></label>
              <label>{libraryKind === 'message' ? 'Mensagem completa' : 'Documentos e orientações'}<textarea required rows={6} value={libraryContent} onChange={e => setLibraryContent(e.target.value)} placeholder={libraryKind === 'message' ? 'Escreva aqui o texto que será enviado ao cliente...' : 'Informe os documentos necessários, de preferência um por linha...'}/></label>
              <div className="library-editor-actions"><button className="primary-button" type="submit" disabled={libraryBusy || !libraryTitle.trim() || !libraryContent.trim()}><Save size={15}/>{libraryBusy ? 'Salvando...' : editingLibraryItem ? 'Salvar alterações' : 'Salvar na biblioteca'}</button><button type="button" className="secondary-button" onClick={resetLibraryForm}>Cancelar</button></div>
            </form>}
            <div className="library-list-heading"><div><h3>{libraryKind === 'message' ? 'Suas mensagens' : 'Tipos de solicitação'}</h3><p>{libraryKind === 'message' ? 'Textos prontos para copiar e utilizar nos retornos.' : 'Consulte os documentos e orientações de cada serviço.'}</p></div><span>{libraryItems.filter(item => item.kind === libraryKind && (item.title + ' ' + item.content).toLocaleLowerCase('pt-BR').includes(librarySearch.toLocaleLowerCase('pt-BR'))).length} resultado(s)</span></div>
            <div className="library-items">{libraryItems.filter(item => item.kind === libraryKind && (item.title + ' ' + item.content).toLocaleLowerCase('pt-BR').includes(librarySearch.toLocaleLowerCase('pt-BR'))).length === 0 ? <div className="library-empty"><div><BookOpen size={25}/></div><strong>{librarySearch ? 'Nenhum resultado encontrado' : 'Sua biblioteca está vazia'}</strong><span>{librarySearch ? 'Tente buscar por outro termo.' : libraryKind === 'message' ? 'Cadastre aqui os modelos de resposta da Cemig. Todos ficarão reunidos e poderão ser copiados quando precisar.' : 'Cadastre um tipo de solicitação e informe os documentos necessários para cada atendimento.'}</span>{!librarySearch && <button type="button" className="secondary-button" onClick={() => setLibraryFormOpen(true)}><Plus size={15}/> Começar cadastro</button>}</div> : libraryItems.filter(item => item.kind === libraryKind && (item.title + ' ' + item.content).toLocaleLowerCase('pt-BR').includes(librarySearch.toLocaleLowerCase('pt-BR'))).map(item => <article className="library-item" key={item.id}>
              <div className="library-item-heading"><div className="library-item-title">{libraryKind === 'message' ? <button type="button" className="library-message-toggle" aria-expanded={expandedLibraryMessageId === item.id} onClick={() => setExpandedLibraryMessageId(expandedLibraryMessageId === item.id ? null : item.id)}>{item.title}<span>{expandedLibraryMessageId === item.id ? 'Ocultar mensagem' : 'Ver mensagem'}</span></button> : <button type="button" className="library-document-toggle" aria-expanded={expandedLibraryDocumentId === item.id} onClick={() => setExpandedLibraryDocumentId(expandedLibraryDocumentId === item.id ? null : item.id)}>{item.title}<span>{expandedLibraryDocumentId === item.id ? 'Ocultar documentos' : 'Ver documentos necessários'}</span></button>}</div><div className="library-item-actions"><button type="button" className="icon-button" title="Editar" aria-label={'Editar ' + item.title} onClick={() => editLibraryItem(item)}><Pencil size={15}/></button><button type="button" className="icon-button danger-icon" title="Excluir" aria-label={'Excluir ' + item.title} onClick={() => deleteLibraryItem(item)}><Trash2 size={15}/></button></div></div>
              {((libraryKind === 'message' && expandedLibraryMessageId === item.id) || (libraryKind === 'documents' && expandedLibraryDocumentId === item.id)) && <p>{item.content}</p>}
              {libraryKind === 'message' && expandedLibraryMessageId === item.id && <button type="button" className="library-copy" onClick={() => {void navigator.clipboard.writeText(item.content).then(() => setNotice('Mensagem copiada.')).catch(() => setError('Não foi possível copiar a mensagem.'))}}><Copy size={15}/> Copiar mensagem</button>}
            </article>)}</div>
          </section>}
          {section === 'ouvidoria' && <>
            <div className="audit-tabs" role="tablist" aria-label="Funcionalidades de auditoria">
              <button type="button" role="tab" aria-selected={auditTab==='invoices'} className={auditTab==='invoices'?'audit-tab active':'audit-tab'} onClick={()=>setAuditTab('invoices')}><FileSpreadsheet size={16}/> Faturas não geradas</button>
              <button type="button" role="tab" aria-selected={auditTab==='contracts'} className={auditTab==='contracts'?'audit-tab active':'audit-tab'} onClick={()=>setAuditTab('contracts')}><FileSpreadsheet size={16}/> Contratos + Faturas não geradas</button>
            </div>
            {auditTab==='invoices' && <section className="panel audit-panel">
              <div className="panel-heading"><div><h2>Fatura não gerada</h2><p>Anexe a planilha de faturamento para comparar automaticamente as três referências mais recentes.</p></div><span className="soft-tag">AUDITORIA POR INSTALAÇÃO</span></div>
              <div className="audit-security-note"><ShieldCheck size={18}/><span><strong>Processamento protegido</strong>O arquivo é lido e auditado no seu próprio navegador. Ele não é enviado ao Watt-Wise, ao Supabase nem armazenado na conta.</span></div>
              <label className="audit-upload" htmlFor="audit-spreadsheet"><Upload size={22}/><strong>{auditBusy ? 'Analisando planilha...' : 'Selecionar planilha Excel'}</strong><span>Formato .xlsx · até 10 MB</span><input id="audit-spreadsheet" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={auditBusy} onChange={e => { const file = e.target.files?.[0]; if (file) void auditInvoices(file); e.currentTarget.value = '' }}/></label>
              {auditBusy && <div className="audit-progress"><span className="spin"><LoaderCircle size={17}/></span> Lendo as referências e comparando as instalações...</div>}
              {auditResult && <>
                <div className="audit-result-heading"><div><strong>Resultado da auditoria</strong><small>{auditResult.fileName}</small></div><div className="audit-actions"><button type="button" className="secondary-button" onClick={clearAudit}>Limpar</button><button type="button" className="primary-button" onClick={() => void downloadAuditedWorkbook()}><FileDown size={15}/> Baixar planilha auditada</button></div></div>
                <div className="audit-months"><span>Referências identificadas (mais recente primeiro):</span>{auditResult.months.map(month => <b key={month}>{month}</b>)}</div>
                <div className="audit-summary audit-summary-enhanced">
                  <div><span>Registros analisados</span><strong>{auditResult.rowCount.toLocaleString('pt-BR')}</strong><small>Linhas válidas na aba de dados</small></div>
                  <div><span>Instalações únicas</span><strong>{auditResult.uniqueInstallations.toLocaleString('pt-BR')}</strong><small>Identificadas para comparação</small></div>
                  <div><span>Instalações com boleto nos 3 meses</span><strong>{auditResult.markedCount}</strong><small><i className="audit-dot orange"/> Linha inteira marcada em laranja</small></div>
                  <div><span>Sem boleto no mês mais recente</span><strong>{auditResult.missing.length}</strong><small><i className="audit-dot"/> Presentes nos 2 meses anteriores</small></div>
                </div>
                {auditResult.warnings.length > 0 && <div className="audit-validation-warnings"><strong><AlertCircle size={16}/> Atenção: confira os avisos antes de usar o resultado</strong><ul>{auditResult.warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul></div>}
                <div className="audit-validation-ok"><ShieldCheck size={16}/> Verificações estruturais concluídas. O arquivo original não é sobrescrito.</div>
                <div className="audit-missing-list">
                  <div className="audit-list-heading"><strong>Instalações para conferir</strong><span>{auditResult.missing.length} registro(s)</span></div>
                  {auditResult.missing.length === 0 ? <div className="audit-empty">Nenhuma instalação encontrada com boleto nos dois meses anteriores e ausência na referência mais recente.</div> : <div className="audit-table-wrap"><table className="audit-table"><thead><tr><th>Cliente</th><th>Número da instalação</th></tr></thead><tbody>{auditResult.missing.map(item => <tr key={item.installation}><td>{item.client}</td><td>{item.installation}</td></tr>)}</tbody></table></div>}
                </div>
                <p className="audit-footnote">A marcação laranja é aplicada à linha inteira de todas as ocorrências da instalação quando ela aparece nas três referências. As instalações presentes nos dois meses anteriores, mas ausentes no mês mais recente, ficam sem a marcação.</p>
              </>}
            </section>}
            {auditTab==='contracts' && <section className="panel audit-panel contract-audit-panel">
              <div className="panel-heading"><div><h2>Contratos + Faturas não geradas</h2><p>Anexe a base de contratos e a exportação de faturas para identificar contratos ativos sem fatura emitida.</p></div><span className="soft-tag">CRUZAMENTO INSTALAÇÃO + UC</span></div>
              <div className="audit-security-note"><ShieldCheck size={18}/><span><strong>Processamento protegido</strong>As duas planilhas são comparadas no navegador e não são enviadas nem armazenadas no servidor.</span></div>
              <div className="contract-audit-upload-grid"><label className="audit-upload" htmlFor="contract-list-upload"><Upload size={22}/><strong>Selecionar planilha de contratos</strong><span>.xlsx até 10 MB</span><input id="contract-list-upload" type="file" accept=".xlsx" onChange={e=>{setContractAuditResult(null);setContractListFile(e.currentTarget.files?.[0]??null);e.currentTarget.value=''}}/></label><label className="audit-upload" htmlFor="invoice-list-upload"><Upload size={22}/><strong>Selecionar planilha de faturas</strong><span>.xlsx até 10 MB</span><input id="invoice-list-upload" type="file" accept=".xlsx" onChange={e=>{setInvoiceListFile(e.currentTarget.files?.[0]??null);e.currentTarget.value=''}}/></label></div>
              <div className="contract-file-selections"><span>{contractListFile ? '✓ '+contractListFile.name : 'Planilha de contratos ainda não selecionada'}</span><span>{invoiceListFile ? '✓ '+invoiceListFile.name : 'Planilha de faturas ainda não selecionada'}</span></div>
              <p className="audit-footnote">A comparação considera somente contratos com <strong>Situação Contrato = Ativo</strong>. A fatura é válida quando a geração está ativa, o status de boleto é “Sucesso” e a fatura não está cancelada. Chave: instalação + unidade consumidora.</p>
              <button type="button" className="primary-button" disabled={contractAuditBusy||!contractListFile||!invoiceListFile} onClick={()=>{void auditContracts(contractListFile??undefined,invoiceListFile??undefined)}}><FileSpreadsheet size={15}/>{contractAuditBusy?'Comparando planilhas...':'Comparar contratos e faturas'}</button>
              {contractAuditBusy&&<div className="audit-progress"><span className="spin"><LoaderCircle size={17}/></span> Cruzando instalações e unidades consumidoras...</div>}
              {contractAuditResult&&<><div className="audit-result-heading"><div><strong>Resultado do comparativo</strong><small>{contractAuditResult.fileNames.join(' · ')}</small></div><div className="audit-actions"><button type="button" className="secondary-button" onClick={()=>setContractAuditResult(null)}>Limpar resultado</button><button type="button" className="primary-button" onClick={exportContractAudit}><FileDown size={15}/> Exportar pendências</button></div></div>
              <div className="audit-summary audit-summary-enhanced"><div><span>Contratos ativos analisados</span><strong>{contractAuditResult.total.toLocaleString('pt-BR')}</strong></div><div><span>Com fatura válida</span><strong>{contractAuditResult.matched.toLocaleString('pt-BR')}</strong></div><div><span>Sem fatura identificada</span><strong>{contractAuditResult.missing.length.toLocaleString('pt-BR')}</strong></div></div>
              {contractAuditResult.warnings.length>0&&<div className="audit-validation-warnings"><strong><AlertCircle size={16}/> Avisos da comparação</strong><ul>{contractAuditResult.warnings.map((w,i)=><li key={i}>{w}</li>)}</ul></div>}
              <div className="audit-list-heading"><strong>Contratos sem faturas válidas</strong><span>{contractAuditResult.missing.length} registro(s)</span></div>{contractAuditResult.missing.length===0?<div className="audit-empty">Todos os contratos ativos foram encontrados com faturas válidas.</div>:<div className="audit-table-wrap"><table className="audit-table"><thead><tr><th>Cliente</th><th>Instalação</th><th>Unid. Consumidora</th></tr></thead><tbody>{contractAuditResult.missing.map(item=><tr key={item.installation+'|'+item.uc}><td>{item.client}</td><td>{item.installation}</td><td>{item.uc}</td></tr>)}</tbody></table></div>}</>}
            </section>}
          </>}
        {section === 'historico' && <section className="panel"><div className="panel-heading"><div><h2>Histórico de movimentações</h2><p>Consulte separadamente as alterações da Minha Agenda e da Visita à Cemig.</p></div><span className="soft-tag">{historyEvents.filter(event => historyFilter === 'agenda' ? event.entity_type === 'Atividade' : event.entity_type === 'Assunto').length} REGISTRO(S)</span></div><div className="history-filters"><button type="button" className={historyFilter === 'agenda' ? 'active' : ''} onClick={() => setHistoryFilter('agenda')}>Minha Agenda</button><button type="button" className={historyFilter === 'visitas' ? 'active' : ''} onClick={() => setHistoryFilter('visitas')}>Visita à Cemig</button></div>{historyEvents.filter(event => historyFilter === 'agenda' ? event.entity_type === 'Atividade' : event.entity_type === 'Assunto').length === 0 ? <div className="empty"><History size={28}/><strong>Nenhuma movimentação encontrada</strong><span>As próximas inclusões e alterações aparecerão aqui após a sincronização.</span></div> : <div className="history-list">{historyEvents.filter(event => historyFilter === 'agenda' ? event.entity_type === 'Atividade' : event.entity_type === 'Assunto').map(event => { const value = event.new_value ?? {}; const old = event.old_value ?? {}; const label = event.event_type === 'created' ? 'Criado' : event.event_type === 'status_changed' ? 'Status alterado' : event.event_type === 'schedule_changed' ? 'Data ou horário alterado' : 'Dados atualizados'; const detail = event.event_type === 'status_changed' ? `${old.status ?? '—'} → ${value.status ?? '—'}` : event.event_type === 'schedule_changed' ? `${old.date ?? '—'} ${old.time ?? ''} → ${value.date ?? '—'} ${value.time ?? ''}` : (value.title ?? old.title ?? 'Registro atualizado'); return <article className="history-item" key={event.id}><span className="history-marker"/><div className="history-copy"><div><strong>{detail}</strong><span className="history-kind">{event.entity_type} · {label}</span></div><time>{new Date(event.created_at).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'})}</time></div></article> })}</div>}</section>}
        <footer>Watt-Wise <span>•</span> Em desenvolvimento</footer>
      </div>
    </main>
  </div>
}
