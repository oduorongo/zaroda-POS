import { redirect } from "next/navigation";

const backoffice = (process.env.NEXT_PUBLIC_BACKOFFICE_URL ?? "").replace(/\/+$/, "");

/** The team portal moved to the back office; old links land there on the same page. */
export default function TeamMoved({ params }: { params: { rest?: string[] } }) {
  const path = `/team${params.rest?.length ? `/${params.rest.join("/")}` : ""}`;
  if (backoffice) redirect(`${backoffice}${path}`);
  return (
    <main className="mx-auto max-w-md space-y-3 p-8 text-center">
      <h1 className="text-xl font-bold">The team page has moved</h1>
      <p className="text-sm text-secondary-500">
        Team leaders and members now sign in on the back office, at <b>/team/login</b>.
      </p>
    </main>
  );
}
