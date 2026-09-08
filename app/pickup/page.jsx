import { AppShell } from '@/components/app-shell';
import { OrderFilters } from '@/components/order-table';
import { PickupWorkspace } from '@/components/pickup-location-groups';
import { getPickupWorkspace } from '@/lib/crm/data';
import { matchesOpsSearch } from '@/lib/crm/order-search';

export default async function PickupPage({ searchParams }) {
  const query = (await searchParams)?.q || '';
  const workspace = await getPickupWorkspace();
  const filterShipments = shipments => (shipments || []).filter(shipment => matchesOpsSearch(shipment, query));
  const filtered = {
    ...workspace,
    needsPickup: (workspace.needsPickup || [])
      .map(group => ({ ...group, shipments: filterShipments(group.shipments) }))
      .filter(group => group.shipments.length),
    pickedUp: filterShipments(workspace.pickedUp),
    exceptions: filterShipments(workspace.exceptions)
  };
  const awaitingCount = filtered.needsPickup.reduce((total, group) => total + group.shipments.length, 0);
  return (
    <AppShell>
      <header className="pageHeader">
        <div>
          <p className="eyebrow">Pickup</p>
          <h1>Awaiting warehouse pickup</h1>
          <p className="muted">
            All carriers with an AWB that the courier has not collected yet ({awaitingCount} waiting).
            Wix Fulfilled is not the same as courier pickup — new bookings stay unfulfilled on Wix until pickup.
          </p>
        </div>
      </header>
      <section className="panel">
        <OrderFilters query={query} action="/pickup" showStatus={false} showSource={false} />
      </section>
      <PickupWorkspace workspace={filtered} />
    </AppShell>
  );
}
