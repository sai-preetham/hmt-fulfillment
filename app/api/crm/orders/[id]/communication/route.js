import { redirect } from 'next/navigation';
import { sendCommunication } from '@/lib/crm/data';

export async function POST(request, { params }) {
  const { id } = await params;
  const form = await request.formData();
  await sendCommunication(id, form.get('type'));
  redirect(`/orders/${id}`);
}
