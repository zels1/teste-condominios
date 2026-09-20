const MAP = {
  pago: "bg-emerald-100 text-emerald-800",
  pendente: "bg-amber-100 text-amber-800",
  ativo: "bg-emerald-100 text-emerald-800",
  inativo: "bg-slate-100 text-slate-700",
  confirmado: "bg-blue-100 text-blue-800",
  // finance charge statuses
  PAID: "bg-emerald-100 text-emerald-800",
  OPEN: "bg-slate-100 text-slate-700",
  PARTIALLY_PAID: "bg-amber-100 text-amber-800",
  OVERDUE: "bg-rose-100 text-rose-800",
  REVERSED: "bg-slate-200 text-slate-600 line-through",
  CANCELLED: "bg-slate-200 text-slate-600",
  CREDIT: "bg-emerald-100 text-emerald-800",
  approved: "bg-emerald-100 text-emerald-800",
  draft: "bg-slate-100 text-slate-700",
};

const LABELS = {
  pago: "Pago",
  pendente: "Pendente",
  ativo: "Ativo",
  inativo: "Inativo",
  confirmado: "Confirmado",
  PAID: "Pago",
  OPEN: "Em aberto",
  PARTIALLY_PAID: "Parcial",
  OVERDUE: "Em atraso",
  REVERSED: "Revertido",
  CANCELLED: "Anulado",
  CREDIT: "Crédito",
  approved: "Aprovado",
  draft: "Rascunho",
};

export function StatusBadge({ status, label }) {
  const cls = MAP[status] || "bg-slate-100 text-slate-700";
  return (
    <span
      className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ${cls}`}
      data-testid={`status-${status}`}
    >
      {label || LABELS[status] || status}
    </span>
  );
}
