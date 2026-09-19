import { PageHeader } from "./PageHeader";
import { EmptyState } from "./EmptyState";
import { Construction } from "lucide-react";

export default function ComingSoon({ title, subtitle }) {
  return (
    <div data-testid="coming-soon-page">
      <PageHeader title={title} subtitle={subtitle} />
      <EmptyState
        icon={Construction}
        title="Módulo em desenvolvimento"
        description="Esta funcionalidade faz parte de uma fase posterior do DOMVUS e estará disponível em breve."
        testid="coming-soon-empty"
      />
    </div>
  );
}
