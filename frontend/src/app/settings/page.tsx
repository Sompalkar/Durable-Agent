import type { Metadata } from "next";
import { SettingsView } from "@/components/settings/SettingsView";

export const metadata: Metadata = { title: "Settings · Durable Agent" };

export default function SettingsPage() {
  return <SettingsView />;
}
