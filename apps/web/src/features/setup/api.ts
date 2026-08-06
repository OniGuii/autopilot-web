import { apiRequest } from "@/lib/api/client";
import { endpoints } from "@/lib/api/endpoints";
import type {
  CreateSetupCompanyInput,
  CreateSetupCompanyResponse,
  SetupStatus,
} from "@/lib/api/types";

export function fetchSetupStatus() {
  return apiRequest<SetupStatus>(endpoints.setup.status);
}

export function createSetupCompany(input: CreateSetupCompanyInput) {
  return apiRequest<CreateSetupCompanyResponse>(endpoints.setup.company, {
    method: "POST",
    body: input,
  });
}
