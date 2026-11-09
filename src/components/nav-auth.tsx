"use client";
// The signed-in or signed-out end of the top nav. The session comes from Better Auth's client, so
// it updates as soon as someone signs in or out.
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { signOut as defaultSignOut } from "@/components/auth/auth-actions";
import { Button, cn, focusRing } from "@/components/ui";
import { authClient } from "@/lib/auth-client";

// min-h-11: at least 44 px tall, easy to tap on a phone (T32).
export const navLink = cn(
  "inline-flex min-h-11 items-center rounded-md px-3 py-2 text-sm font-medium hover:bg-surface",
  focusRing,
);

interface NavAuthProps {
  /** Tests pass a stand-in. Returns a message when signing out fails. */
  signOut?: () => Promise<string | undefined>;
}

export function NavAuth({ signOut = defaultSignOut }: NavAuthProps) {
  const router = useRouter();
  const { data: session, isPending } = authClient.useSession();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<string>();
  const busy = useRef(false);

  async function handleSignOut() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setMessage(undefined);
    const failed = await signOut();
    busy.current = false;
    setPending(false);
    if (failed) {
      setMessage(failed);
      return;
    }
    router.replace("/login");
    router.refresh();
  }

  // Nothing until the session is known, so the wrong links never flash.
  if (isPending) return null;

  if (session)
    return (
      <>
        {message && (
          <li role="status" className="text-sm text-danger">
            {message}
          </li>
        )}
        <li>
          <Button
            variant="secondary"
            loading={pending}
            onClick={() => void handleSignOut()}
          >
            Sign out
          </Button>
        </li>
      </>
    );

  return (
    <>
      <li>
        <Link href="/login" className={navLink}>
          Log in
        </Link>
      </li>
      <li>
        <Link
          href="/signup"
          className={cn(
            navLink,
            "bg-primary text-primary-foreground hover:bg-primary hover:opacity-90",
          )}
        >
          Sign up
        </Link>
      </li>
    </>
  );
}
