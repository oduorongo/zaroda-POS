import { redirect } from "next/navigation";

// The ZARODA Team app: its own address when set (NEXT_PUBLIC_TEAM_URL), else the back office that serves it.
const teamApp = (process.env.NEXT_PUBLIC_TEAM_URL || process.env.NEXT_PUBLIC_BACKOFFICE_URL || "").replace(/\/+$/, "");

/** The team portal moved to the ZARODA Team app; old links land there on the same page. */
export default function TeamMoved({ params }: { params: { rest?: string[] } }) {
  const path = `/team${params.rest?.length ? `/${params.rest.join("/")}` : ""}`;
  if (teamApp) redirect(`${teamApp}${path}`);
  return (
    <main className="mx-auto max-w-md space-y-3 p-8 text-center">
      <h1 className="text-xl font-bold">The team page has moved</h1>
      <p className="text-sm text-secondary-500">
        Team leaders and members now use the ZARODA Team app: sign in at <b>/team/login</b> on the back office.
      </p>
    </main>
  );
}
