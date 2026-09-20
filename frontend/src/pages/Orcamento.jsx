import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, formatApiErrorDetail } from "@/lib/api";
import { formatCurrency, formatDate } from "@/lib/format";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { PieChart, Plus, Loader2, Trash2, CheckCircle2 } from "lucide-react";

const CATEGORIES = ["Administração", "Limpeza", "Eletricidade", "Água", "Elevador", "Seguro", "Manutenção", "Reparações", "Jardinagem", "Despesas bancárias", "Outro"];
const YEAR = new Date().getFullYear();

export default function Orcamento() {
  const qc = useQueryClient();
  const [condo, setCondo] = useState("");
  const [open, setOpen] = useState(false);
  const [year, setYear] = useState(YEAR);
  const [desc, setDesc] = useState(`Orçamento ordinário ${YEAR}`);
  const [lines, setLines] = useState([{ category: "Limpeza", description: "", amount: "" }]);

  const { data: condos = [] } = useQuery({ queryKey: ["condos"], queryFn: () => api.get("/condominiums").then((r) => r.data) });
  const { data: budgets = [], isLoading } = useQuery({
    queryKey: ["budgets", condo],
    queryFn: () => api.get("/finance/budgets", { params: { condominium_id: condo } }).then((r) => r.data),
    enabled: !!condo,
  });

  const create = useMutation({
    mutationFn: () => api.post("/finance/budgets", {
      condominium_id: condo, financial_year: Number(year), description: desc,
      lines: lines.filter((l) => l.amount).map((l) => ({ ...l, amount: Number(l.amount) })), status: "draft",
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["budgets"] }); toast.success("Orçamento criado."); setOpen(false); setLines([{ category: "Limpeza", description: "", amount: "" }]); },
    onError: (e) => toast.error(formatApiErrorDetail(e.response?.data?.detail)),
  });
  const approve = useMutation({
    mutationFn: (id) => api.post(`/finance/budgets/${id}/approve`),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["budgets"] }); toast.success("Orçamento aprovado."); },
  });

  const total = lines.reduce((s, l) => s + (Number(l.amount) || 0), 0);

  return (
    <div data-testid="orcamento-page">
      <PageHeader title="Orçamento" subtitle="Orçamentos anuais por condomínio">
        {condo && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild><Button data-testid="add-budget-btn"><Plus className="mr-2 h-4 w-4" /> Novo Orçamento</Button></DialogTrigger>
            <DialogContent className="max-w-xl">
              <DialogHeader><DialogTitle className="font-display">Novo Orçamento Anual</DialogTitle></DialogHeader>
              <form onSubmit={(e) => { e.preventDefault(); create.mutate(); }} className="space-y-3" data-testid="budget-form">
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2 space-y-1.5"><Label>Descrição</Label><Input value={desc} onChange={(e) => setDesc(e.target.value)} /></div>
                  <div className="space-y-1.5"><Label>Ano</Label><Input type="number" value={year} onChange={(e) => setYear(e.target.value)} /></div>
                </div>
                <div className="space-y-2">
                  <Label>Rubricas</Label>
                  {lines.map((l, i) => (
                    <div key={i} className="flex gap-2">
                      <Select value={l.category} onValueChange={(v) => setLines((ls) => ls.map((x, j) => j === i ? { ...x, category: v } : x))}>
                        <SelectTrigger className="w-[180px]" data-testid={`budget-cat-${i}`}><SelectValue /></SelectTrigger>
                        <SelectContent>{CATEGORIES.map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                      </Select>
                      <Input type="number" step="0.01" placeholder="€" value={l.amount} data-testid={`budget-amt-${i}`}
                        onChange={(e) => setLines((ls) => ls.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))} />
                      <Button type="button" variant="ghost" size="icon" onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))}><Trash2 className="h-4 w-4" /></Button>
                    </div>
                  ))}
                  <Button type="button" variant="outline" size="sm" onClick={() => setLines((ls) => [...ls, { category: "Outro", description: "", amount: "" }])} data-testid="add-line-btn">
                    <Plus className="mr-1 h-4 w-4" /> Adicionar rubrica
                  </Button>
                </div>
                <div className="flex items-center justify-between border-t border-border pt-3">
                  <span className="text-sm text-muted-foreground">Total</span>
                  <span className="font-display text-lg font-bold tabular-nums">{formatCurrency(total)}</span>
                </div>
                <DialogFooter><Button type="submit" disabled={create.isPending} data-testid="budget-submit">{create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Criar Orçamento</Button></DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </PageHeader>

      <Card className="mb-6 border-border p-4 shadow-none">
        <Select value={condo} onValueChange={setCondo}>
          <SelectTrigger className="sm:w-[320px]" data-testid="budget-condo"><SelectValue placeholder="Escolher condomínio" /></SelectTrigger>
          <SelectContent>{condos.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
        </Select>
      </Card>

      {!condo ? (
        <EmptyState icon={PieChart} title="Selecione um condomínio" />
      ) : isLoading ? (
        <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : budgets.length === 0 ? (
        <EmptyState icon={PieChart} title="Sem orçamentos" description="Crie o primeiro orçamento anual." />
      ) : (
        <div className="space-y-4">
          {budgets.map((b) => (
            <Card key={b.id} className="border-border p-5 shadow-none" data-testid={`budget-card-${b.id}`}>
              <div className="flex items-center justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="font-display text-lg font-bold">{b.description}</h3>
                    <StatusBadge status={b.status} />
                  </div>
                  <p className="text-sm text-muted-foreground">Ano fiscal {b.financial_year}{b.approved_by ? ` · Aprovado por ${b.approved_by}` : ""}</p>
                </div>
                <div className="text-right">
                  <p className="font-display text-2xl font-bold tabular-nums">{formatCurrency(b.total_amount)}</p>
                  {b.status !== "approved" && (
                    <Button size="sm" variant="outline" className="mt-2" onClick={() => approve.mutate(b.id)} data-testid={`approve-${b.id}`}>
                      <CheckCircle2 className="mr-1 h-4 w-4" /> Aprovar
                    </Button>
                  )}
                </div>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-x-8 gap-y-1.5 md:grid-cols-3">
                {b.lines.map((l, i) => (
                  <div key={i} className="flex justify-between border-b border-border/60 py-1 text-sm">
                    <span className="text-muted-foreground">{l.category}</span>
                    <span className="font-medium tabular-nums">{formatCurrency(l.amount)}</span>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
