import { useState, useEffect, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  CircleDot, Timer, Eye, CheckCircle2, AlertTriangle, Ban,
  Trash2, ExternalLink, X,
} from 'lucide-react';
import type { useGateway } from '../../hooks/useGateway';
import type { Task, TaskLog, Project, ProjectStatus, TaskStatus } from './helpers';
import { errorText } from './helpers';
import { toast } from 'sonner';

type Props = {
  taskId: string;
  gateway: ReturnType<typeof useGateway>;
  onViewSession?: (sessionId: string, channel?: string, chatId?: string, chatType?: string) => void;
  onClose?: () => void;
};

const STATUS_OPTIONS: { value: TaskStatus; label: string; icon: React.ReactNode; color: string }[] = [
  { value: 'todo', label: 'Todo', icon: <CircleDot className="h-3.5 w-3.5" />, color: 'text-muted-foreground' },
  { value: 'in_progress', label: 'In Progress', icon: <Timer className="h-3.5 w-3.5" />, color: 'text-amber-500' },
  { value: 'review', label: 'Review', icon: <Eye className="h-3.5 w-3.5" />, color: 'text-orange-500' },
  { value: 'done', label: 'Done', icon: <CheckCircle2 className="h-3.5 w-3.5" />, color: 'text-emerald-500' },
  { value: 'blocked', label: 'Blocked', icon: <AlertTriangle className="h-3.5 w-3.5" />, color: 'text-destructive' },
  { value: 'cancelled', label: 'Cancelled', icon: <Ban className="h-3.5 w-3.5" />, color: 'text-muted-foreground/50' },
];

function parseSessionKey(sessionKey?: string): { channel: string; chatType: string; chatId: string } | null {
  if (!sessionKey) return null;
  const [channel = 'desktop', chatType = 'dm', ...rest] = sessionKey.split(':');
  const chatId = rest.join(':');
  if (!chatId) return null;
  return { channel, chatType, chatId };
}

export function TaskDetailView({ taskId, gateway, onViewSession, onClose }: Props) {
  const [task, setTask] = useState<Task | null>(null);
  const [projects, setProjects] = useState<Project[]>([]);
  const [logs, setLogs] = useState<TaskLog[]>([]);
  const [loading, setLoading] = useState(true);

  const [title, setTitle] = useState('');
  const [status, setStatus] = useState<TaskStatus>('todo');
  const [goalId, setGoalId] = useState('');
  const [reason, setReason] = useState('');
  const [result, setResult] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (gateway.connectionState !== 'connected') return;
    try {
      const [taskRes, goalsRes, logsRes] = await Promise.all([
        gateway.rpc('tasks.view', { id: taskId }),
        gateway.rpc('projects.list'),
        gateway.rpc('tasks.logs', { id: taskId, limit: 50 }),
      ]);
      const t = taskRes as Task | null;
      if (t) {
        setTask(t);
        setTitle(t.title || '');
        setStatus(t.status);
        setGoalId(t.goalId || '');
        setReason(t.reason || '');
        setResult(t.result || '');
      }
      if (Array.isArray(goalsRes)) setProjects(goalsRes as Project[]);
      if (Array.isArray(logsRes)) setLogs(logsRes as TaskLog[]);
    } catch (err) {
      toast.error('Failed to load task', { description: errorText(err) });
    } finally {
      setLoading(false);
    }
  }, [gateway.connectionState, gateway.rpc, taskId]);

  useEffect(() => { void load(); }, [load]);

  const save = useCallback(async (updates: Record<string, unknown>) => {
    setSaving(true);
    try {
      await gateway.rpc('tasks.update', { id: taskId, ...updates });
      await load();
    } catch (err) {
      toast.error(errorText(err));
    } finally {
      setSaving(false);
    }
  }, [gateway.rpc, taskId, load]);

  const handleTitleBlur = useCallback(() => {
    const trimmed = title.trim();
    if (trimmed && task && trimmed !== task.title) {
      void save({ title: trimmed });
    }
  }, [title, task, save]);

  const handleStatusChange = useCallback((value: string) => {
    setStatus(value as TaskStatus);
    void save({ status: value });
  }, [save]);

  const handleGoalChange = useCallback((value: string) => {
    const newGoalId = value === '__none' ? null : value;
    setGoalId(newGoalId || '');
    void save({ goalId: newGoalId });
  }, [save]);

  const handleSaveNotes = useCallback(() => {
    void save({ reason });
  }, [reason, save]);

  const handleSaveResult = useCallback(() => {
    void save({ result });
  }, [result, save]);

  const handleDelete = useCallback(async () => {
    if (!window.confirm('Delete this task?')) return;
    try {
      await gateway.rpc('tasks.delete', { id: taskId });
      onClose?.();
    } catch (err) {
      toast.error(errorText(err));
    }
  }, [gateway.rpc, taskId, onClose]);

  const handleViewSession = useCallback(() => {
    if (!task || !onViewSession) return;
    if (task.sessionId) {
      const parsed = task.sessionKey ? parseSessionKey(task.sessionKey) : null;
      onViewSession(task.sessionId, parsed?.channel || 'desktop', parsed?.chatId || task.sessionId, parsed?.chatType || 'dm');
    }
  }, [task, onViewSession]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        loading...
      </div>
    );
  }

  if (!task) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        task not found
      </div>
    );
  }

  const currentStatus = STATUS_OPTIONS.find(s => s.value === status);
  const hasSession = !!(task.sessionId || task.sessionKey);

  return (
    <div className="flex h-full">
      {/* main content */}
      <div className="flex-1 overflow-auto">
        <div className="max-w-2xl mx-auto px-8 py-8">
          {/* title */}
          <input
            value={title}
            onChange={e => setTitle(e.target.value)}
            onBlur={handleTitleBlur}
            onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur(); }}
            className="w-full bg-transparent text-lg font-semibold outline-none placeholder:text-muted-foreground/30 mb-6"
            placeholder="Task title"
          />


          {/* result */}
          {(task.result || task.status === 'done') && (
            <div className="mb-8">
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium block mb-2">Result</span>
              <Textarea
                value={result}
                onChange={e => setResult(e.target.value)}
                onBlur={handleSaveResult}
                className="text-sm min-h-[60px]"
                placeholder="Task result..."
              />
            </div>
          )}

          {/* activity */}
          <div>
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium block mb-3">Activity</span>
            <div className="space-y-1.5">
              {logs.length === 0 && (
                <div className="text-[11px] text-muted-foreground/40">no activity yet</div>
              )}
              {logs.map(log => (
                <div key={log.id} className="flex items-start gap-2 text-[11px]">
                  <span className="text-muted-foreground/40 shrink-0 tabular-nums">
                    {new Date(log.createdAt).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span className="text-muted-foreground/60">{log.eventType}</span>
                  <span className="text-foreground/70">{log.message}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* sidebar */}
      <div className="w-56 border-l border-border/50 p-4 space-y-5 overflow-auto shrink-0">
        {/* status */}
        <div>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium block mb-1.5">Status</span>
          <Select value={status} onValueChange={handleStatusChange}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue>
                {currentStatus && (
                  <span className={cn('flex items-center gap-1.5', currentStatus.color)}>
                    {currentStatus.icon}
                    {currentStatus.label}
                  </span>
                )}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              {STATUS_OPTIONS.map(opt => (
                <SelectItem key={opt.value} value={opt.value}>
                  <span className={cn('flex items-center gap-1.5', opt.color)}>
                    {opt.icon}
                    {opt.label}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* project */}
        <div>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium block mb-1.5">Project</span>
          <Select value={goalId || '__none'} onValueChange={handleGoalChange}>
            <SelectTrigger className="h-8 text-xs">
              <SelectValue placeholder="none" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none">None</SelectItem>
              {projects.filter(p => p.status !== 'done').map(p => (
                <SelectItem key={p.id} value={p.id}>{p.title}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* notes */}
        <div>
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/50 font-medium block mb-1.5">Notes</span>
          <Input
            value={reason}
            onChange={e => setReason(e.target.value)}
            onBlur={handleSaveNotes}
            placeholder="Add notes..."
            className="h-8 text-xs"
          />
        </div>

        {/* actions */}
        <div className="space-y-1.5 pt-2">
          {hasSession && onViewSession && (
            <Button
              variant="ghost"
              size="sm"
              className="w-full justify-start h-7 text-xs text-muted-foreground"
              onClick={handleViewSession}
            >
              <ExternalLink className="mr-1.5 h-3 w-3" />
              Open session
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start h-7 text-xs text-destructive/70 hover:text-destructive"
            onClick={handleDelete}
          >
            <Trash2 className="mr-1.5 h-3 w-3" />
            Delete task
          </Button>
        </div>

        {/* meta */}
        <div className="pt-2 space-y-1 text-[10px] text-muted-foreground/40">
          <div>Created {new Date(task.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}</div>
          <div>Updated {new Date(task.updatedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}</div>
          {task.completedAt && <div>Completed {new Date(task.completedAt).toLocaleDateString([], { month: 'short', day: 'numeric' })}</div>}
        </div>
      </div>
    </div>
  );
}
