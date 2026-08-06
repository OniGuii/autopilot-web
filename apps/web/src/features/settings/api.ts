import { apiRequest } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import type {
  CompanySettings,
  UpdateCompanySettingsInput,
} from "@/lib/api/types";

export function fetchCompanySettings() {
  return apiRequest<CompanySettings>(endpoints.settings.company);
}

export function updateCompanySettings(input: UpdateCompanySettingsInput) {
  return apiRequest<CompanySettings>(endpoints.settings.company, {
    method: "PATCH",
    body: input,
  });
}
