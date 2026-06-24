import Link from 'next/link';
import {
  AlertTriangle,
  Boxes,
  CheckSquare,
  ClipboardList,
  Gauge,
  LogOut,
  MessageCircle,
  PackageCheck,
  Settings,
  Truck,
  Wrench
} from 'lucide-react';
import { WixAutoSync } from './wix-auto-sync';
import { SignOutButton } from './sign-out-button';

const nav = [
  ['/', 'Dashboard', Gauge],
  ['/orders', 'Orders', ClipboardList],
  ['/packing', 'Packing Queue', Boxes],
  ['/shipments', 'Shipment Booking', Truck],
  ['/pickup', 'Pickup Pending', PackageCheck],
  ['/installation', 'Installation', Wrench],
  ['/feedback', 'Feedback', MessageCircle],
  ['/tasks', 'Tasks', CheckSquare],
  ['/integration-errors', 'Integration Errors', AlertTriangle],
  ['/settings', 'Settings', Settings]
];

export function AppShell({ children }) {
  return (
    <div className="appShell">
      <WixAutoSync />
      <aside className="sidebar">
        <div className="brandBlock">
          <strong>Hold My Throttle</strong>
          <span>Operations CRM</span>
        </div>
        <nav className="navList" aria-label="CRM sections">
          {nav.map(([href, label, Icon]) => (
            <Link href={href} className="navItem" key={href}>
              <Icon size={17} aria-hidden="true" />
              <span>{label}</span>
            </Link>
          ))}
        </nav>
        <SignOutButton />
      </aside>
      <main className="content">{children}</main>
    </div>
  );
}
