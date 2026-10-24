export type LocationRecord = {
  user_id: string;
  latitude: number;
  longitude: number;
  accuracy: number | null;
  updated_at: string;
  profiles: { display_name: string | null; sharing_enabled: boolean } | null;
};
