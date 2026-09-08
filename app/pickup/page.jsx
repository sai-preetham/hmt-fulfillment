import { AppShell } from '@/components/app-shell';
import { OrderFilters } from '@/components/order-table';
import { PickupWorkspace } from '@/components/pickup-location-groups';
import { getDelhiveryPickupWorkspace } from '@/lib/crm/data';
import { matchesOpsSearch } from '@/lib/crm/order-search';

export default async function PickupPage({ searchParams }) {
  const query = (await searchParams)?.q || '';
  const workspace = await getDelhiveryPickupWorkspace();
  const filterShipments = shipments => (shipments || []).filter(shipment => matchesOpsSearch(shipment, query));
  const filtered = {
    ...workspace,
    needsPickup: (workspace.needsPickup || []).map(group => ({ ...group, shipments: filterShipments(group.shipments) })).filter(group => group.shipments.length),
    pickedUp: filterShipments(workspace.pickedUp),
    exceptions: filterShipments(workspace.exceptions)
  };
  return (
    <AppShell>
      <header className="pageHeader">
        <div>
          <p className="eyebrow">Pickup</p>
          <h1>Pickup operations</h1>
          <p className="muted">Live Delhivery AWB status separates shipments awaiting collection from shipments the carrier has already picked up.</p>
        </div>
      </header>
      <section className="panel">
        <OrderFilters query={query} action="/pickup" showStatus={false} showSource={false} />
      </section>
      <PickupWorkspace workspace={filtered} />
    </AppShell>
  );
}
