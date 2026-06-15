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
  is_anonymous: boolean;
  votes: number;
  is_answered: boolean;
  created_at: string;
}
