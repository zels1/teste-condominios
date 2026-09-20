import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, formatApiErrorDetail } from "@/lib/api";
import { formatCurrency, PAY_METHOD_LABELS } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";

export function PaymentDialog({ open, onOpenChange, condos = [], fixedFraction = null, fixedCondo = null, onDone }) {
  const qc = useQueryClient();
  const [condoId, setCondoId] = useState(fixedCondo || "");
  const [fractionId, setFractionId] = useState(fixedFraction || "");
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState("transferencia");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [ref, setRef] = useState("");

  const { data: fractions = [] } = useQuery({
    queryKey: ["frac-pay", condoId],
    queryFn: () => api.get("/fractions", { params: condoId ? { condominium_id: condoId } : {} }).then((r) => r.data),
    enabled: open && !!condoId && !fixedFraction,
  });

  const mut = useMutation({
    mutationFn: () => api.post("/finance/payments", {
      condominium_id: fixedCondo || condoId, fraction_id: fixedFraction || fractionId,
      amount: Number(amount), method, date: new Date(date).toISOString(), bank_reference: ref,
      allocation_method: "oldest_first",
    }),
    onSuccess: (r) => {
      const d = r.data;
      qc.invalidateQueries();
      toast.success(`Recebimento registado. Recibo ${d.receipt_number}.` +
        (d.credit_remaining > 0 ? ` Crédito de ${formatCurrency(d.credit_remaining)} disponível.` : ""));
      onOpenChange(false);
      setAmount(""); setRef("");
      onDone && onDone(d);
    },
    onError: (e) => toast.error(formatApiErrorDetail(e.response?.data?.detail)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md" data-testid="payment-dialog">
        <DialogHeader><DialogTitle className="font-display">Registar Recebimento</DialogTitle></DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); mut.mutate(); }} className="space-y-3" data-testid="payment-form">
          {!fixedCondo && (
            <div className="space-y-1.5">
              <Label>Condomínio *</Label>
              <Select value={condoId} onValueChange={(v) => { setCondoId(v); setFractionId(""); }}>
                <SelectTrigger data-testid="pay-condo"><SelectValue placeholder="Selecionar" /></SelectTrigger>
                <SelectContent>{condos.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          )}
          {!fixedFraction && (
            <div className="space-y-1.5">
              <Label>Fração *</Label>
              <Select value={fractionId} onValueChange={setFractionId} disabled={!condoId}>
                <SelectTrigger data-testid="pay-fraction"><SelectValue placeholder="Selecionar" /></SelectTrigger>
                <SelectContent>
                  {fractions.map((f) => (
                    <SelectItem key={f.id} value={f.id}>{f.identifier} — {f.owner_name} ({formatCurrency(f.balance)})</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Montante (€) *</Label>
              <Input type="number" step="0.01" min="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required data-testid="pay-amount" />
            </div>
            <div className="space-y-1.5">
              <Label>Data *</Label>
              <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} required data-testid="pay-date" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Método</Label>
              <Select value={method} onValueChange={setMethod}>
                <SelectTrigger data-testid="pay-method"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(PAY_METHOD_LABELS).map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Referência</Label>
              <Input value={ref} onChange={(e) => setRef(e.target.value)} />
            </div>
          </div>
          <p className="text-xs text-muted-foreground">O valor é alocado às dívidas mais antigas primeiro. Excedente fica como crédito.</p>
          <DialogFooter>
            <Button type="submit" disabled={mut.isPending || !amount || !(fixedFraction || fractionId)} data-testid="pay-submit">
              {mut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />} Registar
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
