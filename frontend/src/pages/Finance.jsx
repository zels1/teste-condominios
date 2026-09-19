import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, formatApiErrorDetail } from "@/lib/api";
import { formatCurrency, formatDate, TX_TYPE_LABELS, TX_CATEGORY_LABELS } from "@/lib/format";
import { useAuth } from "@/context/AuthContext";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Wallet, Plus, Loader2, Trash2 } from "lucide-react";

const CREDIT = new Set(["payment", "credit"]);

export default function Finance() {
  const { isStaff } = useAuth();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("all");
  const empty = {
    condominium_id: "", fraction_id: "", type: "charge", category: "quota",
    description: "", amount: "", date: new Date().toISOString().slice(0, 10), reference: "",
  };
  const [form, setForm] = useState(empty);

  const { data: condos = [] } = useQuery({
    queryKey: ["condos"], queryFn: () => api.get("/condominiums").then((r) => r.data),
  });
  const { data: fractions = [] } = useQuery({
    queryKey: ["fractions-for-tx", form.condominium_id],
    queryFn: () => api.get("/fractions", { params: form.condominium_id ? { condominium_id: form.condominium_id } : {} }).then((r) => r.data),
    enabled: open && !!form.condominium_id,
  });
  const { data: txns = [], isLoading } = useQuery({
    queryKey: ["transactions", filter],
    queryFn: () => api.get("/transactions", { params: filter !== "all" ? { condominium_id: filter } : {} }).then((r) => r.data),
  });

  const create = useMutation({
    mutationFn: (p) => {
      const frac = fractions.find((f) => f.id === p.fraction_id);
      return api.post("/transactions", {
        ...p,
        fraction_id: p.fraction_id || null,
        owner_id: frac?.owner_id || null,
        amount: Number(p.amount) || 0,
        date: new Date(p.date).toISOString(),
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["fractions"] });
      qc.invalidateQueries({ queryKey: ["dashboard"] });
      toast.success("Movimento registado.");
      setOpen(false);
      setForm(empty);
    },
    onError: (e) => toast.error(formatApiErrorDetail(e.response?.data?.detail)),
  });

  const del = useMutation({
    mutationFn: (id) => api.delete(`/transactions/${id}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      qc.invalidateQueries({ queryKey: ["fractions"] });
      toast.success("Movimento eliminado.");
    },
  });

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <div data-testid="finance-page">
      <PageHeader title="Contas Correntes" subtitle="Movimentos financeiros: encargos e recebimentos">
        <Select value={filter} onValueChange={setFilter}>
          <SelectTrigger className="w-[200px]" data-testid="finance-filter"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="all">Todos os condomínios</SelectItem>
            {condos.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
          </SelectContent>
        </Select>
        {isStaff && (
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button data-testid="add-transaction-btn"><Plus className="mr-2 h-4 w-4" /> Novo Movimento</Button>
            </DialogTrigger>
            <DialogContent className="max-w-lg">
              <DialogHeader><DialogTitle className="font-display">Novo Movimento</DialogTitle></DialogHeader>
              <form onSubmit={(e) => { e.preventDefault(); create.mutate(form); }} className="grid grid-cols-2 gap-3" data-testid="transaction-form">
                <div className="space-y-1.5">
                  <Label>Tipo *</Label>
                  <Select value={form.type} onValueChange={(v) => setForm((f) => ({ ...f, type: v }))}>
                    <SelectTrigger data-testid="tx-type"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="charge">Encargo (dívida)</SelectItem>
                      <SelectItem value="payment">Recebimento</SelectItem>
                      <SelectItem value="credit">Crédito</SelectItem>
                      <SelectItem value="debit">Débito</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label>Categoria</Label>
                  <Select value={form.category} onValueChange={(v) => setForm((f) => ({ ...f, category: v }))}>
                    <SelectTrigger data-testid="tx-category"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="quota">Quota</SelectItem>
                      <SelectItem value="fundo_reserva">Fundo Comum de Reserva</SelectItem>
                      <SelectItem value="extraordinaria">Quota Extraordinária</SelectItem>
                      <SelectItem value="outro">Outro</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label>Condomínio *</Label>
                  <Select value={form.condominium_id} onValueChange={(v) => setForm((f) => ({ ...f, condominium_id: v, fraction_id: "" }))}>
                    <SelectTrigger data-testid="tx-condo"><SelectValue placeholder="Selecionar" /></SelectTrigger>
                    <SelectContent>
                      {condos.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label>Fração</Label>
                  <Select value={form.fraction_id} onValueChange={(v) => setForm((f) => ({ ...f, fraction_id: v }))} disabled={!form.condominium_id}>
                    <SelectTrigger data-testid="tx-fraction"><SelectValue placeholder="Selecionar (opcional)" /></SelectTrigger>
                    <SelectContent>
                      {fractions.map((f) => <SelectItem key={f.id} value={f.id}>{f.identifier} — {f.owner_name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-2 space-y-1.5">
                  <Label>Descrição</Label>
                  <Input value={form.description} onChange={set("description")} data-testid="tx-description" />
                </div>
                <div className="space-y-1.5">
                  <Label>Montante (€) *</Label>
                  <Input type="number" step="0.01" value={form.amount} onChange={set("amount")} required data-testid="tx-amount" />
                </div>
                <div className="space-y-1.5">
                  <Label>Data *</Label>
                  <Input type="date" value={form.date} onChange={set("date")} required data-testid="tx-date" />
                </div>
                <DialogFooter className="col-span-2 mt-2">
                  <Button type="submit" disabled={create.isPending || !form.condominium_id} data-testid="tx-submit">
                    {create.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Registar Movimento
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        )}
      </PageHeader>

      {isLoading ? (
        <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : txns.length === 0 ? (
        <EmptyState icon={Wallet} title="Sem movimentos" description="Ainda não existem movimentos registados." testid="finance-empty" />
      ) : (
        <Card className="border-border shadow-none">
          <Table data-testid="transactions-table">
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead>Condomínio</TableHead>
                <TableHead>Fração</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead className="text-right">Montante</TableHead>
                {isStaff && <TableHead className="w-10"></TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {txns.map((t) => {
                const credit = CREDIT.has(t.type);
                return (
                  <TableRow key={t.id} data-testid={`tx-row-${t.id}`}>
                    <TableCell className="tabular-nums text-muted-foreground">{formatDate(t.date)}</TableCell>
                    <TableCell className="font-medium">
                      {t.description || TX_CATEGORY_LABELS[t.category] || "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">{t.condominium_name}</TableCell>
                    <TableCell className="text-muted-foreground">{t.fraction_identifier}</TableCell>
                    <TableCell>
                      <span className={`text-xs font-semibold ${credit ? "text-emerald-600" : "text-slate-600"}`}>
                        {TX_TYPE_LABELS[t.type]}
                      </span>
                    </TableCell>
                    <TableCell className={`text-right font-semibold tabular-nums ${credit ? "text-emerald-600" : "text-rose-600"}`}>
                      {credit ? "−" : "+"}{formatCurrency(t.amount)}
                    </TableCell>
                    {isStaff && (
                      <TableCell>
                        <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          onClick={() => del.mutate(t.id)} data-testid={`tx-delete-${t.id}`}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    )}
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
