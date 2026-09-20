import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { formatCurrency } from "@/lib/format";
import { PageHeader } from "@/components/shared/PageHeader";
import { EmptyState } from "@/components/shared/EmptyState";
import { StatementView, openPdf } from "@/components/shared/StatementView";
import { PaymentDialog } from "@/components/shared/PaymentDialog";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { BookOpen, Receipt, FileDown } from "lucide-react";

export default function ContaCorrente() {
  const [condo, setCondo] = useState("");
  const [fraction, setFraction] = useState("");
  const [payOpen, setPayOpen] = useState(false);

  const { data: condos = [] } = useQuery({ queryKey: ["condos"], queryFn: () => api.get("/condominiums").then((r) => r.data) });
  const { data: fractions = [] } = useQuery({
    queryKey: ["fractions", condo],
    queryFn: () => api.get("/fractions", { params: { condominium_id: condo } }).then((r) => r.data),
    enabled: !!condo,
  });

  return (
    <div data-testid="conta-corrente-page">
      <PageHeader title="Conta Corrente" subtitle="Extrato detalhado por fração">
        {fraction && (
          <>
            <Button variant="outline" onClick={() => openPdf(`/finance/notice/${fraction}`)} data-testid="notice-pdf-btn">
              <FileDown className="mr-2 h-4 w-4" /> Aviso de Pagamento
            </Button>
            <Button onClick={() => setPayOpen(true)} data-testid="register-payment-btn">
              <Receipt className="mr-2 h-4 w-4" /> Registar Recebimento
            </Button>
          </>
        )}
      </PageHeader>

      <Card className="mb-6 flex flex-col gap-3 border-border p-4 shadow-none sm:flex-row">
        <Select value={condo} onValueChange={(v) => { setCondo(v); setFraction(""); }}>
          <SelectTrigger className="sm:w-[280px]" data-testid="cc-condo"><SelectValue placeholder="Escolher condomínio" /></SelectTrigger>
          <SelectContent>{condos.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={fraction} onValueChange={setFraction} disabled={!condo}>
          <SelectTrigger className="sm:w-[280px]" data-testid="cc-fraction"><SelectValue placeholder="Escolher fração" /></SelectTrigger>
          <SelectContent>
            {fractions.map((f) => <SelectItem key={f.id} value={f.id}>{f.identifier} — {f.owner_name} ({formatCurrency(f.balance)})</SelectItem>)}
          </SelectContent>
        </Select>
      </Card>

      {fraction ? (
        <StatementView fractionId={fraction} />
      ) : (
        <EmptyState icon={BookOpen} title="Selecione uma fração" description="Escolha o condomínio e a fração para ver a conta corrente." testid="cc-empty" />
      )}

      <PaymentDialog open={payOpen} onOpenChange={setPayOpen} fixedFraction={fraction} fixedCondo={condo} />
    </div>
  );
}
