import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/shared/PageHeader";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Loader2, Download, Printer } from "lucide-react";

const BACKEND = process.env.REACT_APP_BACKEND_URL;
const REPORTS = [
  ["receivable", "Valores a Receber"],
  ["owner_debt", "Dívida por Condómino"],
  ["aging", "Antiguidade da Dívida"],
  ["payments", "Recebimentos"],
  ["charges", "Encargos Emitidos"],
  ["expenses", "Despesas"],
  ["income_vs_expenses", "Receitas vs Despesas"],
  ["condo_summary", "Resumo por Condomínio"],
];

export default function Relatorios() {
  const [report, setReport] = useState("receivable");
  const [condo, setCondo] = useState("all");
  const { data: condos = [] } = useQuery({ queryKey: ["condos"], queryFn: () => api.get("/condominiums").then((r) => r.data) });
  const params = condo !== "all" ? { condominium_id: condo } : {};
  const { data, isLoading } = useQuery({
    queryKey: ["report", report, condo],
    queryFn: () => api.get(`/finance/reports/${report}`, { params }).then((r) => r.data),
  });

  const isMoney = (col) => col.includes("€");
  const csvUrl = `${BACKEND}/api/finance/reports/${report}?fmt=csv${condo !== "all" ? `&condominium_id=${condo}` : ""}`;

  return (
    <div data-testid="relatorios-page">
      <PageHeader title="Relatórios" subtitle="Relatórios financeiros e exportação">
        <Button variant="outline" onClick={() => window.open(csvUrl, "_blank")} data-testid="export-csv-btn"><Download className="mr-2 h-4 w-4" /> Exportar CSV</Button>
        <Button variant="outline" onClick={() => window.print()} data-testid="print-btn"><Printer className="mr-2 h-4 w-4" /> Imprimir</Button>
      </PageHeader>

      <Card className="mb-6 flex flex-col gap-3 border-border p-4 shadow-none sm:flex-row">
        <Select value={report} onValueChange={setReport}>
          <SelectTrigger className="sm:w-[280px]" data-testid="report-select"><SelectValue /></SelectTrigger>
          <SelectContent>{REPORTS.map(([k, v]) => <SelectItem key={k} value={k}>{v}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={condo} onValueChange={setCondo}>
          <SelectTrigger className="sm:w-[240px]" data-testid="report-condo"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="all">Todos os condomínios</SelectItem>{condos.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
        </Select>
      </Card>

      {isLoading || !data ? (
        <div className="flex h-40 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
      ) : (
        <Card className="border-border shadow-none">
          <div className="border-b border-border px-5 py-3"><h3 className="font-display text-base font-semibold">{data.title}</h3></div>
          <Table data-testid="report-table">
            <TableHeader>
              <TableRow>{data.columns.map((c, i) => <TableHead key={i} className={isMoney(c) ? "text-right" : ""}>{c}</TableHead>)}</TableRow>
            </TableHeader>
            <TableBody>
              {data.rows.length === 0 ? (
                <TableRow><TableCell colSpan={data.columns.length} className="py-10 text-center text-muted-foreground">Sem dados para este relatório.</TableCell></TableRow>
              ) : data.rows.map((row, ri) => (
                <TableRow key={ri}>
                  {row.map((cell, ci) => (
                    <TableCell key={ci} className={isMoney(data.columns[ci]) ? "text-right tabular-nums font-medium" : ""}>
                      {isMoney(data.columns[ci]) ? new Intl.NumberFormat("pt-PT", { style: "currency", currency: "EUR" }).format(Number(cell) || 0) : cell}
                    </TableCell>
                  ))}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
