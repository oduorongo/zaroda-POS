import type { Metadata } from "next";
import SchoolJoin from "../../../../components/school-join";
import { schoolPageMeta } from "../../../../lib/school-meta";

export async function generateMetadata(props: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  return schoolPageMeta((await props.params).slug, "join");
}

export default async function SchoolJoinPage(props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  return <SchoolJoin slug={params.slug} />;
}
