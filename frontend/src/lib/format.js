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

export const FIN_TX_LABELS = {
  CHARGE: "Encargo",
  PAYMENT: "Recebimento",
  CREDIT: "Crédito",
  ADJUSTMENT: "Ajuste",
  REVERSAL: "Reversão",
  REFUND: "Reembolso",
};

export const CHARGE_TYPE_LABELS = {
  REGULAR_QUOTA: "Quota Ordinária",
  FUND_RESERVE: "Fundo Comum de Reserva",
  EXTRAORDINARY_CHARGE: "Quota Extraordinária",
  OTHER: "Outro",
};

export const PAY_METHOD_LABELS = {
  transferencia: "Transferência",
  debito_direto: "Débito Direto",
  numerario: "Numerário",
  cheque: "Cheque",
  cartao: "Cartão",
  outro: "Outro",
};

export const CALC_METHOD_LABELS = {
  FIXED_AMOUNT: "Valor Fixo",
  PERMILAGE: "Permilagem",
  FRACTION_SPECIFIC: "Por Fração",
  MANUAL: "Manual",
};

export const AGING_LABELS = {
  current: "A vencer",
  "1-30": "1–30 dias",
  "31-60": "31–60 dias",
  "61-90": "61–90 dias",
  "91-180": "91–180 dias",
  "181-365": "181–365 dias",
  "365+": "+365 dias",
};
