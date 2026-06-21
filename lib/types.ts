export interface Session {
  id: string;
  title: string;
  description?: string;
  host_name: string;
  created_at: string;
  is_active: boolean;
  admin_token: string;
}

export interface Question {
  id: string;
  session_id: string;
  text: string;
  author_name?: string;
  author_emoji?: string;
  voter_id?: string;
  is_anonymous: boolean;
  votes: number;
  me_too_count: number;
  is_answered: boolean;
  satisfaction_up: number;
  satisfaction_down: number;
  created_at: string;
}
