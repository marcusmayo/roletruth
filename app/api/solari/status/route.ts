export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(
    { configured: Boolean(process.env.SOLARI_API_KEY) },
    {
      headers: {
        "cache-control": "no-store",
      },
    },
  );
}
