import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { tenantService } from '@features/tenants/api';
import { Trash2, Plus, MessageSquare, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { StayoLoader } from '@shared/ui/brand';

interface PrivateNotesProps {
  tenantId: string;
}

export function PrivateNotes({ tenantId }: PrivateNotesProps) {
  const queryClient = useQueryClient();
  const [newNote, setNewNote] = useState('');

  // Fetch notes
  const { data, isLoading } = useQuery({
    queryKey: ['tenant-notes', tenantId],
    queryFn: () => tenantService.getNotes(tenantId),
    enabled: Boolean(tenantId),
  });

  const notes = data?.notes ?? [];

  // Add note mutation
  const addMutation = useMutation({
    mutationFn: (content: string) => tenantService.addNote(tenantId, content),
    onSuccess: () => {
      toast.success('Private note added');
      setNewNote('');
      queryClient.invalidateQueries({ queryKey: ['tenant-notes', tenantId] });
      queryClient.invalidateQueries({ queryKey: ['tenant', tenantId, 'owner-overview'] });
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error?.message || 'Failed to add note');
    },
  });

  // Delete note mutation
  const deleteMutation = useMutation({
    mutationFn: (noteId: string) => tenantService.deleteNote(tenantId, noteId),
    onSuccess: () => {
      toast.success('Private note deleted');
      queryClient.invalidateQueries({ queryKey: ['tenant-notes', tenantId] });
      queryClient.invalidateQueries({ queryKey: ['tenant', tenantId, 'owner-overview'] });
    },
    onError: (err: any) => {
      toast.error(err?.response?.data?.error?.message || 'Failed to delete note');
    },
  });

  const handleAddNote = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newNote.trim()) return;
    addMutation.mutate(newNote.trim());
  };

  const formatDate = (dateStr: string) => {
    const d = new Date(dateStr);
    return d.toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <div className="p-4 rounded-2xl border border-border bg-card shadow-sm space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground flex items-center gap-1.5">
          <MessageSquare className="w-4.5 h-4.5 text-accent" />
          <span>Private Notes</span>
          <span className="text-[10px] font-bold text-muted-foreground uppercase bg-secondary px-1.5 py-0.5 rounded border border-border">
            Owner Only
          </span>
        </h3>
      </div>

      {/* Add note form */}
      <form onSubmit={handleAddNote} className="flex gap-2">
        <input
          type="text"
          value={newNote}
          onChange={(e) => setNewNote(e.target.value)}
          placeholder="Add an owner-private note..."
          disabled={addMutation.isPending}
          className="flex-1 px-3 py-2 text-xs rounded-xl border border-border bg-background text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-accent"
        />
        <button
          type="submit"
          disabled={addMutation.isPending || !newNote.trim()}
          className="p-2 rounded-xl bg-accent text-accent-foreground hover:bg-accent/90 disabled:opacity-50 active:scale-95 transition-transform shrink-0 flex items-center justify-center"
        >
          {addMutation.isPending ? (
            <StayoLoader size="sm" label={null} />
          ) : (
            <Plus className="w-4 h-4" />
          )}
        </button>
      </form>

      {/* Notes list */}
      {isLoading ? (
        <div className="flex justify-center py-4">
          <StayoLoader size="md" className="text-accent" />
        </div>
      ) : (
        <div className="space-y-2.5 max-h-[220px] overflow-y-auto scrollbar-hide">
          {notes.map((note: any) => (
            <div
              key={note.id}
              className="flex justify-between items-start gap-3 p-3 rounded-xl border border-border/80 bg-background/50 hover:bg-background transition-colors group"
            >
              <div className="min-w-0 flex-1 space-y-1">
                <p className="text-xs text-foreground font-medium leading-relaxed break-words">
                  {note.content}
                </p>
                <span className="text-[9px] text-muted-foreground block">
                  {formatDate(note.created_at)}
                </span>
              </div>
              <button
                type="button"
                onClick={() => deleteMutation.mutate(note.id)}
                disabled={deleteMutation.isPending}
                className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 active:scale-95 transition-all md:opacity-0 group-hover:opacity-100 shrink-0"
                title="Delete note"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}

          {notes.length === 0 && (
            <p className="text-xs text-muted-foreground text-center py-4">
              No private notes yet. Notes are only visible to you and co-owners.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
