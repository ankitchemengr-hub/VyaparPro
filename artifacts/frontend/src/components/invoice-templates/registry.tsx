// Central registry of all invoice templates. The template id is what gets stored
// in print_settings.defaultTemplate and selected per-print in invoice-detail.

import type { TemplateMeta } from "./types";
import { A5CompactTemplate } from "./A5CompactTemplate";
import { ClassicTemplate } from "./ClassicTemplate";
import { ModernTemplate } from "./ModernTemplate";
import { ProfessionalTemplate } from "./ProfessionalTemplate";
import { MinimalTemplate } from "./MinimalTemplate";

export const TEMPLATES: TemplateMeta[] = [
  {
    id: "a5-compact",
    name: "A5 Compact (Legacy)",
    description: "Original landscape bill — dense, fits an A5 sheet.",
    paper: "A5",
    orientation: "landscape",
    component: A5CompactTemplate,
  },
  {
    id: "modern-a4",
    name: "Modern",
    description: "On-brand amber header band, rounded cards. Recommended.",
    paper: "A4",
    orientation: "portrait",
    component: ModernTemplate,
  },
  {
    id: "modern-a5",
    name: "Modern",
    description: "On-brand amber header band, rounded cards.",
    paper: "A5",
    orientation: "portrait",
    component: ModernTemplate,
  },
  {
    id: "professional-a4",
    name: "Professional",
    description: "Corporate slate cards, clean rules. Great for GST B2B.",
    paper: "A4",
    orientation: "portrait",
    component: ProfessionalTemplate,
  },
  {
    id: "professional-a5",
    name: "Professional",
    description: "Corporate slate cards, clean rules.",
    paper: "A5",
    orientation: "portrait",
    component: ProfessionalTemplate,
  },
  {
    id: "classic-a4",
    name: "Classic",
    description: "Traditional fully-bordered tax invoice in neutral ink.",
    paper: "A4",
    orientation: "portrait",
    component: ClassicTemplate,
  },
  {
    id: "classic-a5",
    name: "Classic",
    description: "Traditional fully-bordered tax invoice.",
    paper: "A5",
    orientation: "portrait",
    component: ClassicTemplate,
  },
  {
    id: "minimal-a4",
    name: "Minimal",
    description: "Airy, typography-led layout with a single amber accent.",
    paper: "A4",
    orientation: "portrait",
    component: MinimalTemplate,
  },
  {
    id: "minimal-a5",
    name: "Minimal",
    description: "Airy, typography-led layout.",
    paper: "A5",
    orientation: "portrait",
    component: MinimalTemplate,
  },
];

export function getTemplate(id?: string | null): TemplateMeta {
  return TEMPLATES.find((t) => t.id === id) ?? TEMPLATES[0];
}
