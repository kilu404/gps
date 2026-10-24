import * as Location from "expo-location";
import * as TaskManager from "expo-task-manager";
import { supabase } from "./supabase";

export const LOCATION_TASK_NAME = "temu-background-location";

TaskManager.defineTask<{ locations: Location.LocationObject[] }>(
  LOCATION_TASK_NAME,
  async ({ data, error }) => {
    if (error) {
      console.error("Background location task failed:", error);
      return;
    }

    if (!supabase || !data?.locations?.length) return;

    const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
    if (sessionError) {
      console.error("Could not restore location sharing session:", sessionError);
      return;
    }

    let session = sessionData.session;
    if (
      session &&
      session.expires_at &&
      session.expires_at <= Math.floor(Date.now() / 1000) + 60
    ) {
      const { data, error: refreshError } = await supabase.auth.refreshSession();
      if (refreshError) {
        console.error("Could not refresh location sharing session:", refreshError);
        return;
      }
      session = data.session;
    }

    const userId = session?.user.id;
    if (!userId) return;

    const latest = data.locations[data.locations.length - 1];
    const { error: uploadError } = await supabase.from("locations").upsert(
      {
        user_id: userId,
        latitude: latest.coords.latitude,
        longitude: latest.coords.longitude,
        accuracy: latest.coords.accuracy,
      },
      { onConflict: "user_id" },
    );
    if (uploadError) {
      console.error("Could not upload shared location:", uploadError);
    }
  },
);
