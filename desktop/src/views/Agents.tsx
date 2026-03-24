import { useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';
import type { useGateway } from '../hooks/useGateway';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { cn } from '@/lib/utils';
import {
  Plus, Trash2, Bot, Save, RotateCcw, Search,
  Cpu, Wrench, BookOpen, Loader2, Info,
} from 'lucide-react';
import { toast } from 'sonner';

// ── types ──────────────────────────────────────────────────────────

type AgentModel = 'sonnet' | 'opus' | 'haiku' | 'inherit';

type AgentInfo = {
  name: string;
  description: string;
  tools?: string[];
  skills?: string[];
  prompt: string;
  model?: AgentModel;
  builtIn: boolean;
  modified: boolean;
};

type SkillInfo = {
  name: string;
  description: string;
  eligibility: { eligible: boolean };
};

type Props = {
  gateway: ReturnType<typeof useGateway>;
};

const KNOWN_TOOLS = [
  'Read', 'Write', 'Edit', 'Bash', 'Grep', 'Glob',
  'WebSearch', 'WebFetch', 'Agent', 'NotebookEdit',
];

const MODEL_OPTIONS: { value: AgentModel; label: string }[] = [
  { value: 'inherit', label: 'Inherit' },
  { value: 'haiku', label: 'Haiku' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'opus', label: 'Opus' },
];

function sortedJson(arr: string[]): string {
  return JSON.stringify([...arr].sort());
}

// ── main view ──────────────────────────────────────────────────────

export function AgentsView({ gateway }: Props) {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [skills, setSkills] = useState<SkillInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);

  // draft state for the editor
  const [draft, setDraft] = useState<AgentInfo | null>(null);
  const [isNew, setIsNew] = useState(false);

  const loadAgents = useCallback(async () => {
    if (gateway.connectionState !== 'connected') return;
    try {
      const result = await gateway.rpc('agents.list');
      if (Array.isArray(result)) {
        setAgents(result);
        setLoading(false);
      }
    } catch (err) {
      console.error('failed to load agents:', err);
      setLoading(false);
    }
  }, [gateway.connectionState, gateway.rpc]);

  const loadSkills = useCallback(async () => {
    if (gateway.connectionState !== 'connected') return;
    try {
      const result = await gateway.rpc('skills.list');
      if (Array.isArray(result)) setSkills(result);
    } catch {}
  }, [gateway.connectionState, gateway.rpc]);

  useEffect(() => { loadAgents(); }, [loadAgents]);
  useEffect(() => { loadSkills(); }, [loadSkills]);

  const filtered = useMemo(() => {
    if (!search) return agents;
    const q = search.toLowerCase();
    return agents.filter(a =>
      a.name.toLowerCase().includes(q) || a.description.toLowerCase().includes(q)
    );
  }, [agents, search]);

  const builtInList = filtered.filter(a => a.builtIn);
  const customList = filtered.filter(a => !a.builtIn);

  const selectAgent = (name: string) => {
    const agent = agents.find(a => a.name === name);
    if (!agent) return;
    setSelected(name);
    setDraft({ ...agent });
    setIsNew(false);
  };

  const startNew = () => {
    const newAgent: AgentInfo = {
      name: '',
      description: '',
      tools: [],
      skills: [],
      prompt: '',
      model: 'sonnet',
      builtIn: false,
      modified: false,
    };
    setDraft(newAgent);
    setSelected(null);
    setIsNew(true);
  };

  const saveAgent = useCallback(async () => {
    if (!draft) return;
    if (!draft.name || !draft.description || !draft.prompt) {
      toast.error('Name, description, and prompt are required');
      return;
    }
    const savedName = draft.name;
    setBusy(true);
    try {
      await gateway.rpc('agents.set', {
        name: savedName,
        description: draft.description,
        prompt: draft.prompt,
        tools: draft.tools?.length ? draft.tools : undefined,
        skills: draft.skills?.length ? draft.skills : undefined,
        model: draft.model || undefined,
      });
      toast.success('Agent saved');
      setIsNew(false);
      setSelected(savedName);
      await loadAgents();
    } catch (err) {
      toast.error(String(err));
    } finally {
      setBusy(false);
    }
  }, [draft, gateway.rpc, loadAgents]);

  const resetAgent = useCallback(async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const result = await gateway.rpc('agents.reset', { name: selected }) as AgentInfo;
      setDraft({ ...result });
      toast.success('Reset to default');
      await loadAgents();
    } catch (err) {
      toast.error(String(err));
    } finally {
      setBusy(false);
    }
  }, [selected, gateway.rpc, loadAgents]);

  const deleteAgent = useCallback(async () => {
    if (!selected) return;
    setBusy(true);
    try {
      await gateway.rpc('agents.delete', { name: selected });
      toast.success('Agent deleted');
      setSelected(null);
      setDraft(null);
      setIsNew(false);
      await loadAgents();
    } catch (err) {
      toast.error(String(err));
    } finally {
      setBusy(false);
    }
  }, [selected, gateway.rpc, loadAgents]);

  const toggleTool = useCallback((tool: string) => {
    setDraft(prev => {
      if (!prev) return prev;
      const current = prev.tools || [];
      const next = current.includes(tool)
        ? current.filter(t => t !== tool)
        : [...current, tool];
      return { ...prev, tools: next };
    });
  }, []);

  const toggleSkill = useCallback((skill: string) => {
    setDraft(prev => {
      if (!prev) return prev;
      const current = prev.skills || [];
      const next = current.includes(skill)
        ? current.filter(s => s !== skill)
        : [...current, skill];
      return { ...prev, skills: next };
    });
  }, []);

  const eligibleSkills = skills.filter(s => s.eligibility.eligible);

  const isDirty = useMemo(() => {
    if (isNew) return true;
    if (!draft || !selected) return false;
    const original = agents.find(a => a.name === selected);
    if (!original) return true;
    return (
      draft.description !== original.description ||
      draft.prompt !== original.prompt ||
      draft.model !== original.model ||
      sortedJson(draft.tools || []) !== sortedJson(original.tools || []) ||
      sortedJson(draft.skills || []) !== sortedJson(original.skills || [])
    );
  }, [draft, selected, agents, isNew]);

  if (gateway.connectionState !== 'connected') {
    return (
      <div className="flex h-full items-center justify-center text-xs text-muted-foreground">
        connecting...
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0">
      {/* ── left panel: agent list ── */}
      <div className="w-[240px] shrink-0 border-r border-border flex flex-col">
        <div className="px-3 py-2.5 border-b border-border space-y-2 shrink-0">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-foreground">Agents</span>
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={startNew} type="button">
              <Plus className="w-3.5 h-3.5" />
            </Button>
          </div>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-muted-foreground" />
            <Input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search agents..."
              className="h-7 text-xs pl-7"
            />
          </div>
        </div>

        <ScrollArea className="flex-1 min-h-0">
          <div className="p-2 space-y-1">
            {loading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="h-12 rounded-md bg-secondary/30 animate-pulse" />
              ))
            ) : (
              <>
                {builtInList.length > 0 && (
                  <>
                    <div className="px-2 pt-1 pb-0.5">
                      <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Built-in</span>
                    </div>
                    {builtInList.map(agent => (
                      <AgentListItem
                        key={agent.name}
                        agent={agent}
                        active={selected === agent.name && !isNew}
                        onClick={() => selectAgent(agent.name)}
                      />
                    ))}
                  </>
                )}
                {customList.length > 0 && (
                  <>
                    <div className="px-2 pt-2 pb-0.5">
                      <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Custom</span>
                    </div>
                    {customList.map(agent => (
                      <AgentListItem
                        key={agent.name}
                        agent={agent}
                        active={selected === agent.name && !isNew}
                        onClick={() => selectAgent(agent.name)}
                      />
                    ))}
                  </>
                )}
                {filtered.length === 0 && (
                  <div className="px-2 py-4 text-center text-xs text-muted-foreground">
                    No agents found
                  </div>
                )}
              </>
            )}
          </div>
        </ScrollArea>
      </div>

      {/* ── right panel: editor ── */}
      <div className="flex-1 min-w-0 flex flex-col">
        {draft ? (
          <AgentEditor
            key={isNew ? '__new__' : selected}
            draft={draft}
            isNew={isNew}
            isDirty={isDirty}
            busy={busy}
            eligibleSkills={eligibleSkills}
            onUpdate={setDraft}
            onSave={saveAgent}
            onReset={resetAgent}
            onDelete={deleteAgent}
            onToggleTool={toggleTool}
            onToggleSkill={toggleSkill}
          />
        ) : (
          <EmptyState onNew={startNew} />
        )}
      </div>
    </div>
  );
}

// ── agent list item ────────────────────────────────────────────────

function AgentListItem({ agent, active, onClick }: {
  agent: AgentInfo;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-current={active ? 'true' : undefined}
      className={cn(
        'w-full text-left px-2.5 py-2 rounded-md transition-colors',
        active
          ? 'bg-secondary text-foreground'
          : 'text-muted-foreground hover:bg-secondary/50 hover:text-foreground'
      )}
      onClick={onClick}
    >
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium truncate flex-1">{agent.name}</span>
        {agent.modified && (
          <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" title="Modified" />
        )}
      </div>
      <div className="text-[10px] text-muted-foreground truncate mt-0.5">{agent.description}</div>
    </button>
  );
}

// ── empty state ────────────────────────────────────────────────────

function EmptyState({ onNew }: { onNew: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-muted-foreground gap-3 px-8">
      <Bot className="h-6 w-6 text-muted-foreground/20" />
      <div className="text-center space-y-1 max-w-xs">
        <p className="text-[12px] text-muted-foreground/60">Agents</p>
        <p className="text-[10px] text-muted-foreground/30 leading-relaxed">
          Specialized sub-agents the main agent can delegate tasks to. Each has its own prompt, tools, model, and skills.
        </p>
      </div>
      <Button variant="outline" size="sm" className="h-7 text-[11px]" onClick={onNew} type="button">
        <Plus className="w-3.5 h-3.5 mr-1.5" />
        Create agent
      </Button>
    </div>
  );
}

// ── agent editor ───────────────────────────────────────────────────

function AgentEditor({
  draft, isNew, isDirty, busy, eligibleSkills,
  onUpdate, onSave, onReset, onDelete, onToggleTool, onToggleSkill,
}: {
  draft: AgentInfo;
  isNew: boolean;
  isDirty: boolean;
  busy: boolean;
  eligibleSkills: SkillInfo[];
  onUpdate: (d: AgentInfo) => void;
  onSave: () => void;
  onReset: () => void;
  onDelete: () => void;
  onToggleTool: (tool: string) => void;
  onToggleSkill: (skill: string) => void;
}) {
  const canSave = isDirty && !busy && !!draft.name && !!draft.description && !!draft.prompt;

  return (
    <>
      {/* header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border shrink-0">
        <Bot className="w-4 h-4 text-primary shrink-0" />
        <span className="font-semibold text-sm truncate flex-1">
          {isNew ? 'new agent' : draft.name}
        </span>

        <div className="flex items-center gap-1.5 shrink-0">
          {draft.builtIn && draft.modified && (
            <Button variant="ghost" size="sm" className="h-7 text-xs px-2 text-muted-foreground" onClick={onReset} disabled={busy} type="button">
              <RotateCcw className="w-3 h-3 mr-1" />Reset
            </Button>
          )}

          {!draft.builtIn && !isNew && (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button variant="ghost" size="sm" className="h-7 text-xs px-2 text-destructive hover:text-destructive" disabled={busy} type="button">
                  <Trash2 className="w-3 h-3" />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle className="text-sm">Delete {draft.name}?</AlertDialogTitle>
                  <AlertDialogDescription className="text-xs">
                    This will permanently remove this agent configuration.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel className="h-7 text-xs">cancel</AlertDialogCancel>
                  <AlertDialogAction className="h-7 text-xs" onClick={onDelete}>delete</AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}

          <Button
            size="sm"
            className="h-7 text-xs px-3"
            onClick={onSave}
            disabled={!canSave}
            type="button"
          >
            {busy ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <Save className="w-3 h-3 mr-1" />}
            Save
          </Button>
        </div>
      </div>

      {/* editor body */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-5 space-y-5 max-w-2xl">
          {/* info banner for built-in */}
          {draft.builtIn && !draft.modified && (
            <div className="flex items-start gap-2 text-xs text-muted-foreground bg-secondary/30 rounded-lg px-3 py-2.5 border border-border">
              <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>This is a built-in agent. Edit any field and save to override it. You can reset to defaults at any time.</span>
            </div>
          )}

          {/* name + description */}
          <div className="space-y-3">
            <SectionHeader icon={<Bot className="w-3 h-3" />}>Identity</SectionHeader>
            <div className="grid grid-cols-1 gap-3">
              <div className="space-y-1.5">
                <Label className="text-[11px] text-muted-foreground">Name</Label>
                <Input
                  value={draft.name}
                  onChange={e => onUpdate({ ...draft, name: e.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, '-') })}
                  placeholder="my-agent"
                  className="h-8 text-xs font-mono"
                  disabled={!isNew}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-[11px] text-muted-foreground">Description</Label>
                <Input
                  value={draft.description}
                  onChange={e => onUpdate({ ...draft, description: e.target.value })}
                  placeholder="What this agent does (shown to the main agent for delegation decisions)"
                  className="h-8 text-xs"
                />
              </div>
            </div>
          </div>

          {/* model */}
          <div className="space-y-3">
            <SectionHeader icon={<Cpu className="w-3 h-3" />}>Model</SectionHeader>
            <div className="flex gap-1">
              {MODEL_OPTIONS.map(opt => {
                const active = (draft.model || 'inherit') === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    aria-pressed={active}
                    className={cn(
                      'px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
                      active
                        ? 'bg-primary text-primary-foreground'
                        : 'bg-secondary/50 text-muted-foreground hover:bg-secondary hover:text-foreground'
                    )}
                    onClick={() => onUpdate({ ...draft, model: opt.value })}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-muted-foreground">
              Which model this agent uses. "Inherit" uses whatever the parent agent is running.
            </p>
          </div>

          {/* tools */}
          <div className="space-y-3">
            <SectionHeader icon={<Wrench className="w-3 h-3" />}>Tools</SectionHeader>
            <div className="flex flex-wrap gap-1.5">
              {KNOWN_TOOLS.map(tool => {
                const active = (draft.tools || []).includes(tool);
                return (
                  <button
                    key={tool}
                    type="button"
                    aria-pressed={active}
                    className={cn(
                      'px-2.5 py-1 rounded-md text-xs font-mono transition-colors border',
                      active
                        ? 'bg-primary/10 text-primary border-primary/30'
                        : 'bg-secondary/30 text-muted-foreground border-transparent hover:border-border hover:text-foreground'
                    )}
                    onClick={() => onToggleTool(tool)}
                  >
                    {tool}
                  </button>
                );
              })}
            </div>
            <p className="text-[10px] text-muted-foreground">
              Which tools this agent can use. Leave empty to give access to all tools.
            </p>
          </div>

          {/* skills */}
          <div className="space-y-3">
            <SectionHeader icon={<BookOpen className="w-3 h-3" />}>Skills</SectionHeader>
            {eligibleSkills.length > 0 ? (
              <div className="flex flex-wrap gap-1.5">
                {eligibleSkills.map(skill => {
                  const active = (draft.skills || []).includes(skill.name);
                  return (
                    <button
                      key={skill.name}
                      type="button"
                      aria-pressed={active}
                      className={cn(
                        'px-2.5 py-1 rounded-md text-xs transition-colors border',
                        active
                          ? 'bg-primary/10 text-primary border-primary/30'
                          : 'bg-secondary/30 text-muted-foreground border-transparent hover:border-border hover:text-foreground'
                      )}
                      onClick={() => onToggleSkill(skill.name)}
                      title={skill.description}
                    >
                      {skill.name}
                    </button>
                  );
                })}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground py-2">
                No skills installed. Add skills from the Extensions view to give agents specialized instructions.
              </p>
            )}
            <p className="text-[10px] text-muted-foreground">
              Skills provide detailed instructions the agent can follow. Select which skills this agent should have access to.
            </p>
          </div>

          {/* prompt */}
          <div className="space-y-3">
            <SectionHeader icon={<Bot className="w-3 h-3" />}>System Prompt</SectionHeader>
            <Textarea
              value={draft.prompt}
              onChange={e => onUpdate({ ...draft, prompt: e.target.value })}
              placeholder="You are a specialized agent. Your job is to..."
              className="min-h-[300px] text-xs font-mono leading-relaxed resize-y"
            />
            <p className="text-[10px] text-muted-foreground">
              The system prompt defines the agent's behavior and expertise. This is the only context the agent receives
              (it does not inherit the main agent's system prompt, memory, or workspace files).
            </p>
          </div>
        </div>
      </ScrollArea>
    </>
  );
}

// ── section header ─────────────────────────────────────────────────

function SectionHeader({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2">
      {icon && <span className="text-muted-foreground">{icon}</span>}
      <span className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">{children}</span>
      <div className="flex-1 h-px bg-border" />
    </div>
  );
}
