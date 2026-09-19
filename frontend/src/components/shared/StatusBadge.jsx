const MAP = {
  pago: "bg-emerald-100 text-emerald-800",
  pendente: "bg-amber-100 text-amber-800",
  ativo: "bg-emerald-100 text-emerald-800",
  inativo: "bg-slate-100 text-slate-700",
  confirmado: "bg-blue-100 text-blue-800",
  em_atraso: "bg-rose-100 text-rose-800",
  credito: "bg-emerald-100 text-emerald-800",
  debito: "bg-rose-100 text-rose-800",
};

const LABELS = {
  pago: "Pago",
  pendente: "Pendente",
  ativo: "Ativo",
  inativo: "Inativo",
  confirmado: "Confirmado",
  em_atraso: "Em atraso",
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
