import { connection } from "next/server";
import Studio from "@/components/Studio";

export default async function Home() {
  // Read at request time so the page reflects the server's current settings.
  await connection();
  // Only a yes/no ever reaches the browser, never the key itself.
  const hasServerKey = Boolean(process.env.OPENAI_API_KEY?.trim());
  return <Studio hasServerKey={hasServerKey} />;
}
