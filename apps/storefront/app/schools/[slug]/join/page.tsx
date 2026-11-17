import type { Metadata } from "next";
import SchoolJoin from "../../../../components/school-join";

export const metadata: Metadata = { title: "Join as a school", robots: { index: false } };

export default async function SchoolJoinPage(props: { params: Promise<{ slug: string }> }) {
  const params = await props.params;
  return <SchoolJoin slug={params.slug} />;
}
