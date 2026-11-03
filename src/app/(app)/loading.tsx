import { Spinner } from "@/components/ui";

export default function AppLoading() {
  return (
    <div className="flex flex-1 items-center justify-center py-16 text-muted">
      <Spinner label="Loading…" className="size-6" />
    </div>
  );
}
