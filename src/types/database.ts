export type GroupType = 'lead_stage' | 'customer_segment' | 'archive';
export type PaymentStatus = 'pending' | 'paid' | 'refunded';
export type ProjectStatus = 'active' | 'done' | 'on_hold';
export type NoteType = 'call' | 'email' | 'meeting' | 'note';

export interface Group {
  id: string;
  name: string;
  sort_order: number;
  type: GroupType;
  created_at: string;
}

export interface Person {
  id: string;
  full_name: string;
  phone: string | null;
  email: string | null;
  source: string | null;
  group_id: string | null;
  score_1_3: number | null;
  whatsapp_response: string | null;
  employment_status: string | null;
  lead_idea: string | null;
  seller: string | null;
  campaign: string | null;
  ad_name: string | null;
  total_contracts: number | null;
  status: string | null;
  lead_status: string | null;
  external_source_id: string | null;
  sheet_datetime: string | null;
  created_at: string;
  updated_at: string;
}

export interface Purchase {
  id: string;
  person_id: string;
  service_id: string | null;
  price: number | null;
  sale_date: string | null;
  payment_method: string | null;
  installment_plan: string | null;
  payment_status: PaymentStatus | null;
  project_status: ProjectStatus | null;
  created_at: string;
}

export interface Note {
  id: string;
  person_id: string;
  type: NoteType | null;
  content: string;
  created_by: string | null;
  created_by_name: string | null;
  created_at: string;
}

// Joined types for UI
export interface PersonWithGroup extends Person {
  groups: Group | null;
}
