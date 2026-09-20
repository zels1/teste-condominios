const MAP = {
  pago: "bg-emerald-100 text-emerald-800", pendente: "bg-amber-100 text-amber-800",
  ativo: "bg-emerald-100 text-emerald-800", inativo: "bg-slate-100 text-slate-700",
  confirmado: "bg-blue-100 text-blue-800",
  PAID: "bg-emerald-100 text-emerald-800", OPEN: "bg-slate-100 text-slate-700",
  PARTIALLY_PAID: "bg-amber-100 text-amber-800", OVERDUE: "bg-rose-100 text-rose-800",
  REVERSED: "bg-slate-200 text-slate-600 line-through", CANCELLED: "bg-slate-200 text-slate-600",
  CREDIT: "bg-emerald-100 text-emerald-800", approved: "bg-emerald-100 text-emerald-800", draft: "bg-slate-100 text-slate-700",
  // occurrences
  new: "bg-blue-100 text-blue-800", assigned: "bg-indigo-100 text-indigo-800",
  in_progress: "bg-amber-100 text-amber-800", waiting_supplier: "bg-orange-100 text-orange-800",
  waiting_owner: "bg-orange-100 text-orange-800", waiting_approval: "bg-orange-100 text-orange-800",
  resolved: "bg-emerald-100 text-emerald-800", closed: "bg-slate-200 text-slate-600", cancelled: "bg-slate-200 text-slate-600",
  // priorities
  low: "bg-slate-100 text-slate-700", normal: "bg-blue-100 text-blue-800",
  high: "bg-amber-100 text-amber-800", urgent: "bg-rose-100 text-rose-800",
  // maintenance / contract / task
  scheduled: "bg-blue-100 text-blue-800", due: "bg-amber-100 text-amber-800",
  overdue: "bg-rose-100 text-rose-800", completed: "bg-emerald-100 text-emerald-800",
  active: "bg-emerald-100 text-emerald-800", expiring: "bg-amber-100 text-amber-800", expired: "bg-rose-100 text-rose-800",
  todo: "bg-slate-100 text-slate-700", waiting: "bg-orange-100 text-orange-800",
};
const LABELS = {
  pago: "Pago", pendente: "Pendente", ativo: "Ativo", inativo: "Inativo", confirmado: "Confirmado",
  PAID: "Pago", OPEN: "Em aberto", PARTIALLY_PAID: "Parcial", OVERDUE: "Em atraso", REVERSED: "Revertido",
  CANCELLED: "Anulado", CREDIT: "Crédito", approved: "Aprovado", draft: "Rascunho",
  new: "Novo", assigned: "Atribuído", in_progress: "Em curso", waiting_supplier: "Aguarda fornecedor",
  waiting_owner: "Aguarda condómino", waiting_approval: "Aguarda aprovação", resolved: "Resolvido",
  closed: "Fechado", cancelled: "Cancelado",
  low: "Baixa", normal: "Normal", high: "Alta", urgent: "Urgente",
  scheduled: "Agendada", due: "A vencer", overdue: "Em atraso", completed: "Concluída",
  active: "Ativo", expiring: "A expirar", expired: "Expirado", todo: "A fazer", waiting: "Em espera",
};

export function StatusBadge({ status, label }) {
  const cls = MAP[status] || "bg-slate-100 text-slate-700";
  return (
    <span className={`inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold ${cls}`} data-testid={`status-${status}`}>
      {label || LABELS[status] || status}
    </span>
  );
}
export const STATUS_LABELS = LABELS;
