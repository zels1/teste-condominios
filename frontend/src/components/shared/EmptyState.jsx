export function EmptyState({ icon: Icon, title, description, action, testid }) {
  return (
    <div
      className="flex flex-col items-center justify-center rounded-md border border-dashed border-border bg-card px-6 py-16 text-center"
      data-testid={testid}
    >
      {Icon && <Icon className="mb-4 h-10 w-10 text-muted-foreground" strokeWidth={1.5} />}
      <h3 className="font-display text-base font-semibold text-foreground">{title}</h3>
      {description && (
        <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
