import { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, formatApiErrorDetail } from "@/lib/api";
import { formatDateTime, formatCurrency } from "@/lib/format";
import { useAuth } from "@/context/AuthContext";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { CAT_PT } from "./Ocorrencias";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Send, Receipt, ImagePlus } from "lucide-react";

const STATUSES = ["new", "assigned", "in_progress", "waiting_supplier", "waiting_owner", "waiting_approval", "resolved", "closed", "cancelled"];
const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;

export default function OcorrenciaDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { isStaff } = useAuth();
  const [comment, setComment] = useState("");
  const [edit, setEdit] = useState({ status: "", assigned_to: "", supplier_id: "", actual_cost: "" });

  const { data: o, isLoading } = useQuery({ queryKey: ["occurrence", id], queryFn: () => api.get(`/ops/occurrences/${id}`).then((r) => r.data) });
  const { data: users = [] } = useQuery({ queryKey: ["users"], queryFn: () => api.get("/users").then((r) => r.data), enabled: isStaff });
  const { data: suppliers = [] } = useQuery({ queryKey: ["suppliers"], queryFn: () => api.get("/finance/suppliers").then((r) => r.data), enabled: isStaff });

  useEffect(() => { if (o) setEdit({ status: o.status, assigned_to: o.assigned_to || "", supplier_id: o.supplier_id || "", actual_cost: o.actual_cost || "" }); }, [o]);

  const save = useMutation({
    mutationFn: () => api.put(`/ops/occurrences/${id}`, { status: edit.status, assigned_to: edit.assigned_to || null, supplier_id: edit.supplier_id || null, actual_cost: Number(edit.actual_cost) || 0 }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["occurrence", id] }); toast.success("Ocorrência atualizada."); },
    onError: (e) => toast.error(formatApiErrorDetail(e.response?.data?.detail)),
  });
  const addComment = useMutation({
    mutationFn: () => api.post(`/ops/occurrences/${id}/comments`, { text: comment }),
    onSuccess: () => { setComment(""); qc.invalidateQueries({ queryKey: ["occurrence", id] }); },
  });
  const mkExpense = useMutation({
    mutationFn: () => api.post(`/ops/occurrences/${id}/create-expense`),
    onSuccess: (r) => toast.success(`Despesa criada: ${formatCurrency(r.data.amount)}`),
    onError: (e) => toast.error(formatApiErrorDetail(e.response?.data?.detail)),
  });
  const uploadPhoto = useMutation({
    mutationFn: (fileObj) => {
      const fd = new FormData();
      fd.append("file", fileObj);
      return api.post(`/ops/occurrences/${id}/photos`, fd);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["occurrence", id] }); toast.success("Fotografia adicionada."); },
    onError: (e) => toast.error(formatApiErrorDetail(e.response?.data?.detail)),
  });

  const onPhotoPick = (e) => {
    const f = e.target.files?.[0];
    if (f) uploadPhoto.mutate(f);
    e.target.value = "";
  };

  if (isLoading || !o) return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;

  const photos = (o.documents || []).filter((d) => d.category === "Fotografia" || (d.file_type || "").startsWith("image/"));

  return (
    <div data-testid="occurrence-detail-page">
      <Button variant="ghost" size="sm" className="mb-4 -ml-2 text-muted-foreground" onClick={() => nav("/ocorrencias")}><ArrowLeft className="mr-1 h-4 w-4" /> Ocorrências</Button>
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">{o.title}</h1>
        <StatusBadge status={o.status} /><StatusBadge status={o.priority} />
      </div>
      <p className="mb-6 text-sm text-muted-foreground">{o.condominium_name} · {CAT_PT[o.category] || o.category} · {o.location || "—"}</p>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card className="border-border p-5 shadow-none">
            <h3 className="mb-2 font-display text-sm font-semibold">Descrição</h3>
            <p className="text-sm text-muted-foreground">{o.description || "—"}</p>
          </Card>
          <Card className="border-border p-5 shadow-none" data-testid="occ-photos-card">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-display text-sm font-semibold">Fotografias</h3>
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted" data-testid="occ-photo-upload-label">
                {uploadPhoto.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImagePlus className="h-4 w-4" />}
                Adicionar fotografia
                <input type="file" accept="image/*" className="hidden" onChange={onPhotoPick} disabled={uploadPhoto.isPending} data-testid="occ-photo-input" />
              </label>
            </div>
            {photos.length === 0 ? (
              <p className="text-sm text-muted-foreground">Sem fotografias. Adicione imagens do problema para ajudar na resolução.</p>
            ) : (
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-testid="occ-photos-grid">
                {photos.map((d) => (
                  <a
                    key={d.id}
                    href={`${BACKEND_URL}/api/ops/documents/${d.id}/download`}
                    target="_blank"
                    rel="noreferrer"
                    className="group relative block overflow-hidden rounded-md border border-border"
                    data-testid={`occ-photo-${d.id}`}
                  >
                    <img
                      src={`${BACKEND_URL}/api/ops/documents/${d.id}/download`}
                      alt={d.name || "Fotografia"}
                      className="aspect-square w-full object-cover transition-transform group-hover:scale-105"
                      loading="lazy"
                    />
                  </a>
                ))}
              </div>
            )}
          </Card>
          <Card className="border-border p-5 shadow-none">
            <h3 className="mb-3 font-display text-sm font-semibold">Cronologia</h3>
            <div className="space-y-3">
              {o.timeline.map((t) => (
                <div key={t.id} className="flex items-start gap-3 text-sm" data-testid={`timeline-${t.id}`}>
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary" />
                  <div><StatusBadge status={t.status} /> <span className="ml-2 text-xs text-muted-foreground">{formatDateTime(t.created_at)} · {t.user_name}</span></div>
                </div>
              ))}
            </div>
          </Card>
          <Card className="border-border p-5 shadow-none">
            <h3 className="mb-3 font-display text-sm font-semibold">Comentários</h3>
            <div className="mb-3 space-y-3">
              {o.comments.length === 0 ? <p className="text-sm text-muted-foreground">Sem comentários.</p> :
                o.comments.map((c) => (
                  <div key={c.id} className="rounded-md border border-border p-3 text-sm" data-testid={`comment-${c.id}`}>
                    <p>{c.text}</p><p className="mt-1 text-xs text-muted-foreground">{c.user_name} · {formatDateTime(c.created_at)}</p>
                  </div>
                ))}
            </div>
            <div className="flex gap-2">
              <Textarea value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Adicionar comentário…" data-testid="comment-input" />
              <Button onClick={() => addComment.mutate()} disabled={!comment || addComment.isPending} data-testid="comment-submit"><Send className="h-4 w-4" /></Button>
            </div>
          </Card>
        </div>

        {isStaff && (
          <div className="space-y-4">
            <Card className="border-border p-5 shadow-none">
              <h3 className="mb-3 font-display text-sm font-semibold">Gestão</h3>
              <div className="space-y-3">
                <div className="space-y-1.5"><Label>Estado</Label>
                  <Select value={edit.status} onValueChange={(v) => setEdit((s) => ({ ...s, status: v }))}>
                    <SelectTrigger data-testid="occ-edit-status"><SelectValue /></SelectTrigger>
                    <SelectContent>{STATUSES.map((s) => <SelectItem key={s} value={s}><StatusBadge status={s} /></SelectItem>)}</SelectContent>
                  </Select></div>
                <div className="space-y-1.5"><Label>Responsável</Label>
                  <Select value={edit.assigned_to} onValueChange={(v) => setEdit((s) => ({ ...s, assigned_to: v }))}>
                    <SelectTrigger data-testid="occ-edit-assignee"><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>{users.map((u) => <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>)}</SelectContent>
                  </Select></div>
                <div className="space-y-1.5"><Label>Fornecedor</Label>
                  <Select value={edit.supplier_id} onValueChange={(v) => setEdit((s) => ({ ...s, supplier_id: v }))}>
                    <SelectTrigger data-testid="occ-edit-supplier"><SelectValue placeholder="—" /></SelectTrigger>
                    <SelectContent>{suppliers.map((sp) => <SelectItem key={sp.id} value={sp.id}>{sp.name}</SelectItem>)}</SelectContent>
                  </Select></div>
                <div className="space-y-1.5"><Label>Custo real (€)</Label><Input type="number" step="0.01" value={edit.actual_cost} onChange={(e) => setEdit((s) => ({ ...s, actual_cost: e.target.value }))} data-testid="occ-edit-cost" /></div>
                <Button className="w-full" onClick={() => save.mutate()} disabled={save.isPending} data-testid="occ-save">{save.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Guardar</Button>
                <Button variant="outline" className="w-full" onClick={() => mkExpense.mutate()} disabled={mkExpense.isPending} data-testid="occ-create-expense"><Receipt className="mr-2 h-4 w-4" /> Criar Despesa</Button>
              </div>
            </Card>
            <Card className="border-border p-5 shadow-none">
              <h3 className="mb-2 font-display text-sm font-semibold">Custos</h3>
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Estimado</span><span className="tabular-nums">{formatCurrency(o.estimated_cost)}</span></div>
              <div className="flex justify-between text-sm"><span className="text-muted-foreground">Real</span><span className="font-semibold tabular-nums">{formatCurrency(o.actual_cost)}</span></div>
            </Card>
          </div>
        )}
      </div>
    </div>
  );
}
