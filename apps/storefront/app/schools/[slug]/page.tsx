import type { Metadata } from "next";
import SchoolPortal from "../../../components/school-portal";

export const metadata: Metadata = { title: "School ordering", robots: { index: false } };

export default function SchoolPage({ params }: { params: { slug: string } }) {
  return <SchoolPortal slug={params.slug} />;
}
