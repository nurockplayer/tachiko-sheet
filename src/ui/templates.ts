/** Home templates: labelled entries for committed work files under /templates/. */
export type TemplateId = "budget" | "invoice" | "tasks" | "gradebook";

export interface TemplateSummary {
  id: TemplateId;
  label: string;
  description: string;
}

export const TEMPLATES: readonly TemplateSummary[] = [
  {
    id: "budget",
    label: "Budget",
    description: "Planned and actual spending by category, with what is left.",
  },
  {
    id: "invoice",
    label: "Invoice",
    description: "Items, quantities and prices with calculated amounts.",
  },
  {
    id: "tasks",
    label: "Task tracker",
    description: "Tasks with owner, due date, status and priority.",
  },
  {
    id: "gradebook",
    label: "Gradebook",
    description: "Student scores with a calculated average.",
  },
];

export function templateLabel(id: TemplateId): string {
  return TEMPLATES.find((template) => template.id === id)?.label ?? id;
}

/** Await one open and return the message to show, or null when it succeeded. */
export async function openTemplateChoice(
  id: TemplateId,
  open: (id: TemplateId) => Promise<void>,
): Promise<string | null> {
  try {
    await open(id);
    return null;
  } catch (error) {
    return error instanceof Error && error.message.length > 0
      ? error.message
      : "The template could not be opened.";
  }
}
