'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Loader2, Send, X } from 'lucide-react';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useJackDialogStore, type JackTarget } from '@/lib/stores/jack-store';

interface JackStatus {
  state: 'ready' | 'disabled' | 'misconfigured';
  message: string;
}

interface NoteHit {
  id: string;
  title: string;
}

const MAX_PINNED = 5;

/**
 * Hand an item to Jack with a plain-English instruction and, optionally, a
 * few pinned notes. Mounted once in the dashboard layout; opened through
 * `useSendToJack`. The browser only ever talks to Brain Portal: the server
 * checks every id, builds the context and talks to Jack.
 */
export function SendToJackDialog() {
  const target = useJackDialogStore((s) => s.target);
  const close = useJackDialogStore((s) => s.close);

  return (
    <Dialog open={!!target} onOpenChange={(open) => { if (!open) close(); }}>
      <DialogContent className="sm:max-w-lg">
        {/* Keyed by the item, so every opening starts from a fresh form. */}
        {target && <SendToJackForm key={`${target.sourceType}:${target.sourceId}`} target={target} close={close} />}
      </DialogContent>
    </Dialog>
  );
}

function SendToJackForm({ target, close }: { target: JackTarget; close: () => void }) {
  const queryClient = useQueryClient();
  const router = useRouter();

  const [title, setTitle] = useState(target.title);
  const [instruction, setInstruction] = useState('');
  const [noteQuery, setNoteQuery] = useState('');
  const [pinned, setPinned] = useState<NoteHit[]>([]);

  const { data: status } = useQuery<JackStatus>({
    queryKey: ['jack-status'],
    queryFn: async () => {
      const res = await fetch('/api/jack/status');
      if (!res.ok) throw new Error('status');
      return res.json();
    },
    staleTime: 60_000,
  });

  const { data: hits = [] } = useQuery<NoteHit[]>({
    queryKey: ['jack-note-search', noteQuery],
    queryFn: async () => {
      const res = await fetch(`/api/notes?search=${encodeURIComponent(noteQuery)}&limit=6`);
      if (!res.ok) return [];
      const data = await res.json();
      return (data.notes ?? []).map((n: NoteHit) => ({ id: n.id, title: n.title }));
    },
    enabled: noteQuery.trim().length >= 2,
    staleTime: 30_000,
  });

  const submit = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/agent-tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          description: instruction.trim(),
          sourceType: target.sourceType,
          sourceId: target.sourceId,
          projectId: target.projectId ?? undefined,
          contextNoteIds: pinned.map((n) => n.id),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || 'Could not send to Jack');
      return body as { task: { id: string; jack_state: string }; jack: JackStatus };
    },
    onSuccess: (body) => {
      queryClient.invalidateQueries({ queryKey: ['agent-tasks'] });
      queryClient.invalidateQueries({ queryKey: ['agent-tasks-count'] });
      close();
      const sent = body.task.jack_state !== 'needs_dispatch';
      toast.success(sent ? 'Sent to Jack' : 'Saved, not sent: Jack is not connected', {
        description: sent ? 'Follow it in Review.' : body.jack.message,
        action: { label: 'Open', onClick: () => router.push(`/review?task=${body.task.id}`) },
      });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const unavailable = status && status.state !== 'ready';
  const canSubmit = title.trim().length > 0 && instruction.trim().length > 0 && !submit.isPending;

  return (
    <>
        <DialogHeader>
          <DialogTitle>Send to Jack</DialogTitle>
          <DialogDescription>
            Jack works on it with its own tools and reports back in Review. Changes to your records and anything
            sent outside Brain Portal wait for your approval.
          </DialogDescription>
        </DialogHeader>

        {unavailable && (
          <div role="status" className="flex gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-600" aria-hidden />
            <p>
              {status!.message} The task will be saved as <strong>Not sent</strong>, and nothing is sent anywhere until
              you send it.
            </p>
          </div>
        )}

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (canSubmit) submit.mutate();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="jack-title">Title</Label>
            <Input id="jack-title" value={title} maxLength={300} onChange={(e) => setTitle(e.target.value)} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="jack-instruction">What should Jack do?</Label>
            <Textarea
              id="jack-instruction"
              value={instruction}
              maxLength={8000}
              rows={4}
              autoFocus
              placeholder="e.g. Draft a reply to the supplier about the late delivery, and list anything I should check first."
              onChange={(e) => setInstruction(e.target.value)}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && canSubmit) {
                  e.preventDefault();
                  submit.mutate();
                }
              }}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="jack-pin">Pin notes for context (optional)</Label>
            {pinned.length > 0 && (
              <ul className="flex flex-wrap gap-1.5" aria-label="Pinned notes">
                {pinned.map((n) => (
                  <li key={n.id} className="inline-flex items-center gap-1 rounded border bg-muted px-2 py-0.5 text-xs">
                    {n.title}
                    <button
                      type="button"
                      className="rounded p-0.5 hover:bg-background"
                      aria-label={`Unpin ${n.title}`}
                      onClick={() => setPinned((p) => p.filter((x) => x.id !== n.id))}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {pinned.length < MAX_PINNED && (
              <>
                <Input
                  id="jack-pin"
                  value={noteQuery}
                  placeholder="Search notes"
                  onChange={(e) => setNoteQuery(e.target.value)}
                />
                {noteQuery.trim().length >= 2 && hits.length > 0 && (
                  <ul className="max-h-40 overflow-y-auto rounded-md border text-sm">
                    {hits
                      .filter((h) => !pinned.some((p) => p.id === h.id) && h.id !== target.sourceId)
                      .map((h) => (
                        <li key={h.id}>
                          <button
                            type="button"
                            className="w-full px-3 py-2 text-left hover:bg-accent min-h-[44px]"
                            onClick={() => {
                              setPinned((p) => [...p, h].slice(0, MAX_PINNED));
                              setNoteQuery('');
                            }}
                          >
                            {h.title}
                          </button>
                        </li>
                      ))}
                  </ul>
                )}
              </>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={close}>Cancel</Button>
            <Button type="submit" disabled={!canSubmit}>
              {submit.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Send className="h-4 w-4 mr-2" />}
              {unavailable ? 'Save for later' : 'Send to Jack'}
            </Button>
          </DialogFooter>
        </form>
    </>
  );
}
