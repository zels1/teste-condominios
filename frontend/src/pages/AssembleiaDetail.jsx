import { useParams, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, formatApiErrorDetail } from "@/lib/api";
import { formatDate } from "@/lib/format";
import { useAuth } from "@/context/AuthContext";
import { StatusBadge } from "@/components/shared/StatusBadge";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { useState } from "react";
import { ArrowLeft, Users, Gavel, CheckCircle2, XCircle, MinusCircle, Loader2, Vote } from "lucide-react";

const VOTE_META = {
  favor: { label: "A favor", cls: "bg-emerald-600 hover:bg-emerald-700", bar: "bg-emerald-500", text: "text-emerald-700" },
  contra: { label: "Contra", cls: "bg-rose-600 hover:bg-rose-700", bar: "bg-rose-500", text: "text-rose-700" },
  abstencao: { label: "Abstenção", cls: "bg-slate-500 hover:bg-slate-600", bar: "bg-slate-400", text: "text-slate-600" },
};
const RESULT_LABEL = { approved: "Aprovado", rejected: "Rejeitado", tie: "Empate", pending: "Sem votos" };

function VoteButtons({ current, onVote, pending, testidPrefix }) {
  return (
    <div className="flex flex-wrap gap-2">
      {Object.entries(VOTE_META).map(([key, m]) => (
        <Button
          key={key}
          size="sm"
          variant={current === key ? "default" : "outline"}
          className={current === key ? `${m.cls} text-white` : ""}
          disabled={pending}
          onClick={() => onVote(key)}
          data-testid={`${testidPrefix}-${key}`}
        >
          {m.label}
        </Button>
      ))}
    </div>
  );
}

function TallyBar({ item, base }) {
  const denom = base === "present" ? item.favor_pct_present + item.contra_pct_present : null;
  const rows = [
    ["favor", item.votes.favor, base === "present" ? item.favor_pct_present : item.favor_pct_total],
    ["contra", item.votes.contra, base === "present" ? item.contra_pct_present : item.contra_pct_total],
    ["abstencao", item.votes.abstencao, null],
  ];
  return (
    <div className="space-y-2">
      {rows.map(([key, perm, pct]) => {
        const m = VOTE_META[key];
        const width = pct != null ? Math.min(100, pct) : 0;
        return (
          <div key={key} className="flex items-center gap-3 text-xs">
            <span className={`w-20 shrink-0 font-medium ${m.text}`}>{m.label}</span>
            <div className="relative h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
              <div className={`absolute inset-y-0 left-0 ${m.bar}`} style={{ width: `${width}%` }} />
            </div>
            <span className="w-28 shrink-0 text-right tabular-nums text-muted-foreground">
              {perm.toFixed(1)}‰{pct != null ? ` · ${pct}%` : ""}
            </span>
          </div>
        );
      })}
      {denom != null && <p className="pt-0.5 text-[11px] text-muted-foreground">Percentagens sobre o capital presente</p>}
    </div>
  );
}

export default function AssembleiaDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { isStaff } = useAuth();
  const [voteBase, setVoteBase] = useState("present");
  const [staffFraction, setStaffFraction] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["assembly", id],
    queryFn: () => api.get(`/ops/assemblies/${id}`).then((r) => r.data),
  });
  const { data: condoFractions = [] } = useQuery({
    queryKey: ["assembly-fractions", data?.condominium_id],
    queryFn: () => api.get("/fractions", { params: { condominium_id: data.condominium_id } }).then((r) => r.data),
    enabled: isStaff && !!data?.condominium_id,
  });

  const applyDetail = (r) => qc.setQueryData(["assembly", id], r.data);

  const vote = useMutation({
    mutationFn: (p) => api.post(`/ops/assemblies/${id}/vote`, p),
    onSuccess: (r) => { applyDetail(r); toast.success("Voto registado."); },
    onError: (e) => toast.error(formatApiErrorDetail(e.response?.data?.detail)),
  });
  const setCall = useMutation({
    mutationFn: (call) => api.put(`/ops/assemblies/${id}`, { active_call: call }),
    onSuccess: (r) => { applyDetail(r); toast.success("Convocatória atualizada."); },
    onError: (e) => toast.error(formatApiErrorDetail(e.response?.data?.detail)),
  });
  const addAttendee = useMutation({
    mutationFn: (p) => api.post(`/ops/assemblies/${id}/attendees`, p),
    onSuccess: (r) => { applyDetail(r); toast.success("Presença registada."); },
    onError: (e) => toast.error(formatApiErrorDetail(e.response?.data?.detail)),
  });

  if (isLoading || !data) {
    return <div className="flex h-64 items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }
  const q = data.quorum;

  const markPresence = (fid) => {
    const f = condoFractions.find((x) => x.id === fid);
    addAttendee.mutate({ owner_id: f?.owner_id || "", fraction_id: fid, attendance_type: "present" });
  };

  return (
    <div data-testid="assembleia-detail-page" className="space-y-6">
      <button onClick={() => nav("/assembleias")} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground" data-testid="assembly-back">
        <ArrowLeft className="h-4 w-4" /> Voltar às assembleias
      </button>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">{data.condominium_name || "Assembleia"}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {formatDate(data.date)} · {data.time || "—"}{data.second_call_time ? ` (2ª: ${data.second_call_time})` : ""} · {data.assembly_type === "ordinary" ? "Ordinária" : "Extraordinária"} · {data.location || "Sem local"}
          </p>
        </div>
        <StatusBadge status={data.status || "scheduled"} />
      </div>

      {/* Quorum */}
      <Card className="border-border p-5 shadow-none" data-testid="assembly-quorum-card">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="flex items-center gap-2 font-display text-sm font-semibold"><Users className="h-4 w-4 text-muted-foreground" /> Quórum</h3>
          <div className="flex items-center gap-2">
            {isStaff && (
              <div className="flex overflow-hidden rounded-md border border-border">
                {[1, 2].map((c) => (
                  <button
                    key={c}
                    onClick={() => setCall.mutate(c)}
                    disabled={setCall.isPending}
                    data-testid={`assembly-call-${c}`}
                    className={`px-3 py-1 text-xs font-medium ${q.active_call === c ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted"}`}
                  >
                    {c}ª convocatória
                  </button>
                ))}
              </div>
            )}
            {!isStaff && <span className="text-xs text-muted-foreground">{q.active_call}ª convocatória</span>}
            <span data-testid="assembly-quorum-status" className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold ${q.quorum_met ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"}`}>
              {q.quorum_met ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
              {q.quorum_met ? "Quórum atingido" : "Quórum não atingido"}
            </span>
          </div>
        </div>
        <Progress value={Math.min(100, q.present_pct)} className="h-3" data-testid="assembly-quorum-bar" />
        <div className="mt-3 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
          <div><p className="text-xs text-muted-foreground">Capital presente</p><p className="font-display text-lg font-bold tabular-nums">{q.present_permillage.toFixed(1)}‰</p></div>
          <div><p className="text-xs text-muted-foreground">Capital total</p><p className="font-display text-lg font-bold tabular-nums">{q.total_permillage.toFixed(1)}‰</p></div>
          <div><p className="text-xs text-muted-foreground">% presente</p><p className="font-display text-lg font-bold tabular-nums">{q.present_pct}%</p></div>
          <div><p className="text-xs text-muted-foreground">Frações presentes</p><p className="font-display text-lg font-bold tabular-nums">{q.present_fractions}/{q.total_fractions}</p></div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          {q.active_call === 1
            ? "1ª convocatória: exige maioria do capital total (> 500‰) presente ou representado."
            : "2ª convocatória: delibera com qualquer capital presente."}
        </p>
      </Card>

      {/* Staff attendance */}
      {isStaff && (
        <Card className="border-border p-5 shadow-none" data-testid="assembly-attendance-card">
          <h3 className="mb-3 flex items-center gap-2 font-display text-sm font-semibold"><Users className="h-4 w-4 text-muted-foreground" /> Presenças</h3>
          <div className="mb-4 flex flex-wrap items-end gap-2">
            <div className="min-w-[240px] flex-1">
              <Select value={staffFraction} onValueChange={setStaffFraction}>
                <SelectTrigger data-testid="attendee-fraction-select"><SelectValue placeholder="Selecionar fração" /></SelectTrigger>
                <SelectContent>
                  {condoFractions.map((f) => <SelectItem key={f.id} value={f.id}>{f.identifier} · {f.owner_name} · {f.permillage || 0}‰</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <Button disabled={!staffFraction || addAttendee.isPending} onClick={() => { markPresence(staffFraction); setStaffFraction(""); }} data-testid="attendee-add-btn">
              {addAttendee.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null} Marcar presente
            </Button>
          </div>
          {data.attendees.length === 0 ? (
            <p className="text-sm text-muted-foreground">Ainda sem presenças registadas.</p>
          ) : (
            <div className="divide-y divide-border">
              {data.attendees.map((at) => (
                <div key={at.id} className="flex items-center justify-between py-2 text-sm" data-testid={`attendee-${at.fraction_id}`}>
                  <span>{at.owner_name || "—"}</span>
                  <span className="flex items-center gap-3 text-muted-foreground">
                    <span className="tabular-nums">{(at.permillage || 0).toFixed(1)}‰</span>
                    <StatusBadge status={at.attendance_type === "represented" ? "confirmado" : "ativo"} label={at.attendance_type === "represented" ? "Representado" : "Presente"} />
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      )}

      {/* Agenda + voting */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="flex items-center gap-2 font-display text-base font-semibold"><Gavel className="h-4 w-4 text-muted-foreground" /> Ordem de trabalhos</h3>
          <div className="flex overflow-hidden rounded-md border border-border text-xs">
            {[["present", "% presentes"], ["total", "% capital total"]].map(([k, l]) => (
              <button key={k} onClick={() => setVoteBase(k)} className={`px-2.5 py-1 font-medium ${voteBase === k ? "bg-primary text-primary-foreground" : "bg-card text-muted-foreground hover:bg-muted"}`} data-testid={`vote-base-${k}`}>{l}</button>
            ))}
          </div>
        </div>

        {data.agenda.map((it) => (
          <Card key={it.number} className="border-border p-5 shadow-none" data-testid={`agenda-item-${it.number}`}>
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-semibold">{it.number}. {it.title}</p>
                {it.description && <p className="mt-0.5 text-sm text-muted-foreground">{it.description}</p>}
              </div>
              <span data-testid={`agenda-result-${it.number}`} className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-semibold ${it.result === "approved" ? "bg-emerald-100 text-emerald-800" : it.result === "rejected" ? "bg-rose-100 text-rose-800" : "bg-slate-100 text-slate-700"}`}>
                {it.result === "approved" ? <CheckCircle2 className="h-3.5 w-3.5" /> : it.result === "rejected" ? <XCircle className="h-3.5 w-3.5" /> : <MinusCircle className="h-3.5 w-3.5" />}
                {RESULT_LABEL[it.result]}
              </span>
            </div>

            <div className="mt-4"><TallyBar item={it} base={voteBase} /></div>

            {/* Owner voting */}
            {!isStaff && (data.my_fractions || []).length > 0 && (
              <div className="mt-4 space-y-2 border-t border-border pt-4">
                {data.my_fractions.map((f) => (
                  <div key={f.id} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="flex items-center gap-2 text-sm"><Vote className="h-4 w-4 text-muted-foreground" /> Fração {f.identifier} ({f.permillage}‰)</span>
                    <VoteButtons
                      current={data.my_votes?.[`${it.number}:${f.id}`]}
                      pending={vote.isPending}
                      onVote={(v) => vote.mutate({ agenda_number: it.number, fraction_id: f.id, vote: v })}
                      testidPrefix={`owner-vote-${it.number}`}
                    />
                  </div>
                ))}
              </div>
            )}

            {/* Staff voting on behalf */}
            {isStaff && (
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-border pt-4">
                <StaffVoteRow item={it} fractions={condoFractions} vote={vote} />
              </div>
            )}
          </Card>
        ))}
      </div>
    </div>
  );
}

function StaffVoteRow({ item, fractions, vote }) {
  const [fid, setFid] = useState("");
  return (
    <>
      <div className="min-w-[220px] flex-1">
        <Select value={fid} onValueChange={setFid}>
          <SelectTrigger data-testid={`staff-vote-fraction-${item.number}`}><SelectValue placeholder="Fração para votar" /></SelectTrigger>
          <SelectContent>
            {fractions.map((f) => <SelectItem key={f.id} value={f.id}>{f.identifier} · {f.owner_name} · {f.permillage || 0}‰</SelectItem>)}
          </SelectContent>
        </Select>
      </div>
      <VoteButtons
        current={null}
        pending={vote.isPending || !fid}
        onVote={(v) => fid && vote.mutate({ agenda_number: item.number, fraction_id: fid, vote: v })}
        testidPrefix={`staff-vote-${item.number}`}
      />
    </>
  );
}
