import { NotFoundMessage } from "@/components/not-found-message";

// notFound() inside the app routes, e.g. a course that isn't yours (PLAN §4: another user's resource is a 404).
export default function AppNotFound() {
  return <NotFoundMessage />;
}
