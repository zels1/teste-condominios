export function formatCurrency(n) {
  const v = Number(n || 0);
  return new Intl.NumberFormat("pt-PT", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
  }).format(v);
}

export function formatDate(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d)) return "—";
  return d.toLocaleDateString("pt-PT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

export function formatDateTime(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d)) return "—";
  return d.toLocaleString("pt-PT", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export const ROLE_LABELS = {
  super_admin: "Super Administrador",
  property_manager: "Gestor de Condomínio",
  admin_staff: "Staff Administrativo",
  owner: "Condómino",
};

export const TX_TYPE_LABELS = {
  charge: "Encargo",
  payment: "Recebimento",
  credit: "Crédito",
  debit: "Débito",
  adjustment: "Ajuste",
};

export const TX_CATEGORY_LABELS = {
  quota: "Quota",
  fundo_reserva: "Fundo Comum de Reserva",
  extraordinaria: "Quota Extraordinária",
  outro: "Outro",
};
