import { apiRequest } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import type { LeadNote } from "@/lib/api/types";

export function listLeadNotes(leadId: string) {
  return apiRequest<LeadNote[]>(endpoints.leads.notes(leadId));
}

export function createLeadNote(leadId: string, body: string) {
  return apiRequest<LeadNote>(endpoints.leads.notes(leadId), {
    method: "POST",
    body: { body },
  });
}

export function updateLeadNote(leadId: string, noteId: string, body: string) {
  return apiRequest<LeadNote>(endpoints.leads.note(leadId, noteId), {
    method: "PATCH",
    body: { body },
  });
}

export function deleteLeadNote(leadId: string, noteId: string) {
  return apiRequest<void>(endpoints.leads.note(leadId, noteId), {
    method: "DELETE",
  });
}
