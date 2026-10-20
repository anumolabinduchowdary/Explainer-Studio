import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { connection } from "next/server";
import { ReportView } from "@/components/Report";
import { Shell } from "@/components/ui";
import { studioUrl } from "@/lib/config";
import { requestTime } from "@/lib/page";
import { SAMPLE_KINDS, sampleReport, type SampleKind } from "@/lib/samples";

export const metadata: Metadata = { title: "Sample report" };

const isKind = (value: string): value is SampleKind => (SAMPLE_KINDS as readonly string[]).includes(value);

export default async function SamplePage(props: PageProps<"/sample/[kind]">) {
  const { kind } = await props.params;
  if (!isKind(kind)) notFound();
  // Built at request time, so the sample's ages are counted from now.
  await connection();
  const now = requestTime();
  const report = sampleReport(kind, now);
  return (
    <Shell studioUrl={studioUrl()}>
      <p className="mb-4 text-sm">
        <Link href="/" className="font-semibold text-brand-strong underline-offset-2 hover:underline">
          ← Video Insights
        </Link>
        <span className="text-muted"> · Other sample: </span>
        <Link href={kind === "viral" ? "/sample/slow" : "/sample/viral"} className="font-semibold text-brand-strong underline-offset-2 hover:underline">
          {kind === "viral" ? "a video that isn't taking off" : "a video going viral"}
        </Link>
      </p>
      <ReportView report={report} now={now} sample />
    </Shell>
  );
}
