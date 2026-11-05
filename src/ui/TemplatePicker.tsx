import { useState, type ReactNode } from "react";
import { openTemplateChoice, TEMPLATES, type TemplateId } from "./templates.js";

const ICONS: Record<TemplateId, ReactNode> = {
  budget: <svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="6.5" /><path d="M10 3.5v13M10 10h6.5" /></svg>,
  invoice: <svg viewBox="0 0 20 20"><path d="M5 2.5h7l3 3v12H5z" /><path d="M12 2.5v3h3M7.5 9h5M7.5 12h5M7.5 15h3" /></svg>,
  tasks: <svg viewBox="0 0 20 20"><path d="M3.5 5.5h13M3.5 10h13M3.5 14.5h13" /><path d="m2.4 5.5 .8.8 1.4-1.6" /><path d="m2.4 14.5 .8.8 1.4-1.6" /></svg>,
  gradebook: <svg viewBox="0 0 20 20"><path d="M3 3.5h5.5c.8 0 1.5.7 1.5 1.5v11c0-.8-.7-1.5-1.5-1.5H3z" /><path d="M17 3.5h-5.5c-.8 0-1.5.7-1.5 1.5v11c0-.8.7-1.5 1.5-1.5H17z" /></svg>,
};

export interface TemplatePickerViewProps {
  disabled: boolean;
  error: string | null;
  opening: TemplateId | null;
  onOpen(id: TemplateId): void;
}

export function TemplatePickerView({ disabled, error, opening, onOpen }: TemplatePickerViewProps) {
  return (
    <section className="ts-home-other ts-home-templates" aria-label="Start from a template">
      <h2 className="ts-home-other-title">Start from a template</h2>
      <div className="ts-home-other-list">
        {TEMPLATES.map((template) => (
          <div className="ts-home-other-row" key={template.id}>
            <span className="ts-home-other-icon" aria-hidden="true">{ICONS[template.id]}</span>
            <span className="ts-home-other-copy"><strong>{template.label}</strong><span>{template.description}</span></span>
            <button
              type="button"
              className="ts-button"
              aria-label={`Open ${template.label} template`}
              disabled={disabled}
              onClick={() => onOpen(template.id)}
            >{opening === template.id ? "Opening…" : "Open"}</button>
          </div>
        ))}
        {error ? <p className="ts-dialog-error" role="alert">{error}</p> : null}
      </div>
    </section>
  );
}

export function TemplatePicker({ disabled, onOpenTemplate }: {
  disabled: boolean;
  onOpenTemplate(id: TemplateId): Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const [opening, setOpening] = useState<TemplateId | null>(null);
  const open = async (id: TemplateId): Promise<void> => {
    if (opening !== null) return;
    setError(null);
    setOpening(id);
    const failure = await openTemplateChoice(id, onOpenTemplate);
    setOpening(null);
    setError(failure);
  };
  return <TemplatePickerView disabled={disabled || opening !== null} error={error} opening={opening} onOpen={(id) => void open(id)} />;
}
