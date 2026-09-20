import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, formatApiErrorDetail } from "@/lib/api";
import { formatCurrency, CHARGE_TYPE_LABELS, CALC_METHOD_LABELS } from "@/lib/format";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { toast } from "sonner";
import { FileStack, Plus, Loader2, Zap } from "lucide-react";

const YEAR = new Date().getFullYear();
const MONTHS = ["Jan", "Fev", "Mar", "Abr", "Mai", "Jun", "Jul", "Ago", "Set", "Out", "Nov", "Dez"];

export default function Quotas() {
  const qc = useQueryClient();
  const [condo, setCondo] = useState("");
  const [cfgOpen, setCfgOpen] = useState(false);
  const [genOpen, setGenOpen] = useState(false);
  const emptyCfg = { name: "", charge_type: "REGULAR_QUOTA", calculation_method: "PERMILAGE", amount: "", frequency: "monthly", due_day: 8 };
  const [cfg, setCfg] = useState(emptyCfg);
  const [gen, setGen] = useState({ config_id: "", financial_year: YEAR, start_month: 1, end_month: 12 });

  const { data: condos = [] } = useQuery({ queryKey: ["condos"], queryFn: () => api.get("/condominiums").then((r) => r.data) });
  const { data: configs = [], isLoading } = useQuery({
    queryKey: ["charge-configs", condo],
    queryFn: () => api.get("/finance/charge-configs", { params: { condominium_id: condo } }).then((r) => r.data),
    enabled: !!condo,
  });

  const createCfg = useMutation({
    mutationFn: (p) => api.post("/finance/charge-configs", { ...p, condominium_id: condo, amount: Number(p.amount) || 0, due_day: Number(p.due_day) || 8 }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["charge-configs"] }); toast.success("Configuração criada."); setCfgOpen(false); setCfg(emptyCfg); },
    onError: (e) => toast.error(formatApiErrorDetail(e.response?.data?.detail)),
  });
  const genMut = useMutation({
    mutationFn: (p) => api.post("/finance/generate-quotas", { ...p, condominium_id: condo, financial_year: Number(p.financial_year), start_month: Number(p.start_month), end_month: Number(p.end_month) }),
    onSuccess: (r) => { qc.invalidateQueries(); toast.success(r.data.message); setGenOpen(false); },
    onError: (e) => toast.error(formatApiErrorDetail(e.response?.data?.detail)),
  });
  const set = (k) => (e) => setCfg((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div data-testid="quotas-page">
      <PageHeader title="Quotas" subtitle="Configuração de encargos e geração de quotas">
        {condo && (
          <>
            <Dialog open={cfgOpen} onOpenChange={setCfgOpen}>
              <DialogTrigger asChild><Button variant="outline" data-testid="add-config-btn"><Plus className="mr-2 h-4 w-4" /> Nova Configuração</Button></DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader><DialogTitle className="font-display">Nova Configuração de Encargo</DialogTitle></DialogHeader>
                <form onSubmit={(e) => { e.preventDefault(); createCfg.mutate(cfg); }} className="space-y-3" data-testid="config-form">
                  <div className="space-y-1.5"><Label>Nome *</Label><Input value={cfg.name} onChange={set("name")} required data-testid="cfg-name" /></div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label>Tipo</Label>
                      <Select value={cfg.charge_type} onValueChange={(v) => setCfg((f) => ({ ...f, charge_type: v }))}>
                        <SelectTrigger data-testid="cfg-type"><SelectValue /></SelectTrigger>
                        <SelectContent>{Object.entries(CHARGE_TYPE_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Cálculo</Label>
                      <Select value={cfg.calculation_method} onValueChange={(v) => setCfg((f) => ({ ...f, calculation_method: v }))}>
                        <SelectTrigger data-testid="cfg-method"><SelectValue /></SelectTrigger>
                        <SelectContent>{Object.entries(CALC_METHOD_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="col-span-2 space-y-1.5">
                      <Label>{cfg.calculation_method === "PERMILAGE" ? "Orçamento anual (€)" : "Valor por período (€)"}</Label>
                      <Input type="number" step="0.01" value={cfg.amount} onChange={set("amount")} data-testid="cfg-amount" />
                    </div>
                    <div className="space-y-1.5"><Label>Dia venc.</Label><Input type="number" min="1" max="28" value={cfg.due_day} onChange={set("due_day")} /></div>
                  </div>
                  <div className="space-y-1.5">
                    <Label>Frequência</Label>
                    <Select value={cfg.frequency} onValueChange={(v) => setCfg((f) => ({ ...f, frequency: v }))}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="monthly">Mensal</SelectItem>
                        <SelectItem value="quarterly">Trimestral</SelectItem>
                        <SelectItem value="annual">Anual</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <DialogFooter><Button type="submit" disabled={createCfg.isPending} data-testid="cfg-submit">{createCfg.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Criar</Button></DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
            <Dialog open={genOpen} onOpenChange={setGenOpen}>
              <DialogTrigger asChild><Button data-testid="generate-quotas-btn"><Zap className="mr-2 h-4 w-4" /> Gerar Quotas</Button></DialogTrigger>
              <DialogContent className="max-w-md">
                <DialogHeader><DialogTitle className="font-display">Gerar Quotas</DialogTitle></DialogHeader>
                <form onSubmit={(e) => { e.preventDefault(); genMut.mutate(gen); }} className="space-y-3" data-testid="generate-form">
                  <div className="space-y-1.5">
                    <Label>Configuração *</Label>
                    <Select value={gen.config_id} onValueChange={(v) => setGen((g) => ({ ...g, config_id: v }))}>
                      <SelectTrigger data-testid="gen-config"><SelectValue placeholder="Selecionar" /></SelectTrigger>
                      <SelectContent>{configs.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-3 gap-3">
                    <div className="space-y-1.5"><Label>Ano</Label><Input type="number" value={gen.financial_year} onChange={(e) => setGen((g) => ({ ...g, financial_year: e.target.value }))} /></div>
                    <div className="space-y-1.5">
                      <Label>Mês inicial</Label>
                      <Select value={String(gen.start_month)} onValueChange={(v) => setGen((g) => ({ ...g, start_month: v }))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{MONTHS.map((m, i) => <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-1.5">
                      <Label>Mês final</Label>
                      <Select value={String(gen.end_month)} onValueChange={(v) => setGen((g) => ({ ...g, end_month: v }))}>
                        <SelectTrigger><SelectValue /></SelectTrigger>
                        <SelectContent>{MONTHS.map((m, i) => <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>)}</SelectContent>
                      </Select>
                    </div>
                  </div>
                  <p className="text-xs text-muted-foreground">A geração é idempotente — encargos já existentes não são duplicados.</p>
                  <DialogFooter><Button type="submit" disabled={genMut.isPending || !gen.config_id} data-testid="gen-submit">{genMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Gerar</Button></DialogFooter>
                </form>
              </DialogContent>
            </Dialog>
          </>
        )}
      </PageHeader>

      <Card className="mb-6 border-border p-4 shadow-none">
        <Select value={condo} onValueChange={setCondo}>
          <SelectTrigger className="sm:w-[320px]" data-testid="quotas-condo"><SelectValue placeholder="Escolher condomínio" /></SelectTrigger>
          <SelectContent>{condos.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
        </Select>
      </Card>

      {!condo ? (
        <EmptyState icon={FileStack} title="Selecione um condomínio" description="Escolha um condomínio para gerir configurações de quotas." />
      ) : isLoading ? (
        <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : configs.length === 0 ? (
        <EmptyState icon={FileStack} title="Sem configurações" description="Crie a primeira configuração de encargo para este condomínio." />
      ) : (
        <Card className="border-border shadow-none">
          <Table data-testid="configs-table">
            <TableHeader>
              <TableRow><TableHead>Nome</TableHead><TableHead>Tipo</TableHead><TableHead>Cálculo</TableHead><TableHead>Frequência</TableHead><TableHead className="text-right">Valor / Orçamento</TableHead></TableRow>
            </TableHeader>
            <TableBody>
              {configs.map((c) => (
                <TableRow key={c.id} data-testid={`config-row-${c.id}`}>
                  <TableCell className="font-semibold">{c.name}</TableCell>
                  <TableCell>{CHARGE_TYPE_LABELS[c.charge_type] || c.charge_type}</TableCell>
                  <TableCell>{CALC_METHOD_LABELS[c.calculation_method] || c.calculation_method}</TableCell>
                  <TableCell className="text-muted-foreground">{c.frequency}</TableCell>
                  <TableCell className="text-right tabular-nums">{formatCurrency(c.amount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
