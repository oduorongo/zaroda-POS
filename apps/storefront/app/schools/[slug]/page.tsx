import type { Metadata } from "next";
import SchoolPortal from "../../../components/school-portal";
import { schoolPageMeta } from "../../../lib/school-meta";

export async function generateMetadata(props: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  return schoolPageMeta((await props.params).slug, "signin");
}

export default async function SchoolPage(props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  return <SchoolPortal slug={params.slug} />;
}
