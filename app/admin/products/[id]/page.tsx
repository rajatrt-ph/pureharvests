import { ProductEditor } from "../ProductEditor";

export default async function AdminEditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <ProductEditor mode="edit" mongoId={id} />;
}
