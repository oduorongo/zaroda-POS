import type { Metadata } from "next";
import SchoolPortal from "../../../components/school-portal";

export const metadata: Metadata = { title: "School ordering", robots: { index: false } };

export default async function SchoolPage(props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  return <SchoolPortal slug={params.slug} />;
}
