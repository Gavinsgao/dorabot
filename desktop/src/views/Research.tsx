import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { useGateway } from '../hooks/useGateway';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  FileSearch, ExternalLink, Tag, Clock, Trash2,
  ChevronLeft, BookOpen, Loader2, Search,
  Plus, Pencil, Check, X, Archive, RotateCcw,
} from 'lucide-react';

type ResearchItem = {
  id: string;
  topic: string;
  title: string;
  filePath: string;
  status: 'active' | 'completed' | 'archived';
  sources?: string[];
  tags?: string[];
  preview?: string;
  createdAt: string;
  updatedAt: string;
};

type ResearchItemWithContent = ResearchItem & { content: string };

type Props = {
  gateway: ReturnType<typeof useGateway>;
};

const STATUS_CONFIG: Record<string, { label: string; dot: string; badge: string; next: string; icon: typeof Check }> = {
  active: { label: 'Active', dot: 'bg-blue-400', badge: 'bg-blue-500/10 text-blue-400 border-blue-500/20', next: 'completed', icon: Check },
  completed: { label: 'Done', dot: 'bg-emerald-400', badge: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20', next: 'archived', icon: Archive },
  archived: { label: 'Archived', dot: 'bg-zinc-500', badge: 'bg-zinc-500/10 text-zinc-400 border-zinc-500/20', next: 'active', icon: RotateCcw },
};

type FilterType = 'all' | 'active' | 'completed' | 'archived';

export function ResearchView({ gateway }: Props) {
  const [items, setItems] = useState<ResearchItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedContent, setSelectedContent] = useState<ResearchItemWithContent | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [filter, setFilter] = useState<FilterType>('all');
  const [search, setSearch] = useState('');
  const [editing, setEditing] = useState(false);
  const [focusIndex, setFocusIndex] = useState(0);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; item: ResearchItem } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const loadItems = useCallback(async () => {
    if (gateway.connectionState !== 'connected') return;
    try {
      const result = await gateway.rpc('research.list') as ResearchItem[];
      setItems(result || []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [gateway]);

  useEffect(() => { loadItems(); }, [loadItems]);
  useEffect(() => { loadItems(); }, [gateway.researchVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  // fetch content when selection changes
  useEffect(() => {
    if (!selectedId || gateway.connectionState !== 'connected') {
      setSelectedContent(null);
      return;
    }
    let cancelled = false;
    setContentLoading(true);
    gateway.rpc('research.read', { id: selectedId }).then((result: unknown) => {
      if (!cancelled) {
        setSelectedContent(result as ResearchItemWithContent);
        setContentLoading(false);
      }
    }).catch(() => {
      if (!cancelled) {
        setSelectedContent(null);
        setContentLoading(false);
      }
    });
    return () => { cancelled = true; };
  }, [selectedId, gateway]);

  // re-fetch content when research updates
  useEffect(() => {
    if (!selectedId || gateway.connectionState !== 'connected') return;
    gateway.rpc('research.read', { id: selectedId }).then((result: unknown) => {
      setSelectedContent(result as ResearchItemWithContent);
    }).catch(() => {});
  }, [gateway.researchVersion]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(() => {
    let result = filter === 'all' ? items : items.filter(i => i.status === filter);
    if (search.trim()) {
      const q = search.toLowerCase();
      result = result.filter(i =>
        i.title.toLowerCase().includes(q)
        || i.topic.toLowerCase().includes(q)
        || i.tags?.some(t => t.toLowerCase().includes(q))
        || i.preview?.toLowerCase().includes(q)
      );
    }
    // sort by updated desc
    return [...result].sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }, [items, filter, search]);

  const filterCounts = useMemo(() => ({
    all: items.length,
    active: items.filter(i => i.status === 'active').length,
    completed: items.filter(i => i.status === 'completed').length,
    archived: items.filter(i => i.status === 'archived').length,
  }), [items]);

  const handleCreate = async () => {
    if (gateway.connectionState !== 'connected') return;
    try {
      const result = await gateway.rpc('research.add', {
        topic: 'uncategorized',
        title: 'Untitled',
        content: '',
      }) as ResearchItem;
      await loadItems();
      setSelectedId(result.id);
      setEditing(true);
    } catch {}
  };

  const handleDelete = async (itemId: string) => {
    await gateway.rpc('research.delete', { id: itemId });
    if (selectedId === itemId) {
      setSelectedId(null);
      setSelectedContent(null);
      setEditing(false);
    }
    await loadItems();
  };

  const handleStatusChange = async (itemId: string, status: string) => {
    await gateway.rpc('research.update', { id: itemId, status });
    await loadItems();
    // also refresh detail if open
    if (selectedId === itemId) {
      const result = await gateway.rpc('research.read', { id: itemId }) as ResearchItemWithContent;
      setSelectedContent(result);
    }
  };

  const handleSave = async (itemId: string, updates: { title?: string; topic?: string; content?: string; tags?: string[] }) => {
    await gateway.rpc('research.update', { id: itemId, ...updates });
    const result = await gateway.rpc('research.read', { id: itemId }) as ResearchItemWithContent;
    setSelectedContent(result);
    await loadItems();
    setEditing(false);
  };

  const handleBack = useCallback(() => {
    setSelectedId(null);
    setSelectedContent(null);
    setEditing(false);
  }, []);

  // keyboard navigation
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // cmd+left or cmd+[ to go back
      if ((e.metaKey || e.ctrlKey) && (e.key === 'ArrowLeft' || e.key === '[')) {
        if (selectedId) {
          e.preventDefault();
          handleBack();
          return;
        }
      }

      // don't capture when in input/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      // list keyboard nav (only when not in detail view)
      if (!selectedId) {
        if (e.key === 'j' || e.key === 'ArrowDown') {
          e.preventDefault();
          setFocusIndex(i => Math.min(i + 1, filtered.length - 1));
        } else if (e.key === 'k' || e.key === 'ArrowUp') {
          e.preventDefault();
          setFocusIndex(i => Math.max(i - 1, 0));
        } else if (e.key === 'Enter') {
          e.preventDefault();
          if (filtered[focusIndex]) setSelectedId(filtered[focusIndex].id);
        } else if (e.key === 'x') {
          e.preventDefault();
          const item = filtered[focusIndex];
          if (item) {
            const cfg = STATUS_CONFIG[item.status];
            if (cfg) handleStatusChange(item.id, cfg.next);
          }
        } else if (e.key === 'n' && (e.metaKey || e.ctrlKey)) {
          e.preventDefault();
          handleCreate();
        }
      }

      // detail view
      if (selectedId) {
        if (e.key === 'Escape') {
          e.preventDefault();
          if (editing) {
            setEditing(false);
          } else {
            handleBack();
          }
        } else if (e.key === 'e' && !editing) {
          e.preventDefault();
          setEditing(true);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [selectedId, filtered, focusIndex, editing, handleBack]); // eslint-disable-line react-hooks/exhaustive-deps

  // close context menu on click
  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [contextMenu]);

  // clamp focus index
  useEffect(() => {
    if (focusIndex >= filtered.length) setFocusIndex(Math.max(0, filtered.length - 1));
  }, [filtered.length, focusIndex]);

  if (gateway.connectionState !== 'connected') {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-xs">
        not connected
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-xs">
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        loading...
      </div>
    );
  }

  // detail view
  if (selectedId) {
    if (contentLoading || !selectedContent) {
      return (
        <div className="flex items-center justify-center h-full text-muted-foreground text-xs">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" />
          loading...
        </div>
      );
    }
    return (
      <DetailView
        item={selectedContent}
        editing={editing}
        onEdit={() => setEditing(true)}
        onCancelEdit={() => setEditing(false)}
        onBack={handleBack}
        onDelete={handleDelete}
        onStatusChange={handleStatusChange}
        onSave={handleSave}
      />
    );
  }

  // list view
  return (
    <div className="flex flex-col h-full" ref={listRef}>
      {/* header bar */}
      <div className="shrink-0 px-5 py-3 border-b border-border/60">
        <div className="flex items-center gap-3 mb-3">
          <div className="flex items-center gap-2">
            <FileSearch className="w-4 h-4 text-muted-foreground" />
            <span className="text-sm font-semibold text-foreground">Research</span>
          </div>
          <span className="text-[11px] text-muted-foreground/60">{filtered.length} of {items.length}</span>
          <div className="ml-auto">
            <Button variant="outline" size="sm" className="h-7 text-[11px] gap-1" onClick={handleCreate}>
              <Plus className="w-3 h-3" />
              New
            </Button>
          </div>
        </div>

        {/* filters + search */}
        <div className="flex items-center gap-2">
          <div className="flex gap-0.5 bg-secondary/50 rounded-md p-0.5">
            {(['all', 'active', 'completed', 'archived'] as const).map(f => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`text-[11px] px-2.5 py-1 rounded transition-colors ${
                  filter === f
                    ? 'bg-background text-foreground font-medium shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {f === 'all' ? 'All' : f.charAt(0).toUpperCase() + f.slice(1)}
                {filterCounts[f] > 0 && (
                  <span className="ml-1 text-[10px] opacity-50">{filterCounts[f]}</span>
                )}
              </button>
            ))}
          </div>
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search..."
              className="w-full h-7 pl-8 pr-3 text-xs bg-secondary/30 border border-border/50 rounded-md outline-none focus:border-primary/50 focus:bg-secondary/60 transition-colors placeholder:text-muted-foreground/40"
            />
          </div>
        </div>
      </div>

      {/* list */}
      <ScrollArea className="flex-1 min-h-0">
        {items.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center">
            <BookOpen className="h-8 w-8 text-muted-foreground/30 mb-4" />
            <div className="text-sm text-muted-foreground mb-1">No research yet</div>
            <div className="text-[11px] text-muted-foreground/60 max-w-xs mb-4">
              Research is collected during agent work, or you can create your own.
            </div>
            <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={handleCreate}>
              <Plus className="w-3.5 h-3.5" />
              Create research
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <Search className="h-6 w-6 text-muted-foreground/30 mb-3" />
            <div className="text-xs text-muted-foreground">No results</div>
          </div>
        ) : (
          <div className="divide-y divide-border/30">
            {filtered.map((item, i) => (
              <ResearchRow
                key={item.id}
                item={item}
                focused={i === focusIndex}
                onSelect={() => setSelectedId(item.id)}
                onFocus={() => setFocusIndex(i)}
                onStatusChange={handleStatusChange}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextMenu({ x: e.clientX, y: e.clientY, item });
                }}
              />
            ))}
          </div>
        )}
      </ScrollArea>

      {/* keyboard hints */}
      <div className="shrink-0 px-5 py-1.5 border-t border-border/40 flex items-center gap-4 text-[10px] text-muted-foreground/40">
        <span><kbd className="font-mono">j</kbd>/<kbd className="font-mono">k</kbd> navigate</span>
        <span><kbd className="font-mono">Enter</kbd> open</span>
        <span><kbd className="font-mono">x</kbd> cycle status</span>
        <span><kbd className="font-mono">Cmd+N</kbd> new</span>
      </div>

      {/* context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          item={contextMenu.item}
          onStatusChange={handleStatusChange}
          onDelete={handleDelete}
          onOpen={() => setSelectedId(contextMenu.item.id)}
        />
      )}
    </div>
  );
}

/* ---- Row ---- */

function ResearchRow({ item, focused, onSelect, onFocus, onStatusChange, onContextMenu }: {
  item: ResearchItem;
  focused: boolean;
  onSelect: () => void;
  onFocus: () => void;
  onStatusChange: (id: string, status: string) => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  const cfg = STATUS_CONFIG[item.status] || STATUS_CONFIG.active;
  const ref = useRef<HTMLButtonElement>(null);

  // scroll into view when focused
  useEffect(() => {
    if (focused && ref.current) {
      ref.current.scrollIntoView({ block: 'nearest' });
    }
  }, [focused]);

  return (
    <button
      ref={ref}
      onClick={onSelect}
      onMouseEnter={onFocus}
      onContextMenu={onContextMenu}
      className={`flex items-start gap-3 w-full px-5 py-3 text-left transition-colors group ${
        focused ? 'bg-secondary/60' : 'hover:bg-secondary/30'
      }`}
    >
      {/* status dot (clickable) */}
      <button
        onClick={(e) => { e.stopPropagation(); onStatusChange(item.id, cfg.next); }}
        className={`w-2.5 h-2.5 rounded-full shrink-0 mt-1 ring-2 ring-transparent hover:ring-primary/30 transition-all ${cfg.dot}`}
        title={`Mark as ${cfg.next}`}
      />

      {/* title + preview */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-0.5">
          <span className="text-[13px] text-foreground font-medium truncate">{item.title}</span>
        </div>
        {item.preview && (
          <div className="text-[11px] text-muted-foreground/60 truncate leading-relaxed">
            {item.preview}
          </div>
        )}
      </div>

      {/* meta */}
      <div className="flex items-center gap-2 shrink-0 mt-0.5">
        <span className="text-[10px] text-muted-foreground/40 capitalize">{item.topic.replace(/-/g, ' ')}</span>
        {item.tags && item.tags.length > 0 && (
          <Badge variant="secondary" className="text-[9px] px-1.5 py-0 h-4">{item.tags[0]}</Badge>
        )}
        <span className="text-[10px] text-muted-foreground/30 w-14 text-right">
          {formatDate(item.updatedAt)}
        </span>
      </div>
    </button>
  );
}

/* ---- Context Menu ---- */

function ContextMenu({ x, y, item, onStatusChange, onDelete, onOpen }: {
  x: number; y: number;
  item: ResearchItem;
  onStatusChange: (id: string, status: string) => void;
  onDelete: (id: string) => void;
  onOpen: () => void;
}) {
  const cfg = STATUS_CONFIG[item.status];
  return (
    <div
      className="fixed z-50 bg-popover border border-border rounded-lg shadow-xl py-1 min-w-[160px] text-xs"
      style={{ left: x, top: y }}
    >
      <button onClick={onOpen} className="flex items-center gap-2 w-full px-3 py-1.5 hover:bg-secondary/60 transition-colors text-left">
        <BookOpen className="w-3 h-3 text-muted-foreground" />
        Open
      </button>
      <button
        onClick={() => onStatusChange(item.id, cfg?.next || 'active')}
        className="flex items-center gap-2 w-full px-3 py-1.5 hover:bg-secondary/60 transition-colors text-left"
      >
        <cfg.icon className="w-3 h-3 text-muted-foreground" />
        Mark as {cfg?.next || 'active'}
      </button>
      <div className="border-t border-border/40 my-1" />
      <button
        onClick={() => onDelete(item.id)}
        className="flex items-center gap-2 w-full px-3 py-1.5 hover:bg-destructive/10 text-destructive transition-colors text-left"
      >
        <Trash2 className="w-3 h-3" />
        Delete
      </button>
    </div>
  );
}

/* ---- Detail View ---- */

function DetailView({ item, editing, onEdit, onCancelEdit, onBack, onDelete, onStatusChange, onSave }: {
  item: ResearchItemWithContent;
  editing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onBack: () => void;
  onDelete: (id: string) => void;
  onStatusChange: (id: string, status: string) => void;
  onSave: (id: string, updates: { title?: string; topic?: string; content?: string; tags?: string[] }) => Promise<void>;
}) {
  const cfg = STATUS_CONFIG[item.status] || STATUS_CONFIG.active;
  const [saving, setSaving] = useState(false);

  const [editTitle, setEditTitle] = useState(item.title);
  const [editTopic, setEditTopic] = useState(item.topic);
  const [editContent, setEditContent] = useState(item.content);
  const [editTags, setEditTags] = useState(item.tags?.join(', ') || '');
  const titleRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setEditTitle(item.title);
    setEditTopic(item.topic);
    setEditContent(item.content);
    setEditTags(item.tags?.join(', ') || '');
  }, [item]);

  useEffect(() => {
    if (editing && titleRef.current) {
      titleRef.current.focus();
      titleRef.current.select();
    }
  }, [editing]);

  const handleSave = async () => {
    setSaving(true);
    const tags = editTags.split(',').map(t => t.trim()).filter(Boolean);
    await onSave(item.id, {
      title: editTitle || 'Untitled',
      topic: editTopic || 'uncategorized',
      content: editContent,
      tags: tags.length > 0 ? tags : undefined,
    });
    setSaving(false);
  };

  const handleCancel = () => {
    setEditTitle(item.title);
    setEditTopic(item.topic);
    setEditContent(item.content);
    setEditTags(item.tags?.join(', ') || '');
    onCancelEdit();
  };

  const autoResize = useCallback(() => {
    const el = contentRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.max(400, el.scrollHeight) + 'px';
  }, []);

  useEffect(() => {
    if (editing) autoResize();
  }, [editing, editContent, autoResize]);

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* top bar */}
      <div className="shrink-0 px-5 py-2 border-b border-border/60 flex items-center gap-2">
        <button
          onClick={onBack}
          className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="w-3.5 h-3.5" />
          Back
        </button>
        <span className="text-muted-foreground/20 text-[11px]">/</span>
        {editing ? (
          <input
            value={editTopic}
            onChange={e => setEditTopic(e.target.value)}
            className="text-[11px] text-muted-foreground bg-transparent border-b border-dashed border-muted-foreground/30 outline-none focus:border-primary/50 px-1 py-0.5 w-40"
            placeholder="topic"
          />
        ) : (
          <span className="text-[11px] text-muted-foreground">{item.topic.replace(/-/g, ' ')}</span>
        )}

        <div className="ml-auto flex items-center gap-1.5">
          {editing ? (
            <>
              <Button variant="ghost" size="sm" className="h-6 text-[10px] gap-1 text-muted-foreground" onClick={handleCancel} disabled={saving}>
                <X className="w-3 h-3" /> Cancel
              </Button>
              <Button variant="default" size="sm" className="h-6 text-[10px] gap-1" onClick={handleSave} disabled={saving}>
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Save
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" size="sm" className="h-6 text-[10px] gap-1 text-muted-foreground" onClick={onEdit}>
                <Pencil className="w-3 h-3" /> Edit
              </Button>
              <button
                onClick={() => onDelete(item.id)}
                className="p-1.5 rounded-md text-muted-foreground/40 hover:text-destructive hover:bg-destructive/10 transition-colors"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </>
          )}
        </div>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="mx-auto max-w-4xl px-8 py-8">
          {/* title */}
          {editing ? (
            <input
              ref={titleRef}
              value={editTitle}
              onChange={e => setEditTitle(e.target.value)}
              className="w-full text-xl font-semibold text-foreground bg-transparent border-b border-dashed border-muted-foreground/20 outline-none focus:border-primary/50 pb-1 mb-4"
              placeholder="Research title"
            />
          ) : (
            <h1 className="text-xl font-semibold text-foreground leading-snug mb-4">{item.title}</h1>
          )}

          {/* metadata row */}
          <div className="flex flex-wrap items-center gap-3 mb-6">
            <button
              onClick={() => onStatusChange(item.id, cfg.next)}
              className={`text-[11px] px-3 py-1 rounded-full border transition-colors hover:opacity-80 cursor-pointer font-medium ${cfg.badge}`}
              title={`Mark as ${cfg.next}`}
            >
              {cfg.label}
            </button>

            {!editing && (
              <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <Tag className="w-3 h-3" />
                {item.topic.replace(/-/g, ' ')}
              </span>
            )}

            <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <Clock className="w-3 h-3" />
              Updated {new Date(item.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
            </span>

            {editing ? (
              <div className="flex items-center gap-1.5">
                <Tag className="w-3 h-3 text-muted-foreground" />
                <input
                  value={editTags}
                  onChange={e => setEditTags(e.target.value)}
                  className="text-[11px] bg-transparent border-b border-dashed border-muted-foreground/30 outline-none focus:border-primary/50 px-1 py-0.5 w-48"
                  placeholder="tags (comma separated)"
                />
              </div>
            ) : (
              item.tags?.map(tag => (
                <Badge key={tag} variant="secondary" className="text-[10px] px-2 py-0">{tag}</Badge>
              ))
            )}

            {item.sources && item.sources.length > 0 && !editing && (
              <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <ExternalLink className="w-3 h-3" />
                {item.sources.length} source{item.sources.length !== 1 ? 's' : ''}
              </span>
            )}
          </div>

          {/* divider */}
          <div className="border-t border-border/40 mb-6" />

          {/* content */}
          {editing ? (
            <textarea
              ref={contentRef}
              value={editContent}
              onChange={e => { setEditContent(e.target.value); autoResize(); }}
              className="w-full min-h-[400px] text-sm leading-relaxed bg-transparent border border-dashed border-border/40 rounded-md p-5 outline-none focus:border-primary/30 resize-none font-mono"
              placeholder="Write your research in markdown..."
            />
          ) : (
            <div className="prose-chat text-sm leading-relaxed">
              <Markdown remarkPlugins={[remarkGfm]}>{item.content}</Markdown>
            </div>
          )}

          {/* sources */}
          {!editing && item.sources && item.sources.length > 0 && (
            <div className="mt-10 pt-6 border-t border-border/40">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground mb-3">
                Sources ({item.sources.length})
              </h3>
              <div className="grid gap-2">
                {item.sources.map((src, i) => (
                  <a
                    key={i}
                    href={src}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-2.5 px-3 py-2 rounded-md bg-secondary/30 border border-border/30 hover:bg-secondary/60 hover:border-border/60 transition-colors group"
                  >
                    <ExternalLink className="w-3.5 h-3.5 text-muted-foreground/50 group-hover:text-primary shrink-0 transition-colors" />
                    <span className="text-[11px] text-muted-foreground group-hover:text-foreground truncate transition-colors">
                      {extractDomain(src)}
                    </span>
                  </a>
                ))}
              </div>
            </div>
          )}

          <div className="h-16" />
        </div>
      </ScrollArea>

      {/* keyboard hints */}
      <div className="shrink-0 px-5 py-1.5 border-t border-border/40 flex items-center gap-4 text-[10px] text-muted-foreground/40">
        <span><kbd className="font-mono">Cmd+Left</kbd> back</span>
        <span><kbd className="font-mono">e</kbd> edit</span>
        <span><kbd className="font-mono">Esc</kbd> {editing ? 'cancel' : 'back'}</span>
      </div>
    </div>
  );
}

/* ---- Helpers ---- */

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7) return `${diffDays}d ago`;
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}
