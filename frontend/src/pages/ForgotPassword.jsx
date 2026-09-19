import { useState } from "react";
import { Link } from "react-router-dom";
import { api, formatApiErrorDetail } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Building, Loader2, ArrowLeft, MailCheck } from "lucide-react";

export default function ForgotPassword() {
  const [email, setEmail] = useState("");
  const [done, setDone] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      await api.post("/auth/forgot-password", { email });
      setDone(true);
    } catch (err) {
      setError(formatApiErrorDetail(err.response?.data?.detail) || err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2">
          <div className="flex h-9 w-9 items-center justify-center rounded-sm bg-primary text-primary-foreground">
            <Building className="h-5 w-5" />
          </div>
          <span className="font-display text-2xl font-extrabold tracking-tight">DOMVUS</span>
        </div>
        {done ? (
          <div className="rounded-md border border-border bg-card p-6 text-center" data-testid="forgot-success">
            <MailCheck className="mx-auto mb-3 h-10 w-10 text-emerald-600" strokeWidth={1.5} />
            <h1 className="font-display text-lg font-bold">Verifique o seu email</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Se esse email estiver registado, enviámos um link de recuperação válido por 1 hora.
            </p>
          </div>
        ) : (
          <>
            <h1 className="font-display text-2xl font-bold tracking-tight">Recuperar palavra-passe</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Introduza o seu email e enviaremos um link de recuperação.
            </p>
            <form onSubmit={submit} className="mt-8 space-y-4" data-testid="forgot-form">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email</Label>
                <Input id="email" type="email" value={email} required
                  onChange={(e) => setEmail(e.target.value)} data-testid="forgot-email" />
              </div>
              {error && <p className="text-sm text-destructive">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading} data-testid="forgot-submit">
                {loading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Enviar link
              </Button>
            </form>
          </>
        )}
        <Link to="/login" className="mt-6 flex items-center justify-center gap-1 text-sm text-muted-foreground hover:text-foreground" data-testid="back-to-login">
          <ArrowLeft className="h-4 w-4" /> Voltar ao início de sessão
        </Link>
      </div>
    </div>
  );
}
